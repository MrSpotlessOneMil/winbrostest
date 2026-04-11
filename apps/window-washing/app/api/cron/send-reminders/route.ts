import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import {
  getCleaners,
  getCleanerJobsForDate,
  getJobsStartingSoon,
  hasReminderBeenSent,
  markReminderSent,
} from '@/lib/supabase'
import { sendDailySchedule, sendJobReminder } from '@/lib/cleaner-sms'
import { sendSMS } from '@/lib/openphone'
import { logSystemEvent } from '@/lib/system-events'
import { getAllActiveTenants, getTenantById } from '@/lib/tenant'
import { getSupabaseServiceClient } from '@/lib/supabase'

/**
 * Unique timezones across all active tenants, used to run
 * time-relative checks (1-hour-before, job-start) correctly
 * for each tenant's local time.
 */
async function getActiveTimezones(): Promise<string[]> {
  const tenants = await getAllActiveTenants()
  const tzSet = new Set<string>()
  for (const t of tenants) {
    tzSet.add(t.timezone || 'America/Los_Angeles')
  }
  return Array.from(tzSet)
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  try {
    const now = new Date()

    let dailySent = 0
    let oneHourSent = 0
    let startTimeSent = 0
    let eveningBeforeSent = 0
    let morningScheduleSent = 0
    const errors: string[] = []

    // 1. Send daily 8am route/schedule — team leads only
    // Runs per-tenant using each tenant's configured timezone
    const tenants = await getAllActiveTenants()

    for (const t of tenants) {
      const tz = t.timezone || 'America/Los_Angeles'

      // Get current hour/minute in this tenant's timezone
      const tenantTime = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now)

      const [hourStr, minuteStr] = tenantTime.split(':')
      const tenantHour = parseInt(hourStr)
      const tenantMinute = parseInt(minuteStr)

      // Only send if it's 8:00-8:14 in this tenant's timezone
      if (tenantHour !== 8 || tenantMinute >= 15) continue

      // Get today's date in this tenant's timezone
      const todayLocal = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now)

      const cleaners = await getCleaners(undefined, t.id)

      for (const cleaner of cleaners) {
        if (!cleaner.id || !cleaner.phone) continue
        // Only team leads get the full day's route schedule
        if (!cleaner.is_team_lead) continue

        const jobsData = await getCleanerJobsForDate(cleaner.id, todayLocal)

        if (jobsData.length === 0) continue // No jobs today, skip

        // Check if daily reminder already sent
        const firstAssignment = jobsData[0].assignment
        const alreadySent = await hasReminderBeenSent(
          String(firstAssignment.id),
          'daily_8am',
          todayLocal
        )

        if (alreadySent) continue

        // Send daily schedule SMS
        const jobs = jobsData.map(jd => ({
          ...jd.job,
          customer: jd.customer,
        }))
        const result = await sendDailySchedule(t, cleaner, jobs)

        if (result.success) {
          dailySent += 1
          // Mark as sent for the first assignment (represents the cleaner's daily reminder)
          await markReminderSent(String(firstAssignment.id), 'daily_8am', todayLocal)

          await logSystemEvent({
            source: 'cron',
            event_type: 'REMINDER_SENT',
            message: `Sent daily 8am reminder to cleaner ${cleaner.id}`,
            cleaner_id: cleaner.id,
            metadata: {
              reminder_type: 'daily_8am',
              job_count: jobs.length,
            },
          })
        } else {
          errors.push(`Daily reminder failed for cleaner ${cleaner.id}: ${result.error}`)
        }
      }
    }

    // 2. Send 1-hour before job notifications (jobs starting in 45-75 minutes)
    // Run per-timezone so WinBros (America/Chicago) and PST tenants are both correct
    const timezones = await getActiveTimezones()
    const seenOneHourAssignments = new Set<string>()

    for (const tz of timezones) {
      const oneHourBeforeJobs = await getJobsStartingSoon(-75, -45, tz)

      for (const { job, assignment, cleaner, customer } of oneHourBeforeJobs) {
        const asnKey = String(assignment.id)
        if (seenOneHourAssignments.has(asnKey)) continue
        seenOneHourAssignments.add(asnKey)

        const alreadySent = await hasReminderBeenSent(
          asnKey,
          'one_hour_before',
          job.date!
        )

        if (alreadySent) continue

        const reminderTenant = job.tenant_id ? await getTenantById(job.tenant_id) : null
        if (!reminderTenant) continue
        const result = await sendJobReminder(reminderTenant, cleaner, job, customer, 'one_hour_before')

        if (result.success) {
          oneHourSent += 1
          await markReminderSent(
            asnKey,
            'one_hour_before',
            job.date!,
            job.scheduled_at || undefined
          )

          await logSystemEvent({
            source: 'cron',
            event_type: 'REMINDER_SENT',
            message: `Sent 1-hour reminder to cleaner ${cleaner.id} for job ${job.id}`,
            job_id: job.id,
            cleaner_id: cleaner.id,
            metadata: {
              reminder_type: 'one_hour_before',
              job_time: job.scheduled_at,
              timezone: tz,
            },
          })
        } else {
          errors.push(
            `1-hour reminder failed for job ${job.id}, cleaner ${cleaner.id}: ${result.error}`
          )
        }
      }
    }

    // 3. Send job start time notifications (jobs starting in -15 to +15 minutes)
    const seenStartAssignments = new Set<string>()

    for (const tz of timezones) {
      const startingNowJobs = await getJobsStartingSoon(-15, 15, tz)

      for (const { job, assignment, cleaner, customer } of startingNowJobs) {
        const asnKey = String(assignment.id)
        if (seenStartAssignments.has(asnKey)) continue
        seenStartAssignments.add(asnKey)

        const alreadySent = await hasReminderBeenSent(
          asnKey,
          'job_start',
          job.date!
        )

        if (alreadySent) continue

        const startTenant = job.tenant_id ? await getTenantById(job.tenant_id) : null
        if (!startTenant) continue
        const result = await sendJobReminder(startTenant, cleaner, job, customer, 'job_start')

        if (result.success) {
          startTimeSent += 1
          await markReminderSent(
            asnKey,
            'job_start',
            job.date!,
            job.scheduled_at || undefined
          )

          await logSystemEvent({
            source: 'cron',
            event_type: 'REMINDER_SENT',
            message: `Sent job start reminder to cleaner ${cleaner.id} for job ${job.id}`,
            job_id: job.id,
            cleaner_id: cleaner.id,
            metadata: {
              reminder_type: 'job_start',
              job_time: job.scheduled_at,
              timezone: tz,
            },
          })
        } else {
          errors.push(
            `Start time reminder failed for job ${job.id}, cleaner ${cleaner.id}: ${result.error}`
          )
        }
      }
    }

    // 4. WinBros: 5pm evening-before notification (jobs TOMORROW)
    // Sends a reminder to each assigned cleaner/salesman about their job tomorrow
    const allTenants = await getAllActiveTenants()

    for (const t of allTenants) {
      // Only WinBros-style tenants get evening-before reminders
      if (!t.workflow_config?.use_route_optimization && t.slug !== 'winbros') continue

      const tz = t.timezone || 'America/Chicago'
      const localTime = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now)
      const [localHourStr] = localTime.split(':')
      const localHour = parseInt(localHourStr)

      if (localHour !== 17) continue // Only at 5pm

      // Get tomorrow's date in this timezone
      const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      const tomorrowLocal = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(tomorrowDate)

      // Get all cleaners for this tenant
      const tenantCleaners = await getCleaners(undefined, t.id)

      for (const cleaner of tenantCleaners) {
        if (!cleaner.id || !cleaner.phone) continue

        const jobsData = await getCleanerJobsForDate(cleaner.id, tomorrowLocal)
        if (jobsData.length === 0) continue

        for (const { job, assignment, customer } of jobsData) {
          const alreadySent = await hasReminderBeenSent(
            String(assignment.id),
            'evening_before',
            tomorrowLocal
          )
          if (alreadySent) continue

          const timeStr = job.scheduled_at || 'TBD'
          const dateStr = new Date(tomorrowLocal + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })
          const address = job.address || 'Address TBD'
          const customerName = customer
            ? [customer.first_name, customer.last_name].filter(Boolean).join(' ')
            : 'Customer'
          const eveningMsg = `Heads up: Job tomorrow ${dateStr} at ${timeStr}. ${address}. ${customerName}. Get ready for tomorrow!`
          const result = await sendSMS(t, cleaner.phone, eveningMsg)
          if (result.success) {
            eveningBeforeSent += 1
            await markReminderSent(String(assignment.id), 'evening_before', tomorrowLocal, job.scheduled_at || undefined)

            await logSystemEvent({
              tenant_id: t.id,
              source: 'cron',
              event_type: 'REMINDER_SENT',
              message: `Sent evening-before reminder to cleaner ${cleaner.id} for job ${job.id} (tomorrow)`,
              job_id: job.id,
              cleaner_id: cleaner.id,
              metadata: {
                reminder_type: 'evening_before',
                job_date: tomorrowLocal,
                job_time: job.scheduled_at,
                timezone: tz,
              },
            })
          } else {
            errors.push(`Evening-before reminder failed for job ${job.id}, cleaner ${cleaner.id}: ${result.error}`)
          }
        }
      }
    }

    // 5. WinBros: 7am (≈6:59am) morning schedule — send full day schedule to ALL cleaners
    // Unlike the 8am schedule which is team-leads only, this goes to every cleaner with jobs
    for (const t of allTenants) {
      if (!t.workflow_config?.use_route_optimization && t.slug !== 'winbros') continue

      const tz = t.timezone || 'America/Chicago'
      const localTime = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now)
      const [localHourStr] = localTime.split(':')
      const localHour = parseInt(localHourStr)

      if (localHour !== 7) continue // Only at 7am (closest to 6:59am with hourly cron)

      const todayLocal = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now)

      const tenantCleaners = await getCleaners(undefined, t.id)

      for (const cleaner of tenantCleaners) {
        if (!cleaner.id || !cleaner.phone) continue

        const jobsData = await getCleanerJobsForDate(cleaner.id, todayLocal)
        if (jobsData.length === 0) continue

        const firstAssignment = jobsData[0].assignment
        const alreadySent = await hasReminderBeenSent(
          String(firstAssignment.id),
          'morning_schedule',
          todayLocal
        )
        if (alreadySent) continue

        const jobs = jobsData.map(jd => ({
          ...jd.job,
          customer: jd.customer,
        }))
        const result = await sendDailySchedule(t, cleaner, jobs)

        if (result.success) {
          morningScheduleSent += 1
          await markReminderSent(String(firstAssignment.id), 'morning_schedule', todayLocal)

          await logSystemEvent({
            tenant_id: t.id,
            source: 'cron',
            event_type: 'REMINDER_SENT',
            message: `Sent 7am morning schedule to cleaner ${cleaner.id} (${jobs.length} jobs)`,
            cleaner_id: cleaner.id,
            metadata: {
              reminder_type: 'morning_schedule',
              job_count: jobs.length,
              timezone: tz,
            },
          })
        } else {
          errors.push(`Morning schedule failed for cleaner ${cleaner.id}: ${result.error}`)
        }
      }
    }

    // 6. Customer SMS reminders for recurring residential jobs (day before)
    // Commercial customers don't get reminders — residential get a friendly heads-up
    let customerSmsSent = 0
    const svc = getSupabaseServiceClient()

    for (const t of allTenants) {
      const tz = t.timezone || 'America/Chicago'
      const localTime = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now)
      const [localHourStr] = localTime.split(':')
      const localHour = parseInt(localHourStr)

      if (localHour !== 17) continue // Send at 5pm local, day before

      const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      const tomorrowLocal = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(tomorrowDate)

      // Find recurring jobs for tomorrow with customer info
      const { data: tomorrowJobs } = await svc
        .from('jobs')
        .select('id, date, scheduled_at, service_type, address, phone_number, frequency, parent_job_id, customer_id, customers(id, first_name, last_name, phone_number, is_commercial)')
        .eq('tenant_id', t.id)
        .eq('date', tomorrowLocal)
        .in('status', ['scheduled', 'pending'])
        .or('frequency.neq.one-time,parent_job_id.not.is.null')

      for (const job of tomorrowJobs || []) {
        const customer = (job as any).customers
        if (!customer) continue

        // Skip commercial customers — no reminder needed
        if (customer.is_commercial) continue

        const customerPhone = customer.phone_number || job.phone_number
        if (!customerPhone) continue

        // Dedup: check if we already sent this reminder
        const dedupKey = `customer_recurring_${job.id}`
        const alreadySent = await hasReminderBeenSent(dedupKey, 'customer_recurring_reminder', tomorrowLocal)
        if (alreadySent) continue

        const customerName = customer.first_name || 'there'
        const serviceLabel = job.service_type
          ? job.service_type.split(/[\s_]+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
          : 'cleaning'
        const timeStr = job.scheduled_at || ''
        const timePart = timeStr ? ` at ${timeStr}` : ''

        const smsMessage = `Hi ${customerName}! Friendly reminder — your ${serviceLabel} is scheduled for tomorrow${timePart}. Same great team as always! Let us know if you need anything.`

        const result = await sendSMS(t, customerPhone, smsMessage, { source: 'customer_reminder' })
        if (result.success) {
          customerSmsSent++
          await markReminderSent(dedupKey, 'customer_recurring_reminder', tomorrowLocal)
        } else {
          errors.push(`Customer SMS failed for job ${job.id}: ${result.error}`)
        }
      }
    }

    // Log summary
    if (errors.length > 0) {
      console.error('Reminder cron errors:', errors)
    }

    return NextResponse.json({
      success: true,
      timestamp: now.toISOString(),
      daily_sent: dailySent,
      one_hour_before_sent: oneHourSent,
      start_time_sent: startTimeSent,
      evening_before_sent: eveningBeforeSent,
      morning_schedule_sent: morningScheduleSent,
      customer_sms_sent: customerSmsSent,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('Reminder cron job error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
