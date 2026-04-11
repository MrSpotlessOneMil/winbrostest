// lib/brain/types.ts
// Shared types for the Osiris Brain knowledge system

export type SourceType = 'youtube_channel' | 'youtube_video' | 'article' | 'manual'
export type SourceStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'skipped'

export type KnowledgeDomain =
  | 'hiring' | 'pricing' | 'marketing' | 'retention' | 'quality'
  | 'scaling' | 'scheduling' | 'complaints' | 'sales' | 'operations'
  | 'legal' | 'financial' | 'tools' | 'mindset' | 'general'

export type DecisionOutcome = 'positive' | 'negative' | 'neutral' | 'pending'

export interface BrainSource {
  id: number
  source_type: SourceType
  channel_id: string | null
  channel_name: string | null
  video_id: string | null
  video_title: string | null
  video_description: string | null
  video_url: string | null
  published_at: string | null
  view_count: number | null
  like_count: number | null
  comment_count: number | null
  duration_seconds: number | null
  title: string | null
  author: string | null
  url: string | null
  status: SourceStatus
  error_message: string | null
  transcript_raw: string | null
  tags: string[]
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface BrainChunk {
  id: number
  source_id: number
  chunk_index: number
  chunk_text: string
  token_count: number | null
  timestamp_start: number | null
  timestamp_end: number | null
  domain: KnowledgeDomain | null
  sub_topics: string[]
  embedding: number[] | null
  embedded_at: string | null
  created_at: string
}

export interface BrainDecision {
  id: number
  tenant_id: string | null
  query_text: string
  query_context: Record<string, unknown>
  decision_text: string
  reasoning: string | null
  confidence: number | null
  chunk_ids: number[]
  source_ids: number[]
  outcome: DecisionOutcome
  outcome_details: Record<string, unknown>
  outcome_recorded_at: string | null
  decision_type: string | null
  triggered_by: string | null
  created_at: string
}

export interface MatchedChunk {
  id: number
  source_id: number
  chunk_text: string
  domain: string
  sub_topics: string[]
  video_title: string | null
  channel_name: string | null
  similarity: number
}

export interface BrainQueryOptions {
  question: string
  tenantId?: string
  domain?: KnowledgeDomain
  maxChunks?: number
  minSimilarity?: number
  businessContext?: Record<string, unknown>
  decisionType?: string
  triggeredBy?: string
}

export interface BrainAnswer {
  answer: string
  reasoning: string
  confidence: number
  sources: Array<{
    videoTitle: string | null
    channelName: string | null
    chunkText: string
    similarity: number
  }>
  decisionId: number | null
}

export interface YouTubeVideoMeta {
  videoId: string
  title: string
  description: string
  publishedAt: string
  channelId: string
  channelTitle: string
  viewCount: number
  likeCount: number
  commentCount: number
  duration: string
  durationSeconds: number
}

export const CHUNK_CONFIG = {
  maxTokens: 800,
  overlapTokens: 100,
  maxChars: 3200,
  overlapChars: 400,
} as const

export const DOMAIN_CLASSIFICATION_PROMPT = `Classify this cleaning business content into exactly ONE domain:
- hiring: recruiting, managing, training, firing cleaners/employees
- pricing: setting prices, quotes, estimates, discounts, upsells
- marketing: advertising, social media, SEO, referrals, lead generation
- retention: keeping customers, follow-ups, loyalty, reviews
- quality: cleaning standards, inspection, complaints handling, supplies
- scaling: growing revenue, adding locations, systems, delegation
- scheduling: route optimization, booking, calendar management
- complaints: handling unhappy customers, refunds, damage
- sales: closing leads, objection handling, phone/text sales
- operations: day-to-day running, software, processes, insurance
- legal: contracts, liability, business formation, compliance
- financial: bookkeeping, taxes, cash flow, profit margins
- tools: software, apps, equipment recommendations
- mindset: motivation, entrepreneur mindset, work-life balance
- general: doesn't fit above categories

Return ONLY the domain name, nothing else.`
