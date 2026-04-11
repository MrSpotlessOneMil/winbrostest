/**
 * Brain Learn + Curiosity Engine Cron
 *
 * Runs every 12 hours (6AM and 6PM UTC = 11PM and 11AM PT).
 *
 * Phase 1: Existing learning (operational insights, content discovery, transcript ingestion)
 * Phase 2: Curiosity Engine (NEW)
 *   a) Extract lessons from recently scored conversations (won/lost)
 *   b) Identify knowledge gaps (low-confidence Brain decisions)
 *   c) Analyze customer question patterns
 *   d) Check competitor intelligence staleness
 *   e) Generate brain growth report
 *
 * Each phase is non-blocking — if one fails, the rest continue.
 *
 * Endpoint: GET /api/cron/brain-learn
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { learnFromOperations, discoverNewContent, ingestVapiTranscripts, ingestWinningSmsConversations } from '@/lib/brain/learn'
import {
  extractConversationLessons,
  identifyKnowledgeGaps,
  analyzeCustomerQuestions,
  checkCompetitorIntel,
  generateGrowthReport,
} from '@/lib/brain/curiosity'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const results: Record<string, unknown> = {}

  // ── Phase 1: Existing learning ────────────────────────────────────
  try {
    results.insightsGenerated = await learnFromOperations()
  } catch (err) {
    console.warn('[Cron:BrainLearn] learnFromOperations failed:', err)
    results.insightsGenerated = { error: err instanceof Error ? err.message : 'unknown' }
  }

  try {
    results.newVideosDiscovered = await discoverNewContent()
  } catch (err) {
    console.warn('[Cron:BrainLearn] discoverNewContent failed:', err)
    results.newVideosDiscovered = { error: err instanceof Error ? err.message : 'unknown' }
  }

  try {
    results.vapiTranscriptsIngested = await ingestVapiTranscripts()
  } catch (err) {
    console.warn('[Cron:BrainLearn] ingestVapiTranscripts failed:', err)
    results.vapiTranscriptsIngested = { error: err instanceof Error ? err.message : 'unknown' }
  }

  try {
    results.smsConversationsIngested = await ingestWinningSmsConversations()
  } catch (err) {
    console.warn('[Cron:BrainLearn] ingestWinningSmsConversations failed:', err)
    results.smsConversationsIngested = { error: err instanceof Error ? err.message : 'unknown' }
  }

  // ── Phase 2: Curiosity Engine ─────────────────────────────────────
  let lessonsResult = { analyzed: 0, won: 0, lost: 0 }
  let gapsResult = { gapsFound: 0, gaps: [] as { topic: string; occurrences: number; avgConfidence: number; sampleQueries: string[] }[] }
  let faqResult = { questionsAnalyzed: 0, insights: [] as { category: string; percentage: number; sampleQuestions: string[] }[] }
  let competitorStatus = { totalChunks: 0, isStale: true, newestChunkAge: null as number | null, message: 'not checked' }

  // 2a) Extract conversation lessons
  try {
    lessonsResult = await extractConversationLessons()
    results.curiosity_lessons = lessonsResult
  } catch (err) {
    console.warn('[Cron:BrainLearn] extractConversationLessons failed:', err)
    results.curiosity_lessons = { error: err instanceof Error ? err.message : 'unknown' }
  }

  // 2b) Identify knowledge gaps
  try {
    gapsResult = await identifyKnowledgeGaps()
    results.curiosity_gaps = {
      gapsFound: gapsResult.gapsFound,
      topics: gapsResult.gaps.map(g => g.topic),
    }
  } catch (err) {
    console.warn('[Cron:BrainLearn] identifyKnowledgeGaps failed:', err)
    results.curiosity_gaps = { error: err instanceof Error ? err.message : 'unknown' }
  }

  // 2c) Analyze customer questions
  try {
    faqResult = await analyzeCustomerQuestions()
    results.curiosity_faq = {
      questionsAnalyzed: faqResult.questionsAnalyzed,
      topCategories: faqResult.insights.slice(0, 5).map(i => `${i.category}(${i.percentage}%)`),
    }
  } catch (err) {
    console.warn('[Cron:BrainLearn] analyzeCustomerQuestions failed:', err)
    results.curiosity_faq = { error: err instanceof Error ? err.message : 'unknown' }
  }

  // 2d) Check competitor intelligence staleness
  try {
    competitorStatus = await checkCompetitorIntel()
    results.curiosity_competitor = {
      isStale: competitorStatus.isStale,
      totalChunks: competitorStatus.totalChunks,
      message: competitorStatus.message,
    }
  } catch (err) {
    console.warn('[Cron:BrainLearn] checkCompetitorIntel failed:', err)
    results.curiosity_competitor = { error: err instanceof Error ? err.message : 'unknown' }
  }

  // 2e) Generate growth report
  try {
    const report = await generateGrowthReport(
      lessonsResult,
      gapsResult,
      faqResult,
      competitorStatus
    )
    results.growth_report = {
      totalChunks: report.totalChunks,
      newChunksToday: report.newChunksToday,
      avgConfidence7d: report.avgConfidence7d.toFixed(2),
      confidenceDelta: (report.avgConfidence7d - report.avgConfidencePrev7d).toFixed(2),
    }
  } catch (err) {
    console.warn('[Cron:BrainLearn] generateGrowthReport failed:', err)
    results.growth_report = { error: err instanceof Error ? err.message : 'unknown' }
  }

  return NextResponse.json({ success: true, ...results })
}
