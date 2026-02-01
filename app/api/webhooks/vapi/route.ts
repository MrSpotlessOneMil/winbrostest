import { NextRequest, NextResponse } from "next/server"
import { extractVapiCallData, parseTranscript } from "@/lib/vapi"
import { normalizePhoneNumber } from "@/lib/phone-utils"
import { getSupabaseClient } from "@/lib/supabase"
import { createLeadInHCP } from "@/lib/housecall-pro-api"
import { scheduleLeadFollowUp } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getDefaultTenant } from "@/lib/tenant"

export async function POST(request: NextRequest) {
  let payload: any
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  const data = extractVapiCallData(payload)
  if (!data) {
    return NextResponse.json({ success: true, ignored: true })
  }

  const phone = normalizePhoneNumber(data.phone || "") || data.phone || ""
  const client = getSupabaseClient()
  const tenant = await getDefaultTenant()

  // Upsert customer so calls can be linked for dashboard
  let customerId: number | null = null
  if (phone) {
    const { data: customer, error } = await client
      .from("customers")
      .upsert({ phone_number: phone }, { onConflict: "phone_number" })
      .select("id")
      .single()
    if (!error && customer?.id != null) customerId = Number(customer.id)
  }

  const providerCallId = data.callId || null
  const nowIso = new Date().toISOString()

  // Insert call row
  const { error: callErr } = await client.from("calls").insert({
    tenant_id: tenant?.id,
    customer_id: customerId,
    phone_number: phone,
    direction: "inbound",
    provider: "vapi",
    provider_call_id: providerCallId,
    vapi_call_id: providerCallId,
    transcript: data.transcript || null,
    audio_url: data.audioUrl || null,
    duration_seconds: data.duration ? Math.round(Number(data.duration)) : null,
    outcome: data.outcome || null,
    status: "completed",
    started_at: nowIso,
    date: nowIso,
    created_at: nowIso,
  })

  if (callErr) {
    console.error("[VAPI Webhook] Failed to insert call:", callErr.message)
    return NextResponse.json({ success: false, error: `Failed to insert call: ${callErr.message}` }, { status: 500 })
  }

  // Log the call event
  await logSystemEvent({
    source: "vapi",
    event_type: "VAPI_CALL_RECEIVED",
    message: `Inbound VAPI call from ${phone} - ${data.outcome || 'unknown outcome'}`,
    phone_number: phone,
    metadata: {
      call_id: providerCallId,
      duration: data.duration,
      outcome: data.outcome,
    },
  })

  // ============================================
  // NEW: Parse transcript and create lead if booked
  // ============================================
  if (data.transcript && data.transcript.length > 50) {
    try {
      console.log("[VAPI Webhook] Parsing transcript for booking info...")
      const bookingInfo = await parseTranscript(data.transcript)

      // Extract customer name from transcript or booking info
      const firstName = bookingInfo.firstName || null
      const lastName = bookingInfo.lastName || null
      const fullName = [firstName, lastName].filter(Boolean).join(" ") || null
      const address = bookingInfo.address || null
      const email = null // Usually not captured in calls

      // Update customer with extracted info
      if (customerId && (firstName || lastName || address)) {
        await client
          .from("customers")
          .update({
            first_name: firstName || undefined,
            last_name: lastName || undefined,
            address: address || undefined,
          })
          .eq("id", customerId)
      }

      // Determine if this should create a lead
      // Create lead if: outcome is 'booked' OR booking info was extracted
      const shouldCreateLead =
        data.outcome === "booked" ||
        bookingInfo.requestedDate ||
        bookingInfo.serviceType ||
        bookingInfo.address

      if (shouldCreateLead && phone) {
        console.log("[VAPI Webhook] Creating lead from call...")

        // Check if lead already exists for this phone
        const { data: existingLead } = await client
          .from("leads")
          .select("id")
          .eq("phone_number", phone)
          .eq("status", "new")
          .maybeSingle()

        if (!existingLead) {
          // Create lead in our database
          const { data: lead, error: leadErr } = await client.from("leads").insert({
            tenant_id: tenant?.id,
            source_id: `vapi-${providerCallId || Date.now()}`,
            phone_number: phone,
            customer_id: customerId,
            first_name: firstName,
            last_name: lastName,
            source: "phone",
            status: "new",
            form_data: {
              ...bookingInfo,
              vapi_call_id: providerCallId,
              call_outcome: data.outcome,
              transcript_summary: data.transcript.substring(0, 500),
            },
            followup_stage: 0,
            followup_started_at: nowIso,
          }).select("id").single()

          if (leadErr) {
            console.error("[VAPI Webhook] Failed to create lead:", leadErr.message)
          } else if (lead?.id) {
            console.log(`[VAPI Webhook] Lead created: ${lead.id}`)

            // Create lead in HousecallPro for two-way sync
            const hcpResult = await createLeadInHCP({
              firstName: firstName || undefined,
              lastName: lastName || undefined,
              phone,
              address: address || undefined,
              notes: `VAPI Call - ${bookingInfo.serviceType || 'Cleaning inquiry'}. ${bookingInfo.notes || ''}`.trim(),
              source: "vapi",
            })

            if (hcpResult.success) {
              console.log(`[VAPI Webhook] Lead synced to HCP: ${hcpResult.leadId}`)
              // Update lead with HCP ID
              await client
                .from("leads")
                .update({ source_id: hcpResult.leadId || `vapi-${providerCallId}` })
                .eq("id", lead.id)
            } else {
              console.warn("[VAPI Webhook] Failed to sync lead to HCP:", hcpResult.error)
            }

            // Log lead creation
            await logSystemEvent({
              source: "vapi",
              event_type: "LEAD_CREATED_FROM_CALL",
              message: `Lead created from VAPI call: ${fullName || phone}`,
              phone_number: phone,
              metadata: {
                lead_id: lead.id,
                hcp_lead_id: hcpResult.leadId,
                booking_info: bookingInfo,
              },
            })

            // If outcome was "booked", we might skip follow-up since they already booked
            // Otherwise, trigger the 5-stage follow-up sequence
            if (data.outcome !== "booked") {
              try {
                await scheduleLeadFollowUp(
                  tenant?.id || '',
                  String(lead.id),
                  phone,
                  fullName || "there"
                )
                console.log(`[VAPI Webhook] Follow-up sequence scheduled for lead ${lead.id}`)
              } catch (scheduleErr) {
                console.error("[VAPI Webhook] Failed to schedule follow-up:", scheduleErr)
              }
            } else {
              console.log("[VAPI Webhook] Call outcome was 'booked', skipping follow-up sequence")

              // Create a job since they booked on the call
              const { data: job, error: jobErr } = await client.from("jobs").insert({
                tenant_id: tenant?.id,
                customer_id: customerId,
                phone_number: phone,
                address: bookingInfo.address || null,
                service_type: bookingInfo.serviceType || "Cleaning",
                date: bookingInfo.requestedDate || null,
                scheduled_at: bookingInfo.requestedTime || null,
                price: null, // Will be set after quote
                hours: null,
                cleaners: bookingInfo.bedrooms ? Math.ceil(bookingInfo.bedrooms / 2) : 1,
                status: "scheduled",
                booked: true,
                paid: false,
                notes: bookingInfo.notes || null,
                payment_status: "pending",
              }).select("id").single()

              if (jobErr) {
                console.error("[VAPI Webhook] Failed to create job:", jobErr.message)
              } else if (job?.id) {
                console.log(`[VAPI Webhook] Job created from booked call: ${job.id}`)

                // Update lead with job reference
                await client
                  .from("leads")
                  .update({
                    status: "booked",
                    converted_to_job_id: job.id
                  })
                  .eq("id", lead.id)

                await logSystemEvent({
                  source: "vapi",
                  event_type: "JOB_CREATED_FROM_CALL",
                  message: `Job created from booked VAPI call: ${fullName || phone}`,
                  phone_number: phone,
                  metadata: {
                    job_id: job.id,
                    lead_id: lead.id,
                    booking_info: bookingInfo,
                  },
                })
              }
            }
          }
        } else {
          console.log(`[VAPI Webhook] Lead already exists for ${phone}, skipping creation`)
        }
      }
    } catch (parseErr) {
      console.error("[VAPI Webhook] Error parsing transcript:", parseErr)
      // Don't fail the webhook, just log the error
    }
  }

  return NextResponse.json({ success: true })
}
