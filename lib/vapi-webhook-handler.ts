import { NextResponse } from "next/server"
import { extractVapiCallData, parseTranscript } from "@/lib/vapi"
import { normalizePhoneNumber } from "@/lib/phone-utils"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { createLeadInHCP } from "@/lib/housecall-pro-api"
import { scheduleLeadFollowUp } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getTenantBySlug, getDefaultTenant } from "@/lib/tenant"
import { sendSMS, SMS_TEMPLATES } from "@/lib/openphone"
import { mergeOverridesIntoNotes } from "@/lib/pricing-config"
import { syncNewJobToHCP, syncCustomerToHCP } from "@/lib/hcp-job-sync"
import { buildWinBrosJobNotes, parseNaturalDate } from "@/lib/winbros-sms-prompt"
import { lookupPrice } from "@/lib/pricebook"

/**
 * Shared VAPI webhook handler that can be used by any tenant.
 * Pass a tenant slug to route to a specific tenant, or null for the default (winbros).
 */
export async function handleVapiWebhook(payload: any, tenantSlug?: string | null) {
  // Log incoming webhook for debugging
  const tag = tenantSlug ? `[VAPI/${tenantSlug}]` : "[VAPI Webhook]"

  console.log(`${tag} Received webhook:`, JSON.stringify({
    type: payload?.type,
    messageType: payload?.message?.type,
    callId: payload?.call?.id || payload?.message?.call?.id,
    hasTranscript: !!(payload?.message?.transcript || payload?.message?.artifact?.transcript),
  }))

  // VAPI sends different message types - only process end-of-call-report
  const messageType = payload?.message?.type || payload?.type

  if (messageType && messageType !== "end-of-call-report") {
    console.log(`${tag} Ignoring message type: ${messageType}`)
    return NextResponse.json({ success: true, ignored: true, reason: `message type: ${messageType}` })
  }

  const data = extractVapiCallData(payload)
  console.log(`${tag} Extracted data:`, JSON.stringify({
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
    console.warn(`${tag} extractVapiCallData returned null - call will be ignored`)
    return NextResponse.json({ success: true, ignored: true })
  }

  const phone = normalizePhoneNumber(data.phone || "") || data.phone || ""
  console.log(`${tag} Normalized phone: ${phone} (from raw: ${data.phone})`)
  const client = getSupabaseServiceClient()

  // Resolve tenant
  const tenant = tenantSlug
    ? await getTenantBySlug(tenantSlug)
    : await getDefaultTenant()
  console.log(`${tag} Tenant lookup: ${tenant ? tenant.slug : 'NO TENANT FOUND'}`)

  if (!tenant) {
    console.error(`${tag} No tenant found for slug: ${tenantSlug || 'default'}`)
    return NextResponse.json({ success: false, error: "Tenant not found" }, { status: 404 })
  }

  // Upsert customer so calls can be linked for dashboard
  let customerId: number | null = null
  if (phone) {
    const { data: customer, error } = await client
      .from("customers")
      .upsert({ phone_number: phone, tenant_id: tenant.id }, { onConflict: "tenant_id,phone_number" })
      .select("id")
      .single()
    if (error) {
      console.error(`${tag} Customer upsert error:`, error.message)
    }
    if (!error && customer?.id != null) customerId = Number(customer.id)
    console.log(`${tag} Customer ID: ${customerId}`)
  } else {
    console.warn(`${tag} No phone number - skipping customer upsert`)
  }

  const providerCallId = data.callId || null
  const nowIso = new Date().toISOString()

  // Determine call direction from VAPI payload
  const message = (payload.message as Record<string, unknown>) || payload
  const call = (message.call as Record<string, unknown>) || (payload.call as Record<string, unknown>) || message
  const callType = (call.type as string) || (message.type as string) || ""
  const metadata = (call.metadata as Record<string, unknown>) || (message.metadata as Record<string, unknown>) || {}

  const isOutbound =
    callType.toLowerCase().includes("outbound") ||
    !!metadata.leadId ||
    !!metadata.tenantSlug

  const direction = isOutbound ? "outbound" : "inbound"
  console.log(`${tag} Call direction detected: ${direction} (callType: ${callType}, hasLeadId: ${!!metadata.leadId})`)

  // Insert call row
  const { error: callErr } = await client.from("calls").insert({
    tenant_id: tenant.id,
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
    console.error(`${tag} Failed to insert call:`, callErr.message)
    return NextResponse.json({ success: false, error: `Failed to insert call: ${callErr.message}` }, { status: 500 })
  }

  console.log(`${tag} Call inserted successfully for ${phone} (callId: ${providerCallId})`)

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
      tenant_slug: tenant.slug,
    },
  })

  // Parse transcript and create lead if booked
  if (data.transcript && data.transcript.length > 50) {
    try {
      console.log(`${tag} Parsing transcript for booking info...`)
      const bookingInfo = await parseTranscript(data.transcript)

      const firstName = bookingInfo.firstName || null
      const lastName = bookingInfo.lastName || null
      const fullName = [firstName, lastName].filter(Boolean).join(" ") || null
      const address = bookingInfo.address || null

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

        // Sync customer name/address to HCP
        if (tenant && phone) {
          await syncCustomerToHCP({
            tenantId: tenant.id,
            customerId,
            phone,
            firstName,
            lastName,
            address,
          })
        }
      }

      // Determine if this should create a lead
      const shouldCreateLead =
        data.outcome === "booked" ||
        bookingInfo.requestedDate ||
        bookingInfo.serviceType ||
        bookingInfo.address

      if (shouldCreateLead && phone) {
        console.log(`${tag} Creating lead from call...`)

        // Check if lead already exists for this phone (any active status)
        const { data: existingLead } = await client
          .from("leads")
          .select("id, status")
          .eq("phone_number", phone)
          .eq("tenant_id", tenant.id)
          .in("status", ["new", "contacted", "qualified", "booked"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!existingLead) {
          // Create lead in our database
          const { data: lead, error: leadErr } = await client.from("leads").insert({
            tenant_id: tenant.id,
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
            console.error(`${tag} Failed to create lead:`, leadErr.message)
          } else if (lead?.id) {
            console.log(`${tag} Lead created: ${lead.id}`)

            // Create lead in HousecallPro for two-way sync (pass tenant directly)
            const hcpResult = await createLeadInHCP({
              firstName: firstName || undefined,
              lastName: lastName || undefined,
              phone,
              email: undefined,
              address: address || undefined,
              notes: `VAPI Call - ${bookingInfo.serviceType || 'Cleaning inquiry'}. ${bookingInfo.notes || ''}`.trim(),
              source: "vapi",
            }, tenant)

            if (hcpResult.success) {
              console.log(`${tag} Lead synced to HCP: ${hcpResult.leadId}`)
              const updateData: Record<string, string> = {
                source_id: hcpResult.leadId || `vapi-${providerCallId}`,
              }
              if (hcpResult.customerId) {
                updateData.hcp_customer_id = hcpResult.customerId
              }
              await client
                .from("leads")
                .update(updateData)
                .eq("id", lead.id)
            } else {
              console.warn(`${tag} Failed to sync lead to HCP:`, hcpResult.error)
            }

            await logSystemEvent({
              source: "vapi",
              event_type: "LEAD_CREATED_FROM_CALL",
              message: `Lead created from VAPI call: ${fullName || phone}`,
              phone_number: phone,
              metadata: {
                lead_id: lead.id,
                hcp_lead_id: hcpResult.leadId,
                booking_info: bookingInfo,
                tenant_slug: tenant.slug,
              },
            })

            // Treat as booked if outcome says so, OR if structuredData has appointment info
            const isBooked =
              data.outcome === "booked" ||
              !!(structuredData.appointment_date && structuredData.appointment_time) ||
              !!(structuredData.confirmed_datetime)

            if (!isBooked) {
              try {
                await scheduleLeadFollowUp(
                  tenant.id,
                  String(lead.id),
                  phone,
                  fullName || "there"
                )
                console.log(`${tag} Follow-up sequence scheduled for lead ${lead.id}`)
              } catch (scheduleErr) {
                console.error(`${tag} Failed to schedule follow-up:`, scheduleErr)
              }
            } else {
              console.log(`${tag} Call outcome was 'booked', skipping follow-up sequence`)

              let appointmentDate = structuredData.appointment_date as string || bookingInfo.requestedDate || null
              const appointmentTime = structuredData.appointment_time as string || bookingInfo.requestedTime || null
              const serviceType = structuredData.service_type as string || bookingInfo.serviceType || "Cleaning"
              const bookAddress = structuredData.customer_address as string || structuredData.address as string || bookingInfo.address || null

              // Normalize date to YYYY-MM-DD (handles "February 21st", "tomorrow", "2/21", etc.)
              if (appointmentDate && !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)) {
                appointmentDate = parseNaturalDate(appointmentDate).date
              }

              // Build notes — use WinBros-specific helper for window/pressure/gutter services
              const isWinBros = tenant.slug === 'winbros'
              const jobNotes = isWinBros
                ? buildWinBrosJobNotes({
                    serviceType: bookingInfo.serviceType || structuredData.service_type as string || null,
                    squareFootage: bookingInfo.squareFootage || null,
                    scope: bookingInfo.scope || null,
                    planType: bookingInfo.planType || null,
                    pressureWashingSurfaces: bookingInfo.pressureWashingSurfaces || null,
                    areaSize: bookingInfo.areaSize || null,
                    conditionType: bookingInfo.conditionType || null,
                    propertyType: bookingInfo.propertyType || null,
                    gutterConditions: bookingInfo.gutterConditions || null,
                    referralSource: null,
                  })
                : mergeOverridesIntoNotes(bookingInfo.notes || null, {
                    bedrooms: bookingInfo.bedrooms,
                    bathrooms: bookingInfo.bathrooms,
                    squareFootage: bookingInfo.squareFootage,
                  })

              // Look up price from pricebook
              const priceResult = lookupPrice({
                serviceType: bookingInfo.serviceType || serviceType,
                squareFootage: bookingInfo.squareFootage || null,
                notes: jobNotes || null,
                scope: bookingInfo.scope || null,
                pressureWashingSurfaces: bookingInfo.pressureWashingSurfaces || null,
                propertyType: bookingInfo.propertyType || null,
              })
              const jobPrice = priceResult?.price || null
              if (jobPrice) console.log(`${tag} Price from pricebook: $${jobPrice} (${priceResult?.serviceName})`)

              const { data: job, error: jobErr } = await client.from("jobs").insert({
                tenant_id: tenant.id,
                customer_id: customerId,
                phone_number: phone,
                address: bookAddress,
                service_type: serviceType,
                date: appointmentDate,
                scheduled_at: appointmentTime,
                price: jobPrice,
                hours: null,
                cleaners: bookingInfo.bedrooms ? Math.ceil(bookingInfo.bedrooms / 2) : 1,
                status: "scheduled",
                booked: true,
                paid: false,
                notes: jobNotes || null,
                payment_status: "pending",
              }).select("id").single()

              if (jobErr) {
                console.error(`${tag} Failed to create job:`, jobErr.message)
              } else if (job?.id) {
                console.log(`${tag} Job created from booked call: ${job.id}`)

                // Sync to HouseCall Pro
                await syncNewJobToHCP({
                  tenant,
                  jobId: job.id,
                  phone,
                  firstName,
                  lastName,
                  address: bookAddress,
                  serviceType,
                  scheduledDate: appointmentDate,
                  scheduledTime: appointmentTime,
                  price: jobPrice,
                  notes: jobNotes || `Booked via VAPI call`,
                })

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

              await client
                .from("leads")
                .update({
                  status: "booked",
                  converted_to_job_id: job?.id || null,
                })
                .eq("id", lead.id)
              console.log(`${tag} Lead ${lead.id} status set to "booked"`)

              // Send booking confirmation text
              const dateTimeStr = [appointmentDate, appointmentTime].filter(Boolean).join(" at ") || "your requested time"
              const confirmationMsg = SMS_TEMPLATES.vapiConfirmation(
                fullName || "there",
                serviceType,
                dateTimeStr,
                bookAddress || "your address"
              )

              const smsResult = await sendSMS(tenant, phone, confirmationMsg)

              if (smsResult.success) {
                console.log(`${tag} Booking confirmation text sent to ${phone}`)
                await client.from("messages").insert({
                  tenant_id: tenant.id,
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
                console.error(`${tag} Failed to send confirmation text:`, smsResult.error)
              }
            }
          }
        } else {
          console.log(`${tag} Lead already exists for ${phone} (id: ${existingLead.id})`)

          // Also treat as booked if structuredData has appointment info
          const existingLeadIsBooked =
            data.outcome === "booked" ||
            !!(structuredData.appointment_date && structuredData.appointment_time) ||
            !!(structuredData.confirmed_datetime)

          if (existingLeadIsBooked) {
            console.log(`${tag} Updating existing lead ${existingLead.id} with booked outcome`)

            let appointmentDate = structuredData.appointment_date as string || bookingInfo.requestedDate || null
            const appointmentTime = structuredData.appointment_time as string || bookingInfo.requestedTime || null
            const serviceType = structuredData.service_type as string || bookingInfo.serviceType || "Cleaning"
            const bookAddress = structuredData.customer_address as string || structuredData.address as string || bookingInfo.address || null

            // Normalize date to YYYY-MM-DD (handles "February 21st", "tomorrow", "2/21", etc.)
            if (appointmentDate && !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)) {
              appointmentDate = parseNaturalDate(appointmentDate).date
            }

            // Build notes — use WinBros-specific helper for window/pressure/gutter services
            const isWinBrosExisting = tenant.slug === 'winbros'
            const existingLeadNotes = isWinBrosExisting
              ? buildWinBrosJobNotes({
                  serviceType: bookingInfo.serviceType || structuredData.service_type as string || null,
                  squareFootage: bookingInfo.squareFootage || null,
                  scope: bookingInfo.scope || null,
                  planType: bookingInfo.planType || null,
                  pressureWashingSurfaces: bookingInfo.pressureWashingSurfaces || null,
                  areaSize: bookingInfo.areaSize || null,
                  conditionType: bookingInfo.conditionType || null,
                  propertyType: bookingInfo.propertyType || null,
                  gutterConditions: bookingInfo.gutterConditions || null,
                  referralSource: null,
                })
              : mergeOverridesIntoNotes('Booked via phone call (existing lead)', {
                  bedrooms: bookingInfo.bedrooms,
                  bathrooms: bookingInfo.bathrooms,
                  squareFootage: bookingInfo.squareFootage,
                })

            // Look up price from pricebook
            const existingPriceResult = lookupPrice({
              serviceType: bookingInfo.serviceType || serviceType,
              squareFootage: bookingInfo.squareFootage || null,
              notes: existingLeadNotes || null,
              scope: bookingInfo.scope || null,
              pressureWashingSurfaces: bookingInfo.pressureWashingSurfaces || null,
              propertyType: bookingInfo.propertyType || null,
            })
            const existingJobPrice = existingPriceResult?.price || null

            const { data: job, error: jobErr } = await client.from("jobs").insert({
              tenant_id: tenant.id,
              customer_id: customerId,
              phone_number: phone,
              address: bookAddress,
              service_type: serviceType,
              date: appointmentDate || null,
              scheduled_at: appointmentTime || null,
              price: existingJobPrice,
              hours: null,
              cleaners: bookingInfo.bedrooms ? Math.ceil(bookingInfo.bedrooms / 2) : 1,
              status: "scheduled",
              booked: true,
              paid: false,
              notes: existingLeadNotes,
              payment_status: "pending",
            }).select("id").single()

            if (jobErr) {
              console.error(`${tag} Failed to create job for existing lead:`, jobErr.message)
            } else if (job?.id) {
              console.log(`${tag} Job created for existing lead: ${job.id}`)

              // Sync to HouseCall Pro
              await syncNewJobToHCP({
                tenant,
                jobId: job.id,
                phone,
                firstName,
                lastName,
                address: bookAddress,
                serviceType,
                scheduledDate: appointmentDate,
                scheduledTime: appointmentTime,
                price: existingJobPrice,
                notes: existingLeadNotes || `Booked via VAPI call (existing lead)`,
              })
            }

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
              console.log(`${tag} Cancelled pending follow-up tasks for lead ${existingLead.id}`)
            } catch (cancelErr) {
              console.error(`${tag} Error cancelling follow-up tasks:`, cancelErr)
            }

            // Send booking confirmation text
            const dateTimeStr = [appointmentDate, appointmentTime].filter(Boolean).join(" at ") || "your requested time"
            const confirmationMsg = SMS_TEMPLATES.vapiConfirmation(
              fullName || "there",
              serviceType,
              dateTimeStr,
              bookAddress || "your address"
            )

            const smsResult = await sendSMS(tenant, phone, confirmationMsg)

            if (smsResult.success) {
              console.log(`${tag} Booking confirmation text sent to ${phone}`)
              await client.from("messages").insert({
                tenant_id: tenant.id,
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
              console.error(`${tag} Failed to send confirmation text:`, smsResult.error)
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
      console.error(`${tag} Error parsing transcript:`, parseErr)
    }
  }

  return NextResponse.json({ success: true })
}
