/**
 * Pipeline B — Post-Quote Follow-up
 *
 * OUTREACH-SPEC v1.0 Section 6. Customers in lifecycle_state='quoted'
 * receive 4 stages at +7min / +4h / +1d / +3d. Stage 1 is skipped if a
 * live convo is happening (outbound+inbound within last 10 min). Stage 3
 * includes a tenant-capped discount.
 *
 * Behind all the same kill switches as Pipeline A plus PIPELINE_B_DISABLED.
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
import { generateOutreachMessage, type TenantVoiceProfile } from '@/lib/message-generator'
import { pickVariant, getActiveTemplate } from '@/lib/ab-testing'
import { transitionState } from '@/lib/lifecycle-state'

// route-check:no-vercel-cron

const PIPELINE = 'post_quote' as const
const STAGE_DELAYS_MIN = { 1: 7, 2: 60 * 4, 3: 60 * 24, 4: 60 * 24 * 3 } as const
const MAX_CUSTOMERS_PER_TENANT_PER_RUN = 50

function pipelineDisabled(): boolean {
  return (process.env.PIPELINE_B_DISABLED || '').toLowerCase() === 'true'
}
function dryRun(): boolean {
  return (process.env.OUTREACH_DRY_RUN || '').toLowerCase() === 'true'
}

async function liveConvoHappening(
  client: ReturnType<typeof getSupabaseServiceClient>,
  tenantId: string,
  customerId: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data } = await client
    .from('messages')
    .select('direction, timestamp')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .gte('timestamp', cutoff)
    .order('timestamp', { ascending: false })
    .limit(6)
  if (!data || data.length < 2) return false
  const hasOutbound = data.some(m => m.direction === 'outbound')
  const hasInbound = data.some(m => m.direction === 'inbound')
  return hasOutbound && hasInbound
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }
  if (isRetargetingPaused()) {
    return NextResponse.json({ ok: true, paused: 'global_kill_switch', summary: [] })
  }
  if (pipelineDisabled()) {
    return NextResponse.json({ ok: true, paused: 'pipeline_b_disabled', summary: [] })
  }

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()
  const summary: Array<{ tenant: string; processed: number; sent: number; graduated: number; skipped: number; fallbacks: number }> = []
  const appDomain = process.env.NEXT_PUBLIC_APP_URL || 'https://cleanmachine.live'

  for (const tenant of tenants) {
    if (!tenant.workflow_config?.outreach_enabled) continue
    if (!isInPersonalHours(tenant)) continue

    const voice = (tenant.voice_profile || {}) as TenantVoiceProfile
    const offerPct = Number(tenant.workflow_config?.post_quote_max_discount) || 10

    let processed = 0, sent = 0, graduated = 0, skipped = 0, fallbacks = 0

    const { data: candidates } = await client
      .from('customers')
      .select('id, first_name, phone_number, lifecycle_state, post_quote_stage, post_quote_last_sent_at')
      .eq('tenant_id', tenant.id)
      .eq('lifecycle_state', 'quoted')
      .not('phone_number', 'is', null)
      .order('post_quote_last_sent_at', { ascending: true, nullsFirst: true })
      .limit(MAX_CUSTOMERS_PER_TENANT_PER_RUN)

    if (!candidates?.length) continue

    for (const cust of candidates) {
      processed++
      const currentStage = (cust.post_quote_stage as number) || 0
      const nextStage = currentStage + 1

      if (nextStage > 4) {
        // expire any open quote
        await client
          .from('quotes')
          .update({ status: 'expired' })
          .eq('customer_id', cust.id)
          .eq('tenant_id', tenant.id)
          .eq('status', 'pending')
        const t = await transitionState(client, tenant.id, cust.id, 'retargeting', {
          event: 'post_quote_graduation',
          metadata: { reason: 'stage_4_silent' },
        })
        if (t.ok) graduated++
        continue
      }

      // Timing: use quote creation for stage 1, last_sent for 2-4
      let clockStart: Date | null = null
      if (nextStage === 1) {
        const { data: quote } = await client
          .from('quotes')
          .select('created_at, token')
          .eq('customer_id', cust.id)
          .eq('tenant_id', tenant.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (!quote) { skipped++; continue }
        clockStart = new Date(quote.created_at)
      } else if (cust.post_quote_last_sent_at) {
        clockStart = new Date(cust.post_quote_last_sent_at)
      } else {
        skipped++
        continue
      }

      const minutesSince = (Date.now() - clockStart.getTime()) / (1000 * 60)
      if (minutesSince < STAGE_DELAYS_MIN[nextStage as 1 | 2 | 3 | 4]) {
        skipped++
        continue
      }

      // Stage 1: skip if live convo
      if (nextStage === 1 && await liveConvoHappening(client, tenant.id, cust.id)) {
        // don't advance stage — recheck next run
        skipped++
        continue
      }

      const gate = await isEligibleForOutreach({
        client,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        customerId: cust.id,
        kind: PIPELINE,
        channel: 'sms',
      })
      if (!gate.ok) {
        await logGateRefusal(client, tenant.id, cust.id, PIPELINE, gate)
        skipped++
        continue
      }

      // Pull quote link for msg context
      const { data: quote } = await client
        .from('quotes')
        .select('token')
        .eq('customer_id', cust.id)
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const quoteUrl = quote?.token ? `${appDomain}/quote/${quote.token}` : undefined

      const variant = pickVariant(cust.id)
      const template = await getActiveTemplate(client, {
        tenantId: tenant.id,
        pipeline: PIPELINE,
        stage: nextStage,
        variant,
      })

      const gen = await generateOutreachMessage({
        client,
        tenantId: tenant.id,
        tenantName: tenant.business_name_short || tenant.name || 'our team',
        voiceProfile: voice,
        customerId: cust.id,
        customerFirstName: cust.first_name,
        pipeline: PIPELINE,
        stage: nextStage,
        variant,
        channel: 'sms',
        offerPct: nextStage >= 3 ? offerPct : undefined,
        quoteUrl,
      })

      if (gen.fallback) fallbacks++
      if (!gen.lintResult.ok && gen.fallback) {
        await logSystemEvent({
          source: 'cron',
          event_type: 'OUTREACH_LINT_FAILED',
          tenant_id: tenant.id,
          message: `Post-quote stage ${nextStage} lint failed for customer ${cust.id}`,
          metadata: { failures: gen.lintResult.failures, customer_id: cust.id },
        })
        skipped++
        continue
      }

      const nowIso = new Date().toISOString()
      if (dryRun()) {
        await logSystemEvent({
          source: 'cron',
          event_type: 'OUTREACH_DRY_RUN',
          tenant_id: tenant.id,
          message: `[DRY] post_quote stage ${nextStage} -> ${cust.phone_number}`,
          metadata: { customer_id: cust.id, stage: nextStage, variant, template_id: template?.id, text: gen.text },
        })
        sent++
      } else {
        const { data: preInsert } = await client.from('messages').insert({
          tenant_id: tenant.id,
          customer_id: cust.id,
          phone_number: cust.phone_number,
          role: 'assistant',
          content: gen.text,
          direction: 'outbound',
          message_type: 'sms',
          ai_generated: !gen.fallback,
          timestamp: nowIso,
          source: `pipeline_b_stage_${nextStage}`,
          template_id: template?.id ?? null,
          variant,
        }).select('id').single()

        const result = await sendSMS(tenant, cust.phone_number!, gen.text, { skipDedup: true })
        if (result.success) sent++
        else if (preInsert?.id) await client.from('messages').delete().eq('id', preInsert.id)
      }

      await client
        .from('customers')
        .update({ post_quote_stage: nextStage, post_quote_last_sent_at: nowIso })
        .eq('id', cust.id)
        .eq('tenant_id', tenant.id)
    }

    summary.push({ tenant: tenant.slug, processed, sent, graduated, skipped, fallbacks })
  }

  return NextResponse.json({ ok: true, summary, dryRun: dryRun() })
}
