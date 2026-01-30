import { NextRequest, NextResponse } from "next/server"
import { createSchedule, listSchedules, deleteSchedule } from "@/lib/qstash"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_DOMAIN || process.env.VERCEL_URL

function getFullUrl(path: string): string {
  const baseUrl = APP_URL?.startsWith("http") ? APP_URL : `https://${APP_URL}`
  return `${baseUrl}${path}`
}

/**
 * POST /api/setup/qstash-schedules
 *
 * Sets up all required QStash cron schedules for the lead automation system.
 * Should be called once after deployment.
 *
 * Schedules created:
 * 1. Post-cleaning follow-up: Every 15 minutes
 * 2. Monthly follow-up: Daily at 10am PST
 * 3. GHL follow-up processor: Every 2 minutes (for lead follow-up queue)
 */
export async function POST(request: NextRequest) {
  // Simple auth check - require CRON_SECRET or admin
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET || process.env.QSTASH_TOKEN

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const results: Array<{ name: string; scheduleId?: string; error?: string }> = []

    // Schedule 1: Post-cleaning follow-up - every 15 minutes
    try {
      const postCleaningSchedule = await createSchedule({
        destination: getFullUrl("/api/cron/post-cleaning-followup"),
        cron: "*/15 * * * *", // Every 15 minutes
        retries: 3,
      })
      results.push({
        name: "post-cleaning-followup",
        scheduleId: postCleaningSchedule.scheduleId,
      })
    } catch (error) {
      results.push({
        name: "post-cleaning-followup",
        error: error instanceof Error ? error.message : "Unknown error",
      })
    }

    // Schedule 2: Monthly follow-up - daily at 10am PST (6pm UTC)
    try {
      const monthlySchedule = await createSchedule({
        destination: getFullUrl("/api/cron/monthly-followup"),
        cron: "0 18 * * *", // 10am PST = 6pm UTC
        retries: 3,
      })
      results.push({
        name: "monthly-followup",
        scheduleId: monthlySchedule.scheduleId,
      })
    } catch (error) {
      results.push({
        name: "monthly-followup",
        error: error instanceof Error ? error.message : "Unknown error",
      })
    }

    // Schedule 3: GHL follow-up processor - every 2 minutes
    try {
      const ghlSchedule = await createSchedule({
        destination: getFullUrl("/api/cron/ghl-followups"),
        cron: "*/2 * * * *", // Every 2 minutes
        retries: 3,
      })
      results.push({
        name: "ghl-followups",
        scheduleId: ghlSchedule.scheduleId,
      })
    } catch (error) {
      results.push({
        name: "ghl-followups",
        error: error instanceof Error ? error.message : "Unknown error",
      })
    }

    // Schedule 4: Daily cleaner reminders - 8am PST (4pm UTC)
    try {
      const reminderSchedule = await createSchedule({
        destination: getFullUrl("/api/cron/send-reminders"),
        cron: "0 16 * * *", // 8am PST = 4pm UTC
        retries: 3,
      })
      results.push({
        name: "send-reminders",
        scheduleId: reminderSchedule.scheduleId,
      })
    } catch (error) {
      results.push({
        name: "send-reminders",
        error: error instanceof Error ? error.message : "Unknown error",
      })
    }

    // Schedule 5: Unified daily job (daily schedules, reports) - 7am PST (3pm UTC)
    try {
      const unifiedSchedule = await createSchedule({
        destination: getFullUrl("/api/cron/unified-daily"),
        cron: "0 15 * * *", // 7am PST = 3pm UTC
        retries: 3,
      })
      results.push({
        name: "unified-daily",
        scheduleId: unifiedSchedule.scheduleId,
      })
    } catch (error) {
      results.push({
        name: "unified-daily",
        error: error instanceof Error ? error.message : "Unknown error",
      })
    }

    // Schedule 6: Check timeouts - every 5 minutes
    try {
      const timeoutSchedule = await createSchedule({
        destination: getFullUrl("/api/cron/check-timeouts"),
        cron: "*/5 * * * *", // Every 5 minutes
        retries: 3,
      })
      results.push({
        name: "check-timeouts",
        scheduleId: timeoutSchedule.scheduleId,
      })
    } catch (error) {
      results.push({
        name: "check-timeouts",
        error: error instanceof Error ? error.message : "Unknown error",
      })
    }

    const successful = results.filter((r) => r.scheduleId).length
    const failed = results.filter((r) => r.error).length

    return NextResponse.json({
      success: true,
      message: `Created ${successful} schedules, ${failed} failed`,
      results,
    })
  } catch (error) {
    console.error("Error setting up QStash schedules:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

/**
 * GET /api/setup/qstash-schedules
 *
 * Lists all existing QStash schedules
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET || process.env.QSTASH_TOKEN

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const schedules = await listSchedules()
    return NextResponse.json({
      success: true,
      schedules,
    })
  } catch (error) {
    console.error("Error listing QStash schedules:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/setup/qstash-schedules
 *
 * Deletes all existing QStash schedules (for cleanup/reset)
 */
export async function DELETE(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET || process.env.QSTASH_TOKEN

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const schedules = await listSchedules()
    const results: Array<{ scheduleId: string; deleted: boolean; error?: string }> = []

    for (const schedule of schedules) {
      try {
        await deleteSchedule(schedule.scheduleId)
        results.push({ scheduleId: schedule.scheduleId, deleted: true })
      } catch (error) {
        results.push({
          scheduleId: schedule.scheduleId,
          deleted: false,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      }
    }

    return NextResponse.json({
      success: true,
      message: `Deleted ${results.filter((r) => r.deleted).length} of ${schedules.length} schedules`,
      results,
    })
  } catch (error) {
    console.error("Error deleting QStash schedules:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
