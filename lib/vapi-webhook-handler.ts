import { NextResponse } from "next/server"
import { extractVapiCallData, parseTranscript } from "@/lib/vapi"
import { normalizePhoneNumber, maskPhone } from "@/lib/phone-utils"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { createLeadInHCP } from "@/lib/housecall-pro-api"
import { scheduleLeadFollowUp } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getTenantBySlug, getDefaultTenant, tenantUsesFeature } from "@/lib/tenant"
import { sendSMS, SMS_TEMPLATES } from "@/lib/openphone"
import { mergeOverridesIntoNotes } from "@/lib/pricing-config"
import { syncNewJobToHCP, syncCustomerToHCP } from "@/lib/hcp-job-sync"
import { buildWinBrosJobNotes, parseNaturalDate } from "@/lib/winbros-sms-prompt"
import { lookupPrice } from "@/lib/pricebook"
import { getWindowTiersFromDB, getFlatServicesFromDB } from "@/lib/pricebook-db"

/** Format raw appointment date/time into human-readable text for SMS */
function formatDateTimeForSMS(date: string | null, time: string | null): string {
  if (!date && !time) return "your requested time"
  let datePart = date || ""
  let timePart = time || ""
  // Convert "2026-03-05" → "March 5, 2026"
  const isoMatch = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (isoMatch) {
    const d = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]))
    datePart = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }
  // Convert "08:00" or "14:00" → "8:00 AM" / "2:00 PM"
  const timeMatch = timePart.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (timeMatch) {
    let h = Number(timeMatch[1])
    const m = timeMatch[2]
    const period = h >= 12 ? 'PM' : 'AM'
    if (h === 0) h = 12
    else if (h > 12) h -= 12
    timePart = `${h}:${m} ${period}`
  }
  return [datePart, timePart].filter(Boolean).join(" at ")
}

/** Safely extract a string from VAPI structured data — handles objects, arrays, nulls */
function safeString(val: unknown): string | null {
  if (val == null) return null
  if (typeof val === 'string') return val.trim() || null
  if (typeof val === 'object') {
    // Handle address objects like {street, city, state, zip}
    const obj = val as Record<string, unknown>
    const parts = [obj.street, obj.address, obj.city, obj.state, obj.zip, obj.zipCode, obj.postal_code]
      .filter(v => typeof v === 'string' && v.trim())
    if (parts.length > 0) return parts.join(', ')
    // Last resort: try JSON but never return [object Object]
    try { const j = JSON.stringify(val); return j !== '{}' ? j : null } catch { return null }
  }
  return String(val)
}

function estimateJobHours(serviceType: string | null | undefined): number {
  const lower = (serviceType || '').toLowerCase()
  if (lower.includes('pressure') || lower.includes('power wash')) return 3
  if (lower.includes('gutter')) return 1.5
  return 2 // window cleaning default
}

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
  console.log(`${tag} Extracted data: callId=${data?.callId}, outcome=${data?.outcome}, hasTranscript=${!!data?.transcript}`)

  // Extract VAPI structured data (booking details filled by the AI assistant)
  const vapiMessage = (payload.message as Record<string, unknown>) || payload
  const vapiAnalysis = (vapiMessage.analysis as Record<string, unknown>) || {}
  const structuredData = (vapiAnalysis.structuredData as Record<string, unknown>) || {}

  if (!data) {
    console.warn(`${tag} extractVapiCallData returned null - call will be ignored`)
    return NextResponse.json({ success: true, ignored: true })
  }

  const phone = normalizePhoneNumber(data.phone || "") || data.phone || ""
  console.log(`${tag} Phone resolved: ${maskPhone(phone)}`)
  const client = getSupabaseServiceClient()

  // Resolve tenant — require explicit slug, never fall back to a default
  if (!tenantSlug) {
    console.error(`${tag} No tenant slug provided — cannot route VAPI call. Aborting to prevent cross-tenant bleed.`)
    return NextResponse.json({ success: false, error: "No tenant slug provided" }, { status: 400 })
  }
  const tenant = await getTenantBySlug(tenantSlug)
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
      .upsert({ phone_number: phone, tenant_id: tenant.id, lead_source: 'phone' }, { onConflict: "tenant_id,phone_number" })
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
  const { data: callRecord, error: callErr } = await client.from("calls").insert({
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
  }).select("id").single()

  if (callErr) {
    console.error(`${tag} Failed to insert call:`, callErr.message)
    return NextResponse.json({ success: false, error: `Failed to insert call: ${callErr.message}` }, { status: 500 })
  }

  const callId = callRecord?.id
  console.log(`${tag} Call inserted successfully for ${maskPhone(phone)} (callId: ${providerCallId}, dbId: ${callId})`)

  // Log the call event
  await logSystemEvent({
    source: "vapi",
    event_type: "VAPI_CALL_RECEIVED",
    message: `${direction} VAPI call ${direction === 'inbound' ? 'from' : 'to'} ${phone} - ${data.outcome || 'unknown outcome'}`,
    phone_number: phone,
    metadata: {
      call_id: providerCallId,
      duration: data.duration,
      outcome: data.outcome,
      tenant_slug: tenant.slug,
    },
  })

  // Score call for learning system (fire-and-forget)
  if (data.transcript && data.transcript.length > 50 && phone) {
    const callOutcome: 'won' | 'lost' = data.outcome === 'booked' ? 'won' : 'lost'
    import('@/lib/conversation-scoring').then(mod =>
      mod.scoreConversation({
        tenantId: tenant.id,
        customerId: customerId ?? 0,
        phone,
        conversationType: 'vapi_call',
        conversationText: data.transcript!,
        outcome: callOutcome,
        durationSeconds: data.duration ? Math.round(Number(data.duration)) : undefined,
        conversationStartedAt: nowIso,
      })
    ).catch(err => console.warn(`${tag} Call scoring failed (non-blocking):`, err))

    // Extract memory facts from call transcript (fire-and-forget)
    if (customerId) {
      import('@/lib/assistant-memory').then(mem =>
        mem.extractAndStoreFacts(tenant.id, customerId!, '', [
          { role: 'assistant', content: `[VAPI call transcript]: ${data.transcript}` }
        ])
      ).catch(err => console.warn(`${tag} Memory extraction from call failed (non-blocking):`, err))
    }
  }

  // For outbound calls that were answered (customer engaged), cancel remaining call follow-up tasks.
  // This prevents the system from calling the customer again after they already spoke with the AI.
  // We detect "answered" by checking for a meaningful transcript (>100 chars = real conversation).
  if (isOutbound && metadata.leadId && data.transcript && data.transcript.length > 100) {
    try {
      const leadId = Number(metadata.leadId)
      const { cancelTask } = await import("@/lib/scheduler")
      // Cancel call stages: stage-2 (call), stage-3 (double_call), stage-5 (call), double-call-2
      for (const key of [
        `lead-${leadId}-stage-2`,
        `lead-${leadId}-stage-3`,
        `lead-${leadId}-stage-5`,
        `lead-${leadId}-double-call-2`,
      ]) {
        await cancelTask(key)
      }
      console.log(`${tag} Cancelled remaining call follow-up tasks for lead ${leadId} (outbound call was answered)`)

      // Update lead status to reflect customer engagement
      await client
        .from("leads")
        .update({ last_contact_at: nowIso })
        .eq("id", leadId)
    } catch (cancelErr) {
      console.error(`${tag} Error cancelling follow-up tasks after answered outbound call:`, cancelErr)
    }
  }

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

      // Recurring intent detection from call transcript (cleaning tenants only)
      if (customerId && data.transcript && (tenant.slug === "spotless-scrubbers" || tenant.slug === "cedar-rapids")) {
        try {
          const { detectRecurringIntent } = await import("@/lib/recurring-detection")
          const recurringIntent = detectRecurringIntent(data.transcript)
          if (recurringIntent.frequency) {
            await client.from("customers").update({
              preferred_frequency: recurringIntent.frequency,
              preferred_day: recurringIntent.preferredDay || undefined,
              recurring_notes: `[Auto-detected from call ${new Date().toISOString().split("T")[0]}]: wants ${recurringIntent.frequency} cleaning${recurringIntent.preferredDay ? ` on ${recurringIntent.preferredDay}` : ""}`,
            }).eq("id", customerId)
            console.log(`${tag} Recurring intent detected from call: ${recurringIntent.frequency}`)
          }
        } catch (err) {
          console.error(`${tag} Recurring detection error:`, err)
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

            // Link call record to lead immediately
            if (callId) {
              await client
                .from("calls")
                .update({ lead_id: lead.id })
                .eq("id", callId)
            }

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

            // Treat as booked if we have appointment data from VAPI structured output OR our transcript parser
            const hasAppointmentFromVapi = !!(structuredData.appointment_date && structuredData.appointment_time) ||
              !!(structuredData.confirmed_datetime) ||
              !!(structuredData.date && structuredData.time && structuredData.address)
            const hasAppointmentFromParser = !!(bookingInfo.requestedDate && bookingInfo.requestedTime) ||
              !!(bookingInfo.requestedDate && bookingInfo.address) ||
              !!(bookingInfo.requestedTime && bookingInfo.address)
            const hasAppointmentData = hasAppointmentFromVapi || hasAppointmentFromParser
            // Also allow booking when AI says booked AND we have enough customer info (address or name)
            // even without a specific date — the follow-up SMS will collect the date
            const hasEnoughForQuote = data.outcome === "booked" &&
              data.transcript && data.transcript.length > 200 &&
              !!(bookingInfo.address || bookingInfo.firstName || address)
            const isBooked = hasAppointmentData || hasEnoughForQuote

            if (!isBooked) {
              // Not really booked — schedule SMS follow-up so we don't lose the lead
              if (data.outcome === "booked") {
                console.warn(`${tag} AI reported 'booked' but insufficient data — scheduling follow-up (has address: ${!!bookingInfo.address}, has name: ${!!bookingInfo.firstName}, transcript length: ${data.transcript?.length})`)
              }
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

              // DEDUP: Check if a job was already created for this phone+tenant in the last 2 minutes
              const dedupCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString()
              const { data: recentJob } = await client
                .from("jobs")
                .select("id")
                .eq("phone_number", phone)
                .eq("tenant_id", tenant.id)
                .gte("created_at", dedupCutoff)
                .limit(1)
                .maybeSingle()

              if (recentJob) {
                console.log(`${tag} DEDUP: Job ${recentJob.id} already created for ${maskPhone(phone)} in last 2 min, skipping duplicate`)
                return NextResponse.json({ success: true, deduplicated: true, existingJobId: recentJob.id })
              }

              let appointmentDate = safeString(structuredData.appointment_date) || bookingInfo.requestedDate || null
              const appointmentTime = safeString(structuredData.appointment_time) || bookingInfo.requestedTime || null
              const serviceType = safeString(structuredData.service_type) || bookingInfo.serviceType || "Cleaning"
              const bookAddress = safeString(structuredData.customer_address) || safeString(structuredData.address) || bookingInfo.address || null

              // Normalize date to YYYY-MM-DD (handles "February 21st", "tomorrow", "2/21", etc.)
              if (appointmentDate && !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)) {
                appointmentDate = parseNaturalDate(appointmentDate).date
              }

              // TENANT ISOLATION — Notes formatting:
              // WinBros (use_hcp_mirror): buildWinBrosJobNotes (window/pressure/gutter)
              // Cedar Rapids / others: mergeOverridesIntoNotes (bedrooms/bathrooms/sqft)
              // Do NOT use buildWinBrosJobNotes for house cleaning tenants.
              const isWinBros = tenantUsesFeature(tenant, 'use_hcp_mirror')
              const jobNotes = isWinBros
                ? buildWinBrosJobNotes({
                    serviceType: bookingInfo.serviceType || safeString(structuredData.service_type) || null,
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

              // Look up price from pricebook (WinBros window/pressure/gutter)
              const [wTiers, fSvcs] = await Promise.all([getWindowTiersFromDB(tenant.id), getFlatServicesFromDB(tenant.id)])
              const priceResult = lookupPrice({
                serviceType: bookingInfo.serviceType || serviceType,
                squareFootage: bookingInfo.squareFootage || null,
                notes: jobNotes || null,
                scope: bookingInfo.scope || null,
                pressureWashingSurfaces: bookingInfo.pressureWashingSurfaces || null,
                propertyType: bookingInfo.propertyType || null,
              }, { windowTiers: wTiers, flatServices: fSvcs })
              let jobPrice = priceResult?.price || null
              if (jobPrice) console.log(`${tag} Price from pricebook: $${jobPrice} (${priceResult?.serviceName})`)

              // Fallback: DB pricing tiers for house cleaning tenants (Cedar Rapids etc.)
              if (!jobPrice && bookingInfo.bedrooms && bookingInfo.bathrooms && tenant.id) {
                try {
                  const { getPricingRow } = await import('@/lib/pricing-db')
                  const svcRaw = (serviceType || 'standard_cleaning').toLowerCase().replace(/[_ ]cleaning/, '')
                  const pricingTier = (svcRaw === 'deep' || svcRaw === 'move') ? svcRaw : 'standard'
                  const pricingRow = await getPricingRow(pricingTier as any, bookingInfo.bedrooms, bookingInfo.bathrooms, bookingInfo.squareFootage || null, tenant.id)
                  if (pricingRow?.price) {
                    jobPrice = pricingRow.price
                    console.log(`${tag} Price from DB pricing tiers: $${jobPrice}`)
                  }
                } catch (e) {
                  console.error(`${tag} Failed to look up DB pricing:`, e)
                }
              }

              const { data: job, error: jobErr } = await client.from("jobs").insert({
                tenant_id: tenant.id,
                customer_id: customerId,
                phone_number: phone,
                address: bookAddress,
                service_type: serviceType,
                date: appointmentDate,
                scheduled_at: appointmentTime,
                price: jobPrice,
                hours: estimateJobHours(serviceType),
                cleaners: bookingInfo.bedrooms ? Math.ceil(bookingInfo.bedrooms / 2) : 1,
                status: "quoted",
                booked: false,
                paid: false,
                notes: jobNotes || null,
                payment_status: "pending",
                job_type: isWinBros ? 'estimate' : 'cleaning',
              }).select("id").single()

              if (jobErr) {
                console.error(`${tag} Failed to create job:`, jobErr.message)

                // Log the failure as a system event so it's visible in the dashboard
                await logSystemEvent({
                  source: "vapi",
                  event_type: "JOB_CREATION_FAILED",
                  message: `Failed to create job from booked VAPI call: ${fullName || phone} — ${jobErr.message}`,
                  phone_number: phone,
                  metadata: {
                    lead_id: lead.id,
                    error: jobErr.message,
                    booking_info: bookingInfo,
                  },
                })

                // Job creation failed — do NOT mark lead as booked or send confirmation.
                // Fall back to follow-up sequence so the lead isn't lost.
                try {
                  await scheduleLeadFollowUp(
                    tenant.id,
                    String(lead.id),
                    phone,
                    fullName || "there"
                  )
                  console.log(`${tag} Job creation failed — scheduled follow-up for lead ${lead.id} instead`)
                } catch (followupErr) {
                  console.error(`${tag} Failed to schedule fallback follow-up:`, followupErr)
                }
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
                  durationHours: estimateJobHours(serviceType),
                  price: jobPrice,
                  notes: jobNotes || `Booked via VAPI call`,
                  source: 'vapi',
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

                // Mark lead as qualified (not booked — booked requires payment + cleaner assigned)
                await client
                  .from("leads")
                  .update({
                    status: "qualified",
                    converted_to_job_id: job.id,
                  })
                  .eq("id", lead.id)
                console.log(`${tag} Lead ${lead.id} status set to "qualified"`)

                // Link call record to lead and job
                if (callId) {
                  await client
                    .from("calls")
                    .update({ lead_id: lead.id, job_id: job.id })
                    .eq("id", callId)
                  console.log(`${tag} Call ${callId} linked to lead ${lead.id} + job ${job.id}`)
                }

                // Send booking confirmation text
                const dateTimeStr = formatDateTimeForSMS(appointmentDate, appointmentTime)
                const confirmationMsg = SMS_TEMPLATES.vapiConfirmation(
                  firstName || "",
                  serviceType,
                  dateTimeStr,
                  bookAddress || "your address",
                  isWinBros
                )

                // Insert DB record BEFORE sending so outbound webhook dedup finds it
                const { data: confirmMsgRecord } = await client.from("messages").insert({
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
                }).select("id").single()

                // skipDedup: we pre-inserted the DB record above, so sendSMS's content dedup would find it
                const smsResult = await sendSMS(tenant, phone, confirmationMsg, { skipDedup: true })

                if (smsResult.success) {
                  console.log(`${tag} Booking confirmation text sent to ${maskPhone(phone)}`)
                } else {
                  console.error(`${tag} Failed to send confirmation text:`, smsResult.error)
                  // Clean up pre-inserted record since send failed
                  if (confirmMsgRecord?.id) {
                    await client.from("messages").delete().eq("id", confirmMsgRecord.id)
                  }
                }

                // Create "free second cleaning" offer — only for WinBros (house cleaning gets upsells via quote page)
                if (isWinBros) {
                  try {
                    const { createOfferFromBooking } = await import('@/lib/offers')
                    const offerResult = await createOfferFromBooking(client, tenant.id, customerId, job.id, tenant.workflow_config as Record<string, unknown>)
                    if (offerResult.created) {
                      console.log(`${tag} Free cleaning offer created for customer ${customerId} (offer ${offerResult.offer?.id})`)
                      // Delay 45s before sending bonus SMS to avoid spam feel
                      await new Promise(resolve => setTimeout(resolve, 45_000))
                      const offerMsg = `🎉 BONUS: You've earned a FREE standard cleaning on your next visit! Just book again within 90 days and it's on us. We'll apply it automatically.`
                      await sendSMS(tenant, phone, offerMsg)
                    }
                  } catch (offerErr) {
                    console.error(`${tag} Offer creation failed (non-blocking):`, offerErr)
                  }
                }

                // Deposit link is NOT sent here - customer must reply with email first.
                // OpenPhone webhook handles: email received -> deposit flow (invoice + Stripe link)
                // Stripe webhook then triggers cleaner assignment after deposit payment.
              }
            }
          }
        } else {
          console.log(`${tag} Lead already exists for ${maskPhone(phone)} (id: ${existingLead.id})`)

          // Treat as booked if we have appointment data from VAPI OR our transcript parser
          const existingHasAppointmentVapi = !!(structuredData.appointment_date && structuredData.appointment_time) ||
            !!(structuredData.confirmed_datetime) ||
            !!(structuredData.date && structuredData.time && structuredData.address)
          const existingHasAppointmentParser = !!(bookingInfo.requestedDate && bookingInfo.requestedTime) ||
            !!(bookingInfo.requestedDate && bookingInfo.address) ||
            !!(bookingInfo.requestedTime && bookingInfo.address)
          const existingHasAppointment = existingHasAppointmentVapi || existingHasAppointmentParser
          const existingHasEnoughForQuote = data.outcome === "booked" &&
            data.transcript && data.transcript.length > 200 &&
            !!(bookingInfo.address || bookingInfo.firstName || address)
          const existingLeadIsBooked = existingHasAppointment || existingHasEnoughForQuote

          if (!existingLeadIsBooked && data.outcome === "booked") {
            console.warn(`${tag} AI reported 'booked' for existing lead ${existingLead.id} but insufficient data — scheduling follow-up`)
            try {
              await scheduleLeadFollowUp(tenant.id, String(existingLead.id), phone, fullName || "there")
            } catch (err) {
              console.error(`${tag} Failed to schedule follow-up for false-booked lead:`, err)
            }
          }

          if (existingLeadIsBooked) {
            console.log(`${tag} Updating existing lead ${existingLead.id} with booked outcome`)

            // DEDUP: Check if a job was already created for this phone+tenant in the last 2 minutes
            const dedupCutoffExisting = new Date(Date.now() - 2 * 60 * 1000).toISOString()
            const { data: recentJobExisting } = await client
              .from("jobs")
              .select("id")
              .eq("phone_number", phone)
              .eq("tenant_id", tenant.id)
              .gte("created_at", dedupCutoffExisting)
              .limit(1)
              .maybeSingle()

            if (recentJobExisting) {
              console.log(`${tag} DEDUP: Job ${recentJobExisting.id} already created for ${maskPhone(phone)} in last 2 min, skipping duplicate (existing lead path)`)
              return NextResponse.json({ success: true, deduplicated: true, existingJobId: recentJobExisting.id })
            }

            let appointmentDate = safeString(structuredData.appointment_date) || bookingInfo.requestedDate || null
            const appointmentTime = safeString(structuredData.appointment_time) || bookingInfo.requestedTime || null
            const serviceType = safeString(structuredData.service_type) || bookingInfo.serviceType || "Cleaning"
            const bookAddress = safeString(structuredData.customer_address) || safeString(structuredData.address) || bookingInfo.address || null

            // Normalize date to YYYY-MM-DD (handles "February 21st", "tomorrow", "2/21", etc.)
            if (appointmentDate && !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)) {
              appointmentDate = parseNaturalDate(appointmentDate).date
            }

            // TENANT ISOLATION — see notes formatting comment above (new lead path)
            const isWinBrosExisting = tenantUsesFeature(tenant, 'use_hcp_mirror')
            const existingLeadNotes = isWinBrosExisting
              ? buildWinBrosJobNotes({
                  serviceType: bookingInfo.serviceType || safeString(structuredData.service_type) || null,
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

            // Look up price from pricebook (WinBros window/pressure/gutter)
            const [eWTiers, eFSvcs] = await Promise.all([getWindowTiersFromDB(tenant.id), getFlatServicesFromDB(tenant.id)])
            const existingPriceResult = lookupPrice({
              serviceType: bookingInfo.serviceType || serviceType,
              squareFootage: bookingInfo.squareFootage || null,
              notes: existingLeadNotes || null,
              scope: bookingInfo.scope || null,
              pressureWashingSurfaces: bookingInfo.pressureWashingSurfaces || null,
              propertyType: bookingInfo.propertyType || null,
            }, { windowTiers: eWTiers, flatServices: eFSvcs })
            let existingJobPrice = existingPriceResult?.price || null

            // Fallback: DB pricing tiers for house cleaning tenants (Cedar Rapids etc.)
            if (!existingJobPrice && bookingInfo.bedrooms && bookingInfo.bathrooms && tenant.id) {
              try {
                const { getPricingRow } = await import('@/lib/pricing-db')
                const svcRaw = (serviceType || 'standard_cleaning').toLowerCase().replace(/[_ ]cleaning/, '')
                const pricingTier = (svcRaw === 'deep' || svcRaw === 'move') ? svcRaw : 'standard'
                const pricingRow = await getPricingRow(pricingTier as any, bookingInfo.bedrooms, bookingInfo.bathrooms, bookingInfo.squareFootage || null, tenant.id)
                if (pricingRow?.price) {
                  existingJobPrice = pricingRow.price
                  console.log(`${tag} Price from DB pricing tiers (existing lead): $${existingJobPrice}`)
                }
              } catch (e) {
                console.error(`${tag} Failed to look up DB pricing (existing lead):`, e)
              }
            }

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
              status: "quoted",
              booked: false,
              paid: false,
              notes: existingLeadNotes,
              payment_status: "pending",
              job_type: isWinBrosExisting ? 'estimate' : 'cleaning',
            }).select("id").single()

            if (jobErr) {
              console.error(`${tag} Failed to create job for existing lead:`, jobErr.message)

              // Log failure as system event
              await logSystemEvent({
                source: "vapi",
                event_type: "JOB_CREATION_FAILED",
                message: `Failed to create job for existing lead ${existingLead.id}: ${fullName || phone} — ${jobErr.message}`,
                phone_number: phone,
                metadata: {
                  lead_id: existingLead.id,
                  error: jobErr.message,
                  booking_info: bookingInfo,
                },
              })

              // Don't mark lead as booked or cancel follow-ups — let the follow-up sequence continue
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

              // Mark lead as qualified (booked requires payment + cleaner assigned)
              await client
                .from("leads")
                .update({
                  status: "qualified",
                  converted_to_job_id: job.id,
                  form_data: {
                    ...bookingInfo,
                    vapi_call_id: providerCallId,
                    call_outcome: data.outcome,
                    transcript_summary: data.transcript?.substring(0, 500),
                  },
                  last_contact_at: nowIso,
                })
                .eq("id", existingLead.id)

              // Link call record to lead and job
              if (callId) {
                await client
                  .from("calls")
                  .update({ lead_id: existingLead.id, job_id: job.id })
                  .eq("id", callId)
                console.log(`${tag} Call ${callId} linked to lead ${existingLead.id} + job ${job.id}`)
              }

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
              const dateTimeStr = formatDateTimeForSMS(appointmentDate, appointmentTime)
              const confirmationMsg = SMS_TEMPLATES.vapiConfirmation(
                firstName || "",
                serviceType,
                dateTimeStr,
                bookAddress || "your address",
                isWinBrosExisting
              )

              // Insert DB record BEFORE sending so outbound webhook dedup finds it
              const { data: confirmMsgRecord2 } = await client.from("messages").insert({
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
              }).select("id").single()

              // skipDedup: we pre-inserted the DB record above, so sendSMS's content dedup would find it
              const smsResult = await sendSMS(tenant, phone, confirmationMsg, { skipDedup: true })

              if (smsResult.success) {
                console.log(`${tag} Booking confirmation text sent to ${maskPhone(phone)}`)
              } else {
                console.error(`${tag} Failed to send confirmation text:`, smsResult.error)
                if (confirmMsgRecord2?.id) {
                  await client.from("messages").delete().eq("id", confirmMsgRecord2.id)
                }
              }

              // Create "free second cleaning" offer — only for WinBros (house cleaning gets upsells via quote page)
              if (isWinBrosExisting) {
                try {
                  const { createOfferFromBooking } = await import('@/lib/offers')
                  const offerResult = await createOfferFromBooking(client, tenant.id, customerId, job.id, tenant.workflow_config as Record<string, unknown>)
                  if (offerResult.created) {
                    console.log(`${tag} Free cleaning offer created for existing-lead customer ${customerId} (offer ${offerResult.offer?.id})`)
                    await new Promise(resolve => setTimeout(resolve, 45_000))
                    const offerMsg = `🎉 BONUS: You've earned a FREE standard cleaning on your next visit! Just book again within 90 days and it's on us. We'll apply it automatically.`
                    await sendSMS(tenant, phone, offerMsg)
                  }
                } catch (offerErr) {
                  console.error(`${tag} Offer creation failed (non-blocking):`, offerErr)
                }
              }

              // Deposit link sent later: customer replies with email -> OpenPhone handles deposit flow
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
