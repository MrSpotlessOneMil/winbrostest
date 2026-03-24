import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { generateAutoResponse, loadCustomerContext, type KnownCustomerInfo } from '@/lib/auto-response'
import { analyzeBookingIntent } from '@/lib/ai-intent'
import { getTenantById } from '@/lib/tenant'
import { logSystemEvent } from '@/lib/system-events'

/**
 * ONE-TIME admin route: catch up with customers who replied to retargeting
 * messages but got no AI response due to the manual_takeover bug.
 *
 * GET  = dry run (preview who would be contacted)
 * POST = actually send responses
 *
 * DELETE THIS ROUTE after it's been run successfully.
 */

const WINBROS_TENANT_ID = 'e954fbd6-b3e1-4271-88b0-341c9df56beb'

// Negative replies that don't need a follow-up — silence was the right answer
const NEGATIVE_PATTERNS = [
  /^no\.?$/i,
  /^n\.?$/i,
  /^nope/i,
  /^nah/i,
  /^not (right now|at this time|at the moment|yet|interested|now)/i,
  /^no thank/i,
  /^no,? thank/i,
  /^thanks?,? (i|we) (don'?t|will|moved|no longer|already|washed)/i,
  /\b(don'?t live|moved|no longer need|cleaning them ourselves|not making a decision|we are good|good thanks)\b/i,
  /^thanks?\s*$/i,
]

// Additional phone numbers to include regardless of query results
const EXTRA_PHONES = ['+14242755847']

function isNegativeReply(content: string): boolean {
  const trimmed = content.trim()
  return NEGATIVE_PATTERNS.some(p => p.test(trimmed))
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { actionable, negative, extra } = await findGhostedCustomers()

  return NextResponse.json({
    dry_run: true,
    actionable: actionable.map(c => ({
      id: c.id,
      name: c.first_name,
      phone: c.phone_number,
      last_inbound: c.last_inbound,
      last_inbound_at: c.last_inbound_at,
      sequence: c.retargeting_sequence,
    })),
    negative_skipped: negative.map(c => ({
      id: c.id,
      name: c.first_name,
      last_inbound: c.last_inbound,
    })),
    extra: extra.map(c => ({
      id: c.id,
      name: c.first_name,
      phone: c.phone_number,
      last_inbound: c.last_inbound,
    })),
    counts: {
      actionable: actionable.length,
      negative_skipped: negative.length,
      extra: extra.length,
      total: actionable.length + negative.length + extra.length,
    },
  })
}

export async function POST(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const client = getSupabaseServiceClient()
  const tenant = await getTenantById(WINBROS_TENANT_ID)

  if (!tenant) {
    return NextResponse.json({ error: 'WinBros tenant not found' }, { status: 500 })
  }

  const { actionable, negative, extra } = await findGhostedCustomers()

  const results: Array<{
    id: number
    name: string | null
    phone: string
    last_inbound: string
    action: 'responded' | 'cleared' | 'error'
    ai_response?: string
    error?: string
  }> = []

  // 1. Clear flags for negative replies (no message sent)
  for (const c of negative) {
    await clearCustomerFlags(client, c.id)
    results.push({
      id: c.id,
      name: c.first_name,
      phone: c.phone_number,
      last_inbound: c.last_inbound,
      action: 'cleared',
    })
  }

  // 2. Process actionable + extra customers: clear flags, generate AI response, send
  const allActionable = [...actionable, ...extra]
  for (const c of allActionable) {
    try {
      // Clear flags first so the AI can respond to future messages too
      if (c.id > 0) {
        await clearCustomerFlags(client, c.id)
      }

      // Load conversation history (same as openphone webhook does)
      const { data: recentMessages } = await client
        .from('messages')
        .select('role, content')
        .eq('phone_number', c.phone_number)
        .eq('tenant_id', WINBROS_TENANT_ID)
        .order('timestamp', { ascending: false })
        .limit(30)

      const conversationHistory = recentMessages?.reverse().map(m => ({
        role: m.role as 'client' | 'assistant',
        content: m.content as string,
      })) || []

      // Load customer context
      let customerCtx = null
      try {
        customerCtx = await loadCustomerContext(client, WINBROS_TENANT_ID, c.phone_number, c.id)
      } catch {}

      const knownInfo: KnownCustomerInfo = {
        firstName: c.first_name || null,
        lastName: c.last_name || null,
        address: c.address || null,
        email: c.email || null,
        phone: c.phone_number,
      }

      // Inject delay context into conversation history so the AI knows to acknowledge it
      const historyWithDelay = [
        ...conversationHistory,
        {
          role: 'assistant' as const,
          content: '[SYSTEM NOTE: There was a delay in responding to the customer\'s last message. Briefly and naturally apologize for the slow reply before continuing the conversation. Keep it casual — e.g. "Hey sorry for the late reply!" — then pick up where they left off.]',
        },
      ]

      // Generate AI response
      const intent = await analyzeBookingIntent(c.last_inbound, conversationHistory)
      const autoResponse = await generateAutoResponse(
        c.last_inbound,
        intent,
        tenant,
        historyWithDelay,
        knownInfo,
        { isRetargetingReply: true, customerContext: customerCtx },
      )

      if (autoResponse.shouldSend && autoResponse.response) {
        const cleanedResponse = autoResponse.response
          .replace(/\[BOOKING_COMPLETE\]/gi, '')
          .replace(/\[BOOKING_COMPLETE:[^\]]*\]/gi, '')
          .replace(/\[SYSTEM NOTE:.*?\]/gi, '')
          .trim()

        if (cleanedResponse) {
          // Pre-insert message record
          await client.from('messages').insert({
            tenant_id: WINBROS_TENANT_ID,
            customer_id: c.id,
            phone_number: c.phone_number,
            role: 'assistant',
            content: cleanedResponse,
            direction: 'outbound',
            message_type: 'sms',
            ai_generated: true,
            timestamp: new Date().toISOString(),
            source: 'retargeting_catchup',
          })

          const smsResult = await sendSMS(tenant, c.phone_number, cleanedResponse)

          if (smsResult.success) {
            await logSystemEvent({
              source: 'admin',
              event_type: 'RETARGETING_CATCHUP_SENT',
              message: `Catch-up response sent to ${c.first_name} (${c.phone_number})`,
              tenant_id: WINBROS_TENANT_ID,
              customer_id: c.id,
              phone_number: c.phone_number,
              metadata: { last_inbound: c.last_inbound, ai_response: cleanedResponse },
            })

            results.push({
              id: c.id,
              name: c.first_name,
              phone: c.phone_number,
              last_inbound: c.last_inbound,
              action: 'responded',
              ai_response: cleanedResponse,
            })
          } else {
            results.push({
              id: c.id,
              name: c.first_name,
              phone: c.phone_number,
              last_inbound: c.last_inbound,
              action: 'error',
              error: smsResult.error || 'SMS send failed',
            })
          }
        }
      } else {
        results.push({
          id: c.id,
          name: c.first_name,
          phone: c.phone_number,
          last_inbound: c.last_inbound,
          action: 'cleared',
        })
      }
    } catch (err) {
      results.push({
        id: c.id,
        name: c.first_name,
        phone: c.phone_number,
        last_inbound: c.last_inbound,
        action: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return NextResponse.json({
    success: true,
    results,
    summary: {
      responded: results.filter(r => r.action === 'responded').length,
      cleared: results.filter(r => r.action === 'cleared').length,
      errors: results.filter(r => r.action === 'error').length,
    },
  })
}

async function clearCustomerFlags(client: ReturnType<typeof getSupabaseServiceClient>, customerId: number) {
  await client
    .from('customers')
    .update({
      auto_response_paused: false,
      manual_takeover_at: null,
    })
    .eq('id', customerId)
}

interface GhostedCustomer {
  id: number
  first_name: string | null
  last_name: string | null
  phone_number: string
  address: string | null
  email: string | null
  retargeting_sequence: string | null
  last_inbound: string
  last_inbound_at: string
}

async function findGhostedCustomers() {
  const client = getSupabaseServiceClient()

  // Find customers who were retargeted, got manual_takeover'd,
  // and their last message is an unanswered inbound
  const { data: candidates } = await client.rpc('find_ghosted_retargeting_customers', {
    p_tenant_id: WINBROS_TENANT_ID,
  })

  // If RPC doesn't exist, fall back to direct query
  let ghosted: GhostedCustomer[] = []

  if (!candidates) {
    // Direct query fallback
    const { data: customers } = await client
      .from('customers')
      .select('id, first_name, last_name, phone_number, address, email, retargeting_sequence, retargeting_stopped_reason')
      .eq('tenant_id', WINBROS_TENANT_ID)
      .eq('retargeting_stopped_reason', 'manual_takeover')

    if (customers) {
      for (const c of customers) {
        // Get last inbound and last outbound timestamps
        const { data: lastInbound } = await client
          .from('messages')
          .select('content, created_at')
          .eq('phone_number', c.phone_number)
          .eq('tenant_id', WINBROS_TENANT_ID)
          .eq('direction', 'inbound')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const { data: lastOutbound } = await client
          .from('messages')
          .select('created_at')
          .eq('phone_number', c.phone_number)
          .eq('tenant_id', WINBROS_TENANT_ID)
          .eq('direction', 'outbound')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        // Only include if last inbound is after last outbound (we ghosted them)
        if (lastInbound && lastOutbound && lastInbound.created_at > lastOutbound.created_at) {
          ghosted.push({
            id: c.id,
            first_name: c.first_name,
            last_name: c.last_name,
            phone_number: c.phone_number,
            address: c.address || null,
            email: c.email || null,
            retargeting_sequence: c.retargeting_sequence,
            last_inbound: lastInbound.content,
            last_inbound_at: lastInbound.created_at,
          })
        }
      }
    }
  } else {
    ghosted = candidates as GhostedCustomer[]
  }

  // Also check extra phone numbers (test numbers for visibility)
  // These may not exist as WinBros customers — search any tenant, or create a stub entry
  const extra: GhostedCustomer[] = []
  for (const phone of EXTRA_PHONES) {
    // Skip if already in ghosted list
    if (ghosted.some(g => g.phone_number === phone)) continue

    // Look up across any tenant since test numbers may live elsewhere
    const { data: customer } = await client
      .from('customers')
      .select('id, first_name, last_name, phone_number, address, email, retargeting_sequence, tenant_id')
      .eq('phone_number', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Use a test inbound message for extra phones
    extra.push({
      id: customer?.id || 0,
      first_name: customer?.first_name || 'Test',
      last_name: customer?.last_name || null,
      phone_number: phone,
      address: null,
      email: null,
      retargeting_sequence: null,
      last_inbound: 'Yes I am interested!',
      last_inbound_at: new Date().toISOString(),
    })
  }

  // Split into actionable vs negative
  const actionable = ghosted.filter(c => !isNegativeReply(c.last_inbound))
  const negative = ghosted.filter(c => isNegativeReply(c.last_inbound))

  return { actionable, negative, extra }
}
