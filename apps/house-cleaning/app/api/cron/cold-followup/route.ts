import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { getAllActiveTenants } from '@/lib/tenant'
import { logSystemEvent } from '@/lib/system-events'
import { isRetargetingExcluded, isInPersonalHours } from '@/lib/cron-hours-guard'
import { canSendOutreach } from '@/lib/can-send-outreach'
import { templateForStage, COLD_FOLLOWUP_MIN_HOURS, type ColdFollowupStage } from '@/lib/cold-followup-templates'

/**
 * Cold-Lead Follow-up Cadence (T5 — 2026-04-20).
 *
 * Runs every 30 minutes. For each tenant within business hours, finds
 * customers who received an initial outbound message but never replied,
 * and sends staged nudges at +4h / +1d / +3d. Cadence stops on any inbound
 * reply, job creation, human takeover, or escalation.
 *
 * Schedule: every 30 minutes (see vercel.json)
 *
 * Per-tenant cap: 50 sends per run (avoids blasting after a backlog builds).
 */

// route-check:no-vercel-cron

const PER_TENANT_CAP = 50

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()
  const now = new Date()

  const summary: Array<{ tenant: string; stage1: number; stage2: number; stage3: number; skipped: number }> = []

  for (const tenant of tenants) {
    if (isRetargetingExcluded(tenant.slug)) continue
    if (!isInPersonalHours(tenant)) {
      summary.push({ tenant: tenant.slug, stage1: 0, stage2: 0, stage3: 0, skipped: -1 })
      continue
    }

    const counts = { stage1: 0, stage2: 0, stage3: 0, skipped: 0 }

    // One query per stage — eligible rows must:
    //   - not be opted out / disabled / paused
    //   - be at the previous stage (stage - 1)
    //   - have last_cold_followup_at older than the stage threshold
    //     (OR for stage 1: their last agent-origin message older than 4h)
    //   - have NO inbound message ever (no reply to initial outbound)
    //   - have NO confirmed booking

    const stages: ColdFollowupStage[] = [3, 2, 1] // descending — drain oldest first
    for (const stage of stages) {
      const prev = (stage - 1) as 0 | 1 | 2
      const minHours = COLD_FOLLOWUP_MIN_HOURS[stage]
      const cutoff = new Date(now.getTime() - minHours * 60 * 60 * 1000).toISOString()

      // For stage 1, "previous" is stage 0 which means the initial outbound was sent but
      // no cold-followup nudge has been fired yet. Use created_at / last_cold_followup_at.
      const lastActivityColumn = stage === 1 ? 'created_at' : 'last_cold_followup_at'

      const { data: candidates, error } = await client
        .from('customers')
        .select('id, first_name, last_name, phone_number, sms_opt_out, auto_response_disabled, auto_response_paused, human_takeover_until, cold_followup_stage, last_cold_followup_at, created_at')
        .eq('tenant_id', tenant.id)
        .eq('cold_followup_stage', prev)
        .lt(lastActivityColumn, cutoff)
        .not('phone_number', 'is', null)
        .is('sms_opt_out', false)
        .order(lastActivityColumn, { ascending: true })
        .limit(PER_TENANT_CAP)

      if (error) {
        console.error(`[cold-followup] Query error for ${tenant.slug} stage ${stage}:`, error.message)
        continue
      }
      if (!candidates || candidates.length === 0) continue

      // Batch check: any of these customers have an inbound message? Any have a confirmed job?
      const ids = candidates.map(c => c.id)
      const [{ data: withInbound }, { data: withBooking }] = await Promise.all([
        client.from('messages').select('customer_id').eq('tenant_id', tenant.id).in('customer_id', ids).eq('direction', 'inbound'),
        client.from('jobs').select('customer_id').eq('tenant_id', tenant.id).in('customer_id', ids).in('status', ['scheduled', 'in_progress']),
      ])
      const inboundSet = new Set((withInbound || []).map(r => r.customer_id))
      const bookedSet = new Set((withBooking || []).map(r => r.customer_id))

      for (const cust of candidates) {
        if (inboundSet.has(cust.id)) { counts.skipped++; continue }
        if (bookedSet.has(cust.id)) { counts.skipped++; continue }

        // Full pre-flight check (bundles takeover, opt-out, quiet-hours)
        const gate = await canSendOutreach({
          client,
          tenant,
          customer: cust,
          checkConfirmedBooking: false, // already done above
          now,
        })
        if (!gate.ok) { counts.skipped++; continue }

        const body = templateForStage(stage, {
          tenant,
          firstName: cust.first_name,
        })

        const result = await sendSMS(tenant, cust.phone_number!, body, {
          source: `cold_followup_stage_${stage}`,
          customerId: cust.id,
          kind: 'outreach',
        })

        if (result.success) {
          await client
            .from('customers')
            .update({
              cold_followup_stage: stage,
              last_cold_followup_at: new Date().toISOString(),
            })
            .eq('id', cust.id)
            .eq('tenant_id', tenant.id)

          if (stage === 1) counts.stage1++
          else if (stage === 2) counts.stage2++
          else counts.stage3++
        } else {
          counts.skipped++
        }
      }
    }

    if (counts.stage1 || counts.stage2 || counts.stage3 || counts.skipped) {
      summary.push({ tenant: tenant.slug, ...counts })
    }
  }

  if (summary.some(s => s.stage1 || s.stage2 || s.stage3)) {
    await logSystemEvent({
      source: 'cron',
      event_type: 'COLD_FOLLOWUP_RUN',
      message: `Cold-followup: ${summary.map(s => `${s.tenant} ${s.stage1}/${s.stage2}/${s.stage3}`).join(', ')}`,
      metadata: { summary },
    })
  }

  return NextResponse.json({ ok: true, summary })
}
