// route-check:no-vercel-cron
/**
 * SAM Conversion Feedback Webhook
 *
 * POST /api/webhooks/sam/conversion
 * Receives outreach conversation data from SAM (outbound sales agent)
 * and feeds it into the Osiris Brain via the conversation scoring engine.
 *
 * The Brain learns from:
 * - Won conversations (prospect replied and booked)
 * - Lost conversations (prospect ghosted after 48h)
 * - Replied conversations (prospect engaged but not yet booked)
 *
 * Auth: AGENT_BRIDGE_SECRET via X-Agent-Secret header
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { scoreConversation } from '@/lib/conversation-scoring'

const SPOTLESS_TENANT_ID = '2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df'

interface OutreachMessage {
  role: 'agent' | 'prospect'
  content: string
  channel: 'email' | 'sms'
  sent_at: string
}

interface ProspectData {
  company_name?: string
  lead_type?: string
  vertical?: string
  city?: string
  score?: number
}

interface ConversionPayload {
  phone?: string
  email?: string
  outreach_messages: OutreachMessage[]
  outcome: 'won' | 'lost' | 'replied'
  revenue?: number
  prospect_data?: ProspectData
  campaign_name?: string
  variant?: string
}

export async function POST(request: NextRequest) {
  // Auth via AGENT_BRIDGE_SECRET
  const secret = request.headers.get('x-agent-secret')
  if (!secret || secret !== process.env.AGENT_BRIDGE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: ConversionPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    phone,
    email,
    outreach_messages,
    outcome,
    revenue,
    prospect_data,
    campaign_name,
    variant,
  } = body

  if (!outreach_messages?.length) {
    return NextResponse.json(
      { error: 'outreach_messages required (non-empty array)' },
      { status: 400 }
    )
  }

  if (!outcome || !['won', 'lost', 'replied'].includes(outcome)) {
    return NextResponse.json(
      { error: 'outcome must be won, lost, or replied' },
      { status: 400 }
    )
  }

  // Build conversation text in the format the scoring engine expects
  const conversationText = outreach_messages
    .map((m) => {
      const prefix = m.role === 'agent' ? 'Agent' : 'Prospect'
      return `${prefix}: ${m.content}`
    })
    .join('\n')

  // Map 'replied' to 'won' for scoring — the scoring engine only does won/lost.
  // A reply is a positive signal, so we score it as a win for pattern learning.
  const scoringOutcome: 'won' | 'lost' = outcome === 'lost' ? 'lost' : 'won'

  // Look up or create a placeholder customer_id for the phone/email
  const client = getSupabaseServiceClient()
  let customerId = 0

  if (phone) {
    const { data: customer } = await client
      .from('customers')
      .select('id')
      .eq('tenant_id', SPOTLESS_TENANT_ID)
      .eq('phone_number', phone)
      .limit(1)
      .single()

    if (customer?.id) {
      customerId = typeof customer.id === 'number' ? customer.id : Number(customer.id) || 0
    }
  }

  // Find the earliest message timestamp for conversation_started_at
  const startedAt = outreach_messages
    .map((m) => m.sent_at)
    .filter(Boolean)
    .sort()[0] || new Date().toISOString()

  try {
    await scoreConversation({
      tenantId: SPOTLESS_TENANT_ID,
      customerId,
      phone: phone || email || 'unknown',
      conversationType: 'sms', // SAM outreach is categorized as SMS-type for Brain
      conversationText,
      outcome: scoringOutcome,
      revenue: revenue || undefined,
      messageCount: outreach_messages.length,
      conversationStartedAt: startedAt,
    })

    // Also store enriched outreach metadata in brain_chunks so the Brain
    // can surface SAM campaign/variant patterns in future queries
    const outreachMeta = {
      source: 'sam_outreach',
      campaign_name: campaign_name || 'unknown',
      variant: variant || 'A',
      lead_type: prospect_data?.lead_type || 'unknown',
      vertical: prospect_data?.vertical || 'unknown',
      city: prospect_data?.city || 'unknown',
      score: prospect_data?.score || 0,
      company_name: prospect_data?.company_name || '',
      outcome,
      message_count: outreach_messages.length,
      channels: [...new Set(outreach_messages.map((m) => m.channel))],
      revenue: revenue || 0,
    }

    const chunkContent = buildBrainChunk(outreachMeta, conversationText, outcome)

    const { error: chunkError } = await client.from('brain_chunks').insert({
      tenant_id: SPOTLESS_TENANT_ID,
      source_type: 'sam_outreach',
      source_id: `sam-${outcome}-${Date.now()}`,
      content: chunkContent,
      metadata: outreachMeta,
    })

    if (chunkError) {
      console.error('[SAM Conversion] brain_chunks insert error:', chunkError.message)
    }

    console.log(
      `[SAM Conversion] Scored ${outcome} for ${phone || email || 'unknown'} ` +
      `(campaign: ${campaign_name || 'n/a'}, variant: ${variant || 'n/a'})`
    )

    return NextResponse.json({ success: true, scored: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[SAM Conversion] Scoring failed:', message)
    return NextResponse.json(
      { error: 'Scoring failed', detail: message },
      { status: 500 }
    )
  }
}

/**
 * Build a human-readable chunk for the Brain knowledge base.
 * This gets embedded and used in similarity search when the Brain
 * needs to advise on outreach strategy.
 */
function buildBrainChunk(
  meta: Record<string, unknown>,
  conversationText: string,
  outcome: string
): string {
  const lines = [
    `SAM Outbound ${outcome.toUpperCase()} - ${meta.campaign_name} (Variant ${meta.variant})`,
    `Lead: ${meta.lead_type} / ${meta.vertical} in ${meta.city}`,
    `Channels: ${(meta.channels as string[])?.join(', ') || 'unknown'}`,
    `Messages exchanged: ${meta.message_count}`,
    outcome === 'won' && meta.revenue ? `Revenue: $${meta.revenue}` : '',
    '',
    'Conversation:',
    conversationText.slice(0, 3000),
  ]
  return lines.filter(Boolean).join('\n')
}
