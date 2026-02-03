import { NextRequest, NextResponse } from "next/server"
import { getSupabaseClient } from "@/lib/supabase"
import { getDefaultTenant } from "@/lib/tenant"
import { cancelTask } from "@/lib/scheduler"

/**
 * Lead Actions API
 *
 * POST /api/leads/[id]/actions
 *
 * Actions:
 * - skip_to_stage: Skip to a specific follow-up stage
 * - mark_status: Mark lead as booked, lost, or review_sent
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const leadId = id

  if (!leadId) {
    return NextResponse.json({ success: false, error: "Lead ID required" }, { status: 400 })
  }

  const client = getSupabaseClient()
  const tenant = await getDefaultTenant()

  if (!tenant) {
    return NextResponse.json({ success: false, error: "No tenant found" }, { status: 500 })
  }

  // Get the lead
  const { data: lead, error: leadError } = await client
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single()

  if (leadError || !lead) {
    return NextResponse.json({ success: false, error: "Lead not found" }, { status: 404 })
  }

  const body = await request.json()
  const { action, stage, status } = body

  try {
    switch (action) {
      case "skip_to_stage": {
        if (typeof stage !== "number" || stage < 1 || stage > 6) {
          return NextResponse.json({ success: false, error: "Invalid stage" }, { status: 400 })
        }

        // Cancel all pending tasks for stages before the target stage
        for (let s = lead.followup_stage + 1; s < stage; s++) {
          const taskKey = `lead-${leadId}-stage-${s}`
          await cancelTask(taskKey)
        }

        // Update the lead's followup_stage
        const { error: updateError } = await client
          .from("leads")
          .update({ followup_stage: stage })
          .eq("id", leadId)

        if (updateError) {
          throw updateError
        }

        return NextResponse.json({
          success: true,
          data: { leadId, newStage: stage },
        })
      }

      case "mark_status": {
        if (!["booked", "lost", "review_sent", "new", "contacted", "qualified"].includes(status)) {
          return NextResponse.json({ success: false, error: "Invalid status" }, { status: 400 })
        }

        // If marking as booked, lost, or review_sent, cancel all pending follow-up tasks
        if (["booked", "lost", "review_sent"].includes(status)) {
          for (let s = 1; s <= 5; s++) {
            const taskKey = `lead-${leadId}-stage-${s}`
            await cancelTask(taskKey)
          }
        }

        const { error: updateError } = await client
          .from("leads")
          .update({ status })
          .eq("id", leadId)

        if (updateError) {
          throw updateError
        }

        return NextResponse.json({
          success: true,
          data: { leadId, newStatus: status },
        })
      }

      default:
        return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 })
    }
  } catch (error) {
    console.error("Lead action error:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
