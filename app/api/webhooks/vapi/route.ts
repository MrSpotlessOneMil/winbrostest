import { NextRequest, NextResponse } from "next/server"
import { extractVapiCallData, parseTranscript } from "@/lib/vapi"
import { normalizePhoneNumber } from "@/lib/phone-utils"
import { getSupabaseClient } from "@/lib/supabase"
import { createLeadInHCP } from "@/lib/housecall-pro-api"
import { scheduleLeadFollowUp } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getDefaultTenant } from "@/lib/tenant"
import { sendSMS, SMS_TEMPLATES } from "@/lib/openphone"

// GET handler for verification - VAPI or browser can ping this to verify endpoint is live
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "VAPI Webhook",
    timestamp: new Date().toISOString(),
    message: "Webhook endpoint is active. POST your VAPI events here.",
  })
}

export async function POST(request: NextRequest) {
  // Log that we received a request (helps debug if VAPI is even calling us)
  console.log(`[VAPI Webhook] ====== REQUEST RECEIVED ======`)
  console.log(`[VAPI Webhook] Request URL: ${request.url}`)
  console.log(`[VAPI Webhook] Request headers:`, Object.fromEntries(request.headers.entries()))

  let payload: any
  try {
    payload = await request.json()
  } catch (e) {
    console.error(`[VAPI Webhook] Failed to parse JSON:`, e)
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  // Log FULL payload for debugging (temporarily)
  console.log(`[VAPI Webhook] FULL PAYLOAD:`, JSON.stringify(payload, null, 2))

  // Log incoming webhook for debugging
  console.log(`[VAPI Webhook] Received webhook:`, JSON.stringify({
    type: payload?.type,
    messageType: payload?.message?.type,
    callId: payload?.call?.id || payload?.message?.call?.id,
    hasTranscript: !!(payload?.message?.transcript || payload?.message?.artifact?.transcript),
  }))

  // VAPI sends different message types - only process end-of-call-report
  const messageType = payload?.message?.type || payload?.type

  // Ignore real-time transcript updates, function calls, status updates, etc.
  if (messageType && messageType !== "end-of-call-report") {
    console.log(`[VAPI Webhook] Ignoring message type: ${messageType}`)
    return NextResponse.json({ success: true, ignored: true, reason: `message type: ${messageType}` })
  }

  const data = extractVapiCallData(payload)
  console.log(`[VAPI Webhook] Extracted data:`, JSON.stringify({
    hasData: !!data,
    phone: data?.phone,
    callId: data?.callId,
    hasTranscript: !!data?.transcript,
    duration: data?.duration,
    outcome: data?.outcome,
  }))

  // Extract VAPI structured data (booking details filled by the AI assistant)
  const vapiMessage = (payload.message as Record<string, unknown>) || payload
  const vapiAnalysis = (vapiMessage.analysis as Record<string, unknown>) || {}
  const structuredData = (vapiAnalysis.structuredData as Record<string, unknown>) || {}

  if (!data) {
    console.warn(`[VAPI Webhook] extractVapiCallData returned null - call will be ignored`)
    return NextResponse.json({ success: true, ignored: true })
  }

  const phone = normalizePhoneNumber(data.phone || "") || data.phone || ""
  console.log(`[VAPI Webhook] Normalized phone: ${phone} (from raw: ${data.phone})`)
  const client = getSupabaseClient()
  const tenant = await getDefaultTenant()
  console.log(`[VAPI Webhook] Tenant lookup: ${tenant ? tenant.slug : 'NO TENANT FOUND'}`)

  // Upsert customer so calls can be linked for dashboard
  let customerId: number | null = null
  if (phone) {
    const { data: customer, error } = await client
      .from("customers")
      .upsert({ phone_number: phone, tenant_id: tenant?.id }, { onConflict: "tenant_id,phone_number" })
      .select("id")
      .single()
    if (error) {
      console.error(`[VAPI Webhook] Customer upsert error:`, error.message)
    }
    if (!error && customer?.id != null) customerId = Number(customer.id)
    console.log(`[VAPI Webhook] Customer ID: ${customerId}`)
  } else {
    console.warn(`[VAPI Webhook] No phone number - skipping customer upsert`)
  }

  const providerCallId = data.callId || null
  const nowIso = new Date().toISOString()

  // Determine call direction from VAPI payload
  // VAPI includes call type in the message or call object
  const message = (payload.message as Record<string, unknown>) || payload
  const call = (message.call as Record<string, unknown>) || (payload.call as Record<string, unknown>) || message
  const callType = (call.type as string) || (message.type as string) || ""
  const metadata = (call.metadata as Record<string, unknown>) || (message.metadata as Record<string, unknown>) || {}

  // Outbound calls have type "outboundPhoneCall" or have leadId in metadata (from our follow-up system)
  const isOutbound =
    callType.toLowerCase().includes("outbound") ||
    !!metadata.leadId ||
    !!metadata.tenantSlug // Our outbound calls include tenantSlug in metadata

  const direction = isOutbound ? "outbound" : "inbound"
  console.log(`[VAPI Webhook] Call direction detected: ${direction} (callType: ${callType}, hasLeadId: ${!!metadata.leadId})`)

  // Insert call row
  const { error: callErr } = await client.from("calls").insert({
    tenant_id: tenant?.id,
    customer_id: customerId,
    phone_number: phone,
    direction: direction,
    provider: "vapi",
    provider_call_id: providerCallId,
    vapi_call_id: providerCallId,
    transcript: data.transcript || null,
    duration_seconds: data.duration ? Math.round(Number(data.duration)) : null,
    outcome: data.outcome || null,
    audio_url: data.audioUrl || null,
    status: "completed",
    started_at: nowIso,
    date: nowIso,
    created_at: nowIso,
    lead_id: metadata.leadId ? Number(metadata.leadId) : null,
  })

  if (callErr) {
    console.error("[VAPI Webhook] Failed to insert call:", callErr.message)
    return NextResponse.json({ success: false, error: `Failed to insert call: ${callErr.message}` }, { status: 500 })
  }

  console.log(`[VAPI Webhook] ✓ Call inserted successfully for ${phone} (callId: ${providerCallId})`)

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

        // Check if lead already exists for this phone (any active status)
        const { data: existingLead } = await client
          .from("leads")
          .select("id, status")
          .eq("phone_number", phone)
          .eq("tenant_id", tenant?.id)
          .in("status", ["new", "contacted", "qualified", "booked"])
          .order("created_at", { ascending: false })
          .limit(1)
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

              const appointmentDate = structuredData.appointment_date as string || bookingInfo.requestedDate || null
              const appointmentTime = structuredData.appointment_time as string || bookingInfo.requestedTime || null
              const serviceType = structuredData.service_type as string || bookingInfo.serviceType || "Cleaning"
              const bookAddress = structuredData.address as string || bookingInfo.address || null

              // Create a job since they booked on the call
              const { data: job, error: jobErr } = await client.from("jobs").insert({
                tenant_id: tenant?.id,
                customer_id: customerId,
                phone_number: phone,
                address: bookAddress,
                service_type: serviceType,
                date: appointmentDate,
                scheduled_at: appointmentTime,
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

              // ALWAYS update lead to "booked" when call outcome is booked
              // (even if job creation failed - the customer still booked on the call)
              await client
                .from("leads")
                .update({
                  status: "booked",
                  converted_to_job_id: job?.id || null,
                })
                .eq("id", lead.id)
              console.log(`[VAPI Webhook] Lead ${lead.id} status set to "booked"`)

              // Send booking confirmation text
              const dateTimeStr = [appointmentDate, appointmentTime].filter(Boolean).join(" at ") || "your requested time"
              const confirmationMsg = SMS_TEMPLATES.vapiConfirmation(
                fullName || "there",
                serviceType,
                dateTimeStr,
                bookAddress || "your address"
              )

              const smsResult = tenant
                ? await sendSMS(tenant, phone, confirmationMsg)
                : await sendSMS(phone, confirmationMsg)

              if (smsResult.success) {
                console.log(`[VAPI Webhook] Booking confirmation text sent to ${phone}`)
                await client.from("messages").insert({
                  tenant_id: tenant?.id,
                  customer_id: customerId,
                  phone_number: phone,
                  role: "assistant",
                  content: confirmationMsg,
                  direction: "outbound",
                  message_type: "sms",
                  ai_generated: false,
                  timestamp: nowIso,
                  source: "vapi_booking_confirmation",
                })
              } else {
                console.error(`[VAPI Webhook] Failed to send confirmation text:`, smsResult.error)
              }
            }
          }
        } else {
          console.log(`[VAPI Webhook] Lead already exists for ${phone} (id: ${existingLead.id})`)

          // If this call was booked, update the existing lead and send confirmation
          if (data.outcome === "booked") {
            console.log(`[VAPI Webhook] Updating existing lead ${existingLead.id} with booked outcome`)

            const appointmentDate = structuredData.appointment_date as string || bookingInfo.requestedDate || null
            const appointmentTime = structuredData.appointment_time as string || bookingInfo.requestedTime || null
            const serviceType = structuredData.service_type as string || bookingInfo.serviceType || "Cleaning"
            const bookAddress = structuredData.address as string || bookingInfo.address || null

            // Create a job for the booking
            const { data: job, error: jobErr } = await client.from("jobs").insert({
              tenant_id: tenant?.id,
              customer_id: customerId,
              phone_number: phone,
              address: bookAddress,
              service_type: serviceType,
              date: appointmentDate || null,
              scheduled_at: appointmentTime || null,
              price: null,
              hours: null,
              cleaners: 1,
              status: "scheduled",
              booked: true,
              paid: false,
              notes: `Booked via phone call (existing lead)`,
              payment_status: "pending",
            }).select("id").single()

            if (jobErr) {
              console.error("[VAPI Webhook] Failed to create job for existing lead:", jobErr.message)
            } else if (job?.id) {
              console.log(`[VAPI Webhook] Job created for existing lead: ${job.id}`)
            }

            // Update the existing lead to booked status
            await client
              .from("leads")
              .update({
                status: "booked",
                converted_to_job_id: job?.id || null,
                form_data: {
                  ...bookingInfo,
                  vapi_call_id: providerCallId,
                  call_outcome: data.outcome,
                  transcript_summary: data.transcript?.substring(0, 500),
                },
                last_contact_at: nowIso,
              })
              .eq("id", existingLead.id)

            // Cancel any pending follow-up tasks for this lead
            try {
              const { cancelTask } = await import("@/lib/scheduler")
              for (let s = 1; s <= 5; s++) {
                await cancelTask(`lead-${existingLead.id}-stage-${s}`)
              }
              console.log(`[VAPI Webhook] Cancelled pending follow-up tasks for lead ${existingLead.id}`)
            } catch (cancelErr) {
              console.error("[VAPI Webhook] Error cancelling follow-up tasks:", cancelErr)
            }

            // Send booking confirmation text
            const dateTimeStr = [appointmentDate, appointmentTime].filter(Boolean).join(" at ") || "your requested time"
            const confirmationMsg = SMS_TEMPLATES.vapiConfirmation(
              fullName || "there",
              serviceType,
              dateTimeStr,
              bookAddress || "your address"
            )

            const smsResult = tenant
              ? await sendSMS(tenant, phone, confirmationMsg)
              : await sendSMS(phone, confirmationMsg)

            if (smsResult.success) {
              console.log(`[VAPI Webhook] Booking confirmation text sent to ${phone}`)
              // Save to messages table
              await client.from("messages").insert({
                tenant_id: tenant?.id,
                customer_id: customerId,
                phone_number: phone,
                role: "assistant",
                content: confirmationMsg,
                direction: "outbound",
                message_type: "sms",
                ai_generated: false,
                timestamp: nowIso,
                source: "vapi_booking_confirmation",
              })
            } else {
              console.error(`[VAPI Webhook] Failed to send confirmation text:`, smsResult.error)
            }

            await logSystemEvent({
              source: "vapi",
              event_type: "EXISTING_LEAD_BOOKED",
              message: `Existing lead ${existingLead.id} booked via call: ${fullName || phone}`,
              phone_number: phone,
              metadata: { lead_id: existingLead.id, job_id: job?.id, booking_info: bookingInfo },
            })
          }
        }
      }
    } catch (parseErr) {
      console.error("[VAPI Webhook] Error parsing transcript:", parseErr)
      // Don't fail the webhook, just log the error
    }
  }

  return NextResponse.json({ success: true })
}
