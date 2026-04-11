// lib/brain/curiosity.ts
// Curiosity Engine — makes the Osiris Brain actively hungry for knowledge.
// Extracts lessons from conversations, identifies knowledge gaps,
// learns from customer questions, and tracks brain growth.

import { getSupabaseServiceClient } from '../supabase'
import { generateEmbedding } from './embed'

const MAX_CONVERSATIONS_PER_RUN = 20
const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

// ── 1. Extract Lessons from Recent Conversations ──────────────────────

/**
 * Analyze recently scored conversations and extract actionable lessons.
 * WON = "what made this work?" | LOST = "what went wrong?"
 * Stores each lesson as a brain_chunk with domain='sales_learning'.
 * Tracks analyzed IDs via metadata.curiosity_source_id to prevent re-processing.
 */
export async function extractConversationLessons(): Promise<{
  analyzed: number
  won: number
  lost: number
}> {
  const client = getSupabaseServiceClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Get recently scored conversations
  const { data: recentOutcomes, error: fetchErr } = await client
    .from('conversation_outcomes')
    .select('id, outcome, conversation_summary, conversation_text, patterns, revenue, conversation_type, source_phone')
    .in('outcome', ['won', 'lost'])
    .gte('scored_at', since)
    .order('scored_at', { ascending: false })
    .limit(MAX_CONVERSATIONS_PER_RUN)

  if (fetchErr || !recentOutcomes?.length) {
    if (fetchErr) console.warn('[Brain:Curiosity] Failed to fetch recent outcomes:', fetchErr.message)
    return { analyzed: 0, won: 0, lost: 0 }
  }

  // Check which ones we already analyzed (via metadata.curiosity_source_id on brain_chunks)
  // Query all sales_learning chunks from the curiosity engine and filter in-memory
  const { data: existingChunks } = await client
    .from('brain_chunks')
    .select('metadata')
    .eq('domain', 'sales_learning')
    .not('metadata', 'is', null)

  const alreadyAnalyzed = new Set(
    (existingChunks || [])
      .map(c => {
        const meta = c.metadata as Record<string, unknown> | null
        return meta?.curiosity_source_id ? String(meta.curiosity_source_id) : null
      })
      .filter((v): v is string => v !== null)
  )

  const toAnalyze = recentOutcomes.filter(o => !alreadyAnalyzed.has(String(o.id)))
  if (!toAnalyze.length) {
    console.log('[Brain:Curiosity] All recent conversations already analyzed')
    return { analyzed: 0, won: 0, lost: 0 }
  }

  // Get or create a source for curiosity-generated chunks
  const sourceId = await getOrCreateCuriositySource(client)
  if (!sourceId) return { analyzed: 0, won: 0, lost: 0 }

  let won = 0
  let lost = 0

  for (const outcome of toAnalyze) {
    try {
      const lesson = await analyzeConversationWithHaiku(outcome)
      if (!lesson) continue

      // Generate embedding for the lesson
      const embedding = await generateEmbedding(lesson)

      const { error: insertErr } = await client
        .from('brain_chunks')
        .insert({
          source_id: sourceId,
          chunk_index: 0,
          chunk_text: lesson,
          token_count: Math.ceil(lesson.length / 4),
          domain: 'sales_learning',
          sub_topics: [
            outcome.outcome === 'won' ? 'winning_tactic' : 'losing_signal',
            outcome.conversation_type || 'sms',
            'auto_conversation_analysis',
          ],
          is_operational: true,
          metadata: {
            curiosity_source_id: outcome.id,
            outcome: outcome.outcome,
            revenue: outcome.revenue,
            conversation_type: outcome.conversation_type,
            generated_by: 'curiosity_engine',
          },
          ...(embedding ? { embedding, embedded_at: new Date().toISOString() } : {}),
        })

      if (insertErr) {
        console.warn(`[Brain:Curiosity] Failed to insert lesson for outcome ${outcome.id}:`, insertErr.message)
        continue
      }

      if (outcome.outcome === 'won') won++
      else lost++
    } catch (err) {
      console.warn(`[Brain:Curiosity] Error analyzing conversation ${outcome.id}:`, err)
    }
  }

  console.log(`[Brain:Curiosity] Extracted lessons: ${won} won, ${lost} lost`)
  return { analyzed: won + lost, won, lost }
}

// ── 2. Identify Knowledge Gaps ────────────────────────────────────────

interface KnowledgeGap {
  topic: string
  occurrences: number
  avgConfidence: number
  sampleQueries: string[]
}

/**
 * Find questions the Brain couldn't answer well (confidence < 0.5)
 * in the last 7 days. Group by topic, store as knowledge_gap chunks.
 */
export async function identifyKnowledgeGaps(): Promise<{
  gapsFound: number
  gaps: KnowledgeGap[]
}> {
  const client = getSupabaseServiceClient()
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: lowConfDecisions, error } = await client
    .from('brain_decisions')
    .select('query_text, confidence, decision_type, created_at')
    .lt('confidence', 0.5)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error || !lowConfDecisions?.length) {
    if (error) console.warn('[Brain:Curiosity] Failed to fetch low-confidence decisions:', error.message)
    return { gapsFound: 0, gaps: [] }
  }

  // Use Haiku to cluster the low-confidence queries into topics
  const gaps = await clusterKnowledgeGaps(lowConfDecisions)
  if (!gaps.length) return { gapsFound: 0, gaps: [] }

  // Store each gap as a brain_chunk
  const sourceId = await getOrCreateCuriositySource(client)
  if (!sourceId) return { gapsFound: 0, gaps: [] }

  // Delete old knowledge_gap chunks (they get refreshed each run)
  await client
    .from('brain_chunks')
    .delete()
    .eq('domain', 'knowledge_gap')
    .eq('source_id', sourceId)

  for (const gap of gaps) {
    const gapText = `KNOWLEDGE GAP — "${gap.topic}" (${gap.occurrences} occurrences, avg confidence ${gap.avgConfidence.toFixed(2)}). ` +
      `The Brain struggled to answer these types of questions well. ` +
      `Sample queries: ${gap.sampleQueries.slice(0, 3).map(q => `"${q}"`).join(', ')}. ` +
      `This topic needs more knowledge ingested to improve Brain confidence.`

    const embedding = await generateEmbedding(gapText)

    await client
      .from('brain_chunks')
      .insert({
        source_id: sourceId,
        chunk_index: 0,
        chunk_text: gapText,
        token_count: Math.ceil(gapText.length / 4),
        domain: 'knowledge_gap',
        sub_topics: [gap.topic.toLowerCase().replace(/\s+/g, '_'), 'auto_gap_detection'],
        is_operational: true,
        metadata: {
          gap_topic: gap.topic,
          occurrences: gap.occurrences,
          avg_confidence: gap.avgConfidence,
          generated_by: 'curiosity_engine',
        },
        ...(embedding ? { embedding, embedded_at: new Date().toISOString() } : {}),
      })
  }

  const gapSummary = gaps.map(g => `${g.topic} (${g.occurrences} occurrences)`).join(', ')
  console.log(`[Brain:Curiosity] Found ${gaps.length} knowledge gaps: ${gapSummary}`)

  return { gapsFound: gaps.length, gaps }
}

// ── 3. Learn from Customer Questions ──────────────────────────────────

interface FAQInsight {
  category: string
  percentage: number
  sampleQuestions: string[]
}

/**
 * Analyze what customers are asking about most frequently.
 * Queries recent inbound messages for questions, classifies them,
 * and stores the distribution as a customer_faq brain chunk.
 */
export async function analyzeCustomerQuestions(): Promise<{
  questionsAnalyzed: number
  insights: FAQInsight[]
}> {
  const client = getSupabaseServiceClient()
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Find inbound messages that look like questions
  const { data: questions, error } = await client
    .from('messages')
    .select('content, created_at')
    .eq('direction', 'inbound')
    .gte('created_at', since)
    .not('content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error || !questions?.length) {
    if (error) console.warn('[Brain:Curiosity] Failed to fetch customer messages:', error.message)
    return { questionsAnalyzed: 0, insights: [] }
  }

  // Filter to messages that are actually questions
  const questionPattern = /\?|how much|what.*cost|when.*available|do you|can you|what.*include|how.*work|where.*located|what.*price/i
  const customerQuestions = questions
    .filter(m => m.content && questionPattern.test(m.content))
    .map(m => m.content!)
    .slice(0, 100) // Cap at 100 for Haiku analysis

  if (customerQuestions.length < 5) {
    console.log('[Brain:Curiosity] Not enough customer questions to analyze (< 5)')
    return { questionsAnalyzed: 0, insights: [] }
  }

  // Use Haiku to classify question categories
  const insights = await classifyCustomerQuestions(customerQuestions)
  if (!insights.length) return { questionsAnalyzed: customerQuestions.length, insights: [] }

  // Store as a brain_chunk
  const sourceId = await getOrCreateCuriositySource(client)
  if (!sourceId) return { questionsAnalyzed: customerQuestions.length, insights: [] }

  // Delete old customer_faq chunks (refreshed each run)
  await client
    .from('brain_chunks')
    .delete()
    .eq('domain', 'customer_faq')
    .eq('source_id', sourceId)

  const faqText = `CUSTOMER FAQ INSIGHT (last 7 days, ${customerQuestions.length} questions analyzed):\n` +
    insights.map(i =>
      `- ${i.category}: ${i.percentage}% of questions. Examples: ${i.sampleQuestions.slice(0, 2).map(q => `"${q}"`).join(', ')}`
    ).join('\n') +
    `\n\nThe Brain should have strong, confident answers for the most frequently asked topics. ` +
    `Prioritize knowledge ingestion for the top categories.`

  const embedding = await generateEmbedding(faqText)

  await client
    .from('brain_chunks')
    .insert({
      source_id: sourceId,
      chunk_index: 0,
      chunk_text: faqText,
      token_count: Math.ceil(faqText.length / 4),
      domain: 'customer_faq',
      sub_topics: ['faq_distribution', 'auto_question_analysis'],
      is_operational: true,
      metadata: {
        questions_analyzed: customerQuestions.length,
        insights,
        generated_by: 'curiosity_engine',
      },
      ...(embedding ? { embedding, embedded_at: new Date().toISOString() } : {}),
    })

  const insightSummary = insights.map(i => `${i.category}(${i.percentage}%)`).join(', ')
  console.log(`[Brain:Curiosity] Customer FAQ patterns: ${insightSummary}`)

  return { questionsAnalyzed: customerQuestions.length, insights }
}

// ── 4. Competitor Intelligence Staleness ───────────────────────────────

interface CompetitorIntelStatus {
  totalChunks: number
  isStale: boolean
  newestChunkAge: number | null // days
  message: string
}

/**
 * Check if competitor intelligence is stale and flag it.
 * Does NOT scrape — just tracks staleness.
 */
export async function checkCompetitorIntel(): Promise<CompetitorIntelStatus> {
  const client = getSupabaseServiceClient()

  const { data: competitorChunks, error } = await client
    .from('brain_chunks')
    .select('id, created_at')
    .or('sub_topics.cs.{competitor_intel},sub_topics.cs.{competitor}')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.warn('[Brain:Curiosity] Failed to check competitor intel:', error.message)
    return { totalChunks: 0, isStale: true, newestChunkAge: null, message: 'Failed to check' }
  }

  const total = competitorChunks?.length || 0

  if (total === 0) {
    const msg = '[Brain:Curiosity] No competitor intelligence exists. Consider running /brain with competitor analysis queries.'
    console.log(msg)
    return { totalChunks: 0, isStale: true, newestChunkAge: null, message: msg }
  }

  const newest = competitorChunks![0]
  const ageMs = Date.now() - new Date(newest.created_at).getTime()
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000))

  const isStale = total < 10 || ageDays > 14

  if (isStale) {
    const msg = `[Brain:Curiosity] Competitor intelligence is stale (${total} chunks, newest is ${ageDays} days old). Consider running /brain with competitor analysis queries.`
    console.log(msg)
    return { totalChunks: total, isStale: true, newestChunkAge: ageDays, message: msg }
  }

  return {
    totalChunks: total,
    isStale: false,
    newestChunkAge: ageDays,
    message: `Competitor intel OK: ${total} chunks, newest ${ageDays}d old`,
  }
}

// ── 5. Brain Growth Metrics ───────────────────────────────────────────

export interface BrainGrowthReport {
  date: string
  totalChunks: number
  newChunksToday: number
  domainBreakdown: Record<string, number>
  conversationsAnalyzed: { won: number; lost: number }
  knowledgeGapsFound: number
  customerFAQPatterns: FAQInsight[]
  avgConfidence7d: number
  avgConfidencePrev7d: number
  competitorIntelStatus: CompetitorIntelStatus
}

/**
 * Generate a comprehensive brain growth report and store it in system_health.
 */
export async function generateGrowthReport(
  lessonsResult: { won: number; lost: number },
  gapsResult: { gapsFound: number },
  faqResult: { insights: FAQInsight[] },
  competitorStatus: CompetitorIntelStatus
): Promise<BrainGrowthReport> {
  const client = getSupabaseServiceClient()
  const today = new Date().toISOString().split('T')[0]
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)

  // Total chunks
  const { count: totalChunks } = await client
    .from('brain_chunks')
    .select('id', { count: 'exact', head: true })

  // New chunks today
  const { count: newChunksToday } = await client
    .from('brain_chunks')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', todayStart.toISOString())

  // Domain breakdown
  const { data: domainData } = await client
    .from('brain_chunks')
    .select('domain')

  const domainBreakdown: Record<string, number> = {}
  for (const row of domainData || []) {
    const d = (row.domain as string) || 'unclassified'
    domainBreakdown[d] = (domainBreakdown[d] || 0) + 1
  }

  // Average confidence last 7 days
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const since14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

  const { data: recentDecisions } = await client
    .from('brain_decisions')
    .select('confidence')
    .gte('created_at', since7d)
    .not('confidence', 'is', null)

  const { data: prevDecisions } = await client
    .from('brain_decisions')
    .select('confidence')
    .gte('created_at', since14d)
    .lt('created_at', since7d)
    .not('confidence', 'is', null)

  const avgConfidence7d = recentDecisions?.length
    ? recentDecisions.reduce((sum, d) => sum + (d.confidence || 0), 0) / recentDecisions.length
    : 0

  const avgConfidencePrev7d = prevDecisions?.length
    ? prevDecisions.reduce((sum, d) => sum + (d.confidence || 0), 0) / prevDecisions.length
    : 0

  const report: BrainGrowthReport = {
    date: today,
    totalChunks: totalChunks || 0,
    newChunksToday: newChunksToday || 0,
    domainBreakdown,
    conversationsAnalyzed: lessonsResult,
    knowledgeGapsFound: gapsResult.gapsFound,
    customerFAQPatterns: faqResult.insights,
    avgConfidence7d,
    avgConfidencePrev7d,
    competitorIntelStatus: competitorStatus,
  }

  // Build console summary
  const domainSummary = Object.entries(domainBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([d, c]) => `${d}(${c})`)
    .join(', ')

  const confidenceDelta = avgConfidence7d - avgConfidencePrev7d
  const confidenceArrow = confidenceDelta >= 0 ? '\u2191' : '\u2193'

  const faqSummary = faqResult.insights.length
    ? faqResult.insights.map(i => `${i.category}(${i.percentage}%)`).join(', ')
    : 'insufficient data'

  const logLines = [
    `[BRAIN GROWTH] ${today}`,
    `  Total chunks: ${report.totalChunks} (+${report.newChunksToday} today)`,
    `  Domains: ${domainSummary}`,
    `  Conversations analyzed: ${lessonsResult.won} won, ${lessonsResult.lost} lost`,
    `  Knowledge gaps found: ${gapsResult.gapsFound}`,
    `  Customer FAQ patterns: ${faqSummary}`,
    `  Brain confidence avg (7d): ${avgConfidence7d.toFixed(2)} (${confidenceArrow}${Math.abs(confidenceDelta).toFixed(2)} from last week)`,
    `  Competitor intel: ${competitorStatus.message}`,
  ]

  console.log(logLines.join('\n'))

  // Store in system_health
  const { error: healthErr } = await client.from('system_health').insert({
    check_name: 'Brain growth report',
    component: 'osiris_brain_growth',
    status: report.knowledgeGapsFound > 5 ? 'warning' : 'healthy',
    details: report as unknown as Record<string, unknown>,
    checked_at: new Date().toISOString(),
  })

  if (healthErr) {
    console.warn('[Brain:Curiosity] Failed to store growth report:', healthErr.message)
  }

  return report
}

// ── AI Helper Functions ───────────────────────────────────────────────

async function analyzeConversationWithHaiku(
  outcome: {
    id: number
    outcome: string
    conversation_summary: string | null
    conversation_text: string | null
    patterns: Record<string, unknown> | null
    revenue: number | null
    conversation_type: string | null
    source_phone: string | null
  }
): Promise<string | null> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) return null

  const isWon = outcome.outcome === 'won'
  const prompt = isWon
    ? `Analyze this SUCCESSFUL cleaning service conversation and extract the key lesson — what made this work?

Summary: ${outcome.conversation_summary || 'N/A'}
Patterns: ${JSON.stringify(outcome.patterns || {})}
Revenue: ${outcome.revenue ? `$${outcome.revenue}` : 'unknown'}
Type: ${outcome.conversation_type || 'sms'}

Return a single paragraph in this exact format:
"Successful cleaning sales tactic: [extracted lesson]. Context: [customer type], [service requested], [what the agent did right]."

Be specific and actionable. Focus on what can be replicated.`
    : `Analyze this FAILED cleaning service conversation and extract the key lesson — what went wrong?

Summary: ${outcome.conversation_summary || 'N/A'}
Patterns: ${JSON.stringify(outcome.patterns || {})}
Type: ${outcome.conversation_type || 'sms'}

Return a single paragraph in this exact format:
"Warning — this approach failed: [what happened]. Context: [customer type], [what drove them away]."

Be specific about what to avoid in future conversations.`

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: anthropicKey })

    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : null
    return text || null
  } catch (err) {
    console.warn('[Brain:Curiosity] Haiku analysis failed:', err)
    return null
  }
}

async function clusterKnowledgeGaps(
  decisions: Array<{ query_text: string; confidence: number | null; decision_type: string | null }>
): Promise<KnowledgeGap[]> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) return []

  const queryList = decisions
    .map((d, i) => `${i + 1}. "${d.query_text?.slice(0, 150)}" (confidence: ${d.confidence?.toFixed(2) || 'N/A'})`)
    .join('\n')

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: anthropicKey })

    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `These are questions that a cleaning business AI brain couldn't answer well (low confidence). Group them by topic and count occurrences.

${queryList}

Return ONLY a JSON array of objects:
[{"topic": "short topic name", "occurrences": number, "avg_confidence": number, "sample_queries": ["query1", "query2"]}]

Group similar questions together. Max 10 topics. Sort by occurrences descending.`,
      }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
    const match = text.match(/\[[\s\S]*\]/)
    if (match) {
      const parsed = JSON.parse(match[0]) as Array<{
        topic: string
        occurrences: number
        avg_confidence: number
        sample_queries: string[]
      }>
      return parsed.map(g => ({
        topic: g.topic,
        occurrences: g.occurrences,
        avgConfidence: g.avg_confidence,
        sampleQueries: g.sample_queries || [],
      }))
    }
  } catch (err) {
    console.warn('[Brain:Curiosity] Gap clustering failed:', err)
  }

  return []
}

async function classifyCustomerQuestions(questions: string[]): Promise<FAQInsight[]> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) return []

  const questionList = questions.slice(0, 50).map((q, i) => `${i + 1}. "${q.slice(0, 150)}"`).join('\n')

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: anthropicKey })

    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Classify these customer questions from a cleaning service into categories. What are they asking about most?

${questionList}

Return ONLY a JSON array sorted by percentage descending:
[{"category": "Pricing", "percentage": 40, "sample_questions": ["How much for a 3 bedroom?", "What's the price?"]}, ...]

Categories should be: Pricing, Scheduling, Inclusions, Trust/Reviews, Location/Area, Cancellation, Products/Supplies, Other`,
      }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
    const match = text.match(/\[[\s\S]*\]/)
    if (match) {
      const parsed = JSON.parse(match[0]) as Array<{
        category: string
        percentage: number
        sample_questions: string[]
      }>
      return parsed.map(i => ({
        category: i.category,
        percentage: i.percentage,
        sampleQuestions: i.sample_questions || [],
      }))
    }
  } catch (err) {
    console.warn('[Brain:Curiosity] Question classification failed:', err)
  }

  return []
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Get or create the shared brain_source for curiosity-generated chunks.
 * All curiosity engine chunks reference this single source.
 */
async function getOrCreateCuriositySource(
  client: ReturnType<typeof getSupabaseServiceClient>
): Promise<number | null> {
  const TITLE = 'curiosity_engine_auto'

  const { data: existing } = await client
    .from('brain_sources')
    .select('id')
    .eq('title', TITLE)
    .eq('source_type', 'manual')
    .maybeSingle()

  if (existing) return existing.id

  const { data: newSource, error } = await client
    .from('brain_sources')
    .insert({
      source_type: 'manual',
      title: TITLE,
      author: 'Osiris Brain Curiosity Engine',
      status: 'completed',
    })
    .select('id')
    .single()

  if (error || !newSource) {
    console.error('[Brain:Curiosity] Failed to create curiosity source:', error?.message)
    return null
  }

  return newSource.id
}
