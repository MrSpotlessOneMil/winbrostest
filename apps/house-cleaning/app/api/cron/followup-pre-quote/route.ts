/**
 * Pipeline A — Pre-Quote Follow-up
 *
 * OUTREACH-SPEC v1.0 Section 5. Customers in lifecycle_state='engaged'
 * receive 3 stages at +4h / +1d / +3d from the last outbound. After stage 3
 * silent, graduate to retargeting.
 *
 * Everything behind:
 *   - RETARGETING_DISABLED env kill switch (global)
 *   - PIPELINE_A_DISABLED env kill switch (pipeline-specific)
 *   - workflow_config.outreach_enabled per tenant (enable gradually)
 *   - OUTREACH_DRY_RUN=true short-circuits actual SMS send
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

const PIPELINE = 'pre_quote' as const
const STAGE_DELAYS_HOURS = { 1: 4, 2: 24, 3: 24 * 3 } as const // stage n since stage n-1 or engaged
const MAX_CUSTOMERS_PER_TENANT_PER_RUN = 50

function pipelineDisabled(): boolean {
  return (process.env.PIPELINE_A_DISABLED || '').toLowerCase() === 'true'
}
function dryRun(): boolean {
  return (process.env.OUTREACH_DRY_RUN || '').toLowerCase() === 'true'
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }
  if (isRetargetingPaused()) {
    return NextResponse.json({ ok: true, paused: 'global_kill_switch', summary: [] })
  }
  if (pipelineDisabled()) {
    return NextResponse.json({ ok: true, paused: 'pipeline_a_disabled', summary: [] })
  }

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()
  const summary: Array<{ tenant: string; processed: number; sent: number; graduated: number; skipped: number; fallbacks: number }> = []

  for (const tenant of tenants) {
    if (!tenant.workflow_config?.outreach_enabled) continue
    if (!isInPersonalHours(tenant)) continue

    const voice = (tenant.voice_profile || {}) as TenantVoiceProfile
    let processed = 0, sent = 0, graduated = 0, skipped = 0, fallbacks = 0

    // Find engaged customers whose last outbound is old enough for their NEXT stage
    const { data: candidates } = await client
      .from('customers')
      .select('id, first_name, phone_number, lifecycle_state, pre_quote_stage, pre_quote_last_sent_at')
      .eq('tenant_id', tenant.id)
      .eq('lifecycle_state', 'engaged')
      .not('phone_number', 'is', null)
      .order('pre_quote_last_sent_at', { ascending: true, nullsFirst: true })
      .limit(MAX_CUSTOMERS_PER_TENANT_PER_RUN)

    if (!candidates?.length) continue

    for (const cust of candidates) {
      processed++
      const currentStage = (cust.pre_quote_stage as number) || 0
      const nextStage = currentStage + 1

      // If we've already done stage 3, graduate to retargeting
      if (nextStage > 3) {
        const t = await transitionState(client, tenant.id, cust.id, 'retargeting', {
          event: 'pre_quote_graduation',
          metadata: { reason: 'stage_3_silent' },
        })
        if (t.ok) graduated++
        continue
      }

      // Check timing: stage N fires STAGE_DELAYS_HOURS[N] hours after the previous send
      // For stage 1, use the last outbound timestamp as the clock
      let lastSent: Date
      if (cust.pre_quote_last_sent_at) {
        lastSent = new Date(cust.pre_quote_last_sent_at)
      } else {
        const { data: lastOutbound } = await client
          .from('messages')
          .select('timestamp')
          .eq('tenant_id', tenant.id)
          .eq('customer_id', cust.id)
          .eq('direction', 'outbound')
          .order('timestamp', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (!lastOutbound) { skipped++; continue }
        lastSent = new Date(lastOutbound.timestamp)
      }

      const hoursSince = (Date.now() - lastSent.getTime()) / (1000 * 60 * 60)
      if (hoursSince < STAGE_DELAYS_HOURS[nextStage as 1 | 2 | 3]) {
        skipped++
        continue
      }

      // Gate check
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

      // Pick variant + fetch template (optional — if no template rows, generator uses defaults)
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
      })

      if (gen.fallback) fallbacks++
      if (!gen.lintResult.ok && gen.fallback) {
        // lint failed even for template fallback — skip and log
        await logSystemEvent({
          source: 'cron',
          event_type: 'OUTREACH_LINT_FAILED',
          tenant_id: tenant.id,
          message: `Pre-quote stage ${nextStage} lint failed for customer ${cust.id}`,
          metadata: { failures: gen.lintResult.failures, customer_id: cust.id },
        })
        skipped++
        continue
      }

      // Send (or dry-run log)
      const nowIso = new Date().toISOString()
      if (dryRun()) {
        await logSystemEvent({
          source: 'cron',
          event_type: 'OUTREACH_DRY_RUN',
          tenant_id: tenant.id,
          message: `[DRY] pre_quote stage ${nextStage} -> ${cust.phone_number}`,
          metadata: { customer_id: cust.id, stage: nextStage, variant, template_id: template?.id, text: gen.text },
        })
        sent++ // counted for dry-run summary
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
          source: `pipeline_a_stage_${nextStage}`,
          template_id: template?.id ?? null,
          variant,
        }).select('id').single()

        const result = await sendSMS(tenant, cust.phone_number!, gen.text, { skipDedup: true })
        if (result.success) sent++
        else if (preInsert?.id) await client.from('messages').delete().eq('id', preInsert.id)
      }

      await client
        .from('customers')
        .update({ pre_quote_stage: nextStage, pre_quote_last_sent_at: nowIso })
        .eq('id', cust.id)
        .eq('tenant_id', tenant.id)
    }

    summary.push({ tenant: tenant.slug, processed, sent, graduated, skipped, fallbacks })
  }

  return NextResponse.json({ ok: true, summary, dryRun: dryRun() })
}
