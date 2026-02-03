import { NextRequest, NextResponse } from "next/server"
import { sendSMS } from "@/lib/openphone"
import { triggerVAPIOutboundCall } from "@/integrations/ghl/follow-up-scheduler"
import { leadFollowupInitial, leadFollowupSecond, paymentLink } from "@/lib/sms-templates"
import { getGHLLeadById, updateGHLLead, getCustomerByPhone, getSupabaseClient } from "@/lib/supabase"
import { createDepositPaymentLink } from "@/lib/stripe-client"
import { getClientConfig } from "@/lib/client-config"
import { logSystemEvent } from "@/lib/system-events"
import { toE164 } from "@/lib/phone-utils"
import { getDefaultTenant } from "@/lib/tenant"

interface LeadFollowupPayload {
  leadId: string
  leadPhone: string
  leadName: string
  stage: 1 | 2 | 3 | 4 | 5
  action: "text" | "call" | "double_call"
}

/**
 * Lead Follow-up Automation Endpoint
 *
 * Receives internally scheduled messages for automated lead follow-up sequences:
 * - Stage 1 (text): Send initial follow-up SMS
 * - Stage 2 (call): Initiate VAPI call
 * - Stage 3 (double_call): Call twice with 30 second gap
 * - Stage 4 (text): Send second follow-up SMS
 * - Stage 5 (call + payment link): Call, then create and send payment link
 */
export async function POST(request: NextRequest) {
  // 1. Verify internal cron authorization
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  // Allow calls from cron job or internal services
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.error("[lead-followup] Unauthorized request")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.text()

  // 2. Parse the body and extract payload
  let payload: LeadFollowupPayload
  try {
    payload = JSON.parse(body)
  } catch {
    console.error("[lead-followup] Invalid JSON body")
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { leadId, leadPhone, leadName, stage, action } = payload

  if (!leadId || !leadPhone || !stage || !action) {
    console.error("[lead-followup] Missing required fields:", { leadId, leadPhone, stage, action })
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  // 3. Check if lead still exists and hasn't converted
  const lead = await getGHLLeadById(leadId)
  if (!lead) {
    console.log(`[lead-followup] Lead ${leadId} not found, skipping`)
    return NextResponse.json({ success: true, skipped: true, reason: "Lead not found" })
  }

  if (lead.status === "booked") {
    console.log(`[lead-followup] Lead ${leadId} already booked, skipping`)
    return NextResponse.json({ success: true, skipped: true, reason: "Lead already booked" })
  }

  // Skip if lead is lost or unqualified
  if (lead.status === "lost" || lead.status === "unqualified") {
    console.log(`[lead-followup] Lead ${leadId} is ${lead.status}, skipping`)
    return NextResponse.json({ success: true, skipped: true, reason: `Lead ${lead.status}` })
  }

  const config = getClientConfig(lead.brand)
  const firstName = leadName || lead.first_name || "there"

  try {
    // 4. Execute based on stage/action
    let result: { success: boolean; error?: string; details?: Record<string, unknown> }

    switch (stage) {
      case 1:
        // Stage 1: Send initial follow-up SMS
        result = await executeStage1(leadPhone, firstName, config.businessName, lead.brand, lead.customer_id)
        await updateLeadAfterOutreach(leadId, lead, { smsIncrement: 1, stage: 1 })
        break

      case 2:
        // Stage 2: Initiate VAPI call
        result = await executeStage2(lead, firstName, leadPhone)
        await updateLeadAfterOutreach(leadId, lead, { callIncrement: 1, stage: 2 })
        break

      case 3:
        // Stage 3: Double call with 30 second gap
        result = await executeStage3(lead, firstName, leadPhone)
        await updateLeadAfterOutreach(leadId, lead, { callIncrement: 2, stage: 3 })
        break

      case 4:
        // Stage 4: Send second follow-up SMS
        result = await executeStage4(leadPhone, firstName, lead.brand, lead.customer_id)
        await updateLeadAfterOutreach(leadId, lead, { smsIncrement: 1, stage: 4 })
        break

      case 5:
        // Stage 5: Call + payment link
        result = await executeStage5(lead, firstName, leadPhone)
        await updateLeadAfterOutreach(leadId, lead, { callIncrement: 1, smsIncrement: 1, stage: 5 })
        break

      default:
        result = { success: false, error: `Unknown stage: ${stage}` }
    }

    // Log the automation event
    await logSystemEvent({
      source: "lead_followup",
      event_type: `LEAD_FOLLOWUP_STAGE_${stage}`,
      message: result.success
        ? `Stage ${stage} (${action}) executed successfully`
        : `Stage ${stage} (${action}) failed: ${result.error}`,
      phone_number: leadPhone,
      metadata: {
        lead_id: leadId,
        stage,
        action,
        success: result.success,
        ...result.details,
      },
    })

    if (!result.success) {
      console.error(`[lead-followup] Stage ${stage} failed:`, result.error)
      return NextResponse.json(
        { success: false, error: result.error, stage, action },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      stage,
      action,
      leadId,
      ...result.details,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[lead-followup] Stage ${stage} error:`, error)

    await logSystemEvent({
      source: "lead_followup",
      event_type: "LEAD_FOLLOWUP_ERROR",
      message: `Stage ${stage} (${action}) error: ${errorMessage}`,
      phone_number: leadPhone,
      metadata: {
        lead_id: leadId,
        stage,
        action,
        error: errorMessage,
      },
    })

    return NextResponse.json(
      { success: false, error: errorMessage, stage, action },
      { status: 500 }
    )
  }
}

/**
 * Stage 1: Send initial follow-up SMS using leadFollowupInitial template
 */
async function executeStage1(
  phone: string,
  name: string,
  businessName: string,
  brand?: string,
  customerId?: string
): Promise<{ success: boolean; error?: string; details?: Record<string, unknown> }> {
  const message = leadFollowupInitial(name, businessName)
  const result = await sendSMS(phone, message, brand)

  // Save to messages table
  if (result.success) {
    await saveOutboundMessage(phone, message, customerId)
  }

  return {
    success: result.success,
    error: result.error,
    details: { messageId: result.messageId, template: "leadFollowupInitial" },
  }
}

/**
 * Stage 2: Initiate VAPI call
 */
async function executeStage2(
  lead: { id?: string; first_name?: string; phone_number: string; job_id?: string; customer_id?: string; brand?: string },
  name: string,
  phone: string
): Promise<{ success: boolean; error?: string; details?: Record<string, unknown> }> {
  const callResult = await triggerVAPIOutboundCall({
    id: lead.id,
    first_name: name,
    phone_number: phone,
    job_id: lead.job_id,
    customer_id: lead.customer_id,
    brand: lead.brand,
  })

  return {
    success: callResult.success,
    error: callResult.error,
    details: { callId: callResult.callId },
  }
}

/**
 * Stage 3: Double call with 30 second gap
 */
async function executeStage3(
  lead: { id?: string; first_name?: string; phone_number: string; job_id?: string; customer_id?: string; brand?: string },
  name: string,
  phone: string
): Promise<{ success: boolean; error?: string; details?: Record<string, unknown> }> {
  // First call
  const firstCallResult = await triggerVAPIOutboundCall({
    id: lead.id,
    first_name: name,
    phone_number: phone,
    job_id: lead.job_id,
    customer_id: lead.customer_id,
    brand: lead.brand,
  })

  if (!firstCallResult.success) {
    return {
      success: false,
      error: `First call failed: ${firstCallResult.error}`,
      details: { firstCallId: firstCallResult.callId },
    }
  }

  // Wait 30 seconds before second call
  await sleep(30000)

  // Second call
  const secondCallResult = await triggerVAPIOutboundCall({
    id: lead.id,
    first_name: name,
    phone_number: phone,
    job_id: lead.job_id,
    customer_id: lead.customer_id,
    brand: lead.brand,
  })

  return {
    success: secondCallResult.success,
    error: secondCallResult.error,
    details: {
      firstCallId: firstCallResult.callId,
      secondCallId: secondCallResult.callId,
      doubleCallCompleted: secondCallResult.success,
    },
  }
}

/**
 * Stage 4: Send second follow-up SMS using leadFollowupSecond template
 */
async function executeStage4(
  phone: string,
  name: string,
  brand?: string,
  customerId?: string
): Promise<{ success: boolean; error?: string; details?: Record<string, unknown> }> {
  const message = leadFollowupSecond(name)
  const result = await sendSMS(phone, message, brand)

  // Save to messages table
  if (result.success) {
    await saveOutboundMessage(phone, message, customerId)
  }

  return {
    success: result.success,
    error: result.error,
    details: { messageId: result.messageId, template: "leadFollowupSecond" },
  }
}

/**
 * Stage 5: Call + create and send payment link
 */
async function executeStage5(
  lead: { id?: string; first_name?: string; phone_number: string; job_id?: string; customer_id?: string; brand?: string },
  name: string,
  phone: string
): Promise<{ success: boolean; error?: string; details?: Record<string, unknown> }> {
  // First, initiate VAPI call
  const callResult = await triggerVAPIOutboundCall({
    id: lead.id,
    first_name: name,
    phone_number: phone,
    job_id: lead.job_id,
    customer_id: lead.customer_id,
    brand: lead.brand,
  })

  // Even if call fails, try to send payment link if we have job context
  let paymentLinkResult: { success: boolean; url?: string; amount?: number; error?: string } = {
    success: false,
    error: "No job context for payment link",
  }

  // Try to create and send payment link
  const customer = await getCustomerByPhone(phone)
  if (customer && lead.job_id) {
    // Get job details for payment link
    const { getJobById } = await import("@/lib/supabase")
    const job = await getJobById(lead.job_id)

    if (job && customer.email) {
      paymentLinkResult = await createDepositPaymentLink(customer, job)

      if (paymentLinkResult.success && paymentLinkResult.url) {
        // Send SMS with payment link
        const paymentMessage = paymentLink(
          name,
          paymentLinkResult.amount || 0,
          paymentLinkResult.url
        )
        const smsResult = await sendSMS(phone, paymentMessage, lead.brand)

        if (smsResult.success) {
          // Save to messages table
          await saveOutboundMessage(phone, paymentMessage, lead.customer_id)
        } else {
          console.warn(`[lead-followup] Failed to send payment link SMS: ${smsResult.error}`)
        }

        // Update lead with payment link
        if (lead.id) {
          await updateGHLLead(lead.id, {
            // Note: stripe_payment_link column exists per schema migration
            form_data: {
              ...(typeof lead === 'object' && lead !== null && 'form_data' in lead && typeof (lead as Record<string, unknown>).form_data === 'object'
                ? (lead as Record<string, unknown>).form_data as Record<string, unknown>
                : {}),
              stripe_payment_link: paymentLinkResult.url,
            },
          })
        }
      }
    } else {
      paymentLinkResult = {
        success: false,
        error: customer
          ? "Customer has no email for payment link"
          : "Customer not found for payment link",
      }
    }
  }

  // Consider stage successful if either call or payment link succeeded
  const overallSuccess = callResult.success || paymentLinkResult.success

  return {
    success: overallSuccess,
    error: overallSuccess
      ? undefined
      : `Call: ${callResult.error || "N/A"}, Payment: ${paymentLinkResult.error || "N/A"}`,
    details: {
      callId: callResult.callId,
      callSuccess: callResult.success,
      paymentLinkUrl: paymentLinkResult.url,
      paymentLinkAmount: paymentLinkResult.amount,
      paymentLinkSuccess: paymentLinkResult.success,
    },
  }
}

/**
 * Update lead record after outreach
 */
async function updateLeadAfterOutreach(
  leadId: string,
  lead: { call_attempt_count?: number; sms_attempt_count?: number },
  updates: { callIncrement?: number; smsIncrement?: number; stage: number }
): Promise<void> {
  const now = new Date().toISOString()
  const currentCallCount = lead.call_attempt_count || 0
  const currentSmsCount = lead.sms_attempt_count || 0

  await updateGHLLead(leadId, {
    last_outreach_at: now,
    call_attempt_count: currentCallCount + (updates.callIncrement || 0),
    sms_attempt_count: currentSmsCount + (updates.smsIncrement || 0),
    // Note: followup_stage column exists per schema migration
    // Using form_data to store stage until column is available via type
    form_data: {
      ...(typeof lead === 'object' && lead !== null && 'form_data' in lead && typeof (lead as Record<string, unknown>).form_data === 'object'
        ? (lead as Record<string, unknown>).form_data as Record<string, unknown>
        : {}),
      followup_stage: updates.stage,
    },
  })
}

/**
 * Sleep utility for double_call stage
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Save outbound message to messages table for UI display
 */
async function saveOutboundMessage(
  phone: string,
  content: string,
  customerId?: string
): Promise<void> {
  try {
    const client = getSupabaseClient()
    const tenant = await getDefaultTenant()
    const e164Phone = toE164(phone)

    const { error } = await client.from("messages").insert({
      tenant_id: tenant?.id,
      customer_id: customerId || null,
      phone_number: e164Phone,
      role: "business",
      content,
      direction: "outbound",
      message_type: "sms",
      ai_generated: false,
      timestamp: new Date().toISOString(),
      source: "automation",
    })

    if (error) {
      console.error("[lead-followup] Failed to save message to DB:", error)
    } else {
      console.log(`[lead-followup] Saved outbound message to DB for ${e164Phone}`)
    }
  } catch (err) {
    console.error("[lead-followup] Error saving message:", err)
  }
}
