/**
 * VRP-based Cleaner Assignment
 *
 * Implements Vehicle Routing Problem (VRP) inspired cleaner assignment
 * using distance-based prioritization from cleaner home locations.
 */

import {
  getCleaners,
  getCleanerAvailability,
  getCleanerById,
  createCleanerAssignment,
  getCleanerAssignmentsForJob,
  getJobById,
  getCustomerByPhone,
  getSupabaseServiceClient,
  Cleaner,
  CleanerAssignment,
  Job,
} from './supabase'
import { notifyCleanerAssignment } from './cleaner-sms'
import { logSystemEvent } from './system-events'
import { getTenantById, getDefaultTenant, tenantUsesFeature } from './tenant'
import { maybeMarkBooked } from './maybe-mark-booked'
<<<<<<< HEAD
=======
import { scheduleTask } from './scheduler'
>>>>>>> Test

// Extended Cleaner type with location data (now included in base Cleaner interface)
export type CleanerWithLocation = Cleaner

// Earth's radius in miles
const EARTH_RADIUS_MILES = 3958.8

/**
 * Calculate distance between two lat/lng points using Haversine formula
 * @param lat1 Latitude of point 1
 * @param lng1 Longitude of point 1
 * @param lat2 Latitude of point 2
 * @param lng2 Longitude of point 2
 * @returns Distance in miles
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  // Convert degrees to radians
  const toRadians = (degrees: number) => degrees * (Math.PI / 180)

  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return EARTH_RADIUS_MILES * c
}

/**
 * Find best cleaners for a job, sorted by distance from their home location
 * Cleaners without location data are placed at the end of the list
 *
 * @param jobAddress Job address (for logging purposes)
 * @param jobLat Job location latitude
 * @param jobLng Job location longitude
 * @param jobDate Job date in YYYY-MM-DD format
 * @param jobTime Optional job time in HH:MM format
 * @param maxCandidates Maximum number of candidates to return (default 5)
 * @returns Array of cleaners with their distances, sorted by distance ascending
 */
export async function findBestCleaners(
  jobAddress: string,
  jobLat: number,
  jobLng: number,
  jobDate: string,
  jobTime?: string,
  maxCandidates: number = 5,
  tenantId?: string
): Promise<Array<{ cleaner: CleanerWithLocation; distance: number }>> {
  // Get available cleaners for the job date/time (scoped to tenant)
  const availableCleaners = (await getCleanerAvailability(
    jobDate,
    jobTime,
    tenantId
  )) as CleanerWithLocation[]

  if (availableCleaners.length === 0) {
    console.log(
      `[cleaner-assignment] No available cleaners for ${jobDate} ${jobTime || ''}`
    )
    return []
  }

  // Calculate distances and categorize cleaners
  const cleanersWithDistance: Array<{
    cleaner: CleanerWithLocation
    distance: number
  }> = []
  const cleanersWithoutLocation: Array<{
    cleaner: CleanerWithLocation
    distance: number
  }> = []

  for (const cleaner of availableCleaners) {
    if (
      cleaner.home_lat !== undefined &&
      cleaner.home_lat !== null &&
      cleaner.home_lng !== undefined &&
      cleaner.home_lng !== null
    ) {
      const distance = calculateDistance(
        cleaner.home_lat,
        cleaner.home_lng,
        jobLat,
        jobLng
      )
      // Skip if cleaner has a max distance and job is too far
      const maxDist = (cleaner as any).max_distance_miles
      if (maxDist != null && distance > Number(maxDist)) {
        console.log(`[cleaner-assignment] Skipping ${cleaner.name} — ${distance.toFixed(1)} mi exceeds max ${maxDist} mi`)
        continue
      }
      cleanersWithDistance.push({ cleaner, distance })
    } else {
      // Cleaners without location get a very large distance to sort them last
      cleanersWithoutLocation.push({ cleaner, distance: Infinity })
    }
  }

  // Sort cleaners: team leads first, then by distance (ascending)
  cleanersWithDistance.sort((a, b) => {
    // Team leads get priority
    const aIsLead = a.cleaner.is_team_lead ? 1 : 0
    const bIsLead = b.cleaner.is_team_lead ? 1 : 0
    if (bIsLead !== aIsLead) {
      return bIsLead - aIsLead // Team leads first
    }
    // Within same category, sort by distance
    return a.distance - b.distance
  })

  // Sort cleaners without location: team leads first
  cleanersWithoutLocation.sort((a, b) => {
    const aIsLead = a.cleaner.is_team_lead ? 1 : 0
    const bIsLead = b.cleaner.is_team_lead ? 1 : 0
    return bIsLead - aIsLead
  })

  // Combine: cleaners with location first, then those without
  const allCleaners = [...cleanersWithDistance, ...cleanersWithoutLocation]

  // Return top candidates
  const result = allCleaners.slice(0, maxCandidates)

  console.log(
    `[cleaner-assignment] Found ${result.length} candidates for job at ${jobAddress}`
  )

  return result
}

/**
 * Assign the next available cleaner for a job
 * Skips cleaners who have already been contacted or are in the exclude list
 *
 * @param jobId Job ID to assign
 * @param excludeCleanerIds Optional array of cleaner IDs to exclude
 * @returns Assignment result with success status and optional cleaner/assignment
 */
export async function assignNextAvailableCleaner(
  jobId: string,
  excludeCleanerIds: string[] = [],
  tenantId?: string
): Promise<{
  success: boolean
  cleaner?: CleanerWithLocation
  assignment?: CleanerAssignment
  exhausted?: boolean
}> {
  // Get the job details
  const job = await getJobById(jobId)
  if (!job) {
    console.error(`[cleaner-assignment] Job not found: ${jobId}`)
    return { success: false }
  }

  // Check if job has required fields
  if (!job.date) {
    console.error(`[cleaner-assignment] Job ${jobId} has no date`)
    return { success: false }
  }

  // Use job's tenant_id for scoping if not explicitly provided
  const effectiveTenantId = tenantId || (job as any).tenant_id || undefined

  // Get existing assignments to see who's already been contacted
  const existingAssignments = await getCleanerAssignmentsForJob(jobId)
  const alreadyContactedIds = new Set(
    existingAssignments.map((a) => a.cleaner_id)
  )

  // Combine with explicit excludes
  const excludeSet = new Set([
    ...excludeCleanerIds,
    ...Array.from(alreadyContactedIds),
  ])

  // Get all available cleaners for this job's date/time (scoped to tenant)
  const availableCleaners = (await getCleanerAvailability(
    job.date,
    job.scheduled_at || undefined,
    effectiveTenantId
  )) as CleanerWithLocation[]

  // Filter out excluded cleaners
  const eligibleCleaners = availableCleaners.filter(
    (c) => c.id && !excludeSet.has(c.id)
  )

  if (eligibleCleaners.length === 0) {
    console.log(
      `[cleaner-assignment] No more eligible cleaners for job ${jobId}`
    )
    return { success: false, exhausted: true }
  }

  // Sort by distance if job has lat/lng coordinates
  // Cast to access potential lat/lng fields (for future geocoding integration)
  const jobWithCoords = job as typeof job & { lat?: number; lng?: number }
  let selectedCleaner: CleanerWithLocation

  if (
    jobWithCoords.lat !== undefined &&
    jobWithCoords.lat !== null &&
    jobWithCoords.lng !== undefined &&
    jobWithCoords.lng !== null
  ) {
    // Sort eligible cleaners by team lead status, then distance from job location
    const cleanersWithDistance = eligibleCleaners
      .map((cleaner) => {
        if (
          cleaner.home_lat !== undefined &&
          cleaner.home_lat !== null &&
          cleaner.home_lng !== undefined &&
          cleaner.home_lng !== null
        ) {
          const distance = calculateDistance(
            cleaner.home_lat,
            cleaner.home_lng,
            jobWithCoords.lat!,
            jobWithCoords.lng!
          )
          return { cleaner, distance }
        }
        // Cleaners without location get placed at the end
        return { cleaner, distance: Infinity }
      })
      .sort((a, b) => {
        // Team leads get priority
        const aIsLead = a.cleaner.is_team_lead ? 1 : 0
        const bIsLead = b.cleaner.is_team_lead ? 1 : 0
        if (bIsLead !== aIsLead) {
          return bIsLead - aIsLead // Team leads first
        }
        // Within same category, sort by distance
        return a.distance - b.distance
      })

    selectedCleaner = cleanersWithDistance[0].cleaner
    const distanceInfo = cleanersWithDistance[0].distance === Infinity
      ? 'no location'
      : `${cleanersWithDistance[0].distance.toFixed(1)} mi`
    console.log(
      `[cleaner-assignment] Selected cleaner ${selectedCleaner.name} (${selectedCleaner.is_team_lead ? 'team lead, ' : ''}${distanceInfo})`
    )
  } else {
    // No job coordinates - prioritize team leads, then first available
    eligibleCleaners.sort((a, b) => {
      const aIsLead = a.is_team_lead ? 1 : 0
      const bIsLead = b.is_team_lead ? 1 : 0
      return bIsLead - aIsLead
    })
    selectedCleaner = eligibleCleaners[0]
  }

  if (!selectedCleaner.id) {
    console.error(`[cleaner-assignment] Selected cleaner has no ID`)
    return { success: false }
  }

  // Create the assignment
  const assignment = await createCleanerAssignment(jobId, selectedCleaner.id)
  if (!assignment) {
    console.error(
      `[cleaner-assignment] Failed to create assignment for cleaner ${selectedCleaner.id}`
    )
    return { success: false }
  }

  console.log(
    `[cleaner-assignment] Assigned cleaner ${selectedCleaner.name} (${selectedCleaner.id}) to job ${jobId}`
  )

  return {
    success: true,
    cleaner: selectedCleaner,
    assignment,
  }
}

/**
 * Trigger cleaner assignment for a job
 * Creates assignment and sends SMS notification to the cleaner
 *
 * @param jobId Job ID to trigger assignment for
 * @returns Result with success status and optional error message
 */
export async function triggerCleanerAssignment(
  jobId: string,
  excludeCleanerIds?: string[],
  modeOverride?: 'broadcast' | 'ranked' | 'distance'
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get the job details
    const job = await getJobById(jobId)
    if (!job) {
      return { success: false, error: `Job not found: ${jobId}` }
    }

    // Check if job is in a valid state for assignment
    if (job.status === 'completed' || job.status === 'cancelled') {
      return {
        success: false,
        error: `Job ${jobId} is ${job.status}, cannot assign cleaner`,
      }
    }

    // Check if job already has a pending/accepted/confirmed assignment
    const existingAssignments = await getCleanerAssignmentsForJob(jobId)
    const hasActiveAssignment = existingAssignments.some(
      (a) => a.status === 'pending' || a.status === 'accepted' || a.status === 'confirmed'
    )

    if (hasActiveAssignment) {
      const activeStatus = existingAssignments.find(
        (a) => a.status === 'pending' || a.status === 'accepted' || a.status === 'confirmed'
      )?.status
      return {
        success: false,
        error: `Job ${jobId} already has a ${activeStatus} cleaner assignment`,
      }
    }

    // Look up the correct tenant from job.tenant_id — NEVER fall back to a default tenant
    const jobTenantId = (job as any).tenant_id
    if (!jobTenantId) {
      console.error(`[cleaner-assignment] Job ${jobId} has no tenant_id — cannot assign. Skipping to prevent cross-tenant bleed.`)
      return { success: false, error: 'Job has no tenant_id' }
    }
    const tenant = await getTenantById(jobTenantId)

    // ──────────────────────────────────────────────────────────────────────
    // RECURRING PREFERRED CLEANER — runs before broadcast/routing split.
    // If this is a recurring child job, try to assign the same cleaner
    // who did the most recent completed sibling in the same series.
    // ──────────────────────────────────────────────────────────────────────
    const parentJobId = (job as any).parent_job_id
    if (parentJobId && tenant) {
      const preferredResult = await tryAssignPreferredCleaner(jobId, job, parentJobId, tenant)
      if (preferredResult?.success) {
        return preferredResult
      }
      // Preferred cleaner unavailable or not found - fall through to normal logic
    }

    // ──────────────────────────────────────────────────────────────────────
    // TENANT ISOLATION — THREE MUTUALLY EXCLUSIVE ASSIGNMENT MODES:
    //
    // BROADCAST (Cedar Rapids: assignment_mode='broadcast' or legacy use_broadcast_assignment=true):
    //   Notify ALL available cleaners at once. First to click "Available" wins.
    //   Multi-cleaner jobs: keep accepting until all slots filled.
    //   Customer SMS sent only after all slots filled.
    //
    // RANKED (assignment_mode='ranked'):
    //   Send to highest-ranked cleaner first. 20-min cascade on no response.
    //   Owner sets rank order via drag-and-drop on Teams page.
    //
    // DISTANCE ROUTING (WinBros default: assignment_mode='distance' or no mode set):
    //   Pick one cleaner at a time (closest first). Cascade on decline.
    //
    // Do NOT merge these code paths or add cross-dependencies between them.
    // ──────────────────────────────────────────────────────────────────────
    const assignmentMode = modeOverride
      || tenant?.workflow_config?.assignment_mode
      || (tenant && tenantUsesFeature(tenant, 'use_broadcast_assignment') ? 'broadcast' : 'distance')

    if (assignmentMode === 'ranked' && tenant) {
      console.log(`[cleaner-assignment] RANKED MODE for tenant ${tenant.slug}, job ${jobId}`)
      return await triggerRankedAssignment(jobId, job, tenant, excludeCleanerIds)
    }

    if (assignmentMode === 'broadcast' && tenant) {
      console.log(`[cleaner-assignment] BROADCAST MODE for tenant ${tenant.slug}, job ${jobId}`)
      return await triggerBroadcastAssignment(jobId, job, tenant)
    }

    // DISTANCE ROUTING (default): Pick one cleaner at a time based on distance
    console.log(`[cleaner-assignment] DISTANCE ROUTING MODE for tenant ${tenant?.slug || 'unknown'}, job ${jobId}`)
    const assignResult = await assignNextAvailableCleaner(jobId, excludeCleanerIds || [])

    if (!assignResult.success) {
      if (assignResult.exhausted) {
        await logSystemEvent({
          source: 'openphone',
          event_type: 'OWNER_ACTION_REQUIRED',
          message: `No more available cleaners for job ${jobId}`,
          job_id: jobId,
          phone_number: job.phone_number,
          metadata: {
            job_date: job.date,
            job_time: job.scheduled_at,
            reason: 'cleaner_assignment_exhausted',
          },
        })

        return {
          success: false,
          error: 'No available cleaners for this job',
        }
      }
      return { success: false, error: 'Failed to assign cleaner' }
    }

    const { cleaner, assignment } = assignResult

    if (!cleaner || !assignment) {
      return { success: false, error: 'Assignment created but missing data' }
    }

    // Get customer details for the notification
    const customer = job.phone_number
      ? await getCustomerByPhone(job.phone_number)
      : null

    // Send notification to the cleaner
    if (cleaner.phone && tenant) {
      const notifyResult = await notifyCleanerAssignment(
        tenant,
        cleaner,
        job,
        customer || undefined,
        assignment.id
      )

      if (!notifyResult.success) {
        console.error(
          `[cleaner-assignment] Failed to notify cleaner ${cleaner.name}: ${notifyResult.error}`
        )
      } else {
        console.log(
          `[cleaner-assignment] Sent notification to cleaner ${cleaner.name}`
        )
      }
    } else {
      console.warn(
        `[cleaner-assignment] Cleaner ${cleaner.name} has no phone number configured`
      )
    }

    await logSystemEvent({
      source: 'openphone',
      event_type: 'CLEANER_BROADCAST',
      message: `Assigned cleaner ${cleaner.name} to job ${jobId}`,
      job_id: jobId,
      phone_number: job.phone_number,
      cleaner_id: cleaner.id,
      metadata: {
        cleaner_name: cleaner.name,
        assignment_id: assignment.id,
        job_date: job.date,
        job_time: job.scheduled_at,
        notification_sent: !!cleaner.phone,
        mode: 'routing',
      },
    })

    // Cleaner assigned — check if payment also confirmed → mark booked
    await maybeMarkBooked(jobId)

    return { success: true }
  } catch (error) {
    console.error(`[cleaner-assignment] Error triggering assignment:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Broadcast assignment: send job to ALL available cleaners.
 * First one to click "Available" wins. Others get auto-cancelled.
 */
async function triggerBroadcastAssignment(
  jobId: string,
  job: Job,
  tenant: NonNullable<Awaited<ReturnType<typeof getTenantById>>>
): Promise<{ success: boolean; error?: string }> {
  const effectiveTenantId = (job as any).tenant_id || undefined

  // Get all available cleaners for this date/time
  const availableCleaners = await getCleanerAvailability(
    job.date || '',
    job.scheduled_at || undefined,
    effectiveTenantId
  )

  if (availableCleaners.length === 0) {
    await logSystemEvent({
      source: 'openphone',
      event_type: 'OWNER_ACTION_REQUIRED',
      message: `No available cleaners for job ${jobId} (broadcast)`,
      job_id: jobId,
      phone_number: job.phone_number,
      metadata: { job_date: job.date, job_time: job.scheduled_at, reason: 'no_cleaners_available', mode: 'broadcast' },
    })

    // Alert owner via SMS
    if (tenant.owner_phone) {
      const { sendSMS } = await import('./openphone')
      await sendSMS(
        tenant,
        tenant.owner_phone,
        `No Cleaners Available\n\nJob #${jobId} on ${job.date || 'TBD'} at ${job.scheduled_at || 'TBD'}\nAddress: ${job.address || 'N/A'}\n\nNo cleaners are available for this date. Manual assignment required.`
      )
    }

    return { success: false, error: 'No available cleaners for this job' }
  }

  const customer = job.phone_number ? await getCustomerByPhone(job.phone_number) : null
  let notifiedCount = 0

  // Create assignments and send notifications to ALL available cleaners
  for (const cleaner of availableCleaners) {
    if (!cleaner.id) continue

    const assignment = await createCleanerAssignment(jobId, cleaner.id)
    if (!assignment) {
      console.error(`[cleaner-assignment] Failed to create broadcast assignment for ${cleaner.name}`)
      continue
    }

    if (cleaner.phone) {
      const notifyResult = await notifyCleanerAssignment(
        tenant,
        cleaner,
        job,
        customer || undefined,
        assignment.id
      )

      if (notifyResult.success) {
        notifiedCount++
        console.log(`[cleaner-assignment] Broadcast: notified ${cleaner.name}`)
      } else {
        console.error(`[cleaner-assignment] Broadcast: failed to notify ${cleaner.name}: ${notifyResult.error}`)
      }
    }
  }

  await logSystemEvent({
    source: 'openphone',
    event_type: 'CLEANER_BROADCAST',
    message: `Broadcast job ${jobId} to ${availableCleaners.length} cleaners (${notifiedCount} notified)`,
    job_id: jobId,
    phone_number: job.phone_number,
    metadata: {
      job_date: job.date,
      job_time: job.scheduled_at,
      mode: 'broadcast',
      total_cleaners: availableCleaners.length,
      notified_count: notifiedCount,
      cleaner_names: availableCleaners.map(c => c.name),
    },
  })

  if (notifiedCount === 0) {
    return { success: false, error: 'Created assignments but failed to notify any cleaners' }
  }

  // Cleaner(s) assigned — check if payment also confirmed → mark booked
  await maybeMarkBooked(jobId)

<<<<<<< HEAD
=======
  return { success: true }
}

/**
 * Ranked assignment: send job to highest-ranked available cleaner.
 * If they don't respond in 20 minutes, auto-cascade to next ranked cleaner.
 * Owner sets rank order via drag-and-drop on Teams page.
 */
async function triggerRankedAssignment(
  jobId: string,
  job: Job,
  tenant: NonNullable<Awaited<ReturnType<typeof getTenantById>>>,
  excludeCleanerIds?: string[]
): Promise<{ success: boolean; error?: string }> {
  const effectiveTenantId = (job as any).tenant_id || undefined

  // Get all available cleaners for this date/time
  const availableCleaners = await getCleanerAvailability(
    job.date || '',
    job.scheduled_at || undefined,
    effectiveTenantId
  )

  if (availableCleaners.length === 0) {
    await logSystemEvent({
      source: 'openphone',
      event_type: 'OWNER_ACTION_REQUIRED',
      message: `No available cleaners for job ${jobId} (ranked)`,
      job_id: jobId,
      phone_number: job.phone_number,
      metadata: { job_date: job.date, job_time: job.scheduled_at, reason: 'no_cleaners_available', mode: 'ranked' },
    })

    if (tenant.owner_phone) {
      const { sendSMS } = await import('./openphone')
      await sendSMS(
        tenant,
        tenant.owner_phone,
        `No Cleaners Available\n\nJob #${jobId} on ${job.date || 'TBD'} at ${job.scheduled_at || 'TBD'}\nAddress: ${job.address || 'N/A'}\n\nNo cleaners are available for this date. Manual assignment required.`
      )
    }

    return { success: false, error: 'No available cleaners for this job' }
  }

  // Build exclude set from existing assignments + explicit excludes
  const existingAssignments = await getCleanerAssignmentsForJob(jobId)
  const alreadyContactedIds = new Set(existingAssignments.map(a => a.cleaner_id))
  const excludeSet = new Set([
    ...Array.from(alreadyContactedIds),
    ...(excludeCleanerIds || []),
  ])

  // Filter and sort by rank ascending (lower rank = better, nulls last)
  const eligible = availableCleaners
    .filter(c => c.id && !excludeSet.has(c.id))
    .sort((a, b) => {
      const aRank = (a as any).rank as number | null
      const bRank = (b as any).rank as number | null
      if (aRank == null && bRank == null) return 0
      if (aRank == null) return 1
      if (bRank == null) return -1
      return aRank - bRank
    })

  if (eligible.length === 0) {
    await logSystemEvent({
      source: 'openphone',
      event_type: 'OWNER_ACTION_REQUIRED',
      message: `All ranked cleaners exhausted for job ${jobId}`,
      job_id: jobId,
      phone_number: job.phone_number,
      metadata: { job_date: job.date, job_time: job.scheduled_at, reason: 'ranked_assignment_exhausted', mode: 'ranked' },
    })

    if (tenant.owner_phone) {
      const { sendSMS } = await import('./openphone')
      await sendSMS(
        tenant,
        tenant.owner_phone,
        `All Cleaners Declined/Unavailable\n\nJob #${jobId} on ${job.date || 'TBD'}\nAddress: ${job.address || 'N/A'}\n\nAll ranked cleaners have been contacted. Manual assignment required.`
      )
    }

    return { success: false, error: 'All ranked cleaners exhausted' }
  }

  // Pick the top-ranked eligible cleaner
  const selectedCleaner = eligible[0]
  if (!selectedCleaner.id) {
    return { success: false, error: 'Selected cleaner has no ID' }
  }

  const assignment = await createCleanerAssignment(jobId, selectedCleaner.id)
  if (!assignment) {
    return { success: false, error: `Failed to create assignment for cleaner ${selectedCleaner.id}` }
  }

  // Send notification
  const customer = job.phone_number ? await getCustomerByPhone(job.phone_number) : null
  let notified = false
  if (selectedCleaner.phone) {
    const notifyResult = await notifyCleanerAssignment(
      tenant,
      selectedCleaner,
      job,
      customer || undefined,
      assignment.id
    )
    notified = notifyResult.success
    if (!notifyResult.success) {
      console.error(`[cleaner-assignment] Ranked: failed to notify ${selectedCleaner.name}: ${notifyResult.error}`)
    }
  }

  // Schedule 20-minute auto-cascade if no response
  try {
    const cascadeAt = new Date(Date.now() + 20 * 60 * 1000) // 20 minutes
    await scheduleTask({
      tenantId: tenant.id,
      taskType: 'ranked_cascade',
      taskKey: `ranked_cascade_${jobId}_${selectedCleaner.id}`,
      scheduledFor: cascadeAt,
      payload: {
        jobId,
        cleanerId: selectedCleaner.id,
        assignmentId: assignment.id,
      },
    })
  } catch (err) {
    console.error(`[cleaner-assignment] Failed to schedule ranked cascade for job ${jobId}:`, err)
  }

  await logSystemEvent({
    source: 'openphone',
    event_type: 'CLEANER_BROADCAST',
    message: `Ranked: sent job ${jobId} to #${(selectedCleaner as any).rank ?? 'unranked'} cleaner ${selectedCleaner.name}`,
    job_id: jobId,
    phone_number: job.phone_number,
    cleaner_id: selectedCleaner.id,
    metadata: {
      cleaner_name: selectedCleaner.name,
      cleaner_rank: (selectedCleaner as any).rank,
      assignment_id: assignment.id,
      job_date: job.date,
      job_time: job.scheduled_at,
      notification_sent: notified,
      mode: 'ranked',
      remaining_cleaners: eligible.length - 1,
    },
  })

  await maybeMarkBooked(jobId)

>>>>>>> Test
  return { success: true }
}

/**
 * Find best cleaners with pre-computed distances using job coordinates
 * Wrapper that combines findBestCleaners with immediate filtering
 *
 * @param job Job object with coordinates
 * @param jobLat Job latitude
 * @param jobLng Job longitude
 * @param excludeCleanerIds Cleaner IDs to exclude
 * @param maxCandidates Maximum candidates to return
 */
export async function findBestCleanersForJob(
  job: Job,
  jobLat: number,
  jobLng: number,
  excludeCleanerIds: string[] = [],
  maxCandidates: number = 5
): Promise<Array<{ cleaner: CleanerWithLocation; distance: number }>> {
  if (!job.date) {
    console.error(`[cleaner-assignment] Job has no date`)
    return []
  }

  // Get best cleaners sorted by distance (scoped to tenant)
  const candidates = await findBestCleaners(
    job.address || 'Unknown',
    jobLat,
    jobLng,
    job.date,
    job.scheduled_at || undefined,
    maxCandidates + excludeCleanerIds.length, // Get extra to account for excludes
    (job as any).tenant_id
  )

  // Filter out excluded cleaners
  const excludeSet = new Set(excludeCleanerIds)
  const filtered = candidates.filter(
    (c) => c.cleaner.id && !excludeSet.has(c.cleaner.id)
  )

  return filtered.slice(0, maxCandidates)
}

/**
 * Cascade assignment to next cleaner after decline
 * Used when a cleaner declines a job assignment
 *
 * @param jobId Job ID
 * @param declinedCleanerId ID of the cleaner who declined
 */
export async function cascadeToNextCleaner(
  jobId: string,
  declinedCleanerId: string
): Promise<{ success: boolean; error?: string }> {
  console.log(
    `[cleaner-assignment] Cascading assignment for job ${jobId} after decline by ${declinedCleanerId}`
  )

  // Get all cleaners who have already been contacted for this job
  const existingAssignments = await getCleanerAssignmentsForJob(jobId)
  const excludeIds = existingAssignments.map((a) => a.cleaner_id)

  // Trigger assignment excluding all previously contacted cleaners
  return await triggerCleanerAssignment(jobId, excludeIds)
}

/**
 * Get assignment statistics for a job
 * Useful for monitoring and debugging
 */
export async function getJobAssignmentStats(jobId: string): Promise<{
  totalAttempts: number
  pending: number
  accepted: number
  declined: number
  cancelled: number
  cleanersContacted: string[]
}> {
  const assignments = await getCleanerAssignmentsForJob(jobId)

  const stats = {
    totalAttempts: assignments.length,
    pending: 0,
    accepted: 0,
    declined: 0,
    cancelled: 0,
    cleanersContacted: [] as string[],
  }

  for (const a of assignments) {
    stats.cleanersContacted.push(a.cleaner_id)
    switch (a.status) {
      case 'pending':
        stats.pending++
        break
      case 'accepted':
      case 'confirmed':
        stats.accepted++
        break
      case 'declined':
        stats.declined++
        break
      case 'cancelled':
        stats.cancelled++
        break
    }
  }

  return stats
}

/**
 * Try to assign the preferred cleaner for a recurring child job.
 * Looks up the most recent completed sibling in the same series
 * and checks if that cleaner is available for this job's date.
 * Returns null if no preferred cleaner found or they're unavailable.
 */
async function tryAssignPreferredCleaner(
  jobId: string,
  job: Job,
  parentJobId: number,
  tenant: NonNullable<Awaited<ReturnType<typeof getTenantById>>>
): Promise<{ success: boolean; error?: string } | null> {
  const client = getSupabaseServiceClient()

  // Step 1: Find all sibling job IDs in the same recurring series (+ parent)
  const { data: siblings } = await client
    .from('jobs')
    .select('id')
    .eq('parent_job_id', parentJobId)
    .neq('id', jobId)

  const siblingIds = (siblings || []).map(s => String(s.id))
  siblingIds.push(String(parentJobId)) // include parent itself
  if (siblingIds.length === 0) return null

  // Step 2: Find the most recent accepted/confirmed cleaner for any sibling
  const { data: siblingAssignment } = await client
    .from('cleaner_assignments')
    .select('cleaner_id')
    .in('job_id', siblingIds)
    .in('status', ['accepted', 'confirmed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!siblingAssignment?.cleaner_id) {
    console.log(`[cleaner-assignment] No preferred cleaner found for recurring job ${jobId}`)
    return null
  }

  const preferredCleanerId = siblingAssignment.cleaner_id

  // Check if this cleaner is available for the job date
  const effectiveTenantId = (job as any).tenant_id || undefined
  const availableCleaners = await getCleanerAvailability(
    job.date || '',
    job.scheduled_at || undefined,
    effectiveTenantId
  )

  const isAvailable = availableCleaners.some(c => String(c.id) === String(preferredCleanerId))
  if (!isAvailable) {
    console.log(`[cleaner-assignment] Preferred cleaner ${preferredCleanerId} not available for job ${jobId} on ${job.date}`)
    return null
  }

  // Preferred cleaner is available - assign them directly
  const cleaner = await getCleanerById(preferredCleanerId)
  if (!cleaner || !cleaner.id) {
    return null
  }

  const assignment = await createCleanerAssignment(jobId, cleaner.id)
  if (!assignment) {
    console.error(`[cleaner-assignment] Failed to create preferred assignment for cleaner ${cleaner.id}`)
    return null
  }

  // Send notification
  const customer = job.phone_number ? await getCustomerByPhone(job.phone_number) : null
  if (cleaner.phone) {
    const notifyResult = await notifyCleanerAssignment(
      tenant,
      cleaner,
      job,
      customer || undefined,
      assignment.id
    )
    if (!notifyResult.success) {
      console.error(`[cleaner-assignment] Failed to notify preferred cleaner ${cleaner.name}: ${notifyResult.error}`)
    }
  }

  await logSystemEvent({
    source: 'openphone',
    event_type: 'CLEANER_BROADCAST',
    message: `Preferred cleaner ${cleaner.name} assigned to recurring job ${jobId} (same as previous in series)`,
    job_id: jobId,
    phone_number: job.phone_number,
    cleaner_id: cleaner.id,
    metadata: {
      cleaner_name: cleaner.name,
      assignment_id: assignment.id,
      job_date: job.date,
      job_time: job.scheduled_at,
      notification_sent: !!cleaner.phone,
      mode: 'preferred_recurring',
      parent_job_id: parentJobId,
    },
  })

  console.log(`[cleaner-assignment] Preferred cleaner ${cleaner.name} assigned to recurring job ${jobId}`)
  return { success: true }
}
