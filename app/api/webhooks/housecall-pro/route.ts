import { NextRequest, NextResponse } from "next/server"
import { createHmac, timingSafeEqual } from "crypto"
import type { HousecallProWebhookPayload, ApiResponse } from "@/lib/types"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { normalizePhoneNumber, maskPhone } from "@/lib/phone-utils"
import { getApiKey } from "@/lib/user-api-keys"
import { scheduleTask } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { tenantUsesFeature, isHcpSyncEnabled, getAllActiveTenants } from "@/lib/tenant"
import { sendSMS } from "@/lib/openphone"
import { triggerSatisfactionCheck } from "@/lib/lifecycle-engine"
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
    const signature = request.headers.get("X-HousecallPro-Signature")

    // Resolve tenant by matching webhook signature against per-tenant secrets.
    // This correctly routes webhooks in multi-tenant: each tenant has its own HCP webhook secret.
    const allTenants = await getAllActiveTenants()
    const hcpTenants = allTenants.filter(t => t.housecall_pro_api_key)

    let tenant: typeof hcpTenants[0] | null = null

    if (signature) {
      // Try each tenant's webhook secret to find the matching one
      for (const t of hcpTenants) {
        const secret = t.housecall_pro_webhook_secret
        if (!secret) continue
        const expected = createHmac("sha256", secret).update(rawBody).digest("hex")
        const sigLower = signature.toLowerCase()
        const expLower = expected.toLowerCase()
        if (sigLower.length === expLower.length && timingSafeEqual(Buffer.from(sigLower), Buffer.from(expLower))) {
          tenant = t
          break
        }
      }

      // Fallback: try global secret (backward compat for single-tenant setups)
      if (!tenant) {
        const globalSecret = getApiKey("housecallProWebhookSecret") || process.env.HOUSECALL_PRO_WEBHOOK_SECRET
        if (globalSecret) {
          const expected = createHmac("sha256", globalSecret).update(rawBody).digest("hex")
          const sigLower = signature.toLowerCase()
          const expLower = expected.toLowerCase()
          if (sigLower.length === expLower.length && timingSafeEqual(Buffer.from(sigLower), Buffer.from(expLower))) {
            tenant = hcpTenants[0] || null
          } else {
            console.error("[OSIRIS] HCP Webhook: Invalid signature — no tenant secret matched")
            return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 })
          }
        } else {
          console.error("[OSIRIS] HCP Webhook: Signature present but no secrets configured")
          return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 })
        }
      }
    } else {
      // No signature header — fall back to first HCP tenant (dev/unconfigured environments)
      console.warn("[OSIRIS] HCP Webhook: No signature header, falling back to first HCP tenant")
      tenant = hcpTenants[0] || null
    }

    if (!tenant) {
      console.error('[HCP Webhook] No tenant with HCP API key configured — cannot process webhook')
      return NextResponse.json({ success: false, error: "No HCP tenant configured" }, { status: 401 })
    }

    // Master kill switch: drop inbound webhooks when HCP sync is disabled
    if (!isHcpSyncEnabled(tenant)) {
      console.log(`[HCP Webhook] Sync disabled for tenant ${tenant.slug} — ignoring webhook`)
      return NextResponse.json({ success: true, message: "HCP sync disabled, webhook ignored" })
    }

    const payload: HousecallProWebhookPayload = JSON.parse(rawBody)
    const { event, data, timestamp } = payload

    // HCP sends data at top level OR nested under data depending on event type
    const lead = (payload as any).lead || (data as any)?.lead
    const job = (payload as any).job || (data as any)?.job
    const customer = (payload as any).customer || (data as any)?.customer

    console.log(`[OSIRIS] HCP Webhook received: ${event}`, {
      timestamp,
      tenant: tenant.slug,
      hasLead: !!lead,
      hasJob: !!job,
      hasCustomer: !!customer,
      leadCustomer: lead?.customer ? 'present' : 'missing'
    })

    const client = getSupabaseServiceClient()

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

    const rawAddress =
      lead?.address ||
      job?.address ||
      customer?.address ||
      (data as any)?.job?.address ||
      (data as any)?.address ||
      (data as any)?.customer?.address ||
      null
    // Format HCP address objects to a clean string; pass through if already a string
    const address = rawAddress && typeof rawAddress === 'object'
      ? formatHCPAddress(rawAddress)
      : rawAddress

    // Helper: check if OSIRIS is actively managing this customer (recent lead or outbound message)
    // Used to prevent HCP webhooks from overwriting fresh OSIRIS data with stale HCP data
    async function isOsirisActivelyEngaged(phoneNumber: string): Promise<boolean> {
      const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString()
      const { data: recentLead } = await client
        .from("leads")
        .select("id")
        .eq("phone_number", phoneNumber)
        .eq("tenant_id", tenant!.id)
        .gte("created_at", sixtySecondsAgo)
        .limit(1)
        .maybeSingle()
      if (recentLead) return true
      const { data: recentOutbound } = await client
        .from("messages")
        .select("id")
        .eq("phone_number", phoneNumber)
        .eq("tenant_id", tenant!.id)
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
              .eq("tenant_id", tenant.id)
              .maybeSingle()
            customer = existing
            if (!customer) {
              // Shouldn't happen but create without HCP name data as safety net
              const { data: created } = await client
                .from("customers")
                .upsert(
                  { phone_number: phone, tenant_id: tenant.id },
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
                { phone_number: phone, tenant_id: tenant.id, first_name: firstName, last_name: lastName, email, address, housecall_pro_customer_id: hcpCustomerId ? String(hcpCustomerId) : undefined },
                { onConflict: "tenant_id,phone_number" }
              )
              .select("id")
              .single()
            customer = upserted
          }

          // HCP webhook sends schedule as a nested object, NOT as scheduled_start
          const scheduleObj = (job as any)?.schedule || (data as any)?.job?.schedule
          const scheduledStart =
            scheduleObj?.scheduled_start ||
            scheduleObj?.start_time ||
            scheduleObj?.start ||
            scheduleObj?.start_at ||
            (job as any)?.scheduled_start ||  // fallback to flat field
            (data as any)?.job?.scheduled_start
          let scheduledDate =
            (scheduledStart ? new Date(scheduledStart).toISOString().split('T')[0] : null) ||
            (data as any)?.job?.scheduled_date ||
            (data as any)?.job?.date ||
            null
          // Store full ISO for consistency; fall back to raw text only if no parseable start
          const scheduledTime = scheduledStart
            ? new Date(scheduledStart).toISOString()
            : (data as any)?.job?.scheduled_time || (data as any)?.job?.scheduled_at || null

          // Calculate hours from schedule end - start
          const scheduledEnd =
            scheduleObj?.scheduled_end ||
            scheduleObj?.end_time ||
            scheduleObj?.end ||
            scheduleObj?.end_at ||
            (job as any)?.scheduled_end ||
            (data as any)?.job?.scheduled_end
          let jobHours: number | null = null
          if (scheduledStart && scheduledEnd) {
            const diffMs = new Date(scheduledEnd).getTime() - new Date(scheduledStart).getTime()
            if (diffMs > 0) jobHours = Math.round((diffMs / 3_600_000) * 100) / 100
          }

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
            tenant_id: tenant.id,
            customer_id: customer?.id,
            phone_number: phone,
            address: jobAddress,
            service_type: lineItemName || "Service",
            date: scheduledDate,
            scheduled_at: scheduledTime,
            status: "quoted",
            booked: false,
            housecall_pro_job_id: hcpJobId || null,
            price: (job as any)?.total_amount ?? null,
            hours: jobHours,
            notes: jobNotes || null,
            job_type: jobType,
          }).select("id").single()

          console.log(`[OSIRIS] HCP Webhook: Job mirrored to Supabase (HCP job: ${hcpJobId}, phone: ${maskPhone(phone)}, type: ${jobType})`)

          // WinBros: If this is a real cleaning job (NOT an estimate), auto-assign a technician
          if (tenant.slug === 'winbros' && !isEstimateJob && scheduledDate && newHcpJob?.id) {
            try {
              const { optimizeRoutesIncremental } = await import("@/lib/route-optimizer")
              const { dispatchRoutes } = await import("@/lib/dispatch")
              const { sendSMS } = await import("@/lib/openphone")

              console.log(`[OSIRIS] HCP Webhook: Triggering technician route optimization for job ${newHcpJob.id} on ${scheduledDate}`)

              const { optimization, assignedTeamId, assignedLeadId } =
                await optimizeRoutesIncremental(Number(newHcpJob.id), scheduledDate, tenant.id, 'technician')

              if (assignedTeamId) {
                await dispatchRoutes(optimization, tenant.id, {
                  sendTelegramToTeams: false,  // Full route at 5pm
                  sendSmsToCustomers: false,
                })

                // Send immediate SMS notification to assigned technician
                if (assignedLeadId) {
                  const { data: techLead } = await client
                    .from('cleaners')
                    .select('phone, name')
                    .eq('id', assignedLeadId)
                    .maybeSingle()
                  if (techLead?.phone) {
                    const techMsg = `New Job Assigned - WinBros\n\nDate: ${scheduledDate}${scheduledTime ? ` at ${scheduledTime}` : ''}\nService: ${lineItemName || 'Window Cleaning'}\n\nYou'll receive your full route with addresses at 5 PM tonight.`
                    await sendSMS(tenant, techLead.phone, techMsg)
                    console.log(`[OSIRIS] HCP Webhook: SMS sent to technician (team ${assignedTeamId}) for job ${newHcpJob.id}`)
                  }
                }
              } else {
                console.warn(`[OSIRIS] HCP Webhook: No technician team available for job ${newHcpJob.id} on ${scheduledDate}`)
              }

              await logSystemEvent({
                tenant_id: tenant.id,
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
          const hcpJobId = (job as any)?.id || (data as any)?.job?.id || (data as any)?.job_id || (data as any)?.id
          if (hcpJobId) {
            const { data: localJob } = await client
              .from("jobs")
              .select("id, status")
              .eq("housecall_pro_job_id", String(hcpJobId))
              .maybeSingle()

            if (localJob && !['completed', 'cancelled'].includes(localJob.status)) {
              // Status: check both work_status (HCP API field name) and status
              const hcpStatus = (job as any)?.work_status || (data as any)?.job?.work_status
                || (job as any)?.status || (data as any)?.job?.status || (data as any)?.status
              const validStatuses: Record<string, string> = {
                unscheduled: 'pending', scheduled: 'scheduled', dispatched: 'in_progress', in_progress: 'in_progress',
                complete: 'completed', completed: 'completed', canceled: 'cancelled', cancelled: 'cancelled',
              }
              const mappedStatus = hcpStatus ? validStatuses[hcpStatus.toLowerCase()] : undefined

              // Schedule extraction (same logic as job.created)
              const updScheduleObj = (job as any)?.schedule || (data as any)?.job?.schedule
              const updScheduledStart =
                updScheduleObj?.scheduled_start || updScheduleObj?.start_time ||
                updScheduleObj?.start || updScheduleObj?.start_at ||
                (job as any)?.scheduled_start || (data as any)?.job?.scheduled_start
              const updScheduledEnd =
                updScheduleObj?.scheduled_end || updScheduleObj?.end_time ||
                updScheduleObj?.end || updScheduleObj?.end_at ||
                (job as any)?.scheduled_end || (data as any)?.job?.scheduled_end

              // Price and service type
              const updPrice = (job as any)?.total_amount ?? (data as any)?.job?.total_amount
              const updLineItemName = (job as any)?.line_items?.[0]?.name || (data as any)?.job?.line_items?.[0]?.name

              const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
              if (mappedStatus) updates.status = mappedStatus
              if ((data as any)?.job?.paid || (data as any)?.paid) updates.paid = true
              if (address) updates.address = address
              if (updScheduledStart) {
                updates.date = new Date(updScheduledStart).toISOString().split('T')[0]
                updates.scheduled_at = new Date(updScheduledStart).toISOString()
              }
              if (updScheduledStart && updScheduledEnd) {
                const diffMs = new Date(updScheduledEnd).getTime() - new Date(updScheduledStart).getTime()
                if (diffMs > 0) updates.hours = Math.round((diffMs / 3_600_000) * 100) / 100
              }
              if (updPrice !== undefined && updPrice !== null) updates.price = updPrice
              if (updLineItemName) updates.service_type = updLineItemName

              // Only write if there are meaningful updates beyond just updated_at
              if (Object.keys(updates).length > 1) {
                await client.from("jobs").update(updates).eq("id", localJob.id)
                console.log(`[OSIRIS] HCP job.updated: Updated local job ${localJob.id} from HCP job ${hcpJobId}`, Object.keys(updates))
              }
            }
          }
        }
        break

      case "job.completed":
        console.log("[OSIRIS] Job completed, triggering post-job automations")
        {
          const hcpJobId = (job as any)?.id || (data as any)?.job?.id || (data as any)?.job_id || (data as any)?.id
          if (hcpJobId) {
            const { data: localJob } = await client
              .from("jobs")
              .select("id, status, phone_number")
              .eq("housecall_pro_job_id", String(hcpJobId))
              .maybeSingle()

            if (localJob && !['completed', 'cancelled'].includes(localJob.status)) {
              await client
                .from("jobs")
                .update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                .eq("id", localJob.id)

              console.log(`[OSIRIS] HCP job.completed: Updated local job ${localJob.id} from HCP job ${hcpJobId}`)

              await logSystemEvent({
                tenant_id: tenant.id,
                source: "housecall_pro",
                event_type: "JOB_COMPLETED",
                message: `Job ${localJob.id} marked completed via HCP`,
                job_id: String(localJob.id),
                phone_number: localJob.phone_number || phone,
                metadata: { hcp_job_id: hcpJobId },
              })

              // Immediate satisfaction check
              if (tenantUsesFeature(tenant, 'post_cleaning_followup_enabled')) {
                const custPhone = localJob.phone_number || phone
                if (custPhone) {
                  const { data: cust } = await client
                    .from("customers")
                    .select("id, first_name")
                    .eq("phone_number", custPhone)
                    .eq("tenant_id", tenant.id)
                    .maybeSingle()

                  triggerSatisfactionCheck({
                    tenant,
                    jobId: String(localJob.id),
                    customerId: cust?.id ? Number(cust.id) : null,
                    customerPhone: custPhone,
                    customerName: cust?.first_name || 'there',
                  }).catch(err => console.error(`[HCP] Satisfaction check error for job ${localJob.id}:`, err))
                }
              }
            } else if (!localJob) {
              console.log(`[OSIRIS] HCP job.completed: No local job found for HCP job ${hcpJobId}`)
            }
          }
        }
        break

      case "job.cancelled":
        console.log("[OSIRIS] Job cancelled in HCP")
        {
          const hcpJobId = (job as any)?.id || (data as any)?.job?.id || (data as any)?.job_id || (data as any)?.id
          if (hcpJobId) {
            const { data: localJob } = await client
              .from("jobs")
              .select("id, status, paid")
              .eq("housecall_pro_job_id", String(hcpJobId))
              .maybeSingle()

            if (localJob && !['completed', 'cancelled'].includes(localJob.status) && !localJob.paid) {
              await client.from("jobs").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", localJob.id)
              console.log(`[OSIRIS] HCP job.cancelled: Cancelled local job ${localJob.id} from HCP job ${hcpJobId}`)
            } else if (localJob?.paid) {
              console.warn(`[OSIRIS] HCP job.cancelled: Ignoring cancel for paid job ${localJob.id}`)
            }
          }
        }
        break

      case "customer.created":
      case "customer.updated":
        console.log(`[OSIRIS] Customer ${event === 'customer.created' ? 'created' : 'updated'} in HCP`)
        {
          const hcpCustId = customer?.id || (data as any)?.customer?.id || (data as any)?.id
          const updateFields: Record<string, unknown> = {}
          if (phone) updateFields.phone_number = phone
          if (firstName) updateFields.first_name = firstName
          if (lastName) updateFields.last_name = lastName
          if (email) updateFields.email = email
          if (address) updateFields.address = address

          // Strategy: look up by HCP customer ID first (handles phone/email changes correctly)
          // Fall back to phone-based upsert only for genuinely new customers
          let matched = false

          if (hcpCustId && tenant.id) {
            const { data: existing } = await client
              .from("customers")
              .select("id, phone_number")
              .eq("housecall_pro_customer_id", String(hcpCustId))
              .eq("tenant_id", tenant.id)
              .maybeSingle()

            if (existing) {
              // Don't overwrite fresh OSIRIS data with stale HCP data
              const checkPhone = phone || existing.phone_number
              if (checkPhone && await isOsirisActivelyEngaged(checkPhone)) {
                console.log(`[OSIRIS] HCP ${event}: OSIRIS active for ${maskPhone(checkPhone)}, skipping data overwrite`)
              } else if (Object.keys(updateFields).length > 0) {
                await client.from("customers").update(updateFields).eq("id", existing.id)
                console.log(`[OSIRIS] HCP ${event}: Updated customer ${existing.id} by HCP ID ${hcpCustId}`)
              }
              matched = true
            }
          }

          // Fallback: no HCP ID match — upsert by phone (new customer or missing HCP ID)
          if (!matched && phone) {
            if (await isOsirisActivelyEngaged(phone)) {
              console.log(`[OSIRIS] HCP ${event}: OSIRIS active for ${maskPhone(phone)}, skipping data overwrite`)
            } else {
              await client.from("customers").upsert(
                { ...updateFields, phone_number: phone, tenant_id: tenant.id, housecall_pro_customer_id: hcpCustId ? String(hcpCustId) : undefined },
                { onConflict: "tenant_id,phone_number" }
              )
              console.log(`[OSIRIS] HCP ${event}: Upserted customer by phone ${maskPhone(phone)}${hcpCustId ? ` (HCP ID: ${hcpCustId})` : ''}`)
            }
          } else if (!matched && !phone) {
            console.warn(`[OSIRIS] HCP ${event}: No phone and no HCP ID match — cannot process customer`)
          }
        }
        break

      case "payment.received":
      case "invoice.paid":
        console.log("[OSIRIS] Payment received for job")
        {
          const hcpJobId = (job as any)?.id || (data as any)?.job?.id || (data as any)?.job_id || (data as any)?.id
          if (hcpJobId) {
            const { data: localJob } = await client
              .from("jobs")
              .select("id, customer_id, phone_number, address, service_type, price, date, notes, team_id, job_type, tenant_id")
              .eq("housecall_pro_job_id", String(hcpJobId))
              .maybeSingle()

            if (localJob) {
              await client.from("jobs").update({
                paid: true,
                payment_status: 'fully_paid',
                updated_at: new Date().toISOString(),
              }).eq("id", localJob.id)
              console.log(`[OSIRIS] HCP payment: Marked local job ${localJob.id} as paid from HCP job ${hcpJobId}`)

              // WinBros flow: estimate paid → auto-create cleaning job
              if (localJob.job_type === 'estimate' && tenant && tenantUsesFeature(tenant, 'use_team_routing')) {
                try {
                  // Idempotency: check if we already created a cleaning job from this estimate
                  const { data: existingCleaning } = await client
                    .from("jobs")
                    .select("id")
                    .eq("tenant_id", localJob.tenant_id)
                    .eq("job_type", "cleaning")
                    .like("notes", `%[From estimate #${localJob.id}]%`)
                    .limit(1)
                    .maybeSingle()

                  if (existingCleaning) {
                    console.log(`[OSIRIS] HCP payment: Cleaning job already exists for estimate ${localJob.id} (job ${existingCleaning.id}), skipping duplicate`)
                    break
                  }

                  const { sendSMS: sendHcpSMS } = await import("@/lib/openphone")
                  const { alertOwner } = await import("@/lib/owner-alert")

                  // Create a new cleaning job from the estimate data
                  const { data: cleaningJob } = await client.from("jobs").insert({
                    tenant_id: localJob.tenant_id,
                    customer_id: localJob.customer_id,
                    phone_number: localJob.phone_number,
                    address: localJob.address,
                    service_type: localJob.service_type,
                    price: localJob.price,
                    notes: localJob.notes ? `${localJob.notes}\n[From estimate #${localJob.id}]` : `[From estimate #${localJob.id}]`,
                    job_type: 'cleaning',
                    status: 'pending',
                    booked: false,
                    paid: true,
                    payment_status: 'fully_paid',
                    date: null,
                    scheduled_at: null,
                  }).select("id").single()

                  if (cleaningJob) {
                    console.log(`[OSIRIS] HCP payment: Created cleaning job ${cleaningJob.id} from estimate ${localJob.id}`)

                    // Notify team lead via SMS
                    if (localJob.team_id && tenant) {
                      const { data: teamLead } = await client
                        .from("team_members")
                        .select("cleaner_id, cleaners ( id, name, phone )")
                        .eq("team_id", localJob.team_id)
                        .eq("role", "lead")
                        .eq("is_active", true)
                        .limit(1)
                        .maybeSingle()

                      const leadPhone = (teamLead?.cleaners as any)?.phone
                      const leadName = (teamLead?.cleaners as any)?.name || 'Team Lead'
                      if (leadPhone) {
                        const customerName = localJob.phone_number || 'Customer'
                        await sendHcpSMS(
                          tenant,
                          leadPhone,
                          `Payment received for ${customerName} at ${localJob.address || 'TBD'}!\n\nCleaning job #${cleaningJob.id} created - ready to schedule.`
                        )
                        console.log(`[OSIRIS] HCP payment: Notified team lead ${leadName} via SMS`)
                      }
                    }

                    // SMS owner
                    if (tenant) {
                      await alertOwner(
                        `HCP invoice paid! Cleaning job #${cleaningJob.id} created from estimate #${localJob.id} at ${localJob.address || 'TBD'}. Hit "Auto-schedule" in the dashboard to dispatch.`,
                        { jobId: String(cleaningJob.id), tenant }
                      )
                    }

                    // Log system event
                    await logSystemEvent({
                      tenant_id: tenant?.id,
                      event_type: 'CLEANING_JOB_CREATED_FROM_ESTIMATE',
                      source: 'housecall_pro',
                      message: `Cleaning job #${cleaningJob.id} created from paid estimate #${localJob.id}`,
                      job_id: String(cleaningJob.id),
                      customer_id: localJob.customer_id ? String(localJob.customer_id) : undefined,
                      phone_number: localJob.phone_number || undefined,
                      metadata: { estimate_job_id: localJob.id, hcp_job_id: hcpJobId },
                    })
                  }
                } catch (err) {
                  console.error(`[OSIRIS] HCP payment: Failed to create cleaning job from estimate ${localJob.id}:`, err)
                }
              }
            }
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
            .eq("tenant_id", tenant.id)
            .gte("created_at", sixtySecondsAgo)
            .limit(1)
            .maybeSingle()

          const { data: recentOutbound } = await client
            .from("messages")
            .select("id")
            .eq("phone_number", phone)
            .eq("tenant_id", tenant.id)
            .eq("role", "assistant")
            .gte("timestamp", sixtySecondsAgo)
            .limit(1)
            .maybeSingle()

          // Tier 2: broader HCP retry dedup (24h window — catches 30-min HCP retries)
          const { data: existingLead } = await client
            .from("leads")
            .select("id, source")
            .eq("phone_number", phone)
            .eq("tenant_id", tenant.id)
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
              tenant_id: tenant.id,
              source: "housecall_pro",
              event_type: "HCP_LEAD_DEDUPED",
              message: `HCP lead.created for ${maskPhone(phone)} skipped — OSIRIS already engaged`,
              phone_number: phone,
              metadata: { hcp_lead_id: hcpSourceId, existing_lead_id: matchedLead?.id }
            })
            break
          }

          // No existing conversation — this is a genuinely new HCP-sourced lead

          // Check if this phone was recently reset — if so, HCP's customer record is stale
          // (OSIRIS reset only clears our DB, not HCP's cached customer with old names)
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString()
          const serviceClient = getSupabaseServiceClient()
          const { data: recentReset } = await serviceClient
            .from("system_events")
            .select("id")
            .eq("phone_number", phone)
            .eq("event_type", "SYSTEM_RESET")
            .gte("created_at", fiveMinutesAgo)
            .limit(1)
            .maybeSingle()

          if (recentReset) {
            console.log(`[OSIRIS] HCP Webhook: Recent SYSTEM_RESET detected for ${maskPhone(phone)} — discarding stale HCP name`)
            firstName = null
            lastName = null
            email = null
          }

          // Upsert customer now (only for non-deduped leads so stale HCP data doesn't overwrite OSIRIS state)
          const leadHcpCustId = lead?.customer?.id || customer?.id || (data as any)?.customer?.id
          const { data: customerRecord } = await client
            .from("customers")
            .upsert(
              { phone_number: phone, tenant_id: tenant.id, first_name: firstName, last_name: lastName, email, address, housecall_pro_customer_id: leadHcpCustId ? String(leadHcpCustId) : undefined, lead_source: "housecall_pro" },
              { onConflict: "tenant_id,phone_number" }
            )
            .select("id")
            .single()
          const hcpSourceId = lead?.id || (data as any)?.lead?.id || (data as any)?.id || `hcp-${Date.now()}`

          // Extract HCP-specific detail fields for richer lead context
          const hcpLeadSource = lead?.source || lead?.lead_source || (data as any)?.source || null
          const hcpWorkRequested = lead?.work_requested || lead?.notes || (data as any)?.work_requested || null
          const hcpLeadFormData = {
            ...(typeof data === 'object' && data !== null ? data : {}),
            hcp_lead_id: String(hcpSourceId),
            hcp_lead_source: hcpLeadSource ? String(hcpLeadSource) : null,
            hcp_work_requested: hcpWorkRequested ? String(hcpWorkRequested) : null,
          }

          const { data: leadRecord } = await client.from("leads").insert({
            tenant_id: tenant.id,
            source_id: String(hcpSourceId),
            phone_number: phone,
            customer_id: customerRecord?.id ?? null,
            first_name: firstName || null,
            last_name: lastName || null,
            email: email || null,
            source: "housecall_pro",
            status: "new",
            form_data: hcpLeadFormData,
            followup_stage: 0,
            followup_started_at: new Date().toISOString(),
          }).select("id").single()

          // Log system event
          await client.from("system_events").insert({
            tenant_id: tenant.id,
            source: "housecall_pro",
            event_type: "HCP_LEAD_RECEIVED",
            message: `New lead from HousecallPro: ${firstName || 'Unknown'} ${lastName || ''}`.trim(),
            phone_number: phone,
            metadata: { hcp_lead_id: hcpSourceId, lead_id: leadRecord?.id }
          })

          // Send the first text IMMEDIATELY (don't wait for cron)
          const leadName = `${firstName || ''} ${lastName || ''}`.trim() || 'Customer'
          const businessName = tenant.business_name_short || tenant.name || 'Our team'

          // NOTE: Service area validation is handled by the AI during conversation (via [OUT_OF_AREA] tag).
          // HCP addresses are often stale/wrong from its customer DB, so we don't reject at webhook level —
          // the initial greeting asks to confirm address, giving the customer a chance to correct it.

          try {
            // Window cleaning tenants (WinBros) use the estimate flow — just collect info for a free estimate visit
            const initialMessage = tenant && tenantUsesFeature(tenant, 'use_hcp_mirror')
              ? `Hi ${leadName}! Thanks for reaching out to ${businessName}. We'd love to get you set up with a free estimate — one of our team members will come out and give you an exact quote on the spot. Can I just confirm your address so we can get that scheduled?`
              : `Hi ${leadName}! Thanks for reaching out to ${businessName}. We'd love to help with your cleaning needs. Can you share your address and number of bedrooms/bathrooms so we can give you an instant quote?`

            let smsResult
            if (tenant) {
              smsResult = await sendSMS(tenant, phone, initialMessage)
            } else {
              console.error(`[HCP Webhook] No tenant for lead — cannot send initial SMS to ${phone}`)
              smsResult = { success: false, error: 'No tenant' }
            }

            if (smsResult.success) {
              console.log(`[OSIRIS] HCP Webhook: Sent immediate first text to ${maskPhone(phone)}`)

              console.log(`[OSIRIS] HCP Webhook: Saving message to DB - phone: ${maskPhone(phone)}, customer_id: ${customerRecord?.id}, tenant_id: ${tenant.id}`)
              const { error: msgError } = await client.from("messages").insert({
                tenant_id: tenant.id,
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
              await logSystemEvent({
                tenant_id: tenant.id,
                source: "housecall_pro",
                event_type: "LEAD_FOLLOWUP_ERROR",
                message: `Failed to send initial SMS to ${maskPhone(phone)}: ${smsResult.error || 'unknown'}`,
                phone_number: phone,
                metadata: { leadId: leadRecord?.id, stage: 1, error: smsResult.error },
              })
            }
          } catch (smsError) {
            console.error("[OSIRIS] HCP Webhook: Error sending first text:", smsError)
            await logSystemEvent({
              tenant_id: tenant.id,
              source: "housecall_pro",
              event_type: "LEAD_FOLLOWUP_ERROR",
              message: `Error sending initial SMS to ${maskPhone(phone)}`,
              phone_number: phone,
              metadata: { leadId: leadRecord?.id, stage: 1, error: String(smsError) },
            })
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
                  tenantId: tenant.id,
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

      case "job.scheduled":
        // HCP fires this when a job is scheduled (often after we create one via API).
        // Sync the schedule data to our local job record if it exists.
        console.log("[OSIRIS] Job scheduled in HCP, syncing schedule to Supabase")
        {
          const hcpJobId = (job as any)?.id || (data as any)?.job?.id || (data as any)?.id
          const schedObj = (job as any)?.schedule || (data as any)?.job?.schedule
          const scheduledStart =
            schedObj?.scheduled_start ||
            schedObj?.start_time ||
            schedObj?.start ||
            schedObj?.start_at ||
            (job as any)?.scheduled_start ||
            (data as any)?.job?.scheduled_start
          if (hcpJobId) {
            // Use service client to bypass RLS (webhook has no user session)
            const svcClient = getSupabaseServiceClient()
            const { data: existingJob } = await svcClient
              .from("jobs")
              .select("id")
              .eq("housecall_pro_job_id", String(hcpJobId))
              .eq("tenant_id", tenant.id)
              .maybeSingle()

            if (existingJob) {
              const updates: Record<string, unknown> = { status: "scheduled" }
              if (scheduledStart) {
                updates.date = new Date(scheduledStart).toISOString().split('T')[0]
                updates.scheduled_at = new Date(scheduledStart).toISOString()
              }
              await svcClient.from("jobs").update(updates).eq("id", existingJob.id)
              console.log(`[OSIRIS] HCP job.scheduled: Updated local job ${existingJob.id} from HCP job ${hcpJobId}`)
            } else {
              console.log(`[OSIRIS] HCP job.scheduled: No local job found for HCP job ${hcpJobId} — ignoring (may be externally created)`)
            }
          }
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
              status = "qualified"
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

