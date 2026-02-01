import { NextRequest, NextResponse } from "next/server"
import { triggerCleanerAssignment } from "@/lib/cleaner-assignment"
import { logSystemEvent } from "@/lib/system-events"

/**
 * POST /api/automation/job-broadcast
 *
 * Triggered via internal scheduler when a job needs cleaner assignment.
 * Uses VRP-based cleaner selection (nearest available cleaner)
 * and sends Telegram notifications for acceptance.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify internal cron authorization
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET

    // Allow calls from cron job or internal services
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.error("[job-broadcast] Unauthorized request")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.text()

    // Parse request body
    let payload: { jobId?: string; job_id?: string }
    try {
      payload = JSON.parse(body)
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 }
      )
    }

    const jobId = payload.jobId || payload.job_id
    if (!jobId) {
      return NextResponse.json(
        { success: false, error: "Job ID required" },
        { status: 400 }
      )
    }

    console.log(`[job-broadcast] Processing cleaner assignment for job ${jobId}`)

    // Trigger the VRP-based cleaner assignment
    const result = await triggerCleanerAssignment(jobId)

    if (!result.success) {
      console.error(`[job-broadcast] Assignment failed for job ${jobId}: ${result.error}`)

      // Log the failure
      await logSystemEvent({
        source: "scheduler",
        event_type: "OWNER_ACTION_REQUIRED",
        message: `Cleaner assignment failed for job ${jobId}: ${result.error}`,
        job_id: jobId,
        metadata: { error: result.error },
      })

      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      )
    }

    console.log(`[job-broadcast] Successfully initiated cleaner assignment for job ${jobId}`)

    return NextResponse.json({
      success: true,
      message: "Cleaner assignment initiated",
      jobId,
    })
  } catch (error) {
    console.error("[job-broadcast] Error:", error)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}
