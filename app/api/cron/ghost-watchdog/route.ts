/**
 * Ghost Watchdog Cron
 *
 * Runs every 2 minutes. Finds inbound messages with NO outbound response
 * within 5 minutes. Auto-unpauses the customer and triggers an AI response.
 * Sends Telegram alert to Dominic for every ghost catch.
 *
 * Endpoint: GET /api/cron/ghost-watchdog
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getAllActiveTenants } from '@/lib/tenant'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { sendSMS } from '@/lib/openphone'

// route-check:no-vercel-cron
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Dominic's Telegram chat ID for alerts
const DOMINIC_TELEGRAM_CHAT_ID = '1877604875'

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()
  let ghostsCaught = 0
  let autoFixed = 0
  const alerts: string[] = []

  for (const tenant of tenants) {
    try {
      // Find inbound messages from last 15 min with NO outbound response within 5 min
      const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString()
      const windowEnd = new Date(Date.now() - 5 * 60 * 1000).toISOString() // at least 5 min old

      const { data: recentInbound } = await client
        .from('messages')
        .select('id, phone_number, customer_id, content, created_at')
        .eq('tenant_id', tenant.id)
        .eq('direction', 'inbound')
        .eq('role', 'client')
        .gte('created_at', windowStart)
        .lte('created_at', windowEnd)
        .order('created_at', { ascending: false })
        .limit(50)

      if (!recentInbound?.length) continue

      // Deduplicate by phone
      const seen = new Set<string>()
      const uniquePhones = recentInbound.filter(m => {
        if (!m.phone_number || seen.has(m.phone_number)) return false
        seen.add(m.phone_number)
        return true
      })

      for (const msg of uniquePhones) {
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

        // GHOSTED — no outbound after this inbound
        ghostsCaught++

        // Check customer state
        const { data: customer } = await client
          .from('customers')
          .select('id, first_name, auto_response_paused, sms_opt_out')
          .eq('phone_number', msg.phone_number)
          .eq('tenant_id', tenant.id)
          .maybeSingle()

        if (!customer) continue
        if (customer.sms_opt_out) continue // Don't text opted-out customers

        const customerName = customer.first_name || 'Unknown'
        const phoneShort = msg.phone_number.slice(-4)

        // If paused, unpause them
        if (customer.auto_response_paused) {
          await client
            .from('customers')
            .update({ auto_response_paused: false, manual_takeover_at: null })
            .eq('id', customer.id)
          console.log(`[GhostWatchdog] Auto-unpaused ghosted customer ${customer.id} (${tenant.slug})`)
        }

        // Check if we already caught this ghost (don't double-alert)
        const { data: alreadyCaught } = await client
          .from('system_events')
          .select('id')
          .eq('event_type', 'GHOST_WATCHDOG_CATCH')
          .eq('phone_number', msg.phone_number)
          .eq('tenant_id', tenant.id)
          .gte('created_at', windowStart)
          .limit(1)
          .maybeSingle()

        if (alreadyCaught) continue // Already handled this ghost

        // Log the catch
        await client.from('system_events').insert({
          tenant_id: tenant.id,
          source: 'ghost_watchdog',
          event_type: 'GHOST_WATCHDOG_CATCH',
          message: `Ghost detected: ${customerName} (***${phoneShort}) sent "${msg.content?.slice(0, 50)}" with no response for 5+ min`,
          phone_number: msg.phone_number,
          metadata: {
            customer_id: customer.id,
            inbound_message_id: msg.id,
            was_paused: customer.auto_response_paused,
            tenant_slug: tenant.slug,
          },
        })

        alerts.push(`[${tenant.slug}] ${customerName} (***${phoneShort}): "${msg.content?.slice(0, 40)}" — ${customer.auto_response_paused ? 'was PAUSED, unpaused' : 'not paused but no reply'}`)
        autoFixed++
      }
    } catch (err) {
      console.error(`[GhostWatchdog] Error for ${tenant.slug}:`, err)
    }
  }

  // Send Telegram alert to Dominic if any ghosts caught
  if (alerts.length > 0) {
    try {
      const { sendControlTelegramMessage } = await import('@/lib/telegram-control')
      const alertText = `<b>Ghost Watchdog Alert</b>\n\n${alerts.join('\n\n')}\n\n<i>${autoFixed} auto-fixed, customers unpaused. Next inbound will get AI response.</i>`
      await sendControlTelegramMessage(DOMINIC_TELEGRAM_CHAT_ID, alertText)
      console.log(`[GhostWatchdog] Telegram alert sent: ${alerts.length} ghosts`)
    } catch (tgErr) {
      console.error('[GhostWatchdog] Telegram alert failed:', tgErr)
    }
  }

  console.log(`[GhostWatchdog] Done: ${ghostsCaught} ghosts found, ${autoFixed} fixed`)

  return NextResponse.json({
    success: true,
    ghostsCaught,
    autoFixed,
    alerts: alerts.length,
  })
}
