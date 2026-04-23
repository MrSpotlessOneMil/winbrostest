/**
 * Pipeline C — Retargeting Drip
 *
 * OUTREACH-SPEC v1.0 Section 7. Customers in lifecycle_state='retargeting'
 * receive ~1 touch every 30 days forever (until opt-out or re-engagement).
 * Channel rotation SMS -> email -> SMS+MMS -> email -> SMS -> voice/loom.
 * Offer escalation by days-since-lapse, not touch number.
 *
 * Behind: RETARGETING_DISABLED (global) + PIPELINE_C_DISABLED (pipeline) +
 * workflow_config.outreach_enabled (per-tenant) + OUTREACH_DRY_RUN.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getAllActiveTenants } from '@/lib/tenant'
import { sendSMS } from '@/lib/openphone'
import { logSystemEvent } from '@/lib/system-events'
import { isRetargetingPaused } from '@/lib/retargeting-paused'
import { isInPersonalHours } from '@/lib/cron-hours-guard'
import { isEligibleForOutreach, logGateRefusal } from '@/lib/outreach-gate'
import { generateOutreachMessage, type TenantVoiceProfile, type Channel } from '@/lib/message-generator'
import { pickVariant } from '@/lib/ab-testing'

// route-check:no-vercel-cron

const PIPELINE = 'retargeting' as const
const MIN_DAYS_BETWEEN_TOUCHES = 25
const MAX_PER_MONTH = 2
const MAX_CUSTOMERS_PER_TENANT_PER_RUN = 100

function pipelineDisabled(): boolean {
  return (process.env.PIPELINE_C_DISABLED || '').toLowerCase() === 'true'
}
function dryRun(): boolean {
  return (process.env.OUTREACH_DRY_RUN || '').toLowerCase() === 'true'
}

/** Channel rotation: touch % 6 -> (SMS, email, SMS+MMS, email, SMS, voice/loom) */
function channelForTouch(touchNumber: number, highValue: boolean): Channel | 'voice_note' {
  const slot = ((touchNumber - 1) % 6) + 1
  switch (slot) {
    case 1: return 'sms'
    case 2: return 'email'
    case 3: return 'mms'
    case 4: return 'email'
    case 5: return 'sms'
    case 6: return highValue ? 'voice_note' : 'sms'
  }
  return 'sms'
}

/** Offer percentage based on days since lapse. 0 = no offer. */
function offerFor(daysLapsed: number, touchInTier: number): number {
  if (daysLapsed < 60) return 0
  if (daysLapsed < 180) return touchInTier === 1 ? 15 : 0 // 1 offer per 60 days window
  if (daysLapsed < 365) return touchInTier === 1 ? 25 : 0
  return 0
}

/** Stage label for message generator — maps touch # to a generator-friendly stage. */
function stageForTouch(touchNumber: number, hasOffer: boolean): number {
  if (hasOffer) return 3
  return touchNumber === 1 ? 1 : 2
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }
  if (isRetargetingPaused()) {
    return NextResponse.json({ ok: true, paused: 'global_kill_switch', summary: [] })
  }
  if (pipelineDisabled()) {
    return NextResponse.json({ ok: true, paused: 'pipeline_c_disabled', summary: [] })
  }

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()
  const summary: Array<{ tenant: string; processed: number; sent: number; skipped: number; fallbacks: number }> = []

  for (const tenant of tenants) {
    if (!tenant.workflow_config?.outreach_enabled) continue
    if (!isInPersonalHours(tenant)) continue

    const voice = (tenant.voice_profile || {}) as TenantVoiceProfile
    const highValueLtv = Number(tenant.workflow_config?.high_value_ltv_threshold) || 400

    let processed = 0, sent = 0, skipped = 0, fallbacks = 0

    const { data: candidates } = await client
      .from('customers')
      .select('id, first_name, phone_number, email, lifecycle_state, retarget_touch_count, retarget_last_sent_at, retarget_lapsed_at')
      .eq('tenant_id', tenant.id)
      .eq('lifecycle_state', 'retargeting')
      .not('phone_number', 'is', null)
      .order('retarget_last_sent_at', { ascending: true, nullsFirst: true })
      .limit(MAX_CUSTOMERS_PER_TENANT_PER_RUN)

    if (!candidates?.length) continue

    for (const cust of candidates) {
      processed++
      const now = new Date()

      // Timing guard: min 25 days since last touch
      if (cust.retarget_last_sent_at) {
        const days = (now.getTime() - new Date(cust.retarget_last_sent_at).getTime()) / (1000 * 60 * 60 * 24)
        if (days < MIN_DAYS_BETWEEN_TOUCHES) { skipped++; continue }
      }

      // Max 2 per calendar month
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const { data: thisMonthSends } = await client
        .from('messages')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('customer_id', cust.id)
        .like('source', 'pipeline_c_%')
        .gte('timestamp', monthStart)
      if ((thisMonthSends?.length || 0) >= MAX_PER_MONTH) { skipped++; continue }

      // Days-since-lapse drives offer tier
      const lapsedAt = cust.retarget_lapsed_at ? new Date(cust.retarget_lapsed_at) : now
      const daysLapsed = Math.floor((now.getTime() - lapsedAt.getTime()) / (1000 * 60 * 60 * 24))

      const touchNumber = ((cust.retarget_touch_count as number) || 0) + 1

      // High-LTV check for voice-note slot
      const { data: ltvJobs } = await client
        .from('jobs')
        .select('price')
        .eq('tenant_id', tenant.id)
        .eq('customer_id', cust.id)
        .eq('status', 'completed')
      const ltv = (ltvJobs || []).reduce((s, j) => s + (Number(j.price) || 0), 0)
      const highValue = ltv >= highValueLtv

      let channel: Channel = 'sms'
      const slot = channelForTouch(touchNumber, highValue)
      if (slot === 'voice_note') {
        // Voice-note touch: queue for owner to record rather than AI-generate
        await logSystemEvent({
          source: 'cron',
          event_type: 'RETARGETING_VOICE_NOTE_QUEUED',
          tenant_id: tenant.id,
          message: `Voice-note queued for high-LTV customer ${cust.id}`,
          metadata: { customer_id: cust.id, ltv, touch_number: touchNumber },
        })
        await client
          .from('customers')
          .update({ retarget_last_sent_at: now.toISOString(), retarget_touch_count: touchNumber })
          .eq('id', cust.id)
          .eq('tenant_id', tenant.id)
        skipped++ // not counted as sent
        continue
      }
      channel = slot as Channel

      // No email support in v1 — if slot says email, downgrade to SMS for v1 unless
      // we have a working email sender for this tenant. (We check email exists.)
      if (channel === 'email' && !cust.email) channel = 'sms'

      // Gate
      const gate = await isEligibleForOutreach({
        client,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        customerId: cust.id,
        kind: PIPELINE,
        channel,
        activeConversationWindowMinutes:
          (tenant.workflow_config as any)?.active_conversation_window_minutes,
      })
      if (!gate.ok) {
        await logGateRefusal(client, tenant.id, cust.id, PIPELINE, gate)
        skipped++
        continue
      }

      // Offer
      // Touch-in-tier count determined by how many sends fall in current 60-day window
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString()
      const { data: recentOffers } = await client
        .from('messages')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('customer_id', cust.id)
        .like('source', 'pipeline_c_offer_%')
        .gte('timestamp', sixtyDaysAgo)
      const touchInTier = (recentOffers?.length || 0) === 0 ? 1 : 2
      const offerPct = offerFor(daysLapsed, touchInTier)

      const stage = stageForTouch(touchNumber, offerPct > 0)
      const variant = pickVariant(cust.id)

      const gen = await generateOutreachMessage({
        client,
        tenantId: tenant.id,
        tenantName: tenant.business_name_short || tenant.name || 'our team',
        voiceProfile: voice,
        customerId: cust.id,
        customerFirstName: cust.first_name,
        pipeline: PIPELINE,
        stage,
        variant,
        channel: channel === 'mms' ? 'mms' : channel === 'email' ? 'email' : 'sms',
        offerPct: offerPct > 0 ? offerPct : undefined,
      })

      if (gen.fallback) fallbacks++
      if (!gen.lintResult.ok && gen.fallback) {
        await logSystemEvent({
          source: 'cron',
          event_type: 'OUTREACH_LINT_FAILED',
          tenant_id: tenant.id,
          message: `Retargeting touch ${touchNumber} lint failed for customer ${cust.id}`,
          metadata: { failures: gen.lintResult.failures, customer_id: cust.id },
        })
        skipped++
        continue
      }

      const source = offerPct > 0 ? `pipeline_c_offer_${offerPct}` : `pipeline_c_touch_${touchNumber}`
      const nowIso = now.toISOString()

      if (dryRun()) {
        await logSystemEvent({
          source: 'cron',
          event_type: 'OUTREACH_DRY_RUN',
          tenant_id: tenant.id,
          message: `[DRY] retargeting touch ${touchNumber} (${channel}) -> ${cust.phone_number}`,
          metadata: { customer_id: cust.id, touch: touchNumber, variant, channel, offer_pct: offerPct, text: gen.text },
        })
        sent++
      } else if (channel === 'email') {
        // Email stub — v1 only logs. Real email send wired in follow-up PR.
        await logSystemEvent({
          source: 'cron',
          event_type: 'RETARGETING_EMAIL_DEFERRED',
          tenant_id: tenant.id,
          message: `Email channel not wired in v1 — deferred`,
          metadata: { customer_id: cust.id, text: gen.text },
        })
        skipped++
        continue
      } else {
        const { data: preInsert } = await client.from('messages').insert({
          tenant_id: tenant.id,
          customer_id: cust.id,
          phone_number: cust.phone_number,
          role: 'assistant',
          content: gen.text,
          direction: 'outbound',
          message_type: channel === 'mms' ? 'mms' : 'sms',
          ai_generated: !gen.fallback,
          timestamp: nowIso,
          source,
          variant,
        }).select('id').single()

        const result = await sendSMS(tenant, cust.phone_number!, gen.text, { skipDedup: true })
        if (result.success) sent++
        else if (preInsert?.id) await client.from('messages').delete().eq('id', preInsert.id)
      }

      await client
        .from('customers')
        .update({ retarget_last_sent_at: nowIso, retarget_touch_count: touchNumber })
        .eq('id', cust.id)
        .eq('tenant_id', tenant.id)
    }

    summary.push({ tenant: tenant.slug, processed, sent, skipped, fallbacks })
  }

  return NextResponse.json({ ok: true, summary, dryRun: dryRun() })
}
