/**
 * Housecall Pro Job Sync
 *
 * Bidirectional sync between local jobs and Housecall Pro.
 * Handles service radius validation and job import.
 */

import { createClient } from '@supabase/supabase-js'
import { getJob, listJobs, getJobsForDate } from './hcp-client'
import { SERVICE_RADIUS_CONFIG } from './constants'
import { HCP_STATUS_MAP, type HCPJob, type JobSyncResult } from './types'

// Lazy-initialize Supabase client (avoid build-time env var access)
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Sync a single job from HCP to local database
 */
export async function syncJobFromHCP(hcpJobId: string): Promise<JobSyncResult> {
  const result = await getJob(hcpJobId)

  if (!result.success || !result.data) {
    return {
      success: false,
      hcpJobId,
      action: 'skipped',
      error: result.error || 'Failed to fetch job from HCP',
    }
  }

  return await upsertJobFromHCP(result.data)
}

/**
 * Sync all jobs for a specific date
 */
export async function syncJobsForDate(
  date: string
): Promise<{ synced: number; errors: number; results: JobSyncResult[] }> {
  const result = await getJobsForDate(date)

  if (!result.success || !result.data) {
    return { synced: 0, errors: 1, results: [] }
  }

  const results: JobSyncResult[] = []
  let synced = 0
  let errors = 0

  for (const hcpJob of result.data.jobs) {
    const syncResult = await upsertJobFromHCP(hcpJob)
    results.push(syncResult)

    if (syncResult.success) {
      synced++
    } else {
      errors++
    }
  }

  return { synced, errors, results }
}

/**
 * Upsert a job from HCP data
 */
async function upsertJobFromHCP(hcpJob: HCPJob): Promise<JobSyncResult> {
  // Check if job exists
  const { data: existingJob } = await getSupabase()
    .from('jobs')
    .select('id')
    .eq('housecall_pro_job_id', hcpJob.id)
    .single()

  const internalStatus = HCP_STATUS_MAP[hcpJob.work_status] || 'lead'

  const jobData = {
    status: internalStatus,
    price: hcpJob.total_amount,
    housecall_pro_job_id: hcpJob.id,
    housecall_pro_customer_id: hcpJob.customer_id,
    housecall_pro_status: hcpJob.work_status,
    address: formatAddress(hcpJob.address),
    date: hcpJob.scheduled_start
      ? new Date(hcpJob.scheduled_start).toISOString().split('T')[0]
      : null,
    scheduled_at: hcpJob.scheduled_start
      ? new Date(hcpJob.scheduled_start).toTimeString().slice(0, 5)
      : null,
    notes: hcpJob.notes,
    brand: 'winbros',
    updated_at: new Date().toISOString(),
  }

  if (existingJob) {
    const { error } = await getSupabase()
      .from('jobs')
      .update(jobData)
      .eq('id', existingJob.id)

    if (error) {
      return {
        success: false,
        localJobId: existingJob.id,
        hcpJobId: hcpJob.id,
        action: 'skipped',
        error: error.message,
      }
    }

    return {
      success: true,
      localJobId: existingJob.id,
      hcpJobId: hcpJob.id,
      action: 'updated',
    }
  } else {
    const { data: newJob, error } = await getSupabase()
      .from('jobs')
      .insert(jobData)
      .select('id')
      .single()

    if (error) {
      return {
        success: false,
        hcpJobId: hcpJob.id,
        action: 'skipped',
        error: error.message,
      }
    }

    return {
      success: true,
      localJobId: newJob.id,
      hcpJobId: hcpJob.id,
      action: 'created',
    }
  }
}

/**
 * Validate service radius for a job
 * Returns driving time in minutes
 */
export async function validateServiceRadius(
  jobAddress: string,
  businessZip?: string
): Promise<{
  valid: boolean
  drivingMinutes?: number
  distanceMiles?: number
  error?: string
}> {
  const serviceZip = businessZip || process.env.WINBROS_SERVICE_ZIP

  if (!serviceZip) {
    return { valid: true } // Skip validation if no service ZIP configured
  }

  try {
    // Use Google Distance Matrix API or similar
    // For now, we'll use a simple estimation based on ZIP code
    // In production, integrate with Google Maps API

    // Placeholder implementation - replace with actual API call
    const estimatedMinutes = await estimateDrivingTime(jobAddress, serviceZip)

    const isValid = estimatedMinutes <= SERVICE_RADIUS_CONFIG.DEFAULT_MAX_MINUTES

    // If invalid, create alert
    if (!isValid) {
      console.log(
        `[Service Radius] Job outside service area: ${estimatedMinutes} minutes (max: ${SERVICE_RADIUS_CONFIG.DEFAULT_MAX_MINUTES})`
      )
    }

    return {
      valid: isValid,
      drivingMinutes: estimatedMinutes,
    }
  } catch (error) {
    console.error('[Service Radius] Validation error:', error)
    return {
      valid: true, // Allow job if validation fails
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Estimate driving time between addresses
 * Placeholder - replace with Google Maps API
 */
async function estimateDrivingTime(
  destination: string,
  originZip: string
): Promise<number> {
  // Extract destination ZIP from address
  const destZipMatch = destination.match(/\b\d{5}(?:-\d{4})?\b/)
  const destZip = destZipMatch ? destZipMatch[0] : null

  if (!destZip) {
    return 30 // Default estimate if no ZIP found
  }

  // Simple estimation based on ZIP difference
  // In production, use Google Distance Matrix API
  const originNum = parseInt(originZip.slice(0, 3), 10)
  const destNum = parseInt(destZip.slice(0, 3), 10)
  const diff = Math.abs(originNum - destNum)

  // Rough estimation: 5 minutes per "ZIP unit"
  return Math.min(diff * 5, 120) + 10 // Cap at 2 hours, minimum 10 minutes
}

/**
 * Check for underfilled days
 */
export async function checkUnderfillDays(
  startDate: string,
  endDate: string,
  minJobs: number = 3
): Promise<{ date: string; jobCount: number }[]> {
  const underfilled: { date: string; jobCount: number }[] = []

  const { data: jobs, error } = await getSupabase()
    .from('jobs')
    .select('date')
    .eq('brand', 'winbros')
    .gte('date', startDate)
    .lte('date', endDate)
    .in('status', ['scheduled', 'confirmed'])

  if (error || !jobs) {
    console.error('[Underfill Check] Failed to fetch jobs:', error)
    return []
  }

  // Count jobs per day
  const jobsPerDay: Record<string, number> = {}
  for (const job of jobs) {
    if (job.date) {
      jobsPerDay[job.date] = (jobsPerDay[job.date] || 0) + 1
    }
  }

  // Find underfilled days
  const current = new Date(startDate)
  const end = new Date(endDate)

  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0]
    const dayOfWeek = current.getDay()

    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const count = jobsPerDay[dateStr] || 0
      if (count < minJobs) {
        underfilled.push({ date: dateStr, jobCount: count })
      }
    }

    current.setDate(current.getDate() + 1)
  }

  return underfilled
}

/**
 * Get jobs needing crew assignment
 */
export async function getJobsNeedingAssignment(): Promise<
  Array<{ id: string; date: string; address: string; price: number }>
> {
  const { data: jobs, error } = await getSupabase()
    .from('jobs')
    .select('id, date, address, price, crew_id')
    .eq('brand', 'winbros')
    .in('status', ['scheduled', 'confirmed'])
    .is('crew_id', null)
    .order('date', { ascending: true })

  if (error) {
    console.error('[Job Assignment] Failed to fetch jobs:', error)
    return []
  }

  return jobs || []
}

/**
 * Assign crew to a job
 */
export async function assignCrewToJob(
  jobId: string,
  crewId: string
): Promise<{ success: boolean; error?: string }> {
  const { error } = await getSupabase()
    .from('jobs')
    .update({
      crew_id: crewId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}

// =====================
// HELPER FUNCTIONS
// =====================

function formatAddress(address: {
  street: string
  street_line_2?: string
  city: string
  state: string
  zip: string
}): string {
  const parts = [address.street]
  if (address.street_line_2) parts.push(address.street_line_2)
  parts.push(`${address.city}, ${address.state} ${address.zip}`)
  return parts.join(', ')
}
