/**
 * Conversation Scoring Engine
 *
 * Tracks win/loss outcomes for SMS and VAPI conversations.
 * Generates embeddings (OpenAI text-embedding-3-small) and stores in pgvector
 * for similarity search. Injects winning patterns into future AI prompts.
 */

import { getSupabaseServiceClient } from './supabase'

// ── Types ────────────────────────────────────────────────────────────

interface ScoreOptions {
  tenantId: string
  customerId: number
  phone: string
  conversationType: 'sms' | 'vapi_call'
  conversationText: string
  outcome: 'won' | 'lost'
  revenue?: number
  messageCount?: number
  durationSeconds?: number
  conversationStartedAt?: string
}

interface ConversationPattern {
  summary: string
  reason: string
  patterns: {
    winning_tactics?: string[]
    losing_signals?: string[]
    customer_intent?: string
  }
}

interface WinningConversation {
  id: number
  conversation_summary: string
  outcome: string
  outcome_reason: string
  patterns: Record<string, unknown>
  similarity: number
}

// ── Core Functions ───────────────────────────────────────────────────

/**
 * Score a conversation as won or lost.
 * Generates embedding + AI analysis, stores in conversation_outcomes.
 */
export async function scoreConversation(opts: ScoreOptions): Promise<void> {
  const client = getSupabaseServiceClient()

  // Generate embedding
  const embedding = await generateEmbedding(opts.conversationText)

  // Analyze patterns with AI
  const analysis = await analyzeConversationPatterns(
    opts.conversationText,
    opts.outcome
  )

  // Upsert outcome
  const { error } = await client
    .from('conversation_outcomes')
    .upsert({
      tenant_id: opts.tenantId,
      customer_id: opts.customerId,
      conversation_type: opts.conversationType,
      source_phone: opts.phone,
      outcome: opts.outcome,
      outcome_reason: analysis.reason,
      revenue: opts.revenue || null,
      conversation_text: opts.conversationText,
      conversation_summary: analysis.summary,
      message_count: opts.messageCount || 0,
      duration_seconds: opts.durationSeconds || null,
      embedding,
      patterns: analysis.patterns,
      conversation_started_at: opts.conversationStartedAt || null,
      conversation_ended_at: new Date().toISOString(),
      scored_at: new Date().toISOString(),
    }, {
      onConflict: 'tenant_id,conversation_type,source_phone,conversation_started_at',
    })

  if (error) {
    console.error('[ConvScoring] Failed to upsert outcome:', error)
  } else {
    console.log(`[ConvScoring] Scored ${opts.outcome} for ${opts.phone} (${opts.conversationType})`)
  }
}

/**
 * Find similar past winning conversations for a given customer message.
 * Used to inject winning patterns into the AI system prompt.
 */
export async function findSimilarWinningConversations(
  tenantId: string,
  currentMessage: string,
  limit: number = 3
): Promise<WinningConversation[]> {
  const client = getSupabaseServiceClient()

  const embedding = await generateEmbedding(currentMessage)
  if (!embedding) return []

  const { data, error } = await client.rpc('match_winning_conversations', {
    query_embedding: embedding,
    p_tenant_id: tenantId,
    match_threshold: 0.65,
    match_count: limit,
  })

  if (error) {
    console.error('[ConvScoring] Similarity search failed:', error)
    return []
  }

  return (data || []) as WinningConversation[]
}

// ── Frustration Detection ────────────────────────────────────────────

interface FrustrationResult {
  frustrated: boolean
  signals: string[]
  score: number
}

/**
 * Lightweight frustration detection on incoming customer messages.
 * Returns a score 0-100 and signal list. Score >= 40 = frustrated.
 */
export function detectFrustration(
  messages: Array<{ role: string; content: string }>,
  latestMessage: string
): FrustrationResult {
  const signals: string[] = []
  let score = 0
  const lower = latestMessage.toLowerCase()

  // Repeated price ask (asked before and asking again)
  const pricePattern = /how much|what.*(cost|price|rate|charge)|pricing/
  if (pricePattern.test(lower)) {
    const priorPriceAsks = messages.filter(
      m => m.role === 'client' && pricePattern.test(m.content.toLowerCase())
    )
    if (priorPriceAsks.length >= 1) {
      signals.push('repeated_price_ask')
      score += 40
    }
  }

  // Giving up signals
  if (/nevermind|forget it|nvm|this is ridiculous|waste.*time|no thanks|not interested/.test(lower)) {
    signals.push('giving_up')
    score += 60
  }

  // Wants direct answer
  if (/just.*tell.*me|just.*answer|simple.*question|is.*relevant/.test(lower)) {
    signals.push('wants_direct_answer')
    score += 30
  }

  // Single character or very short dismissive reply
  if (latestMessage.trim().length <= 2 && messages.filter(m => m.role === 'client').length >= 3) {
    signals.push('disengaged_short_reply')
    score += 25
  }

  // Messages getting progressively shorter (disengaging)
  const clientMsgs = messages.filter(m => m.role === 'client').map(m => m.content)
  if (clientMsgs.length >= 3) {
    const lastThree = clientMsgs.slice(-3)
    if (lastThree.every((m, i) => i === 0 || m.length < lastThree[i - 1].length * 0.6)) {
      signals.push('shrinking_messages')
      score += 20
    }
  }

  return { frustrated: score >= 40, signals, score }
}

// ── Embedding Generation ─────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn('[ConvScoring] No OPENAI_API_KEY — skipping embedding')
    return null
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000), // trim to stay within limits
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      console.error('[ConvScoring] Embedding API error:', res.status)
      return null
    }

    const data = await res.json()
    return data.data?.[0]?.embedding || null
  } catch (err) {
    console.error('[ConvScoring] Embedding generation failed:', err)
    return null
  }
}

// ── Pattern Analysis ─────────────────────────────────────────────────

async function analyzeConversationPatterns(
  conversationText: string,
  outcome: 'won' | 'lost'
): Promise<ConversationPattern> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    return {
      summary: outcome === 'won' ? 'Customer booked' : 'Customer did not book',
      reason: outcome === 'won' ? 'booked' : 'unknown',
      patterns: {},
    }
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: anthropicKey })

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Analyze this ${outcome === 'won' ? 'successful' : 'failed'} home services conversation. Return ONLY a JSON object:

{
  "summary": "1-2 sentence summary of what happened",
  "reason": "one of: booked, price_objection, ghosted, too_many_questions, name_refusal, competitor, not_interested, timing, unknown",
  "patterns": {
    ${outcome === 'won'
      ? '"winning_tactics": ["list of specific things the agent did well"]'
      : '"losing_signals": ["list of specific moments where the customer was lost"]'
    },
    "customer_intent": "what the customer actually wanted"
  }
}

CONVERSATION:
${conversationText.slice(0, 4000)}

Return ONLY the JSON.`
      }],
    })

    const textContent = response.content.find(block => block.type === 'text')
    const raw = textContent?.type === 'text' ? textContent.text.trim() : ''
    const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    return JSON.parse(jsonStr) as ConversationPattern
  } catch (err) {
    console.error('[ConvScoring] Pattern analysis failed:', err)
    return {
      summary: outcome === 'won' ? 'Customer booked' : 'Customer did not book',
      reason: outcome === 'won' ? 'booked' : 'unknown',
      patterns: {},
    }
  }
}
