import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getAllActiveTenants, tenantUsesFeature } from '@/lib/tenant'
import { sendSMS } from '@/lib/openphone'
import { scheduleRetargetingSequence, type RetargetingSequenceType } from '@/lib/scheduler'
import { isRetargetingExcluded, isInPersonalHours } from '@/lib/cron-hours-guard'
import { customersWithConfirmedBookings } from '@/lib/has-confirmed-booking'

/**
 * Lifecycle Auto-Enrollment Cron
 *
 * Refreshes customer lifecycle stages and auto-enrolls unenrolled customers
 * in matching retargeting sequences.
 *
 * Also handles:
 * - Auto-marking stale leads as "lost" (30+ days in new/contacted with no activity)
 * - Auto-expiring quotes past valid_until and notifying customers
 *
 * Targets: unresponsive, quoted_not_booked, one_time, lapsed
 * Cap: 50 enrollments per tenant per run
 *
 * Schedule: 0 15 * * * (3pm UTC daily)
 */

const ENROLLABLE_STAGES: RetargetingSequenceType[] = [
  'unresponsive',
  'quoted_not_booked',
  'one_time',
  'lapsed',
  'new_lead',
  'lost',
]

const MAX_ENROLLMENTS_PER_TENANT = 400

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Lifecycle Auto-Enroll] Starting...')

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()

  const summary: Array<{ tenant: string; enrolled: number; skipped: number }> = []

  for (const tenant of tenants) {
    if (!tenantUsesFeature(tenant, 'monthly_followup_enabled')) {
      continue
    }
    if (isRetargetingExcluded(tenant.slug)) {
      console.log(`[Lifecycle Auto-Enroll] Skipping ${tenant.slug} (retargeting excluded)`)
      continue
    }
    if (!isInPersonalHours(tenant)) {
      console.log(`[Lifecycle Auto-Enroll] Skipping ${tenant.slug} — outside 9am–9pm ${tenant.timezone || 'America/Chicago'}`)
      continue
    }

    let enrolled = 0
    let skipped = 0

    try {
      // Refresh lifecycle stages
      await client.rpc('refresh_customer_lifecycles', { p_tenant_id: tenant.id })

      // Get cleaner phone numbers to exclude
      const { data: cleanerPhones } = await client
        .from('cleaners')
        .select('phone')
        .eq('tenant_id', tenant.id)
        .not('phone', 'is', null)
      const cleanerPhoneSet = new Set((cleanerPhones || []).map(c => c.phone).filter(Boolean))

      // Find customers eligible for auto-enrollment
      const { data: candidates, error: queryError } = await client
        .from('customers')
        .select('id, first_name, last_name, phone_number, lifecycle_stage, retargeting_sequence, retargeting_stopped_reason, retargeting_completed_at, sms_opt_out')
        .eq('tenant_id', tenant.id)
        .in('lifecycle_stage', ENROLLABLE_STAGES)
        .not('phone_number', 'is', null)
        .order('updated_at', { ascending: true })
        .limit(600) // fetch more than cap to account for filtering

      if (queryError) {
        console.error(`[Lifecycle Auto-Enroll] Query error for ${tenant.slug}:`, queryError.message)
        continue
      }

      if (!candidates || candidates.length === 0) continue

      // Batch-fetch customers with confirmed bookings so we don't enroll anyone
      // already on the calendar into retargeting sequences (W2 — 2026-04-20).
      const candidateIds = candidates.map(c => c.id).filter((id): id is number => typeof id === 'number')
      const bookedSet = await customersWithConfirmedBookings(client, tenant.id, candidateIds)

      for (const cust of candidates) {
        if (enrolled >= MAX_ENROLLMENTS_PER_TENANT) break

        // Skip opted-out customers
        if (cust.sms_opt_out) {
          skipped++
          continue
        }

        // Skip customers with a confirmed booking elsewhere
        if (bookedSet.has(String(cust.id))) {
          skipped++
          continue
        }

        // Skip cleaners
        if (cust.phone_number && cleanerPhoneSet.has(cust.phone_number)) {
          skipped++
          continue
        }

        const stage = cust.lifecycle_stage as RetargetingSequenceType

        // Skip if currently in an active sequence
        if (cust.retargeting_sequence && !cust.retargeting_stopped_reason) {
          skipped++
          continue
        }

        // Skip if they completed the SAME sequence they'd be enrolled in
        // (prevents re-enrollment in the same sequence)
        if (
          cust.retargeting_stopped_reason === 'completed' &&
          cust.retargeting_sequence === stage
        ) {
          skipped++
          continue
        }

        // Global cooldown: skip if any sequence completed within the last 14 days
        if (cust.retargeting_completed_at) {
          const completedAt = new Date(cust.retargeting_completed_at)
          const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
          if (completedAt > fourteenDaysAgo) {
            skipped++
            continue
          }
        }

        // Never enrolled, or completed a DIFFERENT sequence → eligible
        const customerName = [cust.first_name, cust.last_name].filter(Boolean).join(' ') || 'there'

        try {
          await scheduleRetargetingSequence(
            tenant.id,
            cust.id,
            cust.phone_number,
            customerName,
            stage,
          )
          enrolled++
          console.log(`[Lifecycle Auto-Enroll] Enrolled customer ${cust.id} in ${stage} (${tenant.slug})`)
        } catch (err) {
          console.error(`[Lifecycle Auto-Enroll] Failed to enroll customer ${cust.id}:`, err)
        }
      }
    } catch (err) {
      console.error(`[Lifecycle Auto-Enroll] Error for ${tenant.slug}:`, err)
    }

    if (enrolled > 0 || skipped > 0) {
      summary.push({ tenant: tenant.slug, enrolled, skipped })
    }
  }

  // ── Phase 2: Stale lead cleanup & quote expiry (all tenants) ──
  let staleLeadsMarked = 0
  let quotesExpired = 0

  for (const tenant of tenants) {
    try {
      // Auto-mark stale leads as lost: new/contacted for 30+ days with no activity
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data: staleLeads, error: staleErr } = await client
        .from('leads')
        .update({ status: 'lost' })
        .eq('tenant_id', tenant.id)
        .in('status', ['new', 'contacted'])
        .lt('created_at', thirtyDaysAgo)
        .select('id')

      if (staleErr) {
        console.error(`[Lifecycle Auto-Enroll] Stale lead cleanup error for ${tenant.slug}:`, staleErr.message)
      } else if (staleLeads && staleLeads.length > 0) {
        staleLeadsMarked += staleLeads.length
        console.log(`[Lifecycle Auto-Enroll] Marked ${staleLeads.length} stale leads as lost for ${tenant.slug}`)
      }

      // Auto-expire quotes past valid_until
      const { data: expiredQuotes, error: expireErr } = await client
        .from('quotes')
        .update({ status: 'expired' })
        .eq('tenant_id', tenant.id)
        .eq('status', 'pending')
        .lt('valid_until', new Date().toISOString())
        .select('id, token, customer_id, customers(first_name, phone_number)')

      if (expireErr) {
        console.error(`[Lifecycle Auto-Enroll] Quote expiry error for ${tenant.slug}:`, expireErr.message)
      } else if (expiredQuotes && expiredQuotes.length > 0) {
        quotesExpired += expiredQuotes.length
        console.log(`[Lifecycle Auto-Enroll] Expired ${expiredQuotes.length} quotes for ${tenant.slug}`)

        // Send "quote expired" SMS for each (best-effort, don't block on failures)
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL
          || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cleanmachine.live')

        for (const q of expiredQuotes) {
          const cust = q.customers as any
          if (!cust?.phone_number) continue
          const name = cust.first_name || 'there'
          const msg = `Hey ${name}, your quote from ${tenant.business_name_short || tenant.name} has expired. If you're still interested, we'd love to send you an updated one - just reply and we'll get it over to you!`
          try {
            await sendSMS(tenant, cust.phone_number, msg, { source: 'lifecycle_auto_enroll' })
          } catch (smsErr) {
            console.error(`[Lifecycle Auto-Enroll] Failed to send quote expiry SMS for quote ${q.id}:`, smsErr)
          }
        }
      }
    } catch (err) {
      console.error(`[Lifecycle Auto-Enroll] Phase 2 error for ${tenant.slug}:`, err)
    }
  }

  const totalEnrolled = summary.reduce((sum, s) => sum + s.enrolled, 0)
  console.log(`[Lifecycle Auto-Enroll] Done. Enrolled: ${totalEnrolled}, stale leads marked lost: ${staleLeadsMarked}, quotes expired: ${quotesExpired}`)

  return NextResponse.json({ success: true, summary, totalEnrolled, staleLeadsMarked, quotesExpired })
}
