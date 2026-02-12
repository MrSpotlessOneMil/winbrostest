/**
 * Route Optimization Engine
 *
 * Takes all jobs for a given date and active teams, produces optimized
 * job-to-team assignments with ordering and traffic-aware ETAs.
 *
 * Algorithm:
 * 1. Load teams + jobs
 * 2. Geocode addresses
 * 3. Build pairwise distance matrix via Google Maps
 * 4. Assign jobs to nearest team (greedy nearest-insertion)
 * 5. Optimize stop order per team (2-opt local search)
 * 6. Calculate ETAs with traffic-aware travel times
 * 7. Run feasibility checks
 */

import { getSupabaseServiceClient } from './supabase'
import { batchGeocodeAddresses, getPairwiseDistanceMatrix } from './google-maps'

// ── Types ──────────────────────────────────────────────────────

export interface TeamForRouting {
  id: number
  name: string
  leadId: number
  leadName: string
  leadTelegramId?: string
  homeLat: number
  homeLng: number
  maxJobsPerDay: number
  members: Array<{
    id: number
    name: string
    telegramId?: string
    role: string
  }>
}

export interface JobForRouting {
  id: number
  address: string
  lat?: number
  lng?: number
  date: string
  scheduledAt?: string
  serviceType?: string
  price?: number
  hours?: number
  customerName?: string
  customerPhone?: string
  teamId?: number | null
  notes?: string
}

export interface OptimizedStop {
  jobId: number
  order: number
  estimatedArrival: string       // "9:00 AM"
  estimatedDeparture: string     // "11:00 AM"
  arrivalWindow: string          // "9:00 - 9:30 AM"
  driveTimeMinutes: number       // from previous stop
  jobDurationMinutes: number
  address: string
  customerName?: string
  customerPhone?: string
  serviceType?: string
}

export interface OptimizedRoute {
  teamId: number
  teamName: string
  leadId: number
  leadTelegramId?: string
  stops: OptimizedStop[]
  totalDriveTimeMinutes: number
  totalJobTimeMinutes: number
  totalRevenueEstimate: number
  firstDepartureTime: string
  lastCompletionTime: string
}

export interface OptimizationResult {
  date: string
  routes: OptimizedRoute[]
  unassignedJobs: Array<{ jobId: number; reason: string }>
  warnings: string[]
  stats: {
    totalJobs: number
    assignedJobs: number
    totalTeams: number
    activeTeams: number
    totalDriveMinutes: number
    totalRevenueEstimate: number
    generatedAt: string
  }
}

interface OptimizeOptions {
  startTimeDefault?: string   // "08:00" (24hr)
  maxJobsPerTeam?: number     // default 6
  maxDriveMinutes?: number    // default 50
  dailyTargetRevenue?: number // default 1200
}

// ── Main Entry Point ───────────────────────────────────────────

/**
 * Optimize routes for all jobs on a given date.
 */
export async function optimizeRoutesForDate(
  date: string,
  tenantId: string,
  options?: OptimizeOptions
): Promise<OptimizationResult> {
  const startTime = options?.startTimeDefault ?? '08:00'
  const maxJobs = options?.maxJobsPerTeam ?? 6
  const maxDrive = options?.maxDriveMinutes ?? 50
  const dailyTarget = options?.dailyTargetRevenue ?? 1200

  console.log(`[RouteOptimizer] Optimizing routes for ${date}, tenant ${tenantId}`)

  // 1. Load teams and jobs
  const { teams, skippedWarnings } = await loadTeamsWithLocations(tenantId)
  const jobs = await loadJobsForDate(date, tenantId)

  if (teams.length === 0) {
    return buildEmptyResult(date, jobs, 0, [
      'No active teams with home locations found',
      ...skippedWarnings,
    ])
  }

  if (jobs.length === 0) {
    return buildEmptyResult(date, [], teams.length, ['No jobs found for this date', ...skippedWarnings])
  }

  console.log(`[RouteOptimizer] Found ${teams.length} teams and ${jobs.length} jobs`)

  // 2. Geocode job addresses missing coordinates
  const needsGeocode = jobs.filter(j => j.lat == null || j.lng == null)
  if (needsGeocode.length > 0) {
    console.log(`[RouteOptimizer] Geocoding ${needsGeocode.length} job addresses`)
    const geocoded = await batchGeocodeAddresses(needsGeocode.map(j => j.address))
    for (const job of needsGeocode) {
      const result = geocoded.get(job.address)
      if (result) {
        job.lat = result.lat
        job.lng = result.lng
      }
    }
  }

  // Separate geocodeable jobs from failures
  const routableJobs = jobs.filter(j => j.lat != null && j.lng != null)
  const unroutableJobs = jobs.filter(j => j.lat == null || j.lng == null)
  const unassigned: Array<{ jobId: number; reason: string }> = unroutableJobs.map(j => ({
    jobId: j.id,
    reason: `Could not geocode address: ${j.address}`,
  }))

  if (routableJobs.length === 0) {
    return buildEmptyResult(date, jobs, teams.length, ['All job addresses failed geocoding'], unassigned)
  }

  // 3. Build pairwise distance matrix (team homes + job locations)
  const allLocations: Array<{ id: string; address: string; lat?: number; lng?: number }> = []

  // Add team home locations first (prefixed with "team_")
  for (const team of teams) {
    allLocations.push({
      id: `team_${team.id}`,
      address: '',
      lat: team.homeLat,
      lng: team.homeLng,
    })
  }

  // Add job locations (prefixed with "job_")
  for (const job of routableJobs) {
    allLocations.push({
      id: `job_${job.id}`,
      address: job.address,
      lat: job.lat,
      lng: job.lng,
    })
  }

  console.log(`[RouteOptimizer] Building distance matrix for ${allLocations.length} locations`)
  const { matrix, locationIds } = await getPairwiseDistanceMatrix(allLocations)

  // 4. Assign jobs to teams
  const { assignments, unassigned: assignmentFailures } = assignJobsToTeams(
    routableJobs,
    teams,
    matrix,
    locationIds,
    { maxJobsPerTeam: maxJobs, maxDriveMinutes: maxDrive }
  )
  unassigned.push(...assignmentFailures)

  // 5. Optimize stop order per team + calculate ETAs
  const routes: OptimizedRoute[] = []
  const jobMap = new Map(routableJobs.map(j => [j.id, j]))

  for (const team of teams) {
    const teamJobIds = assignments.get(team.id) || []
    if (teamJobIds.length === 0) continue

    const teamLocId = `team_${team.id}`

    // Optimize order with 2-opt
    const optimizedOrder = optimizeStopOrder(
      teamJobIds.map(id => `job_${id}`),
      teamLocId,
      matrix,
      locationIds
    )

    // Calculate ETAs
    const stops = calculateETAs(
      optimizedOrder,
      teamLocId,
      startTime,
      jobMap,
      matrix,
      locationIds
    )

    const totalDrive = stops.reduce((sum, s) => sum + s.driveTimeMinutes, 0)
    const totalJobTime = stops.reduce((sum, s) => sum + s.jobDurationMinutes, 0)
    const totalRevenue = stops.reduce((sum, s) => {
      const job = jobMap.get(s.jobId)
      return sum + (job?.price || 0)
    }, 0)

    routes.push({
      teamId: team.id,
      teamName: team.name,
      leadId: team.leadId,
      leadTelegramId: team.leadTelegramId,
      stops,
      totalDriveTimeMinutes: totalDrive,
      totalJobTimeMinutes: totalJobTime,
      totalRevenueEstimate: totalRevenue,
      firstDepartureTime: startTime,
      lastCompletionTime: stops.length > 0 ? stops[stops.length - 1].estimatedDeparture : startTime,
    })
  }

  // 6. Feasibility checks
  const warnings = [
    ...skippedWarnings,
    ...runFeasibilityChecks(routes, { maxDriveMinutes: maxDrive, dailyTargetRevenue: dailyTarget }),
  ]

  const totalAssigned = routes.reduce((sum, r) => sum + r.stops.length, 0)
  const totalDriveAll = routes.reduce((sum, r) => sum + r.totalDriveTimeMinutes, 0)
  const totalRevAll = routes.reduce((sum, r) => sum + r.totalRevenueEstimate, 0)

  console.log(`[RouteOptimizer] Done: ${totalAssigned} jobs assigned to ${routes.length} teams, ${unassigned.length} unassigned`)

  return {
    date,
    routes,
    unassignedJobs: unassigned,
    warnings,
    stats: {
      totalJobs: jobs.length,
      assignedJobs: totalAssigned,
      totalTeams: teams.length,
      activeTeams: routes.length,
      totalDriveMinutes: totalDriveAll,
      totalRevenueEstimate: totalRevAll,
      generatedAt: new Date().toISOString(),
    },
  }
}

// ── Data Loaders ───────────────────────────────────────────────

/**
 * Load active teams with their lead's home location.
 */
async function loadTeamsWithLocations(tenantId: string): Promise<{
  teams: TeamForRouting[]
  skippedWarnings: string[]
}> {
  const client = getSupabaseServiceClient()

  const { data, error } = await client
    .from('teams')
    .select('id, name, active, team_members ( id, role, is_active, cleaner_id, cleaners ( id, name, phone, telegram_id, is_team_lead, home_lat, home_lng, max_jobs_per_day, active ) )')
    .eq('tenant_id', tenantId)
    .eq('active', true)

  if (error || !data) {
    console.error('[RouteOptimizer] Failed to load teams:', error)
    return { teams: [], skippedWarnings: ['Failed to load teams from database'] }
  }

  const teams: TeamForRouting[] = []
  const skippedWarnings: string[] = []

  for (const team of data) {
    const members = (team.team_members || []) as any[]
    const leadMember = members.find((m: any) => m.role === 'lead' && m.is_active && m.cleaners?.active)

    if (!leadMember?.cleaners) {
      const msg = `Team "${team.name}" has no active lead assigned — skipped from routing`
      console.warn(`[RouteOptimizer] ${msg}`)
      skippedWarnings.push(msg)
      continue
    }

    const lead = leadMember.cleaners
    if (lead.home_lat == null || lead.home_lng == null) {
      const msg = `Team "${team.name}" lead "${lead.name}" has no home coordinates — skipped from routing. Update home address in cleaner settings.`
      console.warn(`[RouteOptimizer] ${msg}`)
      skippedWarnings.push(msg)
      continue
    }

    if (!lead.telegram_id) {
      skippedWarnings.push(`Team "${team.name}" lead "${lead.name}" has no Telegram ID — route will be optimized but team lead won't receive Telegram notification`)
    }

    teams.push({
      id: team.id,
      name: team.name,
      leadId: lead.id,
      leadName: lead.name,
      leadTelegramId: lead.telegram_id || undefined,
      homeLat: Number(lead.home_lat),
      homeLng: Number(lead.home_lng),
      maxJobsPerDay: lead.max_jobs_per_day || 6,
      members: members
        .filter((m: any) => m.is_active && m.cleaners?.active)
        .map((m: any) => ({
          id: m.cleaners.id,
          name: m.cleaners.name,
          telegramId: m.cleaners.telegram_id || undefined,
          role: m.role,
        })),
    })
  }

  return { teams, skippedWarnings }
}

/**
 * Load jobs for the date that need routing.
 */
async function loadJobsForDate(date: string, tenantId: string): Promise<JobForRouting[]> {
  const client = getSupabaseServiceClient()

  const { data, error } = await client
    .from('jobs')
    .select('id, address, date, scheduled_at, service_type, price, hours, notes, team_id, phone_number, customers ( first_name, last_name, phone_number )')
    .eq('tenant_id', tenantId)
    .eq('date', date)
    .neq('status', 'cancelled')
    .order('scheduled_at', { ascending: true })

  if (error || !data) {
    console.error('[RouteOptimizer] Failed to load jobs:', error)
    return []
  }

  return data.map((row: any) => {
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers
    const customerName = customer
      ? [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim()
      : undefined

    return {
      id: row.id,
      address: row.address || '',
      date: row.date,
      scheduledAt: row.scheduled_at || undefined,
      serviceType: row.service_type || undefined,
      price: row.price ? Number(row.price) : undefined,
      hours: row.hours ? Number(row.hours) : undefined,
      customerName: customerName || undefined,
      customerPhone: customer?.phone_number || row.phone_number || undefined,
      teamId: row.team_id ?? null,
      notes: row.notes || undefined,
    }
  })
}

// ── Assignment Algorithm ───────────────────────────────────────

/**
 * Assign jobs to teams using greedy nearest-insertion.
 *
 * For each job: find the team whose current last stop (or home) is nearest.
 * If team has capacity and drive time is within limits, assign it.
 */
function assignJobsToTeams(
  jobs: JobForRouting[],
  teams: TeamForRouting[],
  matrix: number[][],
  locationIds: string[],
  options: { maxJobsPerTeam: number; maxDriveMinutes: number }
): {
  assignments: Map<number, number[]>
  unassigned: Array<{ jobId: number; reason: string }>
} {
  const assignments = new Map<number, number[]>()
  const unassigned: Array<{ jobId: number; reason: string }> = []

  // Track each team's current tail (last assigned job, or home)
  const teamTail = new Map<number, string>()
  for (const team of teams) {
    assignments.set(team.id, [])
    teamTail.set(team.id, `team_${team.id}`)
  }

  // Helper: get distance from locationId A to B
  function getDuration(fromId: string, toId: string): number {
    const fromIdx = locationIds.indexOf(fromId)
    const toIdx = locationIds.indexOf(toId)
    if (fromIdx === -1 || toIdx === -1) return 9999
    return matrix[fromIdx][toIdx]
  }

  // Sort jobs: pre-assigned first, then by latitude (north→south sweep)
  const sortedJobs = [...jobs].sort((a, b) => {
    // Pre-assigned jobs first
    if (a.teamId && !b.teamId) return -1
    if (!a.teamId && b.teamId) return 1
    // Then by latitude descending (north first)
    return (b.lat || 0) - (a.lat || 0)
  })

  for (const job of sortedJobs) {
    const jobLocId = `job_${job.id}`
    if (!locationIds.includes(jobLocId)) {
      unassigned.push({ jobId: job.id, reason: 'Location not in distance matrix' })
      continue
    }

    // If job has a pre-assignment, try to honor it
    if (job.teamId) {
      const teamJobs = assignments.get(job.teamId)
      if (teamJobs && teamJobs.length < options.maxJobsPerTeam) {
        teamJobs.push(job.id)
        teamTail.set(job.teamId, jobLocId)
        continue
      }
      // If pre-assigned team is full, fall through to find best team
    }

    // Find the nearest team with capacity
    let bestTeam: TeamForRouting | null = null
    let bestDuration = Infinity

    for (const team of teams) {
      const teamJobs = assignments.get(team.id) || []
      if (teamJobs.length >= options.maxJobsPerTeam) continue

      const tailId = teamTail.get(team.id)!
      const duration = getDuration(tailId, jobLocId)

      if (duration < bestDuration) {
        bestDuration = duration
        bestTeam = team
      }
    }

    if (!bestTeam) {
      unassigned.push({ jobId: job.id, reason: 'All teams at capacity' })
      continue
    }

    if (bestDuration > options.maxDriveMinutes) {
      // Still assign but it will show up as a warning
      console.warn(`[RouteOptimizer] Job ${job.id} is ${bestDuration} min from nearest team (limit: ${options.maxDriveMinutes})`)
    }

    const teamJobs = assignments.get(bestTeam.id)!
    teamJobs.push(job.id)
    teamTail.set(bestTeam.id, jobLocId)
  }

  return { assignments, unassigned }
}

// ── 2-Opt Route Optimization ───────────────────────────────────

/**
 * Optimize stop order using 2-opt local search.
 * Starting point is the team lead's home.
 */
function optimizeStopOrder(
  stopIds: string[],
  startId: string,
  matrix: number[][],
  locationIds: string[]
): string[] {
  if (stopIds.length <= 2) return stopIds

  function getDuration(fromId: string, toId: string): number {
    const fromIdx = locationIds.indexOf(fromId)
    const toIdx = locationIds.indexOf(toId)
    if (fromIdx === -1 || toIdx === -1) return 9999
    return matrix[fromIdx][toIdx]
  }

  function routeCost(route: string[]): number {
    let cost = getDuration(startId, route[0])
    for (let i = 1; i < route.length; i++) {
      cost += getDuration(route[i - 1], route[i])
    }
    return cost
  }

  let bestRoute = [...stopIds]
  let bestCost = routeCost(bestRoute)
  let improved = true
  let iterations = 0

  while (improved && iterations < 100) {
    improved = false
    iterations++

    for (let i = 0; i < bestRoute.length - 1; i++) {
      for (let j = i + 1; j < bestRoute.length; j++) {
        // Reverse the segment between i and j
        const newRoute = [...bestRoute]
        const segment = newRoute.splice(i, j - i + 1)
        segment.reverse()
        newRoute.splice(i, 0, ...segment)

        const newCost = routeCost(newRoute)
        if (newCost < bestCost) {
          bestRoute = newRoute
          bestCost = newCost
          improved = true
        }
      }
    }
  }

  return bestRoute
}

// ── ETA Calculation ────────────────────────────────────────────

/**
 * Calculate ETAs for each stop, accounting for drive time + job duration.
 */
function calculateETAs(
  stopIds: string[],
  startId: string,
  startTime: string,
  jobMap: Map<number, JobForRouting>,
  matrix: number[][],
  locationIds: string[]
): OptimizedStop[] {
  function getDuration(fromId: string, toId: string): number {
    const fromIdx = locationIds.indexOf(fromId)
    const toIdx = locationIds.indexOf(toId)
    if (fromIdx === -1 || toIdx === -1) return 30
    return matrix[fromIdx][toIdx]
  }

  function extractJobId(locId: string): number {
    return parseInt(locId.replace('job_', ''), 10)
  }

  // Parse start time as minutes since midnight
  const [startH, startM] = startTime.split(':').map(Number)
  let currentMinutes = startH * 60 + startM
  let previousLocId = startId

  const stops: OptimizedStop[] = []

  for (let i = 0; i < stopIds.length; i++) {
    const locId = stopIds[i]
    const jobId = extractJobId(locId)
    const job = jobMap.get(jobId)

    const driveTime = getDuration(previousLocId, locId)
    const arrivalMinutes = currentMinutes + driveTime
    const jobDuration = job?.hours ? Math.round(job.hours * 60) : 120
    const departureMinutes = arrivalMinutes + jobDuration

    stops.push({
      jobId,
      order: i + 1,
      estimatedArrival: formatTime(arrivalMinutes),
      estimatedDeparture: formatTime(departureMinutes),
      arrivalWindow: `${formatTime(arrivalMinutes)} - ${formatTime(arrivalMinutes + 30)}`,
      driveTimeMinutes: driveTime,
      jobDurationMinutes: jobDuration,
      address: job?.address || '',
      customerName: job?.customerName,
      customerPhone: job?.customerPhone,
      serviceType: job?.serviceType,
    })

    currentMinutes = departureMinutes
    previousLocId = locId
  }

  return stops
}

// ── Feasibility Checks ─────────────────────────────────────────

function runFeasibilityChecks(
  routes: OptimizedRoute[],
  options: { maxDriveMinutes: number; dailyTargetRevenue: number }
): string[] {
  const warnings: string[] = []

  for (const route of routes) {
    // Check individual drive legs
    for (const stop of route.stops) {
      if (stop.driveTimeMinutes > options.maxDriveMinutes) {
        warnings.push(
          `Team "${route.teamName}" stop #${stop.order} (${stop.address}) has ${stop.driveTimeMinutes}min drive (limit: ${options.maxDriveMinutes}min)`
        )
      }
    }

    // Check daily revenue target
    if (route.totalRevenueEstimate > 0 && route.totalRevenueEstimate < options.dailyTargetRevenue) {
      warnings.push(
        `Team "${route.teamName}" estimated revenue $${route.totalRevenueEstimate} is below $${options.dailyTargetRevenue} target`
      )
    }

    // Check total drive time
    if (route.totalDriveTimeMinutes > options.maxDriveMinutes * route.stops.length) {
      warnings.push(
        `Team "${route.teamName}" total drive time ${route.totalDriveTimeMinutes}min seems excessive for ${route.stops.length} stops`
      )
    }
  }

  return warnings
}

// ── Helpers ────────────────────────────────────────────────────

function formatTime(minutesSinceMidnight: number): string {
  const h = Math.floor(minutesSinceMidnight / 60) % 24
  const m = minutesSinceMidnight % 60
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function buildEmptyResult(
  date: string,
  jobs: JobForRouting[],
  teamCount: number,
  warnings: string[],
  unassigned?: Array<{ jobId: number; reason: string }>
): OptimizationResult {
  return {
    date,
    routes: [],
    unassignedJobs: unassigned || jobs.map(j => ({ jobId: j.id, reason: warnings[0] || 'Unknown' })),
    warnings,
    stats: {
      totalJobs: jobs.length,
      assignedJobs: 0,
      totalTeams: teamCount,
      activeTeams: 0,
      totalDriveMinutes: 0,
      totalRevenueEstimate: 0,
      generatedAt: new Date().toISOString(),
    },
  }
}
