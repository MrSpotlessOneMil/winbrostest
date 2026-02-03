import { NextRequest, NextResponse } from "next/server"
import { createHmac, timingSafeEqual } from "crypto"
import type { HousecallProWebhookPayload, ApiResponse } from "@/lib/types"
import { getSupabaseClient } from "@/lib/supabase"
import { normalizePhoneNumber } from "@/lib/phone-utils"
import { getApiKey } from "@/lib/user-api-keys"
import { scheduleLeadFollowUp } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getDefaultTenant } from "@/lib/tenant"

/**
 * Webhook handler for Housecall Pro events
 * 
 * HCP is the source of truth for:
 * - Customer records
 * - Job records
 * - Scheduling
 * - Payment status
 * 
 * This webhook mirrors relevant changes to Supabase for automation tracking
 */
export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const rawBody = await request.text()

    // Verify webhook signature
    const signature = request.headers.get("X-HousecallPro-Signature")
    const secret = getApiKey("housecallProWebhookSecret") || process.env.HOUSECALL_PRO_WEBHOOK_SECRET

    if (secret) {
      if (!signature) {
        console.error("[OSIRIS] HCP Webhook: Missing signature header")
        return NextResponse.json(
          { success: false, error: "Missing signature" },
          { status: 401 }
        )
      }

      const expectedSignature = createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex")

      // Use timingSafeEqual to prevent timing attacks
      const signatureLower = signature.toLowerCase()
      const expectedLower = expectedSignature.toLowerCase()

      if (
        signatureLower.length !== expectedLower.length ||
        !timingSafeEqual(Buffer.from(signatureLower), Buffer.from(expectedLower))
      ) {
        console.error("[OSIRIS] HCP Webhook: Invalid signature")
        return NextResponse.json(
          { success: false, error: "Invalid signature" },
          { status: 401 }
        )
      }
    } else {
      console.warn("[OSIRIS] HCP Webhook: No webhook secret configured, skipping signature validation")
    }

    const payload: HousecallProWebhookPayload = JSON.parse(rawBody)
    const { event, data, timestamp } = payload

    // HCP sends data at top level OR nested under data depending on event type
    const lead = (payload as any).lead || (data as any)?.lead
    const job = (payload as any).job || (data as any)?.job
    const customer = (payload as any).customer || (data as any)?.customer

    console.log(`[OSIRIS] HCP Webhook received: ${event}`, {
      timestamp,
      hasLead: !!lead,
      hasJob: !!job,
      hasCustomer: !!customer,
      leadCustomer: lead?.customer ? 'present' : 'missing'
    })

    const client = getSupabaseClient()
    const tenant = await getDefaultTenant()

    // Best-effort field extraction (HCP payload shapes vary by event)
    // For leads, phone is often in lead.customer.mobile_number
    const phoneRaw =
      // Lead customer fields (most common for lead.created)
      lead?.customer?.mobile_number ||
      lead?.customer?.phone_number ||
      lead?.customer?.phone ||
      lead?.phone_numbers?.[0]?.number ||
      // Top-level customer fields
      customer?.mobile_number ||
      customer?.phone_number ||
      customer?.phone ||
      customer?.phone_numbers?.[0]?.number ||
      // Nested data.customer fields
      (data as any)?.customer?.mobile_number ||
      (data as any)?.customer?.phone ||
      (data as any)?.customer?.phone_number ||
      (data as any)?.customer_phone ||
      (data as any)?.phone ||
      (data as any)?.phone_number ||
      ""
    const phone = normalizePhoneNumber(String(phoneRaw)) || String(phoneRaw)

    console.log(`[OSIRIS] HCP Webhook phone extraction: raw="${phoneRaw}", normalized="${phone}"`)

    const firstName =
      lead?.customer?.first_name ||
      lead?.first_name ||
      customer?.first_name ||
      (data as any)?.customer?.first_name ||
      (data as any)?.customer?.firstName ||
      (data as any)?.first_name ||
      (data as any)?.firstName ||
      null
    const lastName =
      lead?.customer?.last_name ||
      lead?.last_name ||
      customer?.last_name ||
      (data as any)?.customer?.last_name ||
      (data as any)?.customer?.lastName ||
      (data as any)?.last_name ||
      (data as any)?.lastName ||
      null
    const email =
      lead?.customer?.email ||
      lead?.email ||
      customer?.email ||
      (data as any)?.customer?.email ||
      (data as any)?.email ||
      null
    const address =
      lead?.address ||
      job?.address ||
      customer?.address ||
      (data as any)?.job?.address ||
      (data as any)?.address ||
      (data as any)?.customer?.address ||
      null

    switch (event) {
      case "job.created":
        console.log("[OSIRIS] New job created in HCP, mirroring to Supabase")
        // upsert customer then insert job
        if (phone) {
          const { data: customer } = await client
            .from("customers")
            .upsert(
              { phone_number: phone, tenant_id: tenant?.id, first_name: firstName, last_name: lastName, email, address },
              { onConflict: "tenant_id,phone_number" }
            )
            .select("id")
            .single()

          const scheduledDate =
            (data as any)?.job?.scheduled_date ||
            (data as any)?.job?.date ||
            (data as any)?.scheduled_date ||
            (data as any)?.date ||
            null
          const scheduledTime =
            (data as any)?.job?.scheduled_time ||
            (data as any)?.job?.scheduled_at ||
            (data as any)?.scheduled_time ||
            (data as any)?.scheduled_at ||
            null

          await client.from("jobs").insert({
            customer_id: customer?.id,
            phone_number: phone,
            address,
            service_type: (data as any)?.job?.service_type || (data as any)?.service_type || "Service",
            date: scheduledDate,
            scheduled_at: scheduledTime,
            status: "scheduled",
            booked: true,
          })
        }
        break

      case "job.updated":
        console.log("[OSIRIS] Job updated in HCP, syncing to Supabase")
        // Best effort update by job id if present
        {
          const jobId = (data as any)?.job?.id || (data as any)?.job_id || (data as any)?.id
          if (jobId != null) {
            await client
              .from("jobs")
              .update({
                status: (data as any)?.job?.status || (data as any)?.status || null,
                paid: Boolean((data as any)?.job?.paid || (data as any)?.paid),
                address,
              })
              .eq("id", Number(jobId))
          }
        }
        break

      case "job.completed":
        console.log("[OSIRIS] Job completed, triggering post-job automations")
        {
          const jobId = (data as any)?.job?.id || (data as any)?.job_id || (data as any)?.id
          const hcpJobId = (data as any)?.job?.id || (data as any)?.id

          // Try to find job by HCP job ID or our internal ID
          let internalJobId = jobId
          if (hcpJobId) {
            const { data: existingJob } = await client
              .from("jobs")
              .select("id")
              .eq("hcp_job_id", String(hcpJobId))
              .maybeSingle()

            if (existingJob) {
              internalJobId = existingJob.id
            }
          }

          if (internalJobId != null) {
            const { data: updatedJob } = await client
              .from("jobs")
              .update({
                status: "completed",
                completed_at: new Date().toISOString()
              })
              .eq("id", Number(internalJobId))
              .select("phone_number")
              .single()

            await logSystemEvent({
              source: "housecall_pro",
              event_type: "JOB_COMPLETED",
              message: `Job ${internalJobId} marked completed via HCP`,
              job_id: String(internalJobId),
              phone_number: updatedJob?.phone_number || phone,
              metadata: { hcp_job_id: hcpJobId },
            })
          }
        }
        break

      case "job.cancelled":
        console.log("[OSIRIS] Job cancelled, sending notifications")
        {
          const jobId = (data as any)?.job?.id || (data as any)?.job_id || (data as any)?.id
          if (jobId != null) {
            await client.from("jobs").update({ status: "cancelled" }).eq("id", Number(jobId))
          }
        }
        break

      case "customer.created":
        console.log("[OSIRIS] New customer created in HCP")
        if (phone) {
          await client.from("customers").upsert(
            { phone_number: phone, tenant_id: tenant?.id, first_name: firstName, last_name: lastName, email, address },
            { onConflict: "tenant_id,phone_number" }
          )
        }
        break

      case "customer.updated":
        console.log("[OSIRIS] Customer updated in HCP")
        if (phone) {
          await client.from("customers").upsert(
            { phone_number: phone, tenant_id: tenant?.id, first_name: firstName, last_name: lastName, email, address },
            { onConflict: "tenant_id,phone_number" }
          )
        }
        break

      case "payment.received":
      case "invoice.paid":
        console.log("[OSIRIS] Payment received for job")
        {
          const jobId = (data as any)?.job?.id || (data as any)?.job_id || (data as any)?.id
          if (jobId != null) {
            await client.from("jobs").update({
              paid: true,
              payment_status: 'fully_paid'
            }).eq("id", Number(jobId))
          }
        }
        break

      case "lead.created":
        console.log("[OSIRIS] New lead created in HCP")
        if (phone) {
          // Upsert customer
          const { data: customerRecord } = await client
            .from("customers")
            .upsert(
              { phone_number: phone, tenant_id: tenant?.id, first_name: firstName, last_name: lastName, email, address },
              { onConflict: "tenant_id,phone_number" }
            )
            .select("id")
            .single()

          // Create lead record - get ID from extracted lead object
          const hcpSourceId = lead?.id || (data as any)?.lead?.id || (data as any)?.id || `hcp-${Date.now()}`
          const { data: leadRecord } = await client.from("leads").insert({
            source_id: String(hcpSourceId),
            phone_number: phone,
            customer_id: customerRecord?.id ?? null,
            first_name: firstName || null,
            last_name: lastName || null,
            email: email || null,
            source: "housecall_pro",
            status: "new",
            form_data: data,
            followup_stage: 0,
            followup_started_at: new Date().toISOString(),
          }).select("id").single()

          // Log system event
          await client.from("system_events").insert({
            source: "housecall_pro",
            event_type: "HCP_LEAD_RECEIVED",
            message: `New lead from HousecallPro: ${firstName || 'Unknown'} ${lastName || ''}`.trim(),
            phone_number: phone,
            metadata: { hcp_lead_id: hcpSourceId, lead_id: leadRecord?.id }
          })

          // Schedule the lead follow-up sequence
          if (leadRecord?.id) {
            try {
              const leadName = `${firstName || ''} ${lastName || ''}`.trim() || 'Customer'
              await scheduleLeadFollowUp(tenant?.id || '', String(leadRecord.id), phone, leadName)
              console.log(`[OSIRIS] HCP Webhook: Scheduled follow-up sequence for lead ${leadRecord.id}`)
            } catch (scheduleError) {
              console.error("[OSIRIS] HCP Webhook: Error scheduling follow-up:", scheduleError)
            }
          }
        } else {
          console.error("[OSIRIS] HCP Webhook: No phone number found for lead, cannot process")
        }
        break

      case "lead.updated":
        console.log("[OSIRIS] Lead updated in HCP")
        {
          const leadId = (data as any)?.lead?.id || (data as any)?.id
          if (leadId && phone) {
            // Update lead status if present
            const hcpStatus = (data as any)?.lead?.status || (data as any)?.status
            let status: string | undefined
            if (hcpStatus === "won" || hcpStatus === "converted") {
              status = "booked"
            } else if (hcpStatus === "lost") {
              status = "lost"
            }

            if (status) {
              await client
                .from("leads")
                .update({ status, form_data: data })
                .eq("source_id", String(leadId))
            }
          }
        }
        break

      default:
        console.log(`[OSIRIS] Unhandled HCP event: ${event}`)
    }

    const response: ApiResponse<{ received: boolean }> = {
      success: true,
      data: { received: true },
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("[OSIRIS] HCP Webhook error:", error)
    return NextResponse.json(
      { success: false, error: "Webhook processing failed" },
      { status: 500 }
    )
  }
}
