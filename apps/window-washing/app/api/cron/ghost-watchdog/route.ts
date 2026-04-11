/**
 * Ghost Watchdog Cron
 *
 * Runs every 2 minutes. Finds inbound customer messages that never got a response:
 * 1. Messages with disposition='pending' older than 5 min (webhook didn't finish)
 * 2. Messages with no outbound follow-up within 5-30 min (fallback)
 *
 * For each ghost: auto-unpauses customer + lead, generates + sends an AI response,
 * logs GHOST_WATCHDOG_CATCH event, and sends Telegram alert.
 *
 * Endpoint: GET /api/cron/ghost-watchdog
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getAllActiveTenants } from '@/lib/tenant'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { sendSMS } from '@/lib/openphone'
import { generateAutoResponse, loadCustomerContext } from '@/lib/auto-response'
import { analyzeBookingIntent } from '@/lib/ai-intent'
import { logSystemEvent } from '@/lib/system-events'

// route-check:no-vercel-cron
export const dynamic = 'force-dynamic'
export const maxDuration = 55

// Dominic's Telegram chat ID for alerts
const DOMINIC_TELEGRAM_CHAT_ID = '1877604875'

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()
  let ghostsCaught = 0
  let responseSent = 0
  const alerts: string[] = []

  for (const tenant of tenants) {
    try {
      const windowStart = new Date(Date.now() - 30 * 60 * 1000).toISOString() // 30 min ago
      const windowEnd = new Date(Date.now() - 5 * 60 * 1000).toISOString()   // 5 min ago

      // Strategy 1: Find messages with disposition='pending' (webhook didn't finish processing)
      const { data: pendingMsgs } = await client
        .from('messages')
        .select('id, phone_number, customer_id, content, created_at, metadata')
        .eq('tenant_id', tenant.id)
        .eq('direction', 'inbound')
        .eq('role', 'client')
        .gte('created_at', windowStart)
        .lte('created_at', windowEnd)
        .filter('metadata->>disposition', 'eq', 'pending')
        .order('created_at', { ascending: false })
        .limit(20)

      // Strategy 2: Fallback — find inbound with NO outbound follow-up at all
      // (catches cases where disposition tracking wasn't set, e.g. old messages)
      const { data: allRecentInbound } = await client
        .from('messages')
        .select('id, phone_number, customer_id, content, created_at, metadata')
        .eq('tenant_id', tenant.id)
        .eq('direction', 'inbound')
        .eq('role', 'client')
        .gte('created_at', windowStart)
        .lte('created_at', windowEnd)
        .order('created_at', { ascending: false })
        .limit(30)

      // Merge and deduplicate by phone
      const allCandidates = [...(pendingMsgs || []), ...(allRecentInbound || [])]
      const seen = new Set<string>()
      const uniqueByPhone = allCandidates.filter(m => {
        if (!m.phone_number || seen.has(m.phone_number)) return false
        seen.add(m.phone_number)
        return true
      })

      for (const msg of uniqueByPhone) {
        // Check if there's any outbound response after this inbound
        const { data: response } = await client
          .from('messages')
          .select('id')
          .eq('phone_number', msg.phone_number)
          .eq('tenant_id', tenant.id)
          .eq('direction', 'outbound')
          .gt('created_at', msg.created_at)
          .limit(1)
          .maybeSingle()

        if (response) continue // Got a response, not ghosted

        // Check if disposition is already set to an intentional filter
        const disposition = msg.metadata?.disposition
        if (disposition && disposition !== 'pending') {
          // Already has a non-pending disposition — this was an intentional skip
          // (filtered_paused, filtered_human_handled, skipped_lead_paused, etc.)
          // Don't treat as ghost unless it's been too long
          const msgAge = Date.now() - new Date(msg.created_at).getTime()
          if (msgAge < 15 * 60 * 1000) continue // Under 15 min with intentional skip = fine
          // Over 15 min with intentional skip = might be stale, check further
        }

        // GHOSTED — no outbound after this inbound
        ghostsCaught++

        // Load customer
        const { data: customer } = await client
          .from('customers')
          .select('id, first_name, last_name, auto_response_paused, auto_response_disabled, sms_opt_out, lifecycle_stage')
          .eq('phone_number', msg.phone_number)
          .eq('tenant_id', tenant.id)
          .maybeSingle()

        if (!customer) continue
        if (customer.sms_opt_out) continue // Don't text opted-out customers
        if (customer.auto_response_disabled) continue // Owner permanently disabled auto-text

        const customerName = customer.first_name || 'Unknown'
        const phoneShort = msg.phone_number.slice(-4)

        // Check if we already caught this ghost (don't double-alert or double-respond)
        const { data: alreadyCaught } = await client
          .from('system_events')
          .select('id')
          .eq('event_type', 'GHOST_WATCHDOG_CATCH')
          .eq('phone_number', msg.phone_number)
          .eq('tenant_id', tenant.id)
          .gte('created_at', windowStart)
          .limit(1)
          .maybeSingle()

        if (alreadyCaught) continue

        // Auto-unpause customer if paused
        if (customer.auto_response_paused) {
          await client
            .from('customers')
            .update({ auto_response_paused: false, manual_takeover_at: null })
            .eq('id', customer.id)
        }

        // Auto-unpause lead if paused
        const { data: pausedLead } = await client
          .from('leads')
          .select('id, form_data')
          .eq('phone_number', msg.phone_number)
          .eq('tenant_id', tenant.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (pausedLead) {
          const fd = typeof pausedLead.form_data === 'object' && pausedLead.form_data ? pausedLead.form_data : {}
          if ((fd as Record<string, unknown>).followup_paused) {
            await client.from('leads').update({
              form_data: { ...fd, followup_paused: false },
            }).eq('id', pausedLead.id)
          }
        }

        // Log the catch
        await logSystemEvent({
          tenant_id: tenant.id,
          source: 'ghost_watchdog',
          event_type: 'GHOST_WATCHDOG_CATCH',
          message: `Ghost detected: ${customerName} (***${phoneShort}) sent "${msg.content?.slice(0, 50)}" with no response for 5+ min`,
          phone_number: msg.phone_number,
          metadata: {
            customer_id: customer.id,
            inbound_message_id: msg.id,
            was_paused: customer.auto_response_paused,
            disposition: disposition || 'none',
            tenant_slug: tenant.slug,
          },
        })

        // 30-minute cooldown: don't auto-respond if we already sent an AI response
        // to this customer in the last 30 minutes (prevents rapid-fire AI texts)
        const cooldownCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
        const { data: recentAiResponse } = await client
          .from('messages')
          .select('id')
          .eq('phone_number', msg.phone_number)
          .eq('tenant_id', tenant.id)
          .eq('direction', 'outbound')
          .eq('ai_generated', true)
          .gte('created_at', cooldownCutoff)
          .limit(1)
          .maybeSingle()

        if (recentAiResponse) {
          console.log(`[ghost-watchdog] Skipping AI response for ***${phoneShort}: already sent AI text within 30 min`)
          continue
        }

        // Actually send an AI response (don't just unpause and wait)
        let aiSent = false
        try {
          // Get conversation history
          const { data: recentMessages } = await client
            .from('messages')
            .select('role, content')
            .eq('phone_number', msg.phone_number)
            .eq('tenant_id', tenant.id)
            .order('timestamp', { ascending: false })
            .limit(20)

          const conversationHistory = recentMessages?.reverse().map(m => ({
            role: m.role as 'client' | 'assistant',
            content: m.content,
          })) || []

          const customerCtx = await loadCustomerContext(client, tenant.id, msg.phone_number, customer.id)
          const quickIntent = await analyzeBookingIntent(msg.content || '', conversationHistory)

          const autoResponse = await generateAutoResponse(
            msg.content || '',
            quickIntent,
            tenant,
            conversationHistory,
            { firstName: customer.first_name || null, lastName: customer.last_name || null, phone: msg.phone_number, address: null, email: null, source: null },
            { customerContext: customerCtx },
          )

          if (autoResponse.shouldSend && autoResponse.response) {
            const cleaned = autoResponse.response
              .replace(/\[BOOKING_COMPLETE\]/gi, '')
              .replace(/\[ESCALATE:[^\]]*\]/gi, '')
              .replace(/\[SCHEDULE_READY\]/gi, '')
              .replace(/\[OUT_OF_AREA\]/gi, '')
              .trim()

            if (cleaned) {
              const sendResult = await sendSMS(tenant, msg.phone_number, cleaned)
              if (sendResult.success) {
                await client.from('messages').insert({
                  tenant_id: tenant.id,
                  customer_id: customer.id,
                  phone_number: msg.phone_number,
                  role: 'assistant',
                  content: cleaned,
                  direction: 'outbound',
                  message_type: 'sms',
                  ai_generated: true,
                  timestamp: new Date().toISOString(),
                  source: 'ghost_watchdog',
                  metadata: { auto_response: true, reason: 'ghost_watchdog_recovery' },
                })
                aiSent = true
                responseSent++

                // Update the original message disposition
                const { data: origMsg } = await client
                  .from('messages')
                  .select('metadata')
                  .eq('id', msg.id)
                  .single()
                if (origMsg) {
                  await client.from('messages').update({
                    metadata: { ...(origMsg.metadata || {}), disposition: 'responded_ai', recovered_by: 'ghost_watchdog' },
                  }).eq('id', msg.id)
                }

                await logSystemEvent({
                  tenant_id: tenant.id,
                  source: 'ghost_watchdog',
                  event_type: 'GHOST_WATCHDOG_RESPONSE',
                  message: `Ghost recovered: sent AI response to ${customerName} (***${phoneShort})`,
                  phone_number: msg.phone_number,
                  metadata: { customer_id: customer.id, response_preview: cleaned.slice(0, 100) },
                })
              }
            }
          }
        } catch (aiErr) {
          console.error(`[GhostWatchdog] AI response failed for ${msg.phone_number}:`, aiErr)
        }

        alerts.push(`[${tenant.slug}] ${customerName} (***${phoneShort}): "${msg.content?.slice(0, 40)}" — ${customer.auto_response_paused ? 'was PAUSED' : 'not paused'}${aiSent ? ', AI response SENT' : ', could not send AI response'}`)
      }
    } catch (err) {
      console.error(`[GhostWatchdog] Error for ${tenant.slug}:`, err)
    }
  }

  // Send Telegram alert if any ghosts caught
  if (alerts.length > 0) {
    try {
      const { sendControlTelegramMessage } = await import('@/lib/telegram-control')
      const isEscalated = ghostsCaught >= 3
      const prefix = isEscalated
        ? '🚨 <b>ESCALATED Ghost Alert</b> 🚨\n\n'
        : '<b>Ghost Watchdog Alert</b>\n\n'
      const suffix = `\n\n<i>${responseSent}/${ghostsCaught} auto-recovered with AI response.</i>`
      await sendControlTelegramMessage(DOMINIC_TELEGRAM_CHAT_ID, `${prefix}${alerts.join('\n\n')}${suffix}`)
    } catch (tgErr) {
      console.error('[GhostWatchdog] Telegram alert failed:', tgErr)
    }
  }

  console.log(`[GhostWatchdog] Done: ${ghostsCaught} ghosts found, ${responseSent} AI responses sent`)

  return NextResponse.json({
    success: true,
    ghostsCaught,
    responseSent,
    alerts: alerts.length,
  })
}
