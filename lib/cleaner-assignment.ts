/**
 * VRP-based Cleaner Assignment
 *
 * Implements Vehicle Routing Problem (VRP) inspired cleaner assignment
 * using distance-based prioritization from cleaner home locations.
 */

import {
  getCleaners,
  getCleanerAvailability,
  createCleanerAssignment,
  getCleanerAssignmentsForJob,
  getJobById,
  getCustomerByPhone,
  Cleaner,
  CleanerAssignment,
  Job,
} from './supabase'
// IMPORTANT: Explicit path to avoid Next resolving `telegram.tsx`.
// @ts-ignore - import needed to resolve correct file
import { notifyCleanerAssignment } from './telegram'
import { logSystemEvent } from './system-events'

// Extended Cleaner type with location data
export interface CleanerWithLocation extends Cleaner {
  home_lat?: number
  home_lng?: number
}

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
  maxCandidates: number = 5
): Promise<Array<{ cleaner: CleanerWithLocation; distance: number }>> {
  // Get available cleaners for the job date/time
  const availableCleaners = (await getCleanerAvailability(
    jobDate,
    jobTime
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
      cleanersWithDistance.push({ cleaner, distance })
    } else {
      // Cleaners without location get a very large distance to sort them last
      cleanersWithoutLocation.push({ cleaner, distance: Infinity })
    }
  }

  // Sort cleaners with location by distance (ascending)
  cleanersWithDistance.sort((a, b) => a.distance - b.distance)

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
  excludeCleanerIds: string[] = []
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

  // Get all available cleaners for this job's date/time
  const availableCleaners = (await getCleanerAvailability(
    job.date,
    job.scheduled_at || undefined
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
    // Sort eligible cleaners by distance from job location
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
      .sort((a, b) => a.distance - b.distance)

    selectedCleaner = cleanersWithDistance[0].cleaner
    console.log(
      `[cleaner-assignment] Selected cleaner ${selectedCleaner.name} (distance: ${cleanersWithDistance[0].distance.toFixed(1)} mi)`
    )
  } else {
    // No job coordinates - use first available cleaner
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
 * Creates assignment and sends Telegram notification to the cleaner
 *
 * @param jobId Job ID to trigger assignment for
 * @returns Result with success status and optional error message
 */
export async function triggerCleanerAssignment(
  jobId: string
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

    // Check if job already has an accepted/confirmed assignment
    const existingAssignments = await getCleanerAssignmentsForJob(jobId)
    const hasAcceptedAssignment = existingAssignments.some(
      (a) => a.status === 'accepted' || a.status === 'confirmed'
    )

    if (hasAcceptedAssignment) {
      return {
        success: false,
        error: `Job ${jobId} already has an accepted cleaner assignment`,
      }
    }

    // Find and assign the next available cleaner
    const assignResult = await assignNextAvailableCleaner(jobId)

    if (!assignResult.success) {
      if (assignResult.exhausted) {
        // Log escalation event - use OWNER_ACTION_REQUIRED for exhausted cleaners
        await logSystemEvent({
          source: 'telegram',
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

    // Send Telegram notification to the cleaner
    if (cleaner.telegram_id) {
      const notifyResult = await notifyCleanerAssignment(
        cleaner,
        job,
        customer || undefined,
        assignment.id
      )

      if (!notifyResult.success) {
        console.error(
          `[cleaner-assignment] Failed to notify cleaner ${cleaner.name}: ${notifyResult.error}`
        )
        // Don't fail the overall operation, just log the error
      } else {
        console.log(
          `[cleaner-assignment] Sent notification to cleaner ${cleaner.name}`
        )
      }
    } else {
      console.warn(
        `[cleaner-assignment] Cleaner ${cleaner.name} has no Telegram ID configured`
      )
    }

    // Log the assignment event - use CLEANER_BROADCAST for initial assignment notification
    await logSystemEvent({
      source: 'telegram',
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
        notification_sent: !!cleaner.telegram_id,
      },
    })

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

  // Get best cleaners sorted by distance
  const candidates = await findBestCleaners(
    job.address || 'Unknown',
    jobLat,
    jobLng,
    job.date,
    job.scheduled_at || undefined,
    maxCandidates + excludeCleanerIds.length // Get extra to account for excludes
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
  return await triggerCleanerAssignment(jobId)
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
