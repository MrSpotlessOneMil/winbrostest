import { NextRequest, NextResponse } from "next/server"
import type { HousecallProWebhookPayload, ApiResponse } from "@/lib/types"
import { getSupabaseClient } from "@/lib/supabase"
import { normalizePhoneNumber } from "@/lib/phone-utils"

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
    // Verify webhook signature (implement based on HCP's signature method)
    const signature = request.headers.get("x-hcp-signature")
    // TODO: Verify signature

    const payload: HousecallProWebhookPayload = await request.json()
    const { event, data, timestamp } = payload

    console.log(`[OSIRIS] HCP Webhook received: ${event}`, { timestamp })

    const client = getSupabaseClient()

    // Best-effort field extraction (HCP payload shapes vary by event)
    const phoneRaw =
      (data as any)?.customer?.mobile_number ||
      (data as any)?.customer?.phone ||
      (data as any)?.customer?.phone_number ||
      (data as any)?.customer_phone ||
      (data as any)?.phone ||
      (data as any)?.phone_number ||
      ""
    const phone = normalizePhoneNumber(String(phoneRaw)) || String(phoneRaw)

    const firstName =
      (data as any)?.customer?.first_name ||
      (data as any)?.customer?.firstName ||
      (data as any)?.first_name ||
      (data as any)?.firstName ||
      null
    const lastName =
      (data as any)?.customer?.last_name ||
      (data as any)?.customer?.lastName ||
      (data as any)?.last_name ||
      (data as any)?.lastName ||
      null
    const email =
      (data as any)?.customer?.email ||
      (data as any)?.email ||
      null
    const address =
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
              { phone_number: phone, first_name: firstName, last_name: lastName, email, address },
              { onConflict: "phone_number" }
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
          if (jobId != null) {
            await client.from("jobs").update({ status: "completed" }).eq("id", Number(jobId))
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
            { phone_number: phone, first_name: firstName, last_name: lastName, email, address },
            { onConflict: "phone_number" }
          )
        }
        break

      case "customer.updated":
        console.log("[OSIRIS] Customer updated in HCP")
        if (phone) {
          await client.from("customers").upsert(
            { phone_number: phone, first_name: firstName, last_name: lastName, email, address },
            { onConflict: "phone_number" }
          )
        }
        break

      case "payment.received":
        console.log("[OSIRIS] Payment received for job")
        {
          const jobId = (data as any)?.job?.id || (data as any)?.job_id || (data as any)?.id
          if (jobId != null) {
            await client.from("jobs").update({ paid: true }).eq("id", Number(jobId))
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
