import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import {
  getCleaners,
  getCleanerJobsForDate,
  getJobsStartingSoon,
  hasReminderBeenSent,
  markReminderSent,
} from '@/lib/supabase'
import { sendDailySchedule, sendJobReminder, sendTelegramMessage } from '@/lib/telegram'
import { logSystemEvent } from '@/lib/system-events'
import { getAllActiveTenants } from '@/lib/tenant'

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

    // Get current time in Pacific timezone (for backwards-compat 8 AM daily schedule)
    const pacificTime = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now)

    const [hourStr, minuteStr] = pacificTime.split(':')
    const currentHour = parseInt(hourStr)
    const currentMinute = parseInt(minuteStr)

    // Get today's date in Pacific timezone
    const todayPST = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)

    let dailySent = 0
    let oneHourSent = 0
    let startTimeSent = 0
    let eveningBeforeSent = 0
    let morningScheduleSent = 0
    const errors: string[] = []

    // 1. Send daily 8am PST route/schedule — team leads only
    if (currentHour === 8 && currentMinute < 15) {
      const cleaners = await getCleaners()

      for (const cleaner of cleaners) {
        if (!cleaner.id || !cleaner.telegram_id) continue
        // Only team leads get the full day's route schedule
        if (!cleaner.is_team_lead) continue

        const jobsData = await getCleanerJobsForDate(cleaner.id, todayPST)

        if (jobsData.length === 0) continue // No jobs today, skip

        // Check if daily reminder already sent
        const firstAssignment = jobsData[0].assignment
        const alreadySent = await hasReminderBeenSent(
          String(firstAssignment.id),
          'daily_8am',
          todayPST
        )

        if (alreadySent) continue

        // Send daily schedule
        const jobs = jobsData.map(jd => ({
          ...jd.job,
          customer: jd.customer,
        }))
        const result = await sendDailySchedule(cleaner, jobs)

        if (result.success) {
          dailySent += 1
          // Mark as sent for the first assignment (represents the cleaner's daily reminder)
          await markReminderSent(String(firstAssignment.id), 'daily_8am', todayPST)

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

        const result = await sendJobReminder(cleaner, job, customer, 'one_hour_before')

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

        const result = await sendJobReminder(cleaner, job, customer, 'job_start')

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
        if (!cleaner.id || !cleaner.telegram_id) continue

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
          const eveningMsg = [
            `<b>Heads up: Job tomorrow</b>`,
            ``,
            `${dateStr} at ${timeStr}`,
            `${address}`,
            `${customerName}`,
            ``,
            `Get ready for tomorrow!`,
          ].join('\n')
          const result = await sendTelegramMessage(t, cleaner.telegram_id, eveningMsg, 'HTML')
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
        if (!cleaner.id || !cleaner.telegram_id) continue

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
