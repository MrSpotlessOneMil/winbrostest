/**
 * WinBros Alert System
 *
 * Handles alerts for high-value jobs, underfilled days,
 * rain days, and service radius violations.
 */

import { createClient } from '@supabase/supabase-js'
import { checkRainDay, getUpcomingRainDays, formatWeatherBriefing } from './weather'
import { HIGH_VALUE_CONFIG, UNDERFILL_CONFIG, SERVICE_RADIUS_CONFIG } from '@/integrations/housecall-pro/constants'

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Alert types
export type AlertType =
  | 'high_value'
  | 'underfilled_day'
  | 'stacked_reschedule'
  | 'rain_day'
  | 'service_radius_exceeded'

// Alert record
export interface JobAlert {
  id: string
  job_id?: string
  brand: string
  alert_type: AlertType
  threshold_value?: string
  actual_value?: string
  message: string
  acknowledged: boolean
  acknowledged_by?: string
  acknowledged_at?: string
  created_at: string
}

// Alert creation input
export interface CreateAlertInput {
  jobId?: string
  alertType: AlertType
  threshold?: number | string
  actual?: number | string
  message: string
}

/**
 * Create a new alert
 */
export async function createAlert(input: CreateAlertInput): Promise<{ success: boolean; alertId?: string; error?: string }> {
  const { data, error } = await supabase
    .from('job_alerts')
    .insert({
      job_id: input.jobId,
      brand: 'winbros',
      alert_type: input.alertType,
      threshold_value: input.threshold?.toString(),
      actual_value: input.actual?.toString(),
      message: input.message,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[Alerts] Failed to create alert:', error)
    return { success: false, error: error.message }
  }

  console.log(`[Alerts] Created ${input.alertType} alert: ${input.message}`)

  // Send notification to owner
  await notifyOwner(input)

  return { success: true, alertId: data.id }
}

/**
 * Check and alert for high-value jobs
 */
export async function checkHighValueJob(
  jobId: string,
  priceCents: number
): Promise<{ isHighValue: boolean; alertCreated: boolean }> {
  const threshold = HIGH_VALUE_CONFIG.THRESHOLD_CENTS

  if (priceCents < threshold) {
    return { isHighValue: false, alertCreated: false }
  }

  const priceFormatted = (priceCents / 100).toFixed(2)
  const thresholdFormatted = (threshold / 100).toFixed(2)

  await createAlert({
    jobId,
    alertType: 'high_value',
    threshold: thresholdFormatted,
    actual: priceFormatted,
    message: `🎯 High-value job: $${priceFormatted} (threshold: $${thresholdFormatted})`,
  })

  return { isHighValue: true, alertCreated: true }
}

/**
 * Check and alert for underfilled days
 */
export async function checkUnderfillDays(
  startDate: string,
  endDate: string
): Promise<{ underfilled: Array<{ date: string; jobCount: number }> }> {
  const minJobs = UNDERFILL_CONFIG.MIN_JOBS

  // Get job counts per day
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('date')
    .eq('brand', 'winbros')
    .gte('date', startDate)
    .lte('date', endDate)
    .in('status', ['scheduled', 'confirmed'])

  if (error) {
    console.error('[Alerts] Failed to fetch jobs for underfill check:', error)
    return { underfilled: [] }
  }

  // Count jobs per day
  const jobsPerDay: Record<string, number> = {}
  for (const job of jobs || []) {
    if (job.date) {
      jobsPerDay[job.date] = (jobsPerDay[job.date] || 0) + 1
    }
  }

  // Find underfilled days (skip weekends)
  const underfilled: Array<{ date: string; jobCount: number }> = []
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

        // Create alert
        await createAlert({
          alertType: 'underfilled_day',
          threshold: minJobs,
          actual: count,
          message: `📉 Underfilled day: ${dateStr} has only ${count} job(s) (minimum: ${minJobs})`,
        })
      }
    }

    current.setDate(current.getDate() + 1)
  }

  return { underfilled }
}

/**
 * Check and alert for service radius violations
 */
export async function checkServiceRadius(
  jobId: string,
  drivingMinutes: number
): Promise<{ exceeds: boolean; alertCreated: boolean }> {
  const maxMinutes = SERVICE_RADIUS_CONFIG.DEFAULT_MAX_MINUTES

  if (drivingMinutes <= maxMinutes) {
    return { exceeds: false, alertCreated: false }
  }

  await createAlert({
    jobId,
    alertType: 'service_radius_exceeded',
    threshold: maxMinutes,
    actual: drivingMinutes,
    message: `📍 Service radius exceeded: ${drivingMinutes} minutes (max: ${maxMinutes} minutes)`,
  })

  return { exceeds: true, alertCreated: true }
}

/**
 * Check and alert for rain days
 */
export async function checkRainDayAlerts(
  date: string,
  zip?: string
): Promise<{ isRainDay: boolean; alertCreated: boolean }> {
  const serviceZip = zip || process.env.WINBROS_SERVICE_ZIP

  if (!serviceZip) {
    console.log('[Alerts] No service ZIP configured, skipping rain day check')
    return { isRainDay: false, alertCreated: false }
  }

  try {
    const result = await checkRainDay(serviceZip, date)

    if (!result.isRainDay) {
      return { isRainDay: false, alertCreated: false }
    }

    // Get affected jobs
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, address, price')
      .eq('brand', 'winbros')
      .eq('date', date)
      .in('status', ['scheduled', 'confirmed'])

    const jobCount = jobs?.length || 0
    const forecast = result.forecast

    await createAlert({
      alertType: 'rain_day',
      actual: forecast?.precipitationChance,
      message: `🌧️ Rain day alert for ${date}: ${forecast?.precipitationChance}% chance of rain. ${jobCount} job(s) may need rescheduling.`,
    })

    // Record in rain_days table
    await supabase.from('rain_days').upsert({
      brand: 'winbros',
      date,
      is_rain_day: true,
      weather_conditions: forecast?.conditions.description,
      precipitation_chance: forecast?.precipitationChance,
      jobs_rescheduled: 0, // Will be updated when jobs are actually rescheduled
    })

    return { isRainDay: true, alertCreated: true }
  } catch (error) {
    console.error('[Alerts] Failed to check rain day:', error)
    return { isRainDay: false, alertCreated: false }
  }
}

/**
 * Check for stacked reschedules (customer has rescheduled multiple times)
 */
export async function checkStackedReschedules(
  customerId: string,
  threshold: number = 2
): Promise<{ stacked: boolean; count: number; alertCreated: boolean }> {
  // This would require tracking reschedule history
  // For now, we'll check if there are multiple cancelled jobs

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, date')
    .eq('customer_id', customerId)
    .eq('brand', 'winbros')
    .eq('status', 'cancelled')
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) // Last 30 days

  if (error || !jobs) {
    return { stacked: false, count: 0, alertCreated: false }
  }

  if (jobs.length < threshold) {
    return { stacked: false, count: jobs.length, alertCreated: false }
  }

  await createAlert({
    alertType: 'stacked_reschedule',
    threshold,
    actual: jobs.length,
    message: `⚠️ Customer has ${jobs.length} cancelled jobs in the last 30 days. May need follow-up.`,
  })

  return { stacked: true, count: jobs.length, alertCreated: true }
}

/**
 * Get unacknowledged alerts
 */
export async function getUnacknowledgedAlerts(): Promise<JobAlert[]> {
  const { data, error } = await supabase
    .from('job_alerts')
    .select('*')
    .eq('brand', 'winbros')
    .eq('acknowledged', false)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[Alerts] Failed to fetch unacknowledged alerts:', error)
    return []
  }

  return data || []
}

/**
 * Acknowledge an alert
 */
export async function acknowledgeAlert(
  alertId: string,
  acknowledgedBy: string
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('job_alerts')
    .update({
      acknowledged: true,
      acknowledged_by: acknowledgedBy,
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', alertId)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * Get alerts summary for dashboard
 */
export async function getAlertsSummary(): Promise<{
  unacknowledged: number
  byType: Record<AlertType, number>
  recent: JobAlert[]
}> {
  const alerts = await getUnacknowledgedAlerts()

  const byType: Record<AlertType, number> = {
    high_value: 0,
    underfilled_day: 0,
    stacked_reschedule: 0,
    rain_day: 0,
    service_radius_exceeded: 0,
  }

  for (const alert of alerts) {
    byType[alert.alert_type as AlertType]++
  }

  return {
    unacknowledged: alerts.length,
    byType,
    recent: alerts.slice(0, 10),
  }
}

/**
 * Notify owner about an alert
 */
async function notifyOwner(alert: CreateAlertInput): Promise<void> {
  const ownerPhone = process.env.OWNER_PHONE_WINBROS || process.env.OWNER_PHONE

  if (!ownerPhone) {
    console.log('[Alerts] No owner phone configured, skipping notification')
    return
  }

  // Import sendSMS dynamically to avoid circular dependency
  try {
    const { sendSMS } = await import('./openphone')
    await sendSMS(ownerPhone, `[WinBros Alert]\n${alert.message}`)
  } catch (error) {
    console.error('[Alerts] Failed to send owner notification:', error)
  }
}

/**
 * Run daily alert checks
 */
export async function runDailyAlertChecks(): Promise<{
  rainDaysChecked: number
  underfillChecked: boolean
  alertsCreated: number
}> {
  let alertsCreated = 0
  const serviceZip = process.env.WINBROS_SERVICE_ZIP

  // Check rain days for next 3 days
  if (serviceZip) {
    const today = new Date()
    for (let i = 1; i <= 3; i++) {
      const date = new Date(today)
      date.setDate(date.getDate() + i)
      const dateStr = date.toISOString().split('T')[0]

      const result = await checkRainDayAlerts(dateStr, serviceZip)
      if (result.alertCreated) alertsCreated++
    }
  }

  // Check underfill for next 7 days
  const today = new Date().toISOString().split('T')[0]
  const nextWeek = new Date()
  nextWeek.setDate(nextWeek.getDate() + 7)
  const nextWeekStr = nextWeek.toISOString().split('T')[0]

  const underfillResult = await checkUnderfillDays(today, nextWeekStr)
  alertsCreated += underfillResult.underfilled.length

  return {
    rainDaysChecked: serviceZip ? 3 : 0,
    underfillChecked: true,
    alertsCreated,
  }
}
