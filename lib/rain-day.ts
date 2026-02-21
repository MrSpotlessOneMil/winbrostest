/**
 * Rain Day Rescheduling System
 *
 * Provides:
 * 1. Automated rain day detection (check tomorrow's forecast)
 * 2. Bulk rescheduling (push all jobs +1 day or auto-spread)
 * 3. Customer SMS + cleaner Telegram notifications
 *
 * Extracted from app/api/rain-day/route.ts for reuse by the
 * daily cron and the manual dashboard trigger.
 */

import { getSupabaseServiceClient } from './supabase'
import { sendSMS } from './openphone'
import { notifyScheduleChange } from './telegram'
import { checkRainDay as checkRainDayWeather, formatWeatherBriefing } from './weather'
import type { DailyForecast } from './weather'
import type { Tenant } from './tenant'
import { getDefaultTenant, getTenantBusinessName } from './tenant'

// ── Types ──────────────────────────────────────────────────────

export interface RainDayCheckResult {
  checked: boolean
  isRainDay: boolean
  forecast?: DailyForecast
  rescheduled?: RescheduleResult
  error?: string
}

export interface RescheduleResult {
  affectedDate: string
  targetDate: string
  jobsAffected: number
  jobsRescheduled: number
  jobsFailed: string[]
  notificationsSent: number
  spreadSummary: Record<string, number>
}

interface AffectedJob {
  id: number
  hcpJobId?: string
  customerName: string
  customerPhone?: string
  address: string
  scheduledTime: string
  serviceType?: string
  estimatedValue: number
  teamId?: number
  cleanerId?: number
  cleanerName?: string
  cleanerTelegramId?: string
}

// ── Auto Rain Day Detection ────────────────────────────────────

/**
 * Check tomorrow's weather and auto-reschedule if rain day detected.
 * Called from the unified-daily cron.
 */
export async function checkAndHandleRainDay(
  tenantId: string,
  options?: {
    daysAhead?: number
    autoSpread?: boolean
    spreadDays?: number
    sendNotifications?: boolean
    serviceAreaZip?: string
  }
): Promise<RainDayCheckResult> {
  const daysAhead = options?.daysAhead ?? 1
  const autoSpread = options?.autoSpread !== false
  const spreadDays = options?.spreadDays ?? 14
  const notify = options?.sendNotifications !== false

  const tenant = await getDefaultTenant()
  if (!tenant) {
    return { checked: false, isRainDay: false, error: 'No tenant configured' }
  }

  // Determine the service area ZIP code
  const zip = options?.serviceAreaZip
    || process.env.SERVICE_AREA_ZIP
    || process.env.WEATHER_ZIP
    || '90001' // LA default

  // Calculate the target date
  const targetDate = new Date()
  targetDate.setDate(targetDate.getDate() + daysAhead)
  const dateStr = targetDate.toISOString().slice(0, 10)

  console.log(`[RainDay] Checking weather for ${dateStr} (ZIP: ${zip})`)

  try {
    const weatherCheck = await checkRainDayWeather(zip, dateStr)

    if (!weatherCheck.isRainDay) {
      console.log(`[RainDay] ${dateStr} is NOT a rain day — no action needed`)
      return {
        checked: true,
        isRainDay: false,
        forecast: weatherCheck.forecast || undefined,
      }
    }

    console.log(`[RainDay] ${dateStr} IS a rain day! Starting auto-reschedule...`)
    if (weatherCheck.forecast) {
      console.log(`[RainDay] ${formatWeatherBriefing(weatherCheck.forecast)}`)
    }

    // Reschedule all jobs for that date
    const result = await rescheduleAllJobs(dateStr, tenantId, tenant, {
      autoSpread,
      spreadDays,
      sendNotifications: notify,
    })

    // Alert owner via SMS
    if (tenant.owner_phone) {
      const forecast = weatherCheck.forecast
      const weatherInfo = forecast ? formatWeatherBriefing(forecast) : 'Rain detected'

      const ownerMsg = `RAIN DAY AUTO-RESCHEDULE

${weatherInfo}

${result.jobsAffected} jobs on ${formatDateHuman(dateStr)} have been rescheduled.
${result.jobsRescheduled} successfully moved.
${result.jobsFailed.length > 0 ? `${result.jobsFailed.length} failed - check dashboard.` : ''}
${result.notificationsSent} notifications sent.`

      await sendSMS(tenant, tenant.owner_phone, ownerMsg)
    }

    return {
      checked: true,
      isRainDay: true,
      forecast: weatherCheck.forecast || undefined,
      rescheduled: result,
    }
  } catch (error) {
    console.error('[RainDay] Error checking/handling rain day:', error)
    return {
      checked: false,
      isRainDay: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ── Bulk Rescheduling ──────────────────────────────────────────

/**
 * Reschedule all jobs for a given date.
 * Can push to a single target date or auto-spread across multiple days.
 */
export async function rescheduleAllJobs(
  affectedDate: string,
  tenantId: string,
  tenant: Tenant,
  options?: {
    targetDate?: string
    autoSpread?: boolean
    spreadDays?: number
    sendNotifications?: boolean
  }
): Promise<RescheduleResult> {
  const autoSpread = options?.autoSpread !== false
  const spreadDays = Math.min(Math.max(options?.spreadDays || 14, 7), 30)
  const notify = options?.sendNotifications !== false
  const client = getSupabaseServiceClient()

  // Load affected jobs
  const jobs = await getAffectedJobs(affectedDate, tenantId)
  if (jobs.length === 0) {
    return {
      affectedDate,
      targetDate: options?.targetDate || 'auto-spread',
      jobsAffected: 0,
      jobsRescheduled: 0,
      jobsFailed: [],
      notificationsSent: 0,
      spreadSummary: {},
    }
  }

  const rescheduled: number[] = []
  const failed: string[] = []
  let notificationsSent = 0
  const spreadSummary: Record<string, number> = {}

  if (autoSpread && !options?.targetDate) {
    // Auto-spread: distribute across least-loaded days
    const candidateDates = getCandidateDates(affectedDate, spreadDays)
    const jobCounts = await getJobCountsByDate(candidateDates, tenantId, client)

    for (const job of jobs) {
      // Find the least-loaded date
      let bestDate = candidateDates[0]
      let bestCount = jobCounts[bestDate] ?? Infinity
      for (const d of candidateDates) {
        if ((jobCounts[d] ?? 0) < bestCount) {
          bestDate = d
          bestCount = jobCounts[d] ?? 0
        }
      }

      const result = await rescheduleJob(job, bestDate, affectedDate, tenant, client, notify)
      if (result.success) {
        rescheduled.push(job.id)
        notificationsSent += result.notifications
        jobCounts[bestDate] = (jobCounts[bestDate] ?? 0) + 1
        spreadSummary[bestDate] = (spreadSummary[bestDate] || 0) + 1
      } else {
        failed.push(String(job.id))
      }
    }
  } else {
    // Single target date (default: +1 day)
    const targetDate = options?.targetDate || getNextWorkday(affectedDate)
    for (const job of jobs) {
      const result = await rescheduleJob(job, targetDate, affectedDate, tenant, client, notify)
      if (result.success) {
        rescheduled.push(job.id)
        notificationsSent += result.notifications
        spreadSummary[targetDate] = (spreadSummary[targetDate] || 0) + 1
      } else {
        failed.push(String(job.id))
      }
    }
  }

  return {
    affectedDate,
    targetDate: options?.targetDate || 'auto-spread',
    jobsAffected: jobs.length,
    jobsRescheduled: rescheduled.length,
    jobsFailed: failed,
    notificationsSent,
    spreadSummary,
  }
}

// ── Single Job Reschedule ──────────────────────────────────────

/**
 * Reschedule a single job: update DB, notify customer + cleaner.
 */
async function rescheduleJob(
  job: AffectedJob,
  targetDate: string,
  affectedDate: string,
  tenant: Tenant,
  client: ReturnType<typeof getSupabaseServiceClient>,
  sendNotifications: boolean
): Promise<{ success: boolean; notifications: number }> {
  let notifications = 0

  try {
    // 1. Update job date in database
    const { error } = await client
      .from('jobs')
      .update({ date: targetDate, updated_at: new Date().toISOString() })
      .eq('id', job.id)

    if (error) {
      console.error(`[RainDay] Failed to update job ${job.id}:`, error)
      return { success: false, notifications: 0 }
    }

    if (!sendNotifications) {
      return { success: true, notifications: 0 }
    }

    // 2. Notify customer via SMS
    if (job.customerPhone && tenant.openphone_api_key) {
      try {
        const businessName = getTenantBusinessName(tenant, true)
        const oldDate = formatDateHuman(affectedDate)
        const newDate = formatDateHuman(targetDate)

        const smsMessage = `Hi ${job.customerName}! Due to weather conditions, your ${businessName} cleaning originally scheduled for ${oldDate} has been rescheduled to ${newDate}. Same time: ${job.scheduledTime || '9:00 AM'}. Reply with any questions!`

        const result = await sendSMS(tenant, job.customerPhone, smsMessage)
        if (result.success) notifications++
      } catch (err) {
        console.error(`[RainDay] SMS failed for ${job.customerPhone}:`, err)
      }
    }

    // 3. Notify cleaner via Telegram
    if (job.cleanerTelegramId) {
      try {
        const result = await notifyScheduleChange(
          tenant,
          { telegram_id: job.cleanerTelegramId, name: job.cleanerName || 'Cleaner', phone: null },
          { id: job.id, date: targetDate, scheduled_at: job.scheduledTime, address: job.address },
          formatDateHuman(affectedDate),
          job.scheduledTime || '09:00'
        )
        if (result.success) notifications++
      } catch (err) {
        console.error(`[RainDay] Telegram failed for cleaner:`, err)
      }
    }

    return { success: true, notifications }
  } catch (err) {
    console.error(`[RainDay] Error rescheduling job ${job.id}:`, err)
    return { success: false, notifications }
  }
}

// ── Data Loaders ───────────────────────────────────────────────

/**
 * Get all non-cancelled jobs for a date with customer + cleaner info.
 */
export async function getAffectedJobs(date: string, tenantId: string): Promise<AffectedJob[]> {
  const client = getSupabaseServiceClient()

  const { data, error } = await client
    .from('jobs')
    .select('*, customers (*), cleaner_assignments (*, cleaners (*))')
    .eq('tenant_id', tenantId)
    .eq('date', date)
    .neq('status', 'cancelled')
    .order('scheduled_at', { ascending: true })

  if (error || !data) return []

  return data.map((row: any) => {
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers
    const assignments = Array.isArray(row.cleaner_assignments) ? row.cleaner_assignments : []
    const primaryAssignment = assignments.find((a: any) => a?.status === 'confirmed') || assignments[0]
    const cleaner = primaryAssignment?.cleaners

    return {
      id: row.id,
      hcpJobId: row.hcp_job_id || undefined,
      customerName: [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim() || 'Customer',
      customerPhone: customer?.phone_number || row.phone_number || undefined,
      address: row.address || customer?.address || '',
      scheduledTime: row.scheduled_at || '09:00',
      serviceType: row.service_type || undefined,
      estimatedValue: row.price ? Number(row.price) : 0,
      teamId: row.team_id ?? undefined,
      cleanerId: cleaner?.id ?? undefined,
      cleanerName: cleaner?.name ?? undefined,
      cleanerTelegramId: cleaner?.telegram_id ?? undefined,
    }
  })
}

/**
 * Generate candidate dates for auto-spread (skips Sundays).
 */
export function getCandidateDates(afterDate: string, count: number): string[] {
  const dates: string[] = []
  const current = new Date(afterDate + 'T12:00:00')
  current.setDate(current.getDate() + 1)

  while (dates.length < count) {
    if (current.getDay() !== 0) { // Skip Sundays
      dates.push(current.toISOString().slice(0, 10))
    }
    current.setDate(current.getDate() + 1)
  }

  return dates
}

/**
 * Count existing non-cancelled jobs for each candidate date.
 */
export async function getJobCountsByDate(
  dates: string[],
  tenantId: string,
  client: ReturnType<typeof getSupabaseServiceClient>
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const d of dates) counts[d] = 0

  const { data } = await client
    .from('jobs')
    .select('date')
    .eq('tenant_id', tenantId)
    .neq('status', 'cancelled')
    .in('date', dates)

  if (data) {
    for (const row of data) {
      const d = String(row.date)
      if (counts[d] !== undefined) counts[d]++
    }
  }

  return counts
}

// ── Helpers ────────────────────────────────────────────────────

function formatDateHuman(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function getNextWorkday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + 1)
  // Skip Sunday
  if (d.getDay() === 0) d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}
