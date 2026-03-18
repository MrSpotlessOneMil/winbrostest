/**
 * Osiris Brain - ML-powered customer scoring engine
 *
 * Analyzes conversation history, job outcomes, and behavioral patterns
 * to compute actionable scores for every customer. Recomputed nightly
 * by the osiris-learn cron, consumed by the Inbox and automation systems.
 */

import { getSupabaseServiceClient } from './supabase'
import { analyzeSimpleSentiment } from './lifecycle-engine'

// ---- Types ----

interface RawMessage {
  customer_id: number
  direction: string
  role: string
  content: string | null
  timestamp: string
  ai_generated: boolean
  source: string | null
}

interface RawJob {
  customer_id: number
  status: string
  created_at: string
}

interface RawQuote {
  customer_id: number
  status: string
}

interface CustomerRow {
  id: number
  phone_number: string | null
  sms_opt_out: boolean | null
  retargeting_replied_at: string | null
  created_at: string | null
  auto_response_paused: boolean | null
}

export interface CustomerScore {
  tenant_id: string
  customer_id: number
  lead_score: number
  best_contact_hour: number | null
  response_likelihood: number
  churn_risk: number
  lifetime_value: number
  segment: string
  scoring_factors: Record<string, any>
  scored_at: string
}

// ---- Main entry point ----

/**
 * Score all customers for a tenant. Called by the nightly cron.
 * Returns the number of customers scored.
 */
export async function scoreAllCustomers(tenantId: string): Promise<number> {
  const client = getSupabaseServiceClient()
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  // 1. Get all customers (batch in chunks of 500 for large tenants)
  const { data: customers, error: custErr } = await client
    .from('customers')
    .select('id, phone_number, sms_opt_out, retargeting_replied_at, created_at, auto_response_paused')
    .eq('tenant_id', tenantId)

  if (custErr || !customers?.length) {
    console.log(`[osiris-brain] No customers for tenant ${tenantId}: ${custErr?.message || 'empty'}`)
    return 0
  }

  // Process in chunks to avoid query size limits
  const CHUNK_SIZE = 500
  const allScores: CustomerScore[] = []

  for (let i = 0; i < customers.length; i += CHUNK_SIZE) {
    const chunk = customers.slice(i, i + CHUNK_SIZE)
    const chunkIds = chunk.map(c => c.id)

    // 2. Batch-fetch messages (last 90 days)
    const { data: messages } = await client
      .from('messages')
      .select('customer_id, direction, role, content, timestamp, ai_generated, source')
      .in('customer_id', chunkIds)
      .eq('tenant_id', tenantId)
      .gte('timestamp', ninetyDaysAgo)
      .order('timestamp', { ascending: false })
      .limit(5000)

    // 3. Batch-fetch jobs
    const { data: jobs } = await client
      .from('jobs')
      .select('customer_id, status, created_at')
      .in('customer_id', chunkIds)
      .eq('tenant_id', tenantId)

    // 4. Batch-fetch quotes
    const { data: quotes } = await client
      .from('quotes')
      .select('customer_id, status')
      .in('customer_id', chunkIds)
      .eq('tenant_id', tenantId)

    // 5. Batch-fetch lead sources (by phone)
    const phones = chunk.map(c => c.phone_number).filter(Boolean) as string[]
    const { data: leads } = phones.length > 0
      ? await client
          .from('leads')
          .select('phone_number, source')
          .in('phone_number', phones)
          .eq('tenant_id', tenantId)
      : { data: [] }

    // Group data by customer
    const msgMap = groupBy(messages || [], 'customer_id')
    const jobMap = groupBy(jobs || [], 'customer_id')
    const quoteMap = groupBy(quotes || [], 'customer_id')
    const leadSrcMap = new Map((leads || []).map((l: any) => [l.phone_number, l.source]))

    // 6. Score each customer
    for (const cust of chunk) {
      const msgs = (msgMap[cust.id] || []) as RawMessage[]
      const custJobs = (jobMap[cust.id] || []) as RawJob[]
      const custQuotes = (quoteMap[cust.id] || []) as RawQuote[]
      const leadSource = leadSrcMap.get(cust.phone_number || '') || null

      const score = computeCustomerScore(cust, msgs, custJobs, custQuotes, leadSource)

      allScores.push({
        tenant_id: tenantId,
        customer_id: cust.id,
        ...score,
        scored_at: new Date().toISOString(),
      })
    }
  }

  // 7. Batch upsert scores
  for (let i = 0; i < allScores.length; i += 200) {
    const batch = allScores.slice(i, i + 200)
    const { error } = await client
      .from('customer_scores')
      .upsert(batch, { onConflict: 'tenant_id,customer_id' })

    if (error) {
      console.error(`[osiris-brain] Upsert error (batch ${i}):`, error.message)
    }
  }

  console.log(`[osiris-brain] Scored ${allScores.length} customers for tenant ${tenantId}`)
  return allScores.length
}

// ---- Scoring functions ----

function computeCustomerScore(
  cust: CustomerRow,
  msgs: RawMessage[],
  jobs: RawJob[],
  quotes: RawQuote[],
  leadSource: string | null,
): Omit<CustomerScore, 'tenant_id' | 'customer_id' | 'scored_at'> {
  const factors: Record<string, any> = {}

  // Lead score
  const lead_score = computeLeadScore(cust, msgs, jobs, quotes, leadSource, factors)

  // Best contact hour
  const best_contact_hour = computeBestContactHour(msgs, factors)

  // Response likelihood
  const response_likelihood = computeResponseLikelihood(msgs, factors)

  // Churn risk
  const churn_risk = computeChurnRisk(msgs, jobs, factors)

  // Lifetime value (count of completed jobs as proxy - no price column)
  const completedJobs = jobs.filter(j => j.status === 'completed')
  const lifetime_value = completedJobs.length
  factors.completed_jobs = completedJobs.length

  // Segment
  const segment = computeSegment(cust, msgs, jobs, quotes, factors)

  return {
    lead_score,
    best_contact_hour,
    response_likelihood,
    churn_risk,
    lifetime_value,
    segment,
    scoring_factors: factors,
  }
}

/**
 * Lead Score (0-100): How likely is this person to book?
 */
function computeLeadScore(
  cust: CustomerRow,
  msgs: RawMessage[],
  jobs: RawJob[],
  quotes: RawQuote[],
  leadSource: string | null,
  factors: Record<string, any>,
): number {
  let score = 10 // base

  // Source quality
  const src = (leadSource || '').toLowerCase()
  let srcBonus = 5
  if (['phone', 'vapi'].includes(src)) srcBonus = 15
  else if (src === 'sms') srcBonus = 12
  else if (['meta', 'website', 'email'].includes(src)) srcBonus = 8
  else if (src === 'housecall_pro') srcBonus = 10
  score += srcBonus
  factors.source = { value: src || 'unknown', bonus: srcBonus }

  // Engagement: inbound message count
  const inbound = msgs.filter(m => m.direction === 'inbound' && m.role === 'client')
  let engagementBonus = 0
  if (inbound.length >= 10) engagementBonus = 15
  else if (inbound.length >= 5) engagementBonus = 10
  else if (inbound.length >= 2) engagementBonus = 5
  score += engagementBonus
  factors.engagement = { inbound_count: inbound.length, bonus: engagementBonus }

  // Response speed: avg time to reply to our outbound
  const outboundTimes = msgs
    .filter(m => m.direction === 'outbound')
    .map(m => new Date(m.timestamp).getTime())
    .sort((a, b) => a - b)
  const inboundTimes = msgs
    .filter(m => m.direction === 'inbound')
    .map(m => new Date(m.timestamp).getTime())
    .sort((a, b) => a - b)

  const responseTimes: number[] = []
  for (const out of outboundTimes) {
    const next = inboundTimes.find(t => t > out && t - out < 24 * 60 * 60 * 1000)
    if (next) responseTimes.push(next - out)
  }

  let speedBonus = 0
  if (responseTimes.length > 0) {
    const avgMin = (responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) / 60000
    if (avgMin < 5) speedBonus = 15
    else if (avgMin < 30) speedBonus = 10
    else if (avgMin < 120) speedBonus = 5
    factors.response_speed = { avg_minutes: Math.round(avgMin), bonus: speedBonus }
  }
  score += speedBonus

  // Buying signals in messages
  const allContent = inbound.map(m => (m.content || '').toLowerCase()).join(' ')
  const buyingPattern = /\b(yes|yeah|interested|how much|price|quote|schedule|book|available|clean|monthly|weekly|biweekly|asap|need|want|ready|address|bedroom|bathroom)\b/i
  const hasBuyingSignals = buyingPattern.test(allContent)
  if (hasBuyingSignals) score += 15
  factors.buying_signals = hasBuyingSignals

  // Sentiment analysis
  const sentiments = inbound
    .filter(m => m.content)
    .map(m => analyzeSimpleSentiment(m.content!))
  const posCount = sentiments.filter(s => s === 'positive').length
  const negCount = sentiments.filter(s => s === 'negative').length
  const total = Math.max(sentiments.length, 1)
  const sentimentBonus = Math.round((posCount / total) * 10) - Math.round((negCount / total) * 15)
  score += sentimentBonus
  factors.sentiment = { positive: posCount, negative: negCount, neutral: sentiments.length - posCount - negCount, bonus: sentimentBonus }

  // Active job or approved quote
  const hasActiveJob = jobs.some(j => ['pending', 'scheduled', 'in_progress'].includes(j.status))
  const hasApprovedQuote = quotes.some(q => q.status === 'approved')
  if (hasActiveJob) { score += 15; factors.active_job = true }
  if (hasApprovedQuote) { score += 10; factors.approved_quote = true }

  // Retargeting reply boost
  if (cust.retargeting_replied_at) { score += 10; factors.retargeting_replied = true }

  // Penalties
  if (cust.sms_opt_out) { score -= 50; factors.opted_out = true }

  const final = Math.max(0, Math.min(100, score))
  factors.lead_score_raw = score
  return final
}

/**
 * Best Contact Hour (0-23): When does this person respond?
 */
function computeBestContactHour(
  msgs: RawMessage[],
  factors: Record<string, any>,
): number | null {
  const inbound = msgs.filter(m => m.direction === 'inbound' && m.role === 'client')
  if (inbound.length < 3) return null // not enough data

  // Count messages by hour
  const hourCounts = new Array(24).fill(0)
  for (const msg of inbound) {
    const hour = new Date(msg.timestamp).getHours()
    hourCounts[hour]++
  }

  const bestHour = hourCounts.indexOf(Math.max(...hourCounts))
  factors.best_contact_hour = { distribution: hourCounts, best: bestHour, sample_size: inbound.length }
  return bestHour
}

/**
 * Response Likelihood (0-1): Will they reply to our next message?
 */
function computeResponseLikelihood(
  msgs: RawMessage[],
  factors: Record<string, any>,
): number {
  const outbound = msgs.filter(m => m.direction === 'outbound').sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )
  const inbound = msgs.filter(m => m.direction === 'inbound').sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )

  if (outbound.length < 2) {
    factors.response_likelihood = { note: 'insufficient data', sample: outbound.length }
    return 0.5
  }

  // Count outbound messages that got a reply within 24 hours
  let replied = 0
  for (const out of outbound) {
    const outTime = new Date(out.timestamp).getTime()
    const gotReply = inbound.some(m => {
      const inTime = new Date(m.timestamp).getTime()
      return inTime > outTime && inTime - outTime < 24 * 60 * 60 * 1000
    })
    if (gotReply) replied++
  }

  const ratio = replied / outbound.length
  factors.response_likelihood = { replied, total_outbound: outbound.length, ratio: Math.round(ratio * 100) / 100 }
  return Math.round(ratio * 100) / 100
}

/**
 * Churn Risk (0-1): Is this customer slipping away?
 */
function computeChurnRisk(
  msgs: RawMessage[],
  jobs: RawJob[],
  factors: Record<string, any>,
): number {
  const completedJobs = jobs
    .filter(j => j.status === 'completed')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // No completed jobs = neutral risk
  if (completedJobs.length === 0) {
    factors.churn_risk = { note: 'no completed jobs', risk: 0.5 }
    return 0.5
  }

  let risk = 0

  // Days since last completed job (longer = higher risk)
  const daysSinceLast = (Date.now() - new Date(completedJobs[0].created_at).getTime()) / (24 * 60 * 60 * 1000)
  risk += Math.min(daysSinceLast / 90, 0.5) // caps at 0.5 from time alone

  // Recent sentiment
  const recentInbound = msgs
    .filter(m => m.direction === 'inbound' && m.content)
    .slice(0, 5)
  const recentSentiments = recentInbound.map(m => analyzeSimpleSentiment(m.content!))
  const negRatio = recentSentiments.filter(s => s === 'negative').length / Math.max(recentSentiments.length, 1)
  risk += negRatio * 0.3

  // No response to recent outbound
  const recentOutbound = msgs
    .filter(m => m.direction === 'outbound')
    .slice(0, 3)
  const recentInboundTimes = msgs
    .filter(m => m.direction === 'inbound')
    .map(m => new Date(m.timestamp).getTime())

  const unrepliedCount = recentOutbound.filter(out => {
    const outTime = new Date(out.timestamp).getTime()
    return !recentInboundTimes.some(t => t > outTime && t - outTime < 48 * 60 * 60 * 1000)
  }).length

  if (unrepliedCount >= 2) risk += 0.2

  const finalRisk = Math.min(Math.max(risk, 0), 1)
  factors.churn_risk = {
    days_since_last_job: Math.round(daysSinceLast),
    negative_sentiment_ratio: Math.round(negRatio * 100) / 100,
    unreplied_recent: unrepliedCount,
    risk: Math.round(finalRisk * 100) / 100,
  }
  return Math.round(finalRisk * 100) / 100
}

/**
 * Segment: What type of customer is this?
 */
function computeSegment(
  cust: CustomerRow,
  msgs: RawMessage[],
  jobs: RawJob[],
  quotes: RawQuote[],
  factors: Record<string, any>,
): string {
  const completedJobs = jobs.filter(j => j.status === 'completed')
  const activeJobs = jobs.filter(j => ['pending', 'scheduled', 'in_progress'].includes(j.status))
  const inbound = msgs.filter(m => m.direction === 'inbound')
  const daysSinceLastInbound = inbound.length > 0
    ? (Date.now() - new Date(inbound[0].timestamp).getTime()) / (24 * 60 * 60 * 1000)
    : 999

  let segment: string

  if (cust.sms_opt_out) {
    segment = 'opted_out'
  } else if (daysSinceLastInbound > 60 && completedJobs.length === 0) {
    segment = 'ghost'
  } else if (completedJobs.length >= 3) {
    segment = 'vip'
  } else if (completedJobs.length >= 2) {
    segment = 'recurring'
  } else if (completedJobs.length === 1) {
    segment = 'one_timer'
  } else if (activeJobs.length > 0) {
    segment = 'active'
  } else if (quotes.some(q => ['pending', 'sent'].includes(q.status))) {
    segment = 'price_shopper'
  } else if (cust.created_at && (Date.now() - new Date(cust.created_at).getTime()) < 30 * 24 * 60 * 60 * 1000) {
    segment = 'new'
  } else {
    segment = 'inactive'
  }

  factors.segment = segment
  return segment
}

// ---- Helpers ----

function groupBy<T>(arr: T[], key: string): Record<number, T[]> {
  const map: Record<number, T[]> = {}
  for (const item of arr) {
    const k = (item as any)[key]
    if (k == null) continue
    if (!map[k]) map[k] = []
    map[k].push(item)
  }
  return map
}
