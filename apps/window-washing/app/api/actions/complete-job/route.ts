/**
 * Complete Job Action Endpoint
 *
 * POST /api/actions/complete-job
 * Body: { jobId: string }
 *
 * This endpoint:
 * 1. Marks the job as completed
 * 2. Creates and sends the remaining 50% payment link
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import {
  getJobById,
  getCustomerByPhone,
  updateJob,
  appendToTextingTranscript,
  getSupabaseServiceClient,
} from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { findOrCreateStripeCustomer, resolveStripeChargeCents, getTenantRedirectDomain, getStripeClientForTenant, chargeCardOnFile } from '@/lib/stripe-client'
import { logSystemEvent } from '@/lib/system-events'
import { getPaymentTotalsFromNotes, getOverridesFromNotes } from '@/lib/pricing-config'
import { getTenantById, getTenantBusinessName, formatTenantCurrency } from '@/lib/tenant'
import { requireAuthWithTenant } from '@/lib/auth'
import { notifyOwnerSMS } from '@/lib/cleaner-sms'
import { triggerSatisfactionCheck } from '@/lib/lifecycle-engine'
import { tenantUsesFeature } from '@/lib/tenant'

/** Safely add months without JS Date overflow (Jan 31 + 1 month = Feb 28, not Mar 3) */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  const day = result.getDate()
  result.setMonth(result.getMonth() + months)
  if (result.getDate() !== day) {
    result.setDate(0)
  }
  return result
}

/**
 * Handle membership lifecycle after a membership-linked job completes.
 * - Increments visits_completed
 * - Advances next_visit_at
 * - Penultimate visit: sends renewal SMS to customer
 * - Final visit: renews or completes membership based on customer's choice
 */
async function handleMembershipLifecycle(
  jobId: string,
  membershipId: string,
  tenant: any,
  customerPhone: string | null,
): Promise<void> {
  const supabase = getSupabaseServiceClient()

  // Fetch membership with its plan
  const { data: membership, error: fetchErr } = await supabase
    .from("customer_memberships")
    .select(`
      id, tenant_id, customer_id, status, visits_completed, next_visit_at,
      renewal_choice, renewal_asked_at,
      service_plans!inner( id, name, slug, visits_per_year, interval_months, discount_per_visit )
    `)
    .eq("id", membershipId)
    .eq("tenant_id", tenant?.id)
    .eq("status", "active")
    .single()

  if (fetchErr || !membership) {
    console.log(`[complete-job] Membership ${membershipId} not found or not active — skipping lifecycle`)
    return
  }

  const plan = membership.service_plans as any
  if (!plan) {
    console.error(`[complete-job] Membership ${membershipId} has no linked service plan — skipping lifecycle`)
    return
  }
  const visitsPerYear = plan.visits_per_year || 0
  const intervalMonths = Math.max(1, plan.interval_months || 3)
  const prevVisitsCompleted = membership.visits_completed || 0
  const newVisitsCompleted = prevVisitsCompleted + 1

  if (visitsPerYear <= 0) {
    console.error(`[complete-job] Invalid visits_per_year=${visitsPerYear} for membership ${membershipId} — skipping lifecycle`)
    return
  }

  // Increment visits_completed and advance next_visit_at
  const nextVisit = addMonths(new Date(), intervalMonths)
  const updates: Record<string, unknown> = {
    visits_completed: newVisitsCompleted,
    next_visit_at: nextVisit.toISOString(),
    updated_at: new Date().toISOString(),
  }

  // Track which lifecycle event occurred (used for post-update notifications)
  let lifecycleEvent: 'penultimate' | 'final_renew' | 'final_complete' | 'single_visit_complete' | null = null
  let completionReason = ''

  // Penultimate visit: queue renewal SMS (sent after DB update succeeds)
  if (newVisitsCompleted === visitsPerYear - 1) {
    updates.renewal_asked_at = new Date().toISOString()
    updates.renewal_choice = null // Reset in case it was set from a previous cycle
    lifecycleEvent = 'penultimate'
  } else if (newVisitsCompleted >= visitsPerYear) {
    // Final visit: act on renewal choice
    if (visitsPerYear === 1) {
      // Single-visit plan: complete immediately and send informational re-enrollment SMS
      updates.status = 'completed'
      updates.next_visit_at = null
      updates.renewal_asked_at = new Date().toISOString() // Mark so OpenPhone handler can match RENEW replies
      updates.renewal_choice = null
      completionReason = 'single-visit plan completed'
      lifecycleEvent = 'single_visit_complete'
    } else if (membership.renewal_choice === 'renew') {
      // Renew: reset visits, advance next_visit_at, clear renewal fields
      updates.visits_completed = 0
      updates.renewal_choice = null
      updates.renewal_asked_at = null
      lifecycleEvent = 'final_renew'
    } else {
      // Cancel or no response: mark membership as completed
      updates.status = 'completed'
      updates.next_visit_at = null
      completionReason = membership.renewal_choice === 'cancel' ? 'customer chose CANCEL' : 'no renewal response received'
      lifecycleEvent = 'final_complete'
    }
  }

  // Apply all updates atomically — include visits_completed in WHERE to prevent race conditions
  // If two jobs complete simultaneously for the same membership, only one will succeed
  const { data: updatedRows, error: updateErr } = await supabase
    .from("customer_memberships")
    .update(updates)
    .eq("id", membershipId)
    .eq("status", "active") // Only update if still active (prevents race)
    .eq("visits_completed", prevVisitsCompleted) // Optimistic lock: reject stale writes
    .select("id")

  if (updateErr) {
    console.error(`[complete-job] Failed to update membership ${membershipId}:`, updateErr.message)
    await logSystemEvent({
      tenant_id: membership.tenant_id,
      source: 'complete-job',
      event_type: 'MEMBERSHIP_UPDATE_FAILED',
      details: { membership_id: membershipId, job_id: jobId, error: updateErr.message },
    }).catch(() => {}) // best-effort
    return
  }
  if (!updatedRows || updatedRows.length === 0) {
    console.warn(`[complete-job] Membership ${membershipId} was not updated — likely a concurrent update (visits_completed mismatch). Will be retried on next job completion.`)
    await logSystemEvent({
      tenant_id: membership.tenant_id,
      source: 'complete-job',
      event_type: 'MEMBERSHIP_UPDATE_SKIPPED',
      details: { membership_id: membershipId, job_id: jobId, reason: 'optimistic lock collision — concurrent update detected' },
    }).catch(() => {}) // best-effort
    return
  }

  // === DB update succeeded — now send notifications ===

  if (lifecycleEvent === 'penultimate') {
    // Send renewal SMS to customer
    if (customerPhone && tenant) {
      const businessName = tenant.business_name_short || tenant.business_name || tenant.name || 'us'
      const remainingVisits = visitsPerYear - newVisitsCompleted
      const renewalMsg = `Hi! You have ${remainingVisits} visit${remainingVisits > 1 ? 's' : ''} left on your ${plan.name} membership with ${businessName}. Would you like to renew? Reply RENEW or CANCEL.`

      try {
        const smsResult = await sendSMS(tenant, customerPhone, renewalMsg)
        if (smsResult.success) {
          console.log(`[complete-job] Renewal SMS sent to ${customerPhone} for membership ${membershipId}`)
        } else {
          console.error(`[complete-job] Failed to send renewal SMS: ${smsResult.error}`)
          await logSystemEvent({
            tenant_id: membership.tenant_id,
            source: 'complete-job',
            event_type: 'MEMBERSHIP_RENEWAL_SMS_FAILED',
            details: { membership_id: membershipId, phone: customerPhone, error: smsResult.error },
          }).catch(() => {})
        }
      } catch (err) {
        console.error(`[complete-job] Renewal SMS error:`, err)
        await logSystemEvent({
          tenant_id: membership.tenant_id,
          source: 'complete-job',
          event_type: 'MEMBERSHIP_RENEWAL_SMS_FAILED',
          details: { membership_id: membershipId, phone: customerPhone, error: String(err) },
        }).catch(() => {})
      }

      // Notify tenant owner via SMS
      if (tenant.owner_phone) {
        try {
          const customerName = await getCustomerName(supabase, membership.customer_id, membership.tenant_id)
          await notifyOwnerSMS(
            tenant,
            `Membership Renewal Pending - Customer: ${customerName}, Plan: ${plan.name}, Visits completed: ${newVisitsCompleted}/${visitsPerYear}. Renewal SMS sent - waiting for customer reply.`,
          )
        } catch (err) {
          console.error(`[complete-job] Owner SMS notification error:`, err)
        }
      }
    }

    await logSystemEvent({
      source: 'actions',
      event_type: 'MEMBERSHIP_RENEWAL_ASKED',
      message: `Renewal SMS sent for membership ${membershipId} (visit ${newVisitsCompleted}/${visitsPerYear})`,
      job_id: jobId,
      phone_number: customerPhone || undefined,
      metadata: { membership_id: membershipId, plan_slug: plan.slug, visits_completed: newVisitsCompleted, visits_per_year: visitsPerYear },
    })
  }

  if (lifecycleEvent === 'final_renew') {
    console.log(`[complete-job] Membership ${membershipId} renewed (customer chose RENEW)`)

    await logSystemEvent({
      source: 'actions',
      event_type: 'MEMBERSHIP_RENEWED',
      message: `Membership ${membershipId} renewed after final visit`,
      job_id: jobId,
      phone_number: customerPhone || undefined,
      metadata: { membership_id: membershipId, plan_slug: plan.slug },
    })

    if (tenant?.owner_phone) {
      const customerName = await getCustomerName(supabase, membership.customer_id, membership.tenant_id)
      try {
        await notifyOwnerSMS(
          tenant,
          `Membership Renewed - Customer: ${customerName}, Plan: ${plan.name}, Visits reset to 0/${visitsPerYear}`,
        )
      } catch {}
    }
  }

  if (lifecycleEvent === 'final_complete') {
    console.log(`[complete-job] Membership ${membershipId} completed (${completionReason})`)

    await logSystemEvent({
      source: 'actions',
      event_type: 'MEMBERSHIP_COMPLETED',
      message: `Membership ${membershipId} completed: ${completionReason}`,
      job_id: jobId,
      phone_number: customerPhone || undefined,
      metadata: { membership_id: membershipId, plan_slug: plan.slug, renewal_choice: membership.renewal_choice },
    })

    if (tenant?.owner_phone) {
      const customerName = await getCustomerName(supabase, membership.customer_id, membership.tenant_id)
      try {
        await notifyOwnerSMS(
          tenant,
          `Membership Completed - Customer: ${customerName}, Plan: ${plan.name}, Reason: ${completionReason}. All ${visitsPerYear} visits used.`,
        )
      } catch {}
    }

    // Inform customer
    if (customerPhone && tenant) {
      const businessName = tenant.business_name_short || tenant.business_name || tenant.name || 'us'
      const completedMsg = `Your ${plan.name} membership with ${businessName} is now complete. Thank you for being a member! Contact us anytime to start a new plan.`
      try {
        await sendSMS(tenant, customerPhone, completedMsg)
      } catch {}
    }
  }

  if (lifecycleEvent === 'single_visit_complete') {
    console.log(`[complete-job] Single-visit membership ${membershipId} completed — sending re-enrollment SMS`)

    await logSystemEvent({
      source: 'actions',
      event_type: 'MEMBERSHIP_COMPLETED',
      message: `Single-visit membership ${membershipId} completed`,
      job_id: jobId,
      phone_number: customerPhone || undefined,
      metadata: { membership_id: membershipId, plan_slug: plan.slug, single_visit: true },
    })

    // Send informational SMS with RENEW option
    if (customerPhone && tenant) {
      const businessName = tenant.business_name_short || tenant.business_name || tenant.name || 'us'
      const customerName = await getCustomerName(supabase, membership.customer_id, membership.tenant_id)
      const firstName = customerName.split(' ')[0] || 'there'
      const reEnrollMsg = `Hi ${firstName}! Your ${plan.name} cleaning with ${businessName} is complete. Would you like to sign up for another? Reply RENEW to re-enroll.`
      try {
        await sendSMS(tenant, customerPhone, reEnrollMsg)
      } catch {}
    }

    if (tenant?.owner_phone) {
      const customerName = await getCustomerName(supabase, membership.customer_id, membership.tenant_id)
      try {
        await notifyOwnerSMS(
          tenant,
          `Single-Visit Membership Completed - Customer: ${customerName}, Plan: ${plan.name}. Re-enrollment SMS sent.`,
        )
      } catch {}
    }
  }
}

/** Helper to get customer display name (tenant-scoped) */
async function getCustomerName(supabase: any, customerId: string | null, tenantId: string): Promise<string> {
  if (!customerId) return 'Unknown'
  const query = supabase
    .from("customers")
    .select("first_name, last_name, phone_number")
    .eq("id", customerId)
    .eq("tenant_id", tenantId)
  const { data } = await query.single()
  if (!data) return 'Unknown'
  const name = [data.first_name, data.last_name].filter(Boolean).join(' ')
  return name || data.phone_number || 'Unknown'
}

/**
 * Core complete-job logic — callable from both the API route (with auth) and the cron (without auth).
 */
export async function executeCompleteJob(jobId: string): Promise<{
  success: boolean
  jobId?: string
  paymentUrl?: string
  remainingAmount?: number
  chargeAmount?: number
  smsSent?: boolean
  message?: string
  error?: string
}> {
  // Use service client to bypass RLS (called by admin action + cron)
  const serviceClient = getSupabaseServiceClient()

  // Get job details
  const job = await getJobById(jobId, serviceClient)
  if (!job) {
    return { success: false, error: 'Job not found' }
  }

  // Status guard: prevent double-execution (dashboard + cron race)
  if (job.status === 'completed') {
    console.log(`[complete-job] Job ${jobId} already completed — skipping`)
    return { success: true, message: 'Job already completed', jobId }
  }
  if (job.payment_status === 'fully_paid') {
    console.log(`[complete-job] Job ${jobId} already fully paid — skipping`)
    return { success: true, message: 'Job already fully paid', jobId }
  }

  // Look up tenant for dynamic business name
  const tenant = job.tenant_id ? await getTenantById(job.tenant_id) : null
  const businessName = tenant ? getTenantBusinessName(tenant) : 'us'
  const businessNameShort = tenant ? getTenantBusinessName(tenant, true) : 'Team'

  // Get customer details
  const customer = await getCustomerByPhone(job.phone_number, serviceClient)
  if (!customer) {
    return { success: false, error: 'Customer not found' }
  }

  if (!customer.email) {
    return { success: false, error: 'Customer email required for final payment' }
  }

  // TENANT ISOLATION — Price resolution:
  // Cedar Rapids uses DB pricing tiers (pricing_tiers table, keyed by bed/bath/sqft)
  // WinBros uses static pricebook (lib/pricebook.ts, keyed by service type/sqft)
  // This fallback uses getPricingRow which works for house cleaning tenants.
  // WinBros jobs should already have price set from pricebook at booking time.
  let resolvedPrice = job.price ? parseFloat(String(job.price)) : 0
  if (!resolvedPrice && job.tenant_id) {
    try {
      const { getPricingRow } = await import('@/lib/pricing-db')
      const overrides = getOverridesFromNotes(job.notes)
      if (overrides.bedrooms && overrides.bathrooms) {
        const svcRaw = (job.service_type || 'standard cleaning').toLowerCase().replace(/[_ ]cleaning/, '')
        const tier = (svcRaw === 'deep' || svcRaw === 'move') ? svcRaw : 'standard'
        const row = await getPricingRow(tier as any, overrides.bedrooms, overrides.bathrooms, overrides.squareFootage || null, job.tenant_id)
        if (row?.price) {
          resolvedPrice = row.price
          // Persist the corrected price on the job
          await updateJob(jobId, { price: resolvedPrice }, {}, serviceClient)
          console.log(`[complete-job] Resolved missing price for job ${jobId}: $${resolvedPrice}`)
        }
      }
    } catch (e) {
      console.error(`[complete-job] Failed to look up pricing for job ${jobId}:`, e)
    }
  }

  // Calculate remaining 50% (with 3% processing fee)
  const totalPrice = resolvedPrice
  const paymentTotals = getPaymentTotalsFromNotes(job.notes)
  const depositPaid = paymentTotals.depositPaid || 0
  const addOnPaid = paymentTotals.addOnPaid || 0
  const totalDue = Math.round(totalPrice * 1.03 * 100) / 100
  const remainingAmount = Math.round((totalDue - depositPaid - addOnPaid) * 100) / 100

  if (remainingAmount <= 0) {
    // Job was fully prepaid
    await updateJob(jobId, { status: 'completed' }, {}, serviceClient)

    await logSystemEvent({
      source: 'actions',
      event_type: 'JOB_COMPLETED',
      message: `Job ${jobId} completed (fully prepaid).`,
      job_id: jobId,
      customer_id: job.customer_id,
      phone_number: job.phone_number,
      metadata: {
        total_price: totalPrice,
        total_due: totalDue,
        deposit_paid: depositPaid,
        add_on_paid: addOnPaid,
      },
    })

    // Membership lifecycle
    if (job.membership_id) {
      await handleMembershipLifecycle(jobId, job.membership_id, tenant, job.phone_number)
    }

    // Immediate satisfaction check
    if (tenant && tenantUsesFeature(tenant, 'post_cleaning_followup_enabled')) {
      triggerSatisfactionCheck({
        tenant,
        jobId,
        customerId: job.customer_id ? Number(job.customer_id) : null,
        customerPhone: customer.phone_number,
        customerName: customer.first_name || 'there',
      }).catch(err => console.error(`[complete-job] Satisfaction check error for job ${jobId}:`, err))
    }

    return {
      success: true,
      message: 'Job completed - was fully prepaid',
      jobId,
    }
  }

  const defaultRemainingCents = Math.round(remainingAmount * 100)
  const { amountCents: chargeAmountCents, testChargeCents } = resolveStripeChargeCents(
    defaultRemainingCents,
    'FINAL'
  )
  const chargeAmount = chargeAmountCents / 100

  // Guard: tenant must have its own Stripe key — never fall back to default
  if (!tenant?.stripe_secret_key) {
    return {
      success: false,
      error: 'Stripe not configured for this tenant. Set stripe_secret_key in admin.',
    }
  }
  const stripeKey = tenant.stripe_secret_key

  // ──────────────────────────────────────────────────────────────────────
  // CARD-ON-FILE AUTO-CHARGE: Charge saved card instead of sending payment link
  // For tenants with use_card_on_file: true (Cedar Rapids, Spotless Scrubbers)
  // ──────────────────────────────────────────────────────────────────────
  const useCardOnFile = tenant?.workflow_config?.use_card_on_file === true
  const customerStripeId = (customer as any).stripe_customer_id as string | null

  if (useCardOnFile && customerStripeId) {
    const autoChargeResult = await chargeCardOnFile(stripeKey, customerStripeId, chargeAmountCents, {
      job_id: jobId,
      phone_number: job.phone_number,
      payment_type: 'AUTO_CHARGE',
    }, tenant?.currency || 'usd')

    if (autoChargeResult.success) {
      // Auto-charge succeeded — mark job as completed + fully paid
      await updateJob(jobId, {
        status: 'completed',
        payment_status: 'fully_paid' as any,
      }, {}, serviceClient)

      await serviceClient
        .from("leads")
        .update({ status: "completed" })
        .eq("converted_to_job_id", Number(jobId))

      // Send receipt SMS
      const receiptMsg = tenant
        ? `Your ${job.service_type || 'cleaning'} is complete! ${formatTenantCurrency(tenant, chargeAmount)} has been charged to your card on file. Thank you!`
        : `Your ${job.service_type || 'cleaning'} is complete! $${chargeAmount.toFixed(2)} has been charged to your card on file. Thank you!`
      const sendResult = tenant
        ? await sendSMS(tenant, customer.phone_number, receiptMsg)
        : { success: false, error: 'No tenant' }

      if (sendResult.success) {
        const timestamp = new Date().toISOString()
        await appendToTextingTranscript(
          customer.phone_number,
          `[${timestamp}] [Job Completed - Auto-Charged] ${businessNameShort}: ${receiptMsg}`,
          serviceClient
        )
      }

      await logSystemEvent({
        source: 'actions',
        event_type: 'AUTO_CHARGE_SUCCESS',
        message: `Auto-charged $${chargeAmount.toFixed(2)} for job ${jobId}.`,
        job_id: jobId,
        customer_id: job.customer_id,
        phone_number: customer.phone_number,
        metadata: {
          charge_amount: chargeAmount,
          payment_intent_id: autoChargeResult.paymentIntentId,
          total_price: totalPrice,
          total_due: totalDue,
        },
      })

      // Membership lifecycle
      if (job.membership_id) {
        await handleMembershipLifecycle(jobId, job.membership_id, tenant, job.phone_number)
      }

      // Immediate satisfaction check
      if (tenantUsesFeature(tenant, 'post_cleaning_followup_enabled')) {
        triggerSatisfactionCheck({
          tenant,
          jobId,
          customerId: job.customer_id ? Number(job.customer_id) : null,
          customerPhone: customer.phone_number,
          customerName: customer.first_name || 'there',
        }).catch(err => console.error(`[complete-job] Satisfaction check error for job ${jobId}:`, err))
      }

      return {
        success: true,
        jobId,
        chargeAmount,
        smsSent: sendResult.success,
        message: 'Auto-charged card on file',
      }
    }

    // Auto-charge failed — log and fall through to manual payment link
    console.warn(`[complete-job] Auto-charge failed for job ${jobId}: ${autoChargeResult.error}`)
    await logSystemEvent({
      source: 'actions',
      event_type: 'AUTO_CHARGE_FAILED',
      message: `Auto-charge failed for job ${jobId}: ${autoChargeResult.error}. Falling back to payment link.`,
      job_id: jobId,
      customer_id: job.customer_id,
      phone_number: customer.phone_number,
      metadata: {
        error: autoChargeResult.error,
        charge_amount: chargeAmount,
        stripe_customer_id: customerStripeId,
      },
    })
  }

  // Create Stripe payment link for remaining amount (fallback or non-card-on-file tenants)
  const stripe = getStripeClientForTenant(stripeKey)

  // Ensure customer exists in Stripe so payment is associated correctly
  await findOrCreateStripeCustomer(customer, stripeKey)

  // First create a price for this specific payment
  const price = await stripe.prices.create({
    currency: tenant?.currency || 'usd',
    unit_amount: chargeAmountCents, // Convert to cents
    product_data: {
      name: `${job.service_type || 'Cleaning'} - Final Payment`,
    },
  })

  // Create a payment link using the tenant's domain (not OSIRIS)
  const domain = await getTenantRedirectDomain(job.tenant_id)
  const paymentMetadata: Record<string, string> = {
    job_id: jobId,
    phone_number: job.phone_number,
    payment_type: 'FINAL',
  }
  if (testChargeCents) {
    paymentMetadata.test_charge_cents = String(testChargeCents)
  }

  const paymentLink = await stripe.paymentLinks.create({
    line_items: [
      {
        price: price.id,
        quantity: 1,
      },
    ],
    metadata: paymentMetadata,
    payment_intent_data: {
      metadata: paymentMetadata,
    },
    after_completion: {
      type: 'redirect',
      redirect: {
        url: `${domain}/thank-you`,
      },
    },
  })

  // Update job status + track payment link for dedup
  const existingNotes = job.notes || ''
  const cleanedNotes = existingNotes.replace(/LATEST_PAYMENT_LINK:[^\n]*\n?/g, '')
  const notesWithLink = `${cleanedNotes}\nLATEST_PAYMENT_LINK: ${paymentLink.url}`.trim()
  await updateJob(jobId, { status: 'completed', notes: notesWithLink }, {}, serviceClient)

  // Sync lead status to "completed" so dashboard pipeline updates
  await serviceClient
    .from("leads")
    .update({ status: "completed" })
    .eq("converted_to_job_id", Number(jobId))

  // Send SMS with payment link
  const smsMessage = `Hi! Thanks so much for choosing ${businessName}. Here's the link for your remaining balance: ${paymentLink.url}`

  if (!tenant) {
    console.error(`[complete-job] No tenant for job ${jobId} — cannot send final payment SMS`)
  }
  const sendResult = tenant
    ? await sendSMS(tenant, customer.phone_number, smsMessage)
    : { success: false, error: 'No tenant' }

  if (sendResult.success) {
    const timestamp = new Date().toISOString()
    await appendToTextingTranscript(
      customer.phone_number,
      `[${timestamp}] [Job Completed - Final Payment Requested] ${businessNameShort}: ${smsMessage}`,
      serviceClient
    )
  }

  await logSystemEvent({
    source: 'actions',
    event_type: 'FINAL_PAYMENT_LINK_SENT',
    message: `Final payment link sent for job ${jobId}.`,
    job_id: jobId,
    customer_id: job.customer_id,
    phone_number: customer.phone_number,
    metadata: {
      remaining_amount: remainingAmount,
      charge_amount: chargeAmount,
      payment_link: paymentLink.url,
      total_due: totalDue,
      deposit_paid: depositPaid,
      add_on_paid: addOnPaid,
      test_charge_cents: testChargeCents ?? undefined,
    },
  })

  await logSystemEvent({
    source: 'actions',
    event_type: 'JOB_COMPLETED',
    message: `Job ${jobId} marked completed.`,
    job_id: jobId,
    customer_id: job.customer_id,
    phone_number: job.phone_number,
    metadata: {
      total_price: totalPrice,
      remaining_amount: remainingAmount,
      charge_amount: chargeAmount,
      total_due: totalDue,
      deposit_paid: depositPaid,
      add_on_paid: addOnPaid,
      test_charge_cents: testChargeCents ?? undefined,
    },
  })

  // Membership lifecycle
  if (job.membership_id) {
    await handleMembershipLifecycle(jobId, job.membership_id, tenant, job.phone_number)
  }

  // Immediate satisfaction check
  if (tenant && tenantUsesFeature(tenant, 'post_cleaning_followup_enabled')) {
    triggerSatisfactionCheck({
      tenant,
      jobId,
      customerId: job.customer_id ? Number(job.customer_id) : null,
      customerPhone: customer.phone_number,
      customerName: customer.first_name || 'there',
    }).catch(err => console.error(`[complete-job] Satisfaction check error for job ${jobId}:`, err))
  }

  return {
    success: true,
    jobId,
    paymentUrl: paymentLink.url,
    remainingAmount,
    chargeAmount,
    smsSent: sendResult.success,
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  try {
    const body = await request.json()
    const { jobId } = body

    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      )
    }

    // Verify job belongs to the authenticated user's tenant
    const serviceClient = getSupabaseServiceClient()
    const job = await getJobById(jobId, serviceClient)
    if (!job || job.tenant_id !== tenant.id) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }

    const result = await executeCompleteJob(jobId)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Complete job error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'complete-job',
    method: 'POST',
    body: {
      jobId: 'string (required)',
    },
    description: 'Marks job as completed and sends final payment link to customer',
  })
}