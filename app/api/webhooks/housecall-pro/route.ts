import { NextRequest, NextResponse } from "next/server"
import { createHmac, timingSafeEqual } from "crypto"
import type { HousecallProWebhookPayload, ApiResponse } from "@/lib/types"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { normalizePhoneNumber, maskPhone } from "@/lib/phone-utils"
import { getApiKey } from "@/lib/user-api-keys"
import { scheduleTask } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getDefaultTenant, tenantUsesFeature } from "@/lib/tenant"
import { sendSMS } from "@/lib/openphone"
import { getCustomer as getHCPCustomer } from "@/integrations/housecall-pro/hcp-client"

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

    const client = getSupabaseServiceClient()
    const tenant = await getDefaultTenant()

    // Best-effort field extraction (HCP payload shapes vary by event)
    // For leads, phone is often in lead.customer.mobile_number
    // For jobs, phone may be nested in job.customer or require an API lookup
    let phoneRaw =
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
      // Job-level customer fields (HCP may nest customer in job)
      (job as any)?.customer?.mobile_number ||
      (job as any)?.customer?.phone_number ||
      (job as any)?.customer?.phone ||
      (job as any)?.customer?.phone_numbers?.[0]?.number ||
      // Nested data.customer fields
      (data as any)?.customer?.mobile_number ||
      (data as any)?.customer?.phone ||
      (data as any)?.customer?.phone_number ||
      (data as any)?.customer_phone ||
      (data as any)?.phone ||
      (data as any)?.phone_number ||
      ""

    let firstName =
      lead?.customer?.first_name ||
      lead?.first_name ||
      customer?.first_name ||
      (job as any)?.customer?.first_name ||
      (data as any)?.customer?.first_name ||
      (data as any)?.customer?.firstName ||
      (data as any)?.first_name ||
      (data as any)?.firstName ||
      null
    let lastName =
      lead?.customer?.last_name ||
      lead?.last_name ||
      customer?.last_name ||
      (job as any)?.customer?.last_name ||
      (data as any)?.customer?.last_name ||
      (data as any)?.customer?.lastName ||
      (data as any)?.last_name ||
      (data as any)?.lastName ||
      null
    let email =
      lead?.customer?.email ||
      lead?.email ||
      customer?.email ||
      (job as any)?.customer?.email ||
      (data as any)?.customer?.email ||
      (data as any)?.email ||
      null

    // If no phone found and we have a customer_id on the job, fetch from HCP API
    const hcpCustomerId = job?.customer_id || (job as any)?.customer?.id || (data as any)?.job?.customer_id
    if (!phoneRaw && hcpCustomerId) {
      console.log(`[OSIRIS] HCP Webhook: No phone in payload, fetching customer ${hcpCustomerId} from HCP API`)
      try {
        const hcpResult = await getHCPCustomer(hcpCustomerId)
        if (hcpResult.success && hcpResult.data) {
          const hcpCust = hcpResult.data
          phoneRaw = hcpCust.phone_numbers?.[0]?.number || ""
          if (!firstName) firstName = hcpCust.first_name || null
          if (!lastName) lastName = hcpCust.last_name || null
          if (!email) email = hcpCust.email || null
          console.log(`[OSIRIS] HCP Webhook: Fetched customer from HCP - phone=${maskPhone(phoneRaw)}`)
        } else {
          console.warn(`[OSIRIS] HCP Webhook: Failed to fetch customer ${hcpCustomerId} from HCP:`, hcpResult.error)
        }
      } catch (hcpErr) {
        console.error(`[OSIRIS] HCP Webhook: Error fetching customer from HCP:`, hcpErr)
      }
    }

    const phone = normalizePhoneNumber(String(phoneRaw)) || String(phoneRaw)

    console.log(`[OSIRIS] HCP Webhook phone extracted, normalized=${phone ? 'yes' : 'no'}`)

    const address =
      lead?.address ||
      job?.address ||
      customer?.address ||
      (data as any)?.job?.address ||
      (data as any)?.address ||
      (data as any)?.customer?.address ||
      null

    // Helper: check if OSIRIS is actively managing this customer (recent lead or outbound message)
    // Used to prevent HCP webhooks from overwriting fresh OSIRIS data with stale HCP data
    async function isOsirisActivelyEngaged(phoneNumber: string): Promise<boolean> {
      const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString()
      const { data: recentLead } = await client
        .from("leads")
        .select("id")
        .eq("phone_number", phoneNumber)
        .eq("tenant_id", tenant?.id)
        .gte("created_at", sixtySecondsAgo)
        .limit(1)
        .maybeSingle()
      if (recentLead) return true
      const { data: recentOutbound } = await client
        .from("messages")
        .select("id")
        .eq("phone_number", phoneNumber)
        .eq("tenant_id", tenant?.id)
        .eq("role", "assistant")
        .gte("timestamp", sixtySecondsAgo)
        .limit(1)
        .maybeSingle()
      return !!recentOutbound
    }

    switch (event) {
      case "job.created":
        console.log("[OSIRIS] New job created in HCP, mirroring to Supabase")
        // upsert customer then insert job
        if (phone) {
          // If OSIRIS is actively engaged, don't overwrite customer data with stale HCP info
          const osirisActive = await isOsirisActivelyEngaged(phone)
          let customer: { id: number } | null = null
          if (osirisActive) {
            // Customer already exists from OSIRIS flow — just look them up
            const { data: existing } = await client
              .from("customers")
              .select("id")
              .eq("phone_number", phone)
              .eq("tenant_id", tenant?.id)
              .maybeSingle()
            customer = existing
            if (!customer) {
              // Shouldn't happen but create without HCP name data as safety net
              const { data: created } = await client
                .from("customers")
                .upsert(
                  { phone_number: phone, tenant_id: tenant?.id },
                  { onConflict: "tenant_id,phone_number" }
                )
                .select("id")
                .single()
              customer = created
            }
            console.log(`[OSIRIS] HCP job.created: OSIRIS active for ${maskPhone(phone)}, skipping customer data overwrite`)
          } else {
            const { data: upserted } = await client
              .from("customers")
              .upsert(
                { phone_number: phone, tenant_id: tenant?.id, first_name: firstName, last_name: lastName, email, address },
                { onConflict: "tenant_id,phone_number" }
              )
              .select("id")
              .single()
            customer = upserted
          }

          // Extract schedule from top-level job object (HCP sends scheduled_start)
          // then fallback to nested data paths
          const scheduledStart = (job as any)?.scheduled_start || (data as any)?.job?.scheduled_start
          const scheduledDate =
            (scheduledStart ? new Date(scheduledStart).toISOString().split('T')[0] : null) ||
            (data as any)?.job?.scheduled_date ||
            (data as any)?.job?.date ||
            null
          const scheduledTime =
            (scheduledStart ? new Date(scheduledStart).toTimeString().slice(0, 5) : null) ||
            (data as any)?.job?.scheduled_time ||
            (data as any)?.job?.scheduled_at ||
            null

          const hcpJobId = (job as any)?.id || (data as any)?.job?.id
          const jobAddress = address || ((job as any)?.address ? formatHCPAddress((job as any).address) : null)

          // Dedup: check if we already have this HCP job mirrored
          const { data: existingHcpJob } = hcpJobId
            ? await client.from("jobs").select("id").eq("housecall_pro_job_id", String(hcpJobId)).maybeSingle()
            : { data: null }
          if (existingHcpJob) {
            console.log(`[OSIRIS] HCP Webhook: Job ${hcpJobId} already exists in OSIRIS (id: ${existingHcpJob.id}), skipping duplicate`)
            break
          }

          // Detect if this is an estimate job (tagged by OSIRIS when syncing salesman visits)
          const lineItemName = (job as any)?.line_items?.[0]?.name || (data as any)?.job?.service_type || ''
          const jobNotes = (job as any)?.notes || ''
          const isEstimateJob =
            lineItemName.toUpperCase().includes('ESTIMATE') ||
            jobNotes.includes('[ESTIMATE]')

          // Determine job_type: estimate visits vs real cleaning jobs
          const jobType = isEstimateJob ? 'estimate' : 'cleaning'

          const { data: newHcpJob } = await client.from("jobs").insert({
            tenant_id: tenant?.id,
            customer_id: customer?.id,
            phone_number: phone,
            address: jobAddress,
            service_type: lineItemName || "Service",
            date: scheduledDate,
            scheduled_at: scheduledTime,
            status: "scheduled",
            booked: true,
            housecall_pro_job_id: hcpJobId || null,
            housecall_pro_customer_id: hcpCustomerId || null,
            price: (job as any)?.total_amount || null,
            notes: jobNotes || null,
            brand: 'winbros',
            job_type: jobType,
          }).select("id").single()

          console.log(`[OSIRIS] HCP Webhook: Job mirrored to Supabase (HCP job: ${hcpJobId}, phone: ${maskPhone(phone)}, type: ${jobType})`)

          // WinBros: If this is a real cleaning job (NOT an estimate), auto-assign a technician
          if (tenant?.slug === 'winbros' && !isEstimateJob && scheduledDate && newHcpJob?.id) {
            try {
              const { optimizeRoutesIncremental } = await import("@/lib/route-optimizer")
              const { dispatchRoutes } = await import("@/lib/dispatch")
              const { sendTelegramMessage } = await import("@/lib/telegram")

              console.log(`[OSIRIS] HCP Webhook: Triggering technician route optimization for job ${newHcpJob.id} on ${scheduledDate}`)

              const { optimization, assignedTeamId, assignedLeadId, assignedLeadTelegramId } =
                await optimizeRoutesIncremental(Number(newHcpJob.id), scheduledDate, tenant.id, 'technician')

              if (assignedTeamId) {
                await dispatchRoutes(optimization, tenant.id, {
                  sendTelegramToTeams: false,  // Full route at 5pm
                  sendSmsToCustomers: false,
                })

                // Send immediate notification to assigned technician (address withheld until 5pm route)
                if (assignedLeadTelegramId) {
                  const customerName = [firstName, lastName].filter(Boolean).join(' ') || 'Customer'
                  const techMsg = [
                    `<b>New Job Assigned - WinBros</b>`,
                    ``,
                    `Date: ${scheduledDate}${scheduledTime ? ` at ${scheduledTime}` : ''}`,
                    `Service: ${lineItemName || 'Window Cleaning'}`,
                    ``,
                    `You'll receive your full route with addresses at 5 PM tonight.`,
                  ].join('\n')
                  await sendTelegramMessage(tenant, assignedLeadTelegramId, techMsg, 'HTML')
                  console.log(`[OSIRIS] HCP Webhook: Telegram sent to technician (team ${assignedTeamId}) for job ${newHcpJob.id}`)
                }
              } else {
                console.warn(`[OSIRIS] HCP Webhook: No technician team available for job ${newHcpJob.id} on ${scheduledDate}`)
              }

              await logSystemEvent({
                tenant_id: tenant?.id,
                source: "housecall_pro_webhook",
                event_type: "TECHNICIAN_AUTO_ASSIGNED",
                message: `Technician auto-assigned for HCP job ${hcpJobId} (OSIRIS job ${newHcpJob.id})`,
                phone_number: phone,
                metadata: {
                  hcp_job_id: hcpJobId,
                  osiris_job_id: newHcpJob.id,
                  assigned_team_id: assignedTeamId,
                  scheduled_date: scheduledDate,
                },
              })
            } catch (routeErr) {
              console.error(`[OSIRIS] HCP Webhook: Error in technician route optimization for job ${newHcpJob.id}:`, routeErr)
            }
          }
        } else {
          console.warn(`[OSIRIS] HCP Webhook: Skipping job.created - no phone number resolved (customer_id: ${hcpCustomerId})`)
        }
        break

      case "job.updated":
        console.log("[OSIRIS] Job updated in HCP, syncing to Supabase")
        {
          const hcpJobId = (data as any)?.job?.id || (data as any)?.job_id || (data as any)?.id
          if (hcpJobId != null) {
            let updateQuery = client
              .from("jobs")
              .update({
                status: (data as any)?.job?.status || (data as any)?.status || null,
                paid: Boolean((data as any)?.job?.paid || (data as any)?.paid),
                address,
              })
              .eq("housecall_pro_job_id", String(hcpJobId))
            if (tenant?.id) updateQuery = updateQuery.eq("tenant_id", tenant.id)
            await updateQuery
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
              .eq("housecall_pro_job_id", String(hcpJobId))
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
          const hcpJobId = (data as any)?.job?.id || (data as any)?.job_id || (data as any)?.id
          if (hcpJobId != null) {
            let cancelQuery = client.from("jobs").update({ status: "cancelled" }).eq("housecall_pro_job_id", String(hcpJobId))
            if (tenant?.id) cancelQuery = cancelQuery.eq("tenant_id", tenant.id)
            await cancelQuery
          }
        }
        break

      case "customer.created":
        console.log("[OSIRIS] New customer created in HCP")
        if (phone) {
          // Don't overwrite fresh OSIRIS data with stale HCP data
          if (await isOsirisActivelyEngaged(phone)) {
            console.log(`[OSIRIS] HCP customer.created: OSIRIS active for ${maskPhone(phone)}, skipping data overwrite`)
          } else {
            await client.from("customers").upsert(
              { phone_number: phone, tenant_id: tenant?.id, first_name: firstName, last_name: lastName, email, address },
              { onConflict: "tenant_id,phone_number" }
            )
          }
        }
        break

      case "customer.updated":
        console.log("[OSIRIS] Customer updated in HCP")
        if (phone) {
          // Don't overwrite fresh OSIRIS data with stale HCP data
          if (await isOsirisActivelyEngaged(phone)) {
            console.log(`[OSIRIS] HCP customer.updated: OSIRIS active for ${maskPhone(phone)}, skipping data overwrite`)
          } else {
            await client.from("customers").upsert(
              { phone_number: phone, tenant_id: tenant?.id, first_name: firstName, last_name: lastName, email, address },
              { onConflict: "tenant_id,phone_number" }
            )
          }
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
          // --- Dedup: two-tier check ---
          // Tier 1 (60s): Prevents instant feedback loops (SMS → HCP → lead.created → duplicate greeting)
          // Tier 2 (24h): Catches HCP webhook retries (HCP retries after 30min+ on failure)
          const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString()
          const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString()

          // Tier 1: instant feedback loop check (60s window)
          const { data: recentLead } = await client
            .from("leads")
            .select("id, source")
            .eq("phone_number", phone)
            .eq("tenant_id", tenant?.id)
            .gte("created_at", sixtySecondsAgo)
            .limit(1)
            .maybeSingle()

          const { data: recentOutbound } = await client
            .from("messages")
            .select("id")
            .eq("phone_number", phone)
            .eq("tenant_id", tenant?.id)
            .eq("role", "assistant")
            .gte("timestamp", sixtySecondsAgo)
            .limit(1)
            .maybeSingle()

          // Tier 2: broader HCP retry dedup (24h window — catches 30-min HCP retries)
          const { data: existingLead } = await client
            .from("leads")
            .select("id, source")
            .eq("phone_number", phone)
            .eq("tenant_id", tenant?.id)
            .eq("source", "housecall_pro")
            .gte("created_at", twentyFourHoursAgo)
            .limit(1)
            .maybeSingle()

          if (recentLead || recentOutbound || existingLead) {
            // OSIRIS already has an active conversation — just store the HCP link, skip the greeting
            // IMPORTANT: Do NOT upsert customer here — OSIRIS is already handling this lead and
            // HCP may have stale data from a previous interaction that would overwrite fresh OSIRIS state
            const hcpSourceId = lead?.id || (data as any)?.lead?.id || (data as any)?.id
            const matchReason = recentLead
              ? `recent lead ${recentLead.id} (${recentLead.source})`
              : recentOutbound
                ? 'recent outbound message'
                : existingLead
                  ? `HCP lead ${existingLead.id} within 24h`
                  : 'unknown match'
            console.log(
              `[OSIRIS] HCP Webhook: Skipping lead.created greeting for ${maskPhone(phone)} — ` +
              `already have ${matchReason}. HCP lead ID: ${hcpSourceId || 'unknown'}`
            )

            // If an existing lead was found, store the HCP source ID on it for reference
            const matchedLead = recentLead || existingLead
            if (matchedLead && hcpSourceId) {
              await client
                .from("leads")
                .update({ form_data: { ...((await client.from("leads").select("form_data").eq("id", matchedLead.id).single()).data?.form_data || {}), hcp_lead_id: String(hcpSourceId) } })
                .eq("id", matchedLead.id)
            }

            await client.from("system_events").insert({
              tenant_id: tenant?.id,
              source: "housecall_pro",
              event_type: "HCP_LEAD_DEDUPED",
              message: `HCP lead.created for ${maskPhone(phone)} skipped — OSIRIS already engaged`,
              phone_number: phone,
              metadata: { hcp_lead_id: hcpSourceId, existing_lead_id: matchedLead?.id }
            })
            break
          }

          // No existing conversation — this is a genuinely new HCP-sourced lead
          // Upsert customer now (only for non-deduped leads so stale HCP data doesn't overwrite OSIRIS state)
          const { data: customerRecord } = await client
            .from("customers")
            .upsert(
              { phone_number: phone, tenant_id: tenant?.id, first_name: firstName, last_name: lastName, email, address },
              { onConflict: "tenant_id,phone_number" }
            )
            .select("id")
            .single()
          const hcpSourceId = lead?.id || (data as any)?.lead?.id || (data as any)?.id || `hcp-${Date.now()}`
          const { data: leadRecord } = await client.from("leads").insert({
            tenant_id: tenant?.id,
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
            tenant_id: tenant?.id,
            source: "housecall_pro",
            event_type: "HCP_LEAD_RECEIVED",
            message: `New lead from HousecallPro: ${firstName || 'Unknown'} ${lastName || ''}`.trim(),
            phone_number: phone,
            metadata: { hcp_lead_id: hcpSourceId, lead_id: leadRecord?.id }
          })

          // Send the first text IMMEDIATELY (don't wait for cron)
          const leadName = `${firstName || ''} ${lastName || ''}`.trim() || 'Customer'
          const businessName = tenant?.business_name_short || tenant?.name || 'Our team'

          try {
            // Window cleaning tenants (WinBros) use the estimate flow — just collect info for a free estimate visit
            const initialMessage = tenant && tenantUsesFeature(tenant, 'use_hcp_mirror')
              ? `Hi ${leadName}! Thanks for reaching out to ${businessName}. We'd love to get you set up with a free estimate — one of our team members will come out and give you an exact quote on the spot. Can I just confirm your address so we can get that scheduled?`
              : `Hi ${leadName}! Thanks for reaching out to ${businessName}. We'd love to help with your cleaning needs. Can you share your address and number of bedrooms/bathrooms so we can give you an instant quote?`

            let smsResult
            if (tenant) {
              smsResult = await sendSMS(tenant, phone, initialMessage)
            } else {
              console.warn("[OSIRIS] HCP Webhook: No tenant found, skipping SMS for lead")
              smsResult = { success: false, error: "No tenant" }
            }

            if (smsResult.success) {
              console.log(`[OSIRIS] HCP Webhook: Sent immediate first text to ${maskPhone(phone)}`)

              console.log(`[OSIRIS] HCP Webhook: Saving message to DB - phone: ${maskPhone(phone)}, customer_id: ${customerRecord?.id}, tenant_id: ${tenant?.id}`)
              const { error: msgError } = await client.from("messages").insert({
                tenant_id: tenant?.id,
                customer_id: customerRecord?.id,
                phone_number: phone,
                role: "assistant",
                content: initialMessage,
                direction: "outbound",
                message_type: "sms",
                ai_generated: false,
                timestamp: new Date().toISOString(),
                source: "hcp_webhook",
              })
              if (msgError) {
                console.error(`[OSIRIS] HCP Webhook: Failed to save message to DB:`, msgError)
              } else {
                console.log(`[OSIRIS] HCP Webhook: Message saved successfully to DB for ${maskPhone(phone)}`)
              }

              // Update lead to stage 1 + mark as contacted so dedup checks work
              await client
                .from("leads")
                .update({ followup_stage: 1, last_contact_at: new Date().toISOString() })
                .eq("id", leadRecord?.id)

              // Log the event
              await logSystemEvent({
                source: "housecall_pro",
                event_type: "LEAD_FOLLOWUP_STAGE_1",
                message: `First follow-up text sent immediately to ${maskPhone(phone)}`,
                phone_number: phone,
                metadata: { leadId: leadRecord?.id, stage: 1, action: 'text' },
              })
            } else {
              console.error("[OSIRIS] HCP Webhook: Failed to send first text:", smsResult.error)
            }
          } catch (smsError) {
            console.error("[OSIRIS] HCP Webhook: Error sending first text:", smsError)
          }

          // Schedule stages 2-5 for the follow-up sequence
          if (leadRecord?.id) {
            const now = new Date()
            const stages = [
              { stage: 2, action: 'text', delayMinutes: 10 },
              { stage: 3, action: 'call', delayMinutes: 15 },
              { stage: 4, action: 'call', delayMinutes: 17 },  // Double dial - shortly after Call 1
              { stage: 5, action: 'text', delayMinutes: 30 },
            ]

            for (const { stage, action, delayMinutes } of stages) {
              try {
                const scheduledFor = new Date(now.getTime() + delayMinutes * 60 * 1000)
                await scheduleTask({
                  tenantId: tenant?.id,
                  taskType: 'lead_followup',
                  taskKey: `lead-${leadRecord.id}-stage-${stage}`,
                  scheduledFor,
                  payload: {
                    leadId: String(leadRecord.id),
                    leadPhone: phone,
                    leadName,
                    stage,
                    action,
                  },
                })
              } catch (scheduleError) {
                console.error(`[OSIRIS] HCP Webhook: Error scheduling stage ${stage}:`, scheduleError)
              }
            }
            console.log(`[OSIRIS] HCP Webhook: Scheduled follow-up stages 2-5 for lead ${leadRecord.id}`)
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
              let leadQuery = client
                .from("leads")
                .update({ status, form_data: data })
                .eq("source_id", String(leadId))
              if (tenant?.id) leadQuery = leadQuery.eq("tenant_id", tenant.id)
              await leadQuery
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

/** Format an HCP address object to a single string */
function formatHCPAddress(addr: { street?: string; street_line_2?: string; city?: string; state?: string; zip?: string }): string | null {
  if (!addr?.street) return null
  const parts = [addr.street]
  if (addr.street_line_2) parts.push(addr.street_line_2)
  if (addr.city || addr.state || addr.zip) {
    parts.push(`${addr.city || ''}, ${addr.state || ''} ${addr.zip || ''}`.trim())
  }
  return parts.join(', ')
}
