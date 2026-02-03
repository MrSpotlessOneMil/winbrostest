import { NextRequest, NextResponse } from "next/server"
import { getSupabaseClient } from "@/lib/supabase"
import { getDefaultTenant } from "@/lib/tenant"
import { cancelTask, scheduleTask } from "@/lib/scheduler"
import { sendSMS } from "@/lib/openphone"
import { initiateOutboundCall } from "@/lib/vapi"
import { logSystemEvent } from "@/lib/system-events"

/**
 * Lead Actions API
 *
 * POST /api/leads/[id]/actions
 *
 * Actions:
 * - skip_to_stage: Skip to a specific follow-up stage (no action execution)
 * - mark_status: Mark lead as booked, lost, or review_sent
 * - move_to_stage: Move to a stage and EXECUTE the action (send text/make call)
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
        if (typeof stage !== "number" || stage < 1 || stage > 10) {
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

      case "move_to_stage": {
        // Move to a stage AND execute the action (for drag & drop)
        if (typeof stage !== "number" || stage < 1 || stage > 10) {
          return NextResponse.json({ success: false, error: "Invalid stage" }, { status: 400 })
        }

        // Cancel all pending follow-up tasks first
        for (let s = 1; s <= 5; s++) {
          const taskKey = `lead-${leadId}-stage-${s}`
          await cancelTask(taskKey)
        }

        // Reset status from "lost" to "new" if needed
        const newStatus = lead.status === "lost" ? "new" : lead.status

        // Update the lead
        const { error: updateError } = await client
          .from("leads")
          .update({
            followup_stage: stage,
            status: newStatus,
            followup_started_at: new Date().toISOString(),
          })
          .eq("id", leadId)

        if (updateError) {
          throw updateError
        }

        // Get lead and customer info for messaging
        const leadName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Customer'
        const leadPhone = lead.phone_number
        const businessName = tenant?.business_name_short || tenant?.name || 'Our team'

        // Define stage actions
        const stageActions: Record<number, { type: 'text' | 'call'; getMessage?: () => string }> = {
          1: {
            type: 'text',
            getMessage: () => `Hi ${leadName}! Thanks for reaching out to ${businessName}. We'd love to help with your cleaning needs. Can you share your address and number of bedrooms/bathrooms so we can give you an instant quote?`
          },
          2: {
            type: 'text',
            getMessage: () => `Hi ${leadName}, just checking in! We have openings this week for cleaning services. Reply with your home details (beds/baths/sqft) and we'll send you pricing right away!`
          },
          3: { type: 'call' },
          4: { type: 'call' },  // Double dial
          5: {
            type: 'text',
            getMessage: () => `Hi ${leadName}, last chance to book your cleaning with ${businessName}! We have limited availability this week. Reply with your address and beds/baths for an instant quote, or call us directly!`
          },
        }

        const stageAction = stageActions[stage]
        let actionResult = { success: true, message: '' }

        if (stageAction) {
          if (stageAction.type === 'text' && stageAction.getMessage) {
            // Send text
            const message = stageAction.getMessage()
            const smsResult = await sendSMS(tenant, leadPhone, message)

            if (smsResult.success) {
              // Save to messages table
              console.log(`[move_to_stage] Saving message to DB for phone ${leadPhone}, customer_id ${lead.customer_id}`)
              const { error: msgError } = await client.from("messages").insert({
                tenant_id: tenant.id,
                customer_id: lead.customer_id,
                phone_number: leadPhone,
                role: "business",
                content: message,
                timestamp: new Date().toISOString(),
              })
              if (msgError) {
                console.error(`[move_to_stage] Failed to save message:`, msgError)
              } else {
                console.log(`[move_to_stage] Message saved successfully for ${leadPhone}`)
              }
              actionResult.message = `Text sent for stage ${stage}`
            } else {
              console.error(`[move_to_stage] SMS failed:`, smsResult.error)
              actionResult = { success: false, message: smsResult.error || 'Failed to send text' }
            }
          } else if (stageAction.type === 'call') {
            // Initiate call
            try {
              await initiateOutboundCall(leadPhone, leadName, { leadId })
              actionResult.message = `Call initiated for stage ${stage}`

              // For stage 4 (double dial), schedule a second call in 30 seconds
              if (stage === 4) {
                setTimeout(async () => {
                  try {
                    await initiateOutboundCall(leadPhone, leadName, { leadId })
                  } catch (e) {
                    console.error('[move_to_stage] Double dial second call failed:', e)
                  }
                }, 30000)
              }
            } catch (e) {
              actionResult = { success: false, message: 'Failed to initiate call' }
            }
          }
        }

        // Schedule subsequent stages (only for stages 1-4)
        if (stage >= 1 && stage < 5) {
          const now = new Date()
          const subsequentStages = [
            { stage: 2, action: 'text', delayMinutes: 10 },
            { stage: 3, action: 'call', delayMinutes: 15 },
            { stage: 4, action: 'call', delayMinutes: 17 },
            { stage: 5, action: 'text', delayMinutes: 30 },
          ].filter(s => s.stage > stage)

          for (const { stage: stageNum, action: actionType, delayMinutes } of subsequentStages) {
            try {
              const scheduledFor = new Date(now.getTime() + delayMinutes * 60 * 1000)
              await scheduleTask({
                tenantId: tenant.id,
                taskType: 'lead_followup',
                taskKey: `lead-${leadId}-stage-${stageNum}`,
                scheduledFor,
                payload: {
                  leadId: String(leadId),
                  leadPhone,
                  leadName,
                  stage: stageNum,
                  action: actionType,
                },
              })
            } catch (scheduleError) {
              console.error(`[move_to_stage] Error scheduling stage ${stageNum}:`, scheduleError)
            }
          }
        }

        // Log the event
        await logSystemEvent({
          source: "lead_actions",
          event_type: "LEAD_STAGE_CHANGED",
          message: `Lead moved to stage ${stage} via drag & drop${actionResult.message ? ': ' + actionResult.message : ''}`,
          phone_number: leadPhone,
          metadata: { leadId, stage, actionResult },
        })

        return NextResponse.json({
          success: true,
          data: {
            leadId,
            newStage: stage,
            newStatus,
            actionExecuted: stageAction?.type || null,
            actionResult,
          },
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
