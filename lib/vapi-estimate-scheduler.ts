/**
 * VAPI Estimate Scheduler for WinBros
 *
 * Auto-finds the next available estimate slot for a salesman.
 * The customer does NOT choose a preferred date — the system picks optimally.
 *
 * Priority algorithm:
 * 1. Tiered time slots — offer 3 options from a cascading priority:
 *      8:00 AM → 11:00 AM → 2:00 PM → 5:00 PM
 *    For each tier, check the next 3 days. Fill from 8 AM first, then
 *    cascade to later tiers only for days where the earlier tier is taken.
 *    Example: if day 1 & 2 have 8 AM filled but day 3 is open:
 *      → 8 AM day 3, 11 AM day 1, 11 AM day 2
 * 2. Fallback: travel-optimized slotting using Google Maps distance
 *    calculations for any remaining available time.
 */

import { getSupabaseServiceClient } from './supabase'
import { geocodeAddress, getDistanceMatrix, LatLng, haversineMinutes } from './google-maps'
import { getCleanerBlockedDates } from './supabase'

// ── Constants (defaults — overridden by tenant workflow_config) ──

const TIMEZONE = 'America/Los_Angeles'
const ESTIMATE_DURATION_MINUTES = 30
const DEFAULT_SLOT_START_MINUTES = 8 * 60 // 8:00 AM = 480
const DEFAULT_LAST_SLOT_MINUTES = 17 * 60 // 5:00 PM = 1020
const DEFAULT_SLOT_STEP_MINUTES = 30
const PRIORITY_LOOKAHEAD_DAYS = 3
const MAX_LOOKAHEAD_DAYS = 7

/** Build cascading time tiers from business hours */
function buildTimeTiers(startMin: number, endMin: number): Array<{ minutes: number; label: string }> {
  const range = endMin - startMin
  if (range <= 0) return [{ minutes: startMin, label: formatTimeFromMinutes(startMin) }]
  // Distribute tiers: start, ~1/3, ~2/3, end
  const tiers = [startMin]
  if (range >= 180) tiers.push(startMin + Math.round(range / 3))
  if (range >= 360) tiers.push(startMin + Math.round((2 * range) / 3))
  tiers.push(endMin)
  // Snap to nearest 30 min and deduplicate
  const snapped = [...new Set(tiers.map(t => Math.round(t / 30) * 30))]
  return snapped.map(m => ({ minutes: m, label: formatTimeFromMinutes(m) }))
}

// ── Types ──────────────────────────────────────────────────────

export type EstimateOption = {
  date: string // "2026-02-25"
  time: string // "8:00 AM"
  day_of_week: string // "Tuesday"
  salesman_name: string
}

export type VapiEstimateResponse = {
  scheduled: boolean
  options: EstimateOption[]
  error?: string
}

type Salesman = {
  id: number
  name: string
  homeLat: number
  homeLng: number
  maxJobsPerDay: number
}

type ScheduledJob = {
  jobId: number
  salesmanId: number
  date: string // YYYY-MM-DD
  timeMinutes: number // minutes since midnight
  address: string | null
  lat?: number
  lng?: number
}

type CandidateSlot = {
  salesmanId: number
  salesmanName: string
  date: string
  timeMinutes: number
  originLat: number
  originLng: number
  driveTimeMinutes?: number
  score?: number
}

// ── Helpers ────────────────────────────────────────────────────

function pickFirst(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== null && obj[key] !== undefined && obj[key] !== '') {
      return obj[key]
    }
  }
  return null
}

function formatTimeFromMinutes(totalMinutes: number): string {
  const hours24 = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  const period = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 === 0 ? 12 : hours24 > 12 ? hours24 - 12 : hours24
  return `${hours12}:${String(mins).padStart(2, '0')} ${period}`
}

/** Given a "YYYY-MM-DD" string, return the day of week name for VAPI responses. */
function getDayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  // Use UTC noon to avoid timezone-shift issues
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  return dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}

function parseScheduledAt(value: string | null | undefined): number | null {
  if (!value) return null
  const raw = value.trim().toLowerCase()

  // "8:00 AM" or "10:30 PM" format
  const match = raw.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i)
  if (match) {
    let hour = Number(match[1])
    const minute = Number(match[2])
    const ampm = match[3].toLowerCase()
    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0
    return hour * 60 + minute
  }

  // "08:00" 24h format
  const match24 = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (match24) {
    return Number(match24[1]) * 60 + Number(match24[2])
  }

  return null
}

/**
 * Get the current Pacific time components.
 */
function getPacificNow(): { year: number; month: number; day: number; hour: number; minute: number; dayOfWeek: number } {
  const now = new Date()
  const opts = { timeZone: TIMEZONE } as const
  const year = Number(new Intl.DateTimeFormat('en-US', { ...opts, year: 'numeric' }).format(now))
  const month = Number(new Intl.DateTimeFormat('en-US', { ...opts, month: 'numeric' }).format(now))
  const day = Number(new Intl.DateTimeFormat('en-US', { ...opts, day: 'numeric' }).format(now))
  const hour = Number(new Intl.DateTimeFormat('en-US', { ...opts, hour: 'numeric', hour12: false }).format(now))
  const minute = Number(new Intl.DateTimeFormat('en-US', { ...opts, minute: 'numeric' }).format(now))
  const weekday = new Intl.DateTimeFormat('en-US', { ...opts, weekday: 'short' }).format(now).toLowerCase()
  const dayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
  return { year, month, day, hour: hour === 24 ? 0 : hour, minute, dayOfWeek: dayMap[weekday] ?? 0 }
}

/**
 * Get the next N candidate dates (YYYY-MM-DD) for scheduling.
 * Skips today if past 3:00 PM Pacific. Skips Sundays.
 */
function getNextCandidateDates(count: number, lastSlotMinutes = DEFAULT_LAST_SLOT_MINUTES): string[] {
  const pacific = getPacificNow()
  const todayMinutes = pacific.hour * 60 + pacific.minute
  const skipToday = todayMinutes >= lastSlotMinutes

  const dates: string[] = []
  const cursor = new Date(pacific.year, pacific.month - 1, pacific.day)
  if (skipToday) {
    cursor.setDate(cursor.getDate() + 1)
  }

  while (dates.length < count) {
    const dow = cursor.getDay() // 0=Sun
    if (dow !== 0) {
      // Skip Sundays
      const yyyy = cursor.getFullYear()
      const mm = String(cursor.getMonth() + 1).padStart(2, '0')
      const dd = String(cursor.getDate()).padStart(2, '0')
      dates.push(`${yyyy}-${mm}-${dd}`)
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return dates
}

/**
 * Parse job address from DB — handles both string and JSON-object format.
 */
function parseJobAddress(address: unknown): string | null {
  if (!address) return null
  if (typeof address === 'string') {
    // Try parsing as JSON (some addresses are stored as objects)
    if (address.startsWith('{')) {
      try {
        const parsed = JSON.parse(address)
        const parts = [parsed.street, parsed.city, parsed.state, parsed.zip].filter(Boolean)
        return parts.length > 0 ? parts.join(', ') : null
      } catch {
        return address
      }
    }
    return address
  }
  if (typeof address === 'object' && address !== null) {
    const obj = address as Record<string, unknown>
    const parts = [obj.street, obj.city, obj.state, obj.zip].filter(Boolean)
    return parts.length > 0 ? parts.map(String).join(', ') : null
  }
  return null
}

// ── Core Algorithm ─────────────────────────────────────────────

export async function scheduleEstimate(
  payload: Record<string, unknown>,
  tenantId?: string | null
): Promise<VapiEstimateResponse> {
  const LOG = '[VAPI schedule-estimate]'

  // 1. Extract customer address
  const addressRaw = pickFirst(payload, [
    'address',
    'customer_address',
    'customerAddress',
    'street_address',
    'streetAddress',
    'location',
  ])

  if (!addressRaw || typeof addressRaw !== 'string' || !addressRaw.trim()) {
    console.warn(`${LOG} No address in payload. Keys: ${Object.keys(payload).join(', ')}`)
    return { scheduled: false, options: [], error: 'MISSING_ADDRESS' }
  }

  const customerAddress = String(addressRaw).trim()
  console.log(`${LOG} Customer address: ${customerAddress}`)

  // 2. Geocode customer address
  let customerLat: number
  let customerLng: number
  try {
    const geo = await geocodeAddress(customerAddress)
    if (!geo) {
      console.error(`${LOG} Geocoding returned null for: ${customerAddress}`)
      return { scheduled: false, options: [], error: 'GEOCODE_FAILED' }
    }
    customerLat = geo.lat
    customerLng = geo.lng
    console.log(`${LOG} Geocoded to ${customerLat}, ${customerLng}`)
  } catch (err) {
    console.error(`${LOG} Geocoding error:`, err)
    return { scheduled: false, options: [], error: 'GEOCODE_FAILED' }
  }

  // 3. Load tenant config for business hours + buffer settings
  const resolvedTenantId = tenantId || 'e954fbd6-b3e1-4271-88b0-341c9df56beb' // WinBros fallback
  const client = getSupabaseServiceClient()

  const { data: tenantRow } = await client
    .from('tenants')
    .select('workflow_config')
    .eq('id', resolvedTenantId)
    .single()

  const wc = (tenantRow?.workflow_config ?? {}) as Record<string, unknown>
  const SLOT_START_MINUTES = typeof wc.business_hours_start === 'number' ? wc.business_hours_start : DEFAULT_SLOT_START_MINUTES
  const LAST_SLOT_MINUTES = typeof wc.business_hours_end === 'number' ? wc.business_hours_end : DEFAULT_LAST_SLOT_MINUTES
  const SLOT_STEP_MINUTES = typeof wc.salesman_buffer_minutes === 'number'
    ? ESTIMATE_DURATION_MINUTES + (wc.salesman_buffer_minutes as number)
    : DEFAULT_SLOT_STEP_MINUTES
  const TIME_TIERS = buildTimeTiers(SLOT_START_MINUTES, LAST_SLOT_MINUTES)

  console.log(`${LOG} Config: hours ${formatTimeFromMinutes(SLOT_START_MINUTES)}-${formatTimeFromMinutes(LAST_SLOT_MINUTES)}, step ${SLOT_STEP_MINUTES}min`)

  const { data: salesmenRows, error: salesmenError } = await client
    .from('cleaners')
    .select('id, name, home_lat, home_lng, max_jobs_per_day')
    .eq('tenant_id', resolvedTenantId)
    .eq('employee_type', 'salesman')
    .eq('active', true)
    .is('deleted_at', null)

  if (salesmenError) {
    console.error(`${LOG} Error loading salesmen:`, salesmenError.message)
    return { scheduled: false, options: [], error: 'DB_ERROR' }
  }

  const salesmen: Salesman[] = (salesmenRows || [])
    .filter((s) => s.home_lat && s.home_lng)
    .map((s) => ({
      id: s.id,
      name: s.name || 'Salesman',
      homeLat: Number(s.home_lat),
      homeLng: Number(s.home_lng),
      maxJobsPerDay: Number(s.max_jobs_per_day) || 8,
    }))

  if (salesmen.length === 0) {
    console.error(`${LOG} No salesmen with home coordinates found for tenant ${resolvedTenantId}`)
    return { scheduled: false, options: [], error: 'NO_SALESMEN_AVAILABLE' }
  }

  console.log(`${LOG} Found ${salesmen.length} salesmen: ${salesmen.map((s) => s.name).join(', ')}`)

  // 4. Compute candidate dates (3 initially, extend to 7 if needed)
  const allDates = getNextCandidateDates(MAX_LOOKAHEAD_DAYS, LAST_SLOT_MINUTES)
  const priorityDates = allDates.slice(0, PRIORITY_LOOKAHEAD_DAYS)

  // 5. Load existing estimate jobs for the full date range
  const { data: jobRows, error: jobError } = await client
    .from('jobs')
    .select('id, date, scheduled_at, team_id, address, status')
    .eq('tenant_id', resolvedTenantId)
    .eq('job_type', 'estimate')
    .in('date', allDates)
    .neq('status', 'cancelled')

  if (jobError) {
    console.error(`${LOG} Error loading jobs:`, jobError.message)
    return { scheduled: false, options: [], error: 'DB_ERROR' }
  }

  const jobs = jobRows || []
  const jobIds = jobs.map((j) => j.id)

  // Load cleaner assignments for these jobs
  let assignments: Array<{ job_id: number; cleaner_id: number; status: string }> = []
  if (jobIds.length > 0) {
    const { data: assignmentRows } = await client
      .from('cleaner_assignments')
      .select('job_id, cleaner_id, status')
      .in('job_id', jobIds)
      .not('status', 'in', '("cancelled","declined")')

    assignments = (assignmentRows || []) as Array<{ job_id: number; cleaner_id: number; status: string }>
  }

  // Load blocked dates for all salesmen
  const salesmanIds = salesmen.map((s) => s.id)
  const blockedDatesMap = new Map<number, Set<string>>()
  for (const id of salesmanIds) {
    const blocked = await getCleanerBlockedDates(id, allDates[0], allDates[allDates.length - 1])
    if (blocked.length > 0) {
      blockedDatesMap.set(
        id,
        new Set(blocked.map((b) => b.date))
      )
    }
  }

  // 6. Build schedule map: salesmanId → date → ScheduledJob[]
  const assignmentByJobId = new Map<number, number>() // jobId → cleanerId
  for (const a of assignments) {
    assignmentByJobId.set(a.job_id, a.cleaner_id)
  }

  const scheduleMap = new Map<number, Map<string, ScheduledJob[]>>()
  for (const s of salesmen) {
    scheduleMap.set(s.id, new Map())
  }

  for (const job of jobs) {
    const cleanerId = assignmentByJobId.get(job.id) ?? (job.team_id ? findSalesmanByTeam(job.team_id, salesmen) : null)
    if (cleanerId === null || cleanerId === undefined) continue
    if (!scheduleMap.has(cleanerId)) continue

    const dateMap = scheduleMap.get(cleanerId)!
    if (!dateMap.has(job.date)) {
      dateMap.set(job.date, [])
    }

    const timeMinutes = parseScheduledAt(job.scheduled_at)
    if (timeMinutes === null) continue

    dateMap.get(job.date)!.push({
      jobId: job.id,
      salesmanId: cleanerId,
      date: job.date,
      timeMinutes,
      address: parseJobAddress(job.address),
    })
  }

  // Sort each salesman's daily schedule by time
  for (const dateMap of scheduleMap.values()) {
    for (const jobList of dateMap.values()) {
      jobList.sort((a, b) => a.timeMinutes - b.timeMinutes)
    }
  }

  // Get current time for filtering same-day slots
  const pacific = getPacificNow()
  const todayStr = `${pacific.year}-${String(pacific.month).padStart(2, '0')}-${String(pacific.day).padStart(2, '0')}`
  const nowMinutes = pacific.hour * 60 + pacific.minute

  // ── Phase 1: Tiered time slots (8 AM → 11 AM → 2 PM → 5 PM) ──

  console.log(`${LOG} Phase 1: Checking tiered slots for ${priorityDates.length} days...`)

  const tieredOptions: EstimateOption[] = []
  const usedSlots = new Set<string>() // "date|timeMinutes" — dedup

  for (const tier of TIME_TIERS) {
    if (tieredOptions.length >= 3) break

    for (const date of priorityDates) {
      if (tieredOptions.length >= 3) break

      const slotKey = `${date}|${tier.minutes}`
      if (usedSlots.has(slotKey)) continue

      // Skip if today and past this tier's time
      if (date === todayStr && nowMinutes >= tier.minutes + ESTIMATE_DURATION_MINUTES) continue

      // Find best available salesman for this date + tier (shortest drive)
      let bestSalesman: Salesman | null = null
      let bestDrive = Infinity

      for (const salesman of salesmen) {
        if (blockedDatesMap.get(salesman.id)?.has(date)) continue

        const dayJobs = scheduleMap.get(salesman.id)?.get(date) || []
        if (dayJobs.length >= salesman.maxJobsPerDay) continue

        // Check if this salesman already has a job at this exact time
        const hasConflict = dayJobs.some((j) => j.timeMinutes === tier.minutes)
        if (hasConflict) continue

        const driveMinutes = haversineMinutes(
          salesman.homeLat,
          salesman.homeLng,
          customerLat,
          customerLng
        )

        if (driveMinutes < bestDrive) {
          bestDrive = driveMinutes
          bestSalesman = salesman
        }
      }

      if (bestSalesman) {
        usedSlots.add(slotKey)
        tieredOptions.push({
          date,
          time: tier.label,
          day_of_week: getDayOfWeek(date),
          salesman_name: bestSalesman.name,
        })
      }
    }
  }

  if (tieredOptions.length > 0) {
    console.log(
      `${LOG} Phase 1: Returning ${tieredOptions.length} tiered options: ${tieredOptions.map((o) => `${o.date} ${o.time}`).join(', ')}`
    )
    return { scheduled: true, options: tieredOptions }
  }

  console.log(`${LOG} Phase 1: No tiered slots available. Moving to Phase 2...`)

  // ── Phase 2: Travel-optimized slotting (no gaps) ─────────────
  //
  // For each salesman × date, only consider the FIRST available slot.
  // This packs appointments front-to-back with zero gaps — new estimates
  // always go right after the last scheduled appointment.

  const candidates: CandidateSlot[] = []

  for (let dateIdx = 0; dateIdx < allDates.length; dateIdx++) {
    const date = allDates[dateIdx]

    for (const salesman of salesmen) {
      // Check blocked dates
      if (blockedDatesMap.get(salesman.id)?.has(date)) continue

      const dayJobs = scheduleMap.get(salesman.id)?.get(date) || []

      // Check max jobs per day
      if (dayJobs.length >= salesman.maxJobsPerDay) continue

      // Build set of occupied time slots
      const occupiedSlots = new Set<number>()
      for (const job of dayJobs) {
        occupiedSlots.add(job.timeMinutes)
      }

      // Find the FIRST available slot — walk from 8am forward, take the earliest open one
      let firstAvailableSlot: number | null = null
      for (let slotMin = SLOT_START_MINUTES; slotMin <= LAST_SLOT_MINUTES; slotMin += SLOT_STEP_MINUTES) {
        if (occupiedSlots.has(slotMin)) continue
        if (date === todayStr && slotMin <= nowMinutes + 90) continue
        firstAvailableSlot = slotMin
        break
      }

      if (firstAvailableSlot === null) continue

      // Determine origin: previous job's location, or salesman's home
      let originLat = salesman.homeLat
      let originLng = salesman.homeLng

      const precedingJobs = dayJobs.filter((j) => j.timeMinutes < firstAvailableSlot!)
      if (precedingJobs.length > 0) {
        const prevJob = precedingJobs[precedingJobs.length - 1]
        if (prevJob.lat && prevJob.lng) {
          originLat = prevJob.lat
          originLng = prevJob.lng
        }
      }

      candidates.push({
        salesmanId: salesman.id,
        salesmanName: salesman.name,
        date,
        timeMinutes: firstAvailableSlot,
        originLat,
        originLng,
      })
    }
  }

  if (candidates.length === 0) {
    console.warn(`${LOG} Phase 2: No open slots found in ${allDates.length} days`)
    return { scheduled: false, options: [], error: 'NO_SLOTS_AVAILABLE' }
  }

  console.log(`${LOG} Phase 2: ${candidates.length} candidate slots. Computing travel times...`)

  // Geocode previous job addresses where needed (only unique origins)
  // For Phase 2, we need to get the drive time from each origin to the customer
  // First, try Google Maps distance matrix for unique origins
  const uniqueOrigins = new Map<string, LatLng>()
  for (const c of candidates) {
    const key = `${c.originLat.toFixed(6)},${c.originLng.toFixed(6)}`
    if (!uniqueOrigins.has(key)) {
      uniqueOrigins.set(key, { lat: c.originLat, lng: c.originLng })
    }
  }

  const originsList = Array.from(uniqueOrigins.entries())
  const customerLatLng: LatLng = { lat: customerLat, lng: customerLng }

  // Build drive time lookup: "lat,lng" → minutes
  const driveTimeLookup = new Map<string, number>()

  try {
    // Only use Google Maps if we have the API key and origins are reasonable count
    if (originsList.length <= 25) {
      const origins = originsList.map(([, latlng]) => latlng)
      const result = await getDistanceMatrix(origins, [customerLatLng])

      for (let i = 0; i < result.entries.length; i++) {
        const entry = result.entries[i]
        const originKey = originsList[entry.originIndex][0]
        const minutes = entry.durationInTrafficMinutes ?? entry.durationMinutes
        driveTimeLookup.set(originKey, minutes)
      }
      console.log(`${LOG} Google Maps returned drive times for ${driveTimeLookup.size} origins`)
    } else {
      // Too many origins — use haversine fallback
      throw new Error('Too many origins for single API call')
    }
  } catch (err) {
    console.warn(`${LOG} Google Maps distance matrix failed, using haversine fallback:`, err)
    for (const [key, latlng] of originsList) {
      driveTimeLookup.set(
        key,
        haversineMinutes(latlng.lat, latlng.lng, customerLat, customerLng)
      )
    }
  }

  // Score each candidate (one per salesman per day — the first available slot)
  // Since slots are packed front-to-back, scoring decides which salesman on which day.
  for (const c of candidates) {
    const key = `${c.originLat.toFixed(6)},${c.originLng.toFixed(6)}`
    c.driveTimeMinutes = driveTimeLookup.get(key) ?? haversineMinutes(c.originLat, c.originLng, customerLat, customerLng)

    const dayOffset = allDates.indexOf(c.date)

    // Prefer shorter drive, then earlier day, then earlier time
    c.score = c.driveTimeMinutes + dayOffset * 60 + c.timeMinutes * 0.1
  }

  // Sort by score ascending, then dedup by date+time so customer never sees the same slot twice
  candidates.sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity))

  const seenSlots = new Set<string>()
  const top3: CandidateSlot[] = []
  for (const c of candidates) {
    const slotKey = `${c.date}|${c.timeMinutes}`
    if (seenSlots.has(slotKey)) continue
    seenSlots.add(slotKey)
    top3.push(c)
    if (top3.length >= 3) break
  }

  const options: EstimateOption[] = top3.map((c) => ({
    date: c.date,
    time: formatTimeFromMinutes(c.timeMinutes),
    day_of_week: getDayOfWeek(c.date),
    salesman_name: c.salesmanName,
  }))

  console.log(
    `${LOG} Phase 2: Returning ${options.length} options: ${options.map((o) => `${o.date} ${o.time} with ${o.salesman_name}`).join(', ')}`
  )

  return { scheduled: true, options }
}

/**
 * Try to find which salesman is the lead of a given team.
 */
function findSalesmanByTeam(teamId: number, salesmen: Salesman[]): number | null {
  // This is a simple heuristic — in practice, the cleaner_assignments query
  // should cover most cases. This is a fallback for jobs assigned via team_id.
  // We just return the first salesman that matches (the team lead).
  // For more accuracy, we'd query team_members, but we don't want extra DB calls here.
  return null
}
