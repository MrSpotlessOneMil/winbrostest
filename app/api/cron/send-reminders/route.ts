import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import {
  getCleaners,
  getCleanerJobsForDate,
  getJobsStartingSoon,
  hasReminderBeenSent,
  markReminderSent,
} from '@/lib/supabase'
import { sendDailySchedule, sendJobReminder } from '@/lib/telegram'
import { logSystemEvent } from '@/lib/system-events'

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  try {
    const now = new Date()

    // Get current time in Pacific timezone
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
    const errors: string[] = []

    // 1. Send daily 8am PST notifications (run if current time is 8:00-8:14 PST)
    if (currentHour === 8 && currentMinute < 15) {
      const cleaners = await getCleaners()

      for (const cleaner of cleaners) {
        if (!cleaner.id || !cleaner.telegram_id) continue

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
    const oneHourBeforeJobs = await getJobsStartingSoon(-75, -45)

    for (const { job, assignment, cleaner, customer } of oneHourBeforeJobs) {
      const alreadySent = await hasReminderBeenSent(
        String(assignment.id),
        'one_hour_before',
        job.date!
      )

      if (alreadySent) continue

      const result = await sendJobReminder(cleaner, job, customer, 'one_hour_before')

      if (result.success) {
        oneHourSent += 1
        await markReminderSent(
          String(assignment.id),
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
          },
        })
      } else {
        errors.push(
          `1-hour reminder failed for job ${job.id}, cleaner ${cleaner.id}: ${result.error}`
        )
      }
    }

    // 3. Send job start time notifications (jobs starting in -15 to +15 minutes)
    const startingNowJobs = await getJobsStartingSoon(-15, 15)

    for (const { job, assignment, cleaner, customer } of startingNowJobs) {
      const alreadySent = await hasReminderBeenSent(
        String(assignment.id),
        'job_start',
        job.date!
      )

      if (alreadySent) continue

      const result = await sendJobReminder(cleaner, job, customer, 'job_start')

      if (result.success) {
        startTimeSent += 1
        await markReminderSent(
          String(assignment.id),
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
          },
        })
      } else {
        errors.push(
          `Start time reminder failed for job ${job.id}, cleaner ${cleaner.id}: ${result.error}`
        )
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
