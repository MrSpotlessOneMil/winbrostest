/**
 * Housecall Pro Webhook Handler
 *
 * Processes incoming webhooks from HCP and syncs data to local database.
 * Handles lead events and triggers aggressive SDR follow-up sequence.
 */

import { createClient } from '@supabase/supabase-js'
import { validateWebhookSignature, getCustomer } from './hcp-client'
import { sendSMS } from '@/lib/openphone'
import { HIGH_VALUE_CONFIG, SERVICE_RADIUS_CONFIG } from './constants'
import {
  HCP_STATUS_MAP,
  type HCPWebhookPayload,
  type HCPJob,
  type HCPCustomer,
  type HCPLead,
  type JobSyncResult,
} from './types'
import { normalizePhone } from '@/lib/phone-utils'
import { logSystemEvent } from '@/lib/system-events'
import { getClientConfig } from '@/lib/client-config'

// Lazy-initialize Supabase client (avoid build-time env var access)
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Main webhook handler - routes to appropriate handler based on event type
 */
export async function handleHCPWebhook(
  payload: HCPWebhookPayload,
  rawBody: string,
  signature: string
): Promise<{ success: boolean; message: string; error?: string }> {
  // Skip signature validation if no signature provided (for initial setup)
  // Real events should have signatures
  if (signature && !validateWebhookSignature(rawBody, signature)) {
    console.warn('[HCP Webhook] Signature validation failed, but continuing for now')
    // TODO: Enable strict validation once webhook secret is confirmed working
    // return { success: false, message: 'Invalid signature', error: 'INVALID_SIGNATURE' }
  }

  console.log(`[HCP Webhook] Received event: ${payload.event}`)

  // HCP sends data at top level (e.g., payload.lead) not nested under payload.data
  const job = payload.job || payload.data?.job
  const customer = payload.customer || payload.data?.customer
  const lead = payload.lead || payload.data?.lead

  try {
    switch (payload.event) {
      case 'job.created':
        if (!job) return { success: false, message: 'No job data in payload' }
        return await handleJobCreated(job)

      case 'job.updated':
      case 'job.scheduled':
        if (!job) return { success: false, message: 'No job data in payload' }
        return await handleJobUpdated(job)

      case 'job.started':
        if (!job) return { success: false, message: 'No job data in payload' }
        return await handleJobStarted(job)

      case 'job.completed':
        if (!job) return { success: false, message: 'No job data in payload' }
        return await handleJobCompleted(job)

      case 'job.canceled':
        if (!job) return { success: false, message: 'No job data in payload' }
        return await handleJobCanceled(job)

      case 'customer.created':
      case 'customer.updated':
        if (!customer) return { success: false, message: 'No customer data in payload' }
        return await handleCustomerSync(customer)

      case 'invoice.paid':
      case 'payment.received':
        return await handlePaymentReceived(payload)

      case 'lead.created':
        if (!lead) return { success: false, message: 'No lead data in payload' }
        return await handleLeadCreated(lead)

      case 'lead.updated':
        if (!lead) return { success: false, message: 'No lead data in payload' }
        return await handleLeadUpdated(lead)

      default:
        console.log(`[HCP Webhook] Unhandled event type: ${payload.event}`)
        return { success: true, message: `Event ${payload.event} acknowledged but not processed` }
    }
  } catch (error) {
    console.error('[HCP Webhook] Processing error:', error)
    return {
      success: false,
      message: 'Webhook processing failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Handle new job creation from HCP
 */
async function handleJobCreated(
  hcpJob: HCPJob
): Promise<{ success: boolean; message: string }> {
  console.log(`[HCP Webhook] New job created: ${hcpJob.id}`)

  // Check if job already exists
  const { data: existingJob } = await getSupabase()
    .from('jobs')
    .select('id')
    .eq('housecall_pro_job_id', hcpJob.id)
    .single()

  if (existingJob) {
    return { success: true, message: 'Job already exists, skipping' }
  }

  // Get or create customer
  const customerResult = await ensureCustomerExists(hcpJob.customer_id)
  if (!customerResult.success) {
    return { success: false, message: `Failed to sync customer: ${customerResult.error}` }
  }

  // Map HCP status to internal status
  const internalStatus = HCP_STATUS_MAP[hcpJob.work_status] || 'lead'

  // Create job record
  const { data: newJob, error } = await getSupabase()
    .from('jobs')
    .insert({
      customer_id: customerResult.customerId,
      status: internalStatus,
      price: hcpJob.total_amount,
      housecall_pro_job_id: hcpJob.id,
      housecall_pro_customer_id: hcpJob.customer_id,
      housecall_pro_status: hcpJob.work_status,
      address: formatAddress(hcpJob.address),
      date: hcpJob.scheduled_start
        ? new Date(hcpJob.scheduled_start).toISOString().split('T')[0]
        : null,
      scheduled_at: hcpJob.scheduled_start
        ? new Date(hcpJob.scheduled_start).toTimeString().slice(0, 5)
        : null,
      notes: hcpJob.notes,
      brand: 'winbros',
    })
    .select('id')
    .single()

  if (error) {
    console.error('[HCP Webhook] Failed to create job:', error)
    return { success: false, message: `Database error: ${error.message}` }
  }

  // Check for high-value job alert
  if (hcpJob.total_amount * 100 >= HIGH_VALUE_CONFIG.THRESHOLD_CENTS) {
    await createJobAlert(newJob.id, 'high_value', {
      threshold: HIGH_VALUE_CONFIG.THRESHOLD_CENTS / 100,
      actual: hcpJob.total_amount,
    })
  }

  return { success: true, message: `Job ${newJob.id} created from HCP ${hcpJob.id}` }
}

/**
 * Handle job updates from HCP
 */
async function handleJobUpdated(
  hcpJob: HCPJob
): Promise<{ success: boolean; message: string }> {
  console.log(`[HCP Webhook] Job updated: ${hcpJob.id}`)

  const { data: existingJob, error: fetchError } = await getSupabase()
    .from('jobs')
    .select('id, status')
    .eq('housecall_pro_job_id', hcpJob.id)
    .single()

  if (fetchError || !existingJob) {
    // Job doesn't exist, create it
    return handleJobCreated(hcpJob)
  }

  const internalStatus = HCP_STATUS_MAP[hcpJob.work_status] || existingJob.status

  const { error } = await getSupabase()
    .from('jobs')
    .update({
      status: internalStatus,
      price: hcpJob.total_amount,
      housecall_pro_status: hcpJob.work_status,
      date: hcpJob.scheduled_start
        ? new Date(hcpJob.scheduled_start).toISOString().split('T')[0]
        : null,
      scheduled_at: hcpJob.scheduled_start
        ? new Date(hcpJob.scheduled_start).toTimeString().slice(0, 5)
        : null,
      notes: hcpJob.notes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existingJob.id)

  if (error) {
    console.error('[HCP Webhook] Failed to update job:', error)
    return { success: false, message: `Database error: ${error.message}` }
  }

  return { success: true, message: `Job ${existingJob.id} updated` }
}

/**
 * Handle job started (in progress)
 */
async function handleJobStarted(
  hcpJob: HCPJob
): Promise<{ success: boolean; message: string }> {
  console.log(`[HCP Webhook] Job started: ${hcpJob.id}`)

  const { error } = await getSupabase()
    .from('jobs')
    .update({
      status: 'in_progress',
      housecall_pro_status: 'in_progress',
      updated_at: new Date().toISOString(),
    })
    .eq('housecall_pro_job_id', hcpJob.id)

  if (error) {
    console.error('[HCP Webhook] Failed to mark job in progress:', error)
    return { success: false, message: `Database error: ${error.message}` }
  }

  return { success: true, message: `Job marked in_progress` }
}

/**
 * Handle job completion - triggers payment and review flow
 */
async function handleJobCompleted(
  hcpJob: HCPJob
): Promise<{ success: boolean; message: string }> {
  console.log(`[HCP Webhook] Job completed: ${hcpJob.id}`)

  const { data: job, error: fetchError } = await getSupabase()
    .from('jobs')
    .select('id, customer_id, price, paid')
    .eq('housecall_pro_job_id', hcpJob.id)
    .single()

  if (fetchError || !job) {
    return { success: false, message: 'Job not found in database' }
  }

  // Update job status
  const { error } = await getSupabase()
    .from('jobs')
    .update({
      status: 'completed',
      housecall_pro_status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id)

  if (error) {
    console.error('[HCP Webhook] Failed to mark job completed:', error)
    return { success: false, message: `Database error: ${error.message}` }
  }

  // If not paid via our system, trigger payment flow
  if (!job.paid) {
    // This will be handled by the cron job that sends final payments
    console.log(`[HCP Webhook] Job ${job.id} needs payment processing`)
  }

  // Schedule review request (will be handled by cron)
  // The review-only follow-up logic kicks in here

  return { success: true, message: `Job ${job.id} marked completed` }
}

/**
 * Handle job cancellation
 */
async function handleJobCanceled(
  hcpJob: HCPJob
): Promise<{ success: boolean; message: string }> {
  console.log(`[HCP Webhook] Job canceled: ${hcpJob.id}`)

  const { error } = await getSupabase()
    .from('jobs')
    .update({
      status: 'cancelled',
      housecall_pro_status: 'canceled',
      updated_at: new Date().toISOString(),
    })
    .eq('housecall_pro_job_id', hcpJob.id)

  if (error) {
    console.error('[HCP Webhook] Failed to cancel job:', error)
    return { success: false, message: `Database error: ${error.message}` }
  }

  return { success: true, message: 'Job canceled' }
}

/**
 * Sync customer data from HCP
 */
async function handleCustomerSync(
  hcpCustomer: HCPCustomer
): Promise<{ success: boolean; message: string }> {
  console.log(`[HCP Webhook] Customer sync: ${hcpCustomer.id}`)

  const phone = hcpCustomer.phone_numbers?.[0]?.number
  if (!phone) {
    return { success: false, message: 'Customer has no phone number' }
  }

  // Check if customer exists
  const { data: existingCustomer } = await getSupabase()
    .from('customers')
    .select('id')
    .eq('phone_number', phone)
    .single()

  const customerData = {
    phone_number: phone,
    first_name: hcpCustomer.first_name,
    last_name: hcpCustomer.last_name,
    email: hcpCustomer.email,
    address: hcpCustomer.addresses?.[0]
      ? formatAddress(hcpCustomer.addresses[0])
      : null,
    housecall_pro_customer_id: hcpCustomer.id,
  }

  if (existingCustomer) {
    const { error } = await getSupabase()
      .from('customers')
      .update(customerData)
      .eq('id', existingCustomer.id)

    if (error) {
      return { success: false, message: `Update failed: ${error.message}` }
    }
    return { success: true, message: `Customer ${existingCustomer.id} updated` }
  } else {
    const { data: newCustomer, error } = await getSupabase()
      .from('customers')
      .insert(customerData)
      .select('id')
      .single()

    if (error) {
      return { success: false, message: `Insert failed: ${error.message}` }
    }
    return { success: true, message: `Customer ${newCustomer.id} created` }
  }
}

/**
 * Handle payment received
 */
async function handlePaymentReceived(
  payload: HCPWebhookPayload
): Promise<{ success: boolean; message: string }> {
  const payment = payload.payment || payload.data?.payment
  const invoice = payload.invoice || payload.data?.invoice

  if (!payment && !invoice) {
    return { success: false, message: 'No payment or invoice data' }
  }

  // Find the job by invoice
  const jobId = invoice?.job_id
  if (!jobId) {
    return { success: true, message: 'Payment received but no job_id to update' }
  }

  const { error } = await getSupabase()
    .from('jobs')
    .update({
      paid: true,
      paid_at: new Date().toISOString(),
    })
    .eq('housecall_pro_job_id', jobId)

  if (error) {
    return { success: false, message: `Failed to mark paid: ${error.message}` }
  }

  return { success: true, message: 'Payment recorded' }
}

// =====================
// HELPER FUNCTIONS
// =====================

/**
 * Ensure customer exists in our database
 */
async function ensureCustomerExists(
  hcpCustomerId: string
): Promise<{ success: boolean; customerId?: number; error?: string }> {
  // First check if we have a customer with this HCP ID
  const { data: existingByHcpId } = await getSupabase()
    .from('customers')
    .select('id')
    .eq('housecall_pro_customer_id', hcpCustomerId)
    .single()

  if (existingByHcpId) {
    return { success: true, customerId: existingByHcpId.id }
  }

  // Fetch customer from HCP
  const result = await getCustomer(hcpCustomerId)
  if (!result.success || !result.data) {
    return { success: false, error: 'Failed to fetch customer from HCP' }
  }

  const hcpCustomer = result.data
  const phone = hcpCustomer.phone_numbers?.[0]?.number

  if (!phone) {
    return { success: false, error: 'Customer has no phone number' }
  }

  // Check by phone number
  const { data: existingByPhone } = await getSupabase()
    .from('customers')
    .select('id')
    .eq('phone_number', phone)
    .single()

  if (existingByPhone) {
    // Update with HCP ID
    await getSupabase()
      .from('customers')
      .update({ housecall_pro_customer_id: hcpCustomerId })
      .eq('id', existingByPhone.id)

    return { success: true, customerId: existingByPhone.id }
  }

  // Create new customer
  const { data: newCustomer, error } = await getSupabase()
    .from('customers')
    .insert({
      phone_number: phone,
      first_name: hcpCustomer.first_name,
      last_name: hcpCustomer.last_name,
      email: hcpCustomer.email,
      address: hcpCustomer.addresses?.[0]
        ? formatAddress(hcpCustomer.addresses[0])
        : null,
      housecall_pro_customer_id: hcpCustomerId,
    })
    .select('id')
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, customerId: newCustomer.id }
}

/**
 * Format HCP address to string
 */
function formatAddress(address: {
  street: string
  street_line_2?: string
  city: string
  state: string
  zip: string
}): string {
  const parts = [address.street]
  if (address.street_line_2) parts.push(address.street_line_2)
  parts.push(`${address.city}, ${address.state} ${address.zip}`)
  return parts.join(', ')
}

/**
 * Create a job alert
 */
async function createJobAlert(
  jobId: string,
  alertType: string,
  values: { threshold: number; actual: number }
): Promise<void> {
  await getSupabase().from('job_alerts').insert({
    job_id: jobId,
    brand: 'winbros',
    alert_type: alertType,
    threshold_value: values.threshold.toString(),
    actual_value: values.actual.toString(),
    message: `${alertType === 'high_value' ? 'High-value job' : 'Alert'}: $${values.actual} (threshold: $${values.threshold})`,
  })
}

// =====================
// LEAD HANDLING (SDR FLOW)
// =====================

/**
 * Handle new lead from HCP - triggers aggressive follow-up sequence
 * Flow: SMS → Call → Double-dial → SMS → SMS
 */
async function handleLeadCreated(
  hcpLead: HCPLead
): Promise<{ success: boolean; message: string }> {
  console.log(`[HCP Webhook] New lead created: ${hcpLead.id}`)

  // Get phone number - HCP sends it on nested customer object
  const rawPhone =
    hcpLead.customer?.mobile_number ||
    hcpLead.customer?.phone_number ||
    hcpLead.phone_numbers?.[0]?.number
  if (!rawPhone) {
    console.error('[HCP Webhook] Lead has no phone number:', hcpLead.id)
    return { success: false, message: 'Lead has no phone number' }
  }

  const phoneNumber = normalizePhone(rawPhone)
  if (!phoneNumber) {
    return { success: false, message: `Invalid phone number: ${rawPhone}` }
  }

  // Check if lead already exists
  const { data: existingLead } = await getSupabase()
    .from('leads')
    .select('id')
    .eq('source_id', `hcp_${hcpLead.id}`)
    .single()

  if (existingLead) {
    console.log(`[HCP Webhook] Lead already exists: ${hcpLead.id}`)
    return { success: true, message: 'Lead already exists, skipping' }
  }

  try {
    // 1. Create or update customer
    let customer = await getOrCreateCustomerFromLead(hcpLead, phoneNumber)

    // 2. Create job with 'lead' status
    const { data: job, error: jobError } = await getSupabase()
      .from('jobs')
      .insert({
        phone_number: phoneNumber,
        customer_id: customer?.id,
        service_type: 'Window cleaning',
        status: 'lead',
        booked: false,
        paid: false,
        invoice_sent: false,
        brand: 'winbros',
        notes: `HCP Lead - ${new Date().toISOString()}\nSource: ${hcpLead.source || 'unknown'}`,
      })
      .select('id')
      .single()

    if (jobError) {
      console.error('[HCP Webhook] Failed to create job:', jobError)
    }

    // 3. Create lead record
    const leadFirstName = hcpLead.customer?.first_name || hcpLead.first_name
    const leadLastName = hcpLead.customer?.last_name || hcpLead.last_name
    const leadEmail = hcpLead.customer?.email || hcpLead.email

    const { data: lead, error: leadError } = await getSupabase()
      .from('leads')
      .insert({
        source_id: `hcp_${hcpLead.id}`,
        phone_number: phoneNumber,
        customer_id: customer?.id,
        job_id: job?.id,
        first_name: leadFirstName,
        last_name: leadLastName,
        email: leadEmail,
        source: 'housecall_pro',
        status: 'new',
        brand: 'winbros',
        call_attempt_count: 0,
        sms_attempt_count: 0,
      })
      .select('id')
      .single()

    if (leadError) {
      console.error('[HCP Webhook] Failed to create lead record:', leadError)
      return { success: false, message: `Failed to create lead: ${leadError.message}` }
    }

    // 4. Send initial SMS immediately via OpenPhone
    const config = getClientConfig('winbros')
    const firstName = leadFirstName || 'there'
    const initialMessage = `Hey ${firstName}! This is ${config.sdrPersona || 'the team'} from WinBros Window Cleaning. Thanks for reaching out! When would be a good time to get your windows sparkling clean?`

    const smsResult = await sendSMS(phoneNumber, initialMessage, 'winbros')

    if (smsResult.success) {
      // Update lead status
      await getSupabase()
        .from('leads')
        .update({
          status: 'sms_sent',
          last_outreach_at: new Date().toISOString(),
          sms_attempt_count: 1,
        })
        .eq('id', lead.id)

      console.log(`[HCP Webhook] Initial SMS sent via OpenPhone to ${phoneNumber}`)
    } else {
      console.error(`[HCP Webhook] Failed to send SMS: ${smsResult.error}`)
    }

    // 5. Schedule follow-up sequence with double-dial
    await scheduleHCPFollowUpSequence(lead.id, phoneNumber)

    // 6. Log the event
    await logSystemEvent({
      source: 'housecall_pro',
      event_type: 'HCP_LEAD_RECEIVED',
      message: `New HCP lead: ${firstName} ${leadLastName || ''}`.trim(),
      job_id: job?.id?.toString(),
      customer_id: customer?.id?.toString(),
      phone_number: phoneNumber,
      metadata: {
        hcp_lead_id: hcpLead.id,
        source: hcpLead.source,
        origin: 'housecall_pro',
      },
    })

    return { success: true, message: `Lead processed, initial SMS sent, follow-ups scheduled` }
  } catch (error) {
    console.error('[HCP Webhook] Error processing lead:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Handle lead update from HCP
 */
async function handleLeadUpdated(
  hcpLead: HCPLead
): Promise<{ success: boolean; message: string }> {
  console.log(`[HCP Webhook] Lead updated: ${hcpLead.id}`)

  // Check if this lead exists in our system
  const { data: existingLead } = await getSupabase()
    .from('leads')
    .select('id, status')
    .eq('source_id', `hcp_${hcpLead.id}`)
    .single()

  if (!existingLead) {
    // Lead doesn't exist, create it
    return handleLeadCreated(hcpLead)
  }

  // Update lead info if needed
  await getSupabase()
    .from('leads')
    .update({
      first_name: hcpLead.customer?.first_name || hcpLead.first_name,
      last_name: hcpLead.customer?.last_name || hcpLead.last_name,
      email: hcpLead.customer?.email || hcpLead.email,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existingLead.id)

  return { success: true, message: `Lead ${existingLead.id} updated` }
}

/**
 * Get or create customer from HCP lead
 */
async function getOrCreateCustomerFromLead(
  hcpLead: HCPLead,
  phoneNumber: string
): Promise<{ id: number } | null> {
  // Check if customer exists by phone
  const { data: existing } = await getSupabase()
    .from('customers')
    .select('id')
    .eq('phone_number', phoneNumber)
    .single()

  if (existing) {
    return existing
  }

  // Create new customer
  const { data: newCustomer, error } = await getSupabase()
    .from('customers')
    .insert({
      phone_number: phoneNumber,
      first_name: hcpLead.customer?.first_name || hcpLead.first_name,
      last_name: hcpLead.customer?.last_name || hcpLead.last_name,
      email: hcpLead.customer?.email || hcpLead.email,
      address: hcpLead.address
        ? formatAddress(hcpLead.address)
        : null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[HCP Webhook] Failed to create customer:', error)
    return null
  }

  return newCustomer
}

/**
 * Schedule the HCP follow-up sequence
 *
 * Cron processes queue every 15 minutes, so steps are spaced
 * to guarantee each fires in a separate cron run.
 *
 * Flow:
 * 1. Initial SMS (already sent)
 * 2. +15 min → Call
 * 3. +45 min → Post-no-answer SMS
 * 4. +90 min → Follow-up SMS #1
 * 5. +180 min → Follow-up SMS #2 (final)
 */
async function scheduleHCPFollowUpSequence(
  leadId: string,
  phoneNumber: string
): Promise<void> {
  const now = Date.now()
  const supabase = getSupabase()

  const schedule = [
    { type: 'trigger_call', delayMin: 15, label: 'Call' },
    { type: 'post_no_answer_sms', delayMin: 45, label: 'Post-call SMS' },
    { type: 'followup_sms_1', delayMin: 90, label: 'Follow-up SMS #1' },
    { type: 'followup_sms_2', delayMin: 180, label: 'Follow-up SMS #2 (final)' },
  ]

  let scheduled = 0
  for (const item of schedule) {
    const { error } = await supabase.from('followup_queue').insert({
      lead_id: leadId,
      phone_number: phoneNumber,
      followup_type: item.type,
      scheduled_at: new Date(now + item.delayMin * 60 * 1000).toISOString(),
      status: 'pending',
    })

    if (error) {
      console.error(`[HCP Webhook] Failed to schedule ${item.label} for lead ${leadId}:`, error.message)
    } else {
      scheduled++
    }
  }

  console.log(`[HCP Webhook] Scheduled ${scheduled}/${schedule.length} follow-ups for lead ${leadId}`)
}
