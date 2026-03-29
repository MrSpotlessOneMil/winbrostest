# Osiris Brain — Autonomous Cleaning Business Intelligence System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a RAG-powered knowledge system that ingests cleaning industry expertise from YouTube creators, structures it into operational intelligence, and integrates into the Osiris stack so every AI decision (VAPI calls, SMS responses, scheduling, pricing) is backed by deep industry knowledge.

**Architecture:** Three-layer system: (1) Knowledge Layer — YouTube transcripts chunked, embedded with OpenAI text-embedding-3-small, stored in Supabase pgvector. (2) Reasoning Layer — Brain query API that retrieves relevant knowledge chunks, combines with live business context, and uses Claude to produce decisions. (3) Feedback Layer — Every Brain decision is logged with outcomes so the system learns what actually works for Spotless Scrubbers vs. what gurus preach.

**Tech Stack:** Next.js 16 (existing), Supabase pgvector (already enabled), OpenAI text-embedding-3-small (already in use), Claude API (already in use), `youtube-transcript` npm package (new), YouTube Data API v3 (new, for metadata).

---

## File Structure

### New Files
| File | Purpose |
|------|---------|
| `scripts/28-brain-knowledge.sql` | DB migration: knowledge tables + similarity search RPCs |
| `lib/brain/index.ts` | Core Brain query engine (RAG retrieval + Claude reasoning) |
| `lib/brain/ingest.ts` | YouTube ingestion: metadata + transcripts + chunking |
| `lib/brain/embed.ts` | Embedding generation + storage (reuses existing OpenAI pattern) |
| `lib/brain/types.ts` | Shared types for Brain module |
| `app/api/cron/brain-ingest/route.ts` | Cron: process queued YouTube channels/videos |
| `app/api/cron/brain-embed/route.ts` | Cron: embed un-embedded chunks |
| `app/api/actions/brain-query/route.ts` | Dashboard action: ask the Brain anything |
| `app/api/actions/brain-add-source/route.ts` | Dashboard action: queue a new YouTube channel |

### Modified Files
| File | Change |
|------|--------|
| `lib/ai-responder.ts` | Inject Brain knowledge context into SMS system prompt |
| `lib/conversation-scoring.ts` | Tag Brain-assisted conversations for feedback tracking |
| `vercel.json` | Register brain-ingest and brain-embed crons |
| `package.json` | Add `youtube-transcript` dependency |

---

## Task 1: Database Migration — Knowledge Tables

**Files:**
- Create: `scripts/28-brain-knowledge.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 28-brain-knowledge.sql
-- Osiris Brain: Industry knowledge storage with vector embeddings
-- Ingests YouTube transcripts, articles, and other sources into
-- a queryable knowledge base for autonomous decision-making.

-- ── Sources ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brain_sources (
  id SERIAL PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('youtube_channel', 'youtube_video', 'article', 'manual')),

  -- YouTube-specific
  channel_id TEXT,
  channel_name TEXT,
  video_id TEXT UNIQUE,
  video_title TEXT,
  video_description TEXT,
  video_url TEXT,
  published_at TIMESTAMPTZ,
  view_count INTEGER,
  like_count INTEGER,
  comment_count INTEGER,
  duration_seconds INTEGER,

  -- General
  title TEXT,
  author TEXT,
  url TEXT,

  -- Processing state
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'skipped')),
  error_message TEXT,
  transcript_raw TEXT,

  -- Metadata
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_sources_status ON brain_sources(status);
CREATE INDEX IF NOT EXISTS idx_brain_sources_channel ON brain_sources(channel_id);
CREATE INDEX IF NOT EXISTS idx_brain_sources_video ON brain_sources(video_id);

-- ── Knowledge Chunks ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brain_chunks (
  id SERIAL PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES brain_sources(id) ON DELETE CASCADE,

  -- Chunk content
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  token_count INTEGER,

  -- Temporal reference (from transcript timestamps)
  timestamp_start REAL,
  timestamp_end REAL,

  -- Domain tagging (set by AI during ingestion)
  domain TEXT CHECK (domain IN (
    'hiring', 'pricing', 'marketing', 'retention', 'quality',
    'scaling', 'scheduling', 'complaints', 'sales', 'operations',
    'legal', 'financial', 'tools', 'mindset', 'general'
  )),
  sub_topics TEXT[] DEFAULT '{}',

  -- Vector embedding
  embedding extensions.vector(1536),

  -- Processing state
  embedded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_chunks_source ON brain_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_brain_chunks_domain ON brain_chunks(domain);
CREATE INDEX IF NOT EXISTS idx_brain_chunks_unembedded ON brain_chunks(id) WHERE embedded_at IS NULL;

-- HNSW index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_brain_chunks_embedding ON brain_chunks
  USING hnsw (embedding extensions.vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ── Brain Decisions (feedback loop) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS brain_decisions (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,

  -- What was asked
  query_text TEXT NOT NULL,
  query_context JSONB DEFAULT '{}',

  -- What the Brain decided
  decision_text TEXT NOT NULL,
  reasoning TEXT,
  confidence REAL,

  -- Which knowledge was used
  chunk_ids INTEGER[] DEFAULT '{}',
  source_ids INTEGER[] DEFAULT '{}',

  -- Outcome tracking
  outcome TEXT CHECK (outcome IN ('positive', 'negative', 'neutral', 'pending')),
  outcome_details JSONB DEFAULT '{}',
  outcome_recorded_at TIMESTAMPTZ,

  -- Context
  decision_type TEXT, -- 'sms_response', 'pricing', 'scheduling', 'hiring', 'complaint', 'sales_objection', etc.
  triggered_by TEXT, -- 'vapi', 'sms', 'cron', 'dashboard', 'manual'

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_decisions_tenant ON brain_decisions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_brain_decisions_type ON brain_decisions(decision_type);
CREATE INDEX IF NOT EXISTS idx_brain_decisions_pending ON brain_decisions(id) WHERE outcome = 'pending';

-- ── Similarity Search RPC ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION match_brain_chunks(
  query_embedding extensions.vector(1536),
  match_threshold FLOAT DEFAULT 0.6,
  match_count INT DEFAULT 10,
  filter_domain TEXT DEFAULT NULL
)
RETURNS TABLE (
  id INT,
  source_id INT,
  chunk_text TEXT,
  domain TEXT,
  sub_topics TEXT[],
  video_title TEXT,
  channel_name TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    bc.id,
    bc.source_id,
    bc.chunk_text,
    bc.domain,
    bc.sub_topics,
    bs.video_title,
    bs.channel_name,
    (1 - (bc.embedding <=> query_embedding))::FLOAT AS similarity
  FROM brain_chunks bc
  JOIN brain_sources bs ON bs.id = bc.source_id
  WHERE bc.embedding IS NOT NULL
    AND (filter_domain IS NULL OR bc.domain = filter_domain)
    AND 1 - (bc.embedding <=> query_embedding) > match_threshold
  ORDER BY bc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

- [ ] **Step 2: Run migration against Supabase**

Run the migration via the Supabase dashboard SQL editor or CLI. Verify tables exist:

```bash
# Via supabase CLI or dashboard
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'brain_%';
-- Expected: brain_sources, brain_chunks, brain_decisions
```

- [ ] **Step 3: Commit**

```bash
git add scripts/28-brain-knowledge.sql
git commit -m "feat: add brain knowledge tables with pgvector embeddings"
```

---

## Task 2: Types and Shared Constants

**Files:**
- Create: `lib/brain/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
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

// YouTube API types
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
  duration: string // ISO 8601 duration
  durationSeconds: number
}

// Chunking config
export const CHUNK_CONFIG = {
  maxTokens: 800,
  overlapTokens: 100,
  // Rough: 1 token ~ 4 chars for English
  maxChars: 3200,
  overlapChars: 400,
} as const

// Domain classification prompt (used during ingestion)
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
```

- [ ] **Step 2: Commit**

```bash
git add lib/brain/types.ts
git commit -m "feat: add Brain module type definitions"
```

---

## Task 3: Embedding Utility

**Files:**
- Create: `lib/brain/embed.ts`

- [ ] **Step 1: Write the embedding module**

This reuses the exact same OpenAI pattern from `lib/conversation-scoring.ts` lines 188-224.

```typescript
// lib/brain/embed.ts
// Embedding generation for Brain knowledge chunks.
// Uses OpenAI text-embedding-3-small (same as conversation-scoring.ts).

import { getSupabaseServiceClient } from '../supabase'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536
const BATCH_SIZE = 20 // OpenAI supports up to 2048 inputs per request
const TIMEOUT_MS = 15_000

/**
 * Generate an embedding vector for a single text string.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn('[Brain:Embed] No OPENAI_API_KEY — skipping embedding')
    return null
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.slice(0, 8000),
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      console.error('[Brain:Embed] API error:', res.status, await res.text())
      return null
    }

    const data = await res.json()
    return data.data?.[0]?.embedding || null
  } catch (err) {
    console.error('[Brain:Embed] Failed:', err)
    return null
  }
}

/**
 * Generate embeddings for multiple texts in a single API call.
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn('[Brain:Embed] No OPENAI_API_KEY — skipping batch embedding')
    return texts.map(() => null)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)

    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts.map(t => t.slice(0, 8000)),
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      console.error('[Brain:Embed] Batch API error:', res.status)
      return texts.map(() => null)
    }

    const data = await res.json()
    const embeddings: (number[] | null)[] = texts.map(() => null)
    for (const item of data.data || []) {
      embeddings[item.index] = item.embedding
    }
    return embeddings
  } catch (err) {
    console.error('[Brain:Embed] Batch failed:', err)
    return texts.map(() => null)
  }
}

/**
 * Embed all un-embedded brain_chunks. Called by the brain-embed cron.
 * Processes in batches of BATCH_SIZE. Returns count of newly embedded chunks.
 */
export async function embedPendingChunks(limit: number = 200): Promise<number> {
  const client = getSupabaseServiceClient()

  const { data: chunks, error } = await client
    .from('brain_chunks')
    .select('id, chunk_text')
    .is('embedded_at', null)
    .order('id', { ascending: true })
    .limit(limit)

  if (error || !chunks?.length) {
    if (error) console.error('[Brain:Embed] Fetch error:', error.message)
    return 0
  }

  console.log(`[Brain:Embed] Embedding ${chunks.length} pending chunks`)
  let embedded = 0

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)
    const texts = batch.map(c => c.chunk_text)
    const embeddings = await generateEmbeddingsBatch(texts)

    for (let j = 0; j < batch.length; j++) {
      if (!embeddings[j]) continue

      const { error: updateErr } = await client
        .from('brain_chunks')
        .update({
          embedding: JSON.stringify(embeddings[j]),
          embedded_at: new Date().toISOString(),
        })
        .eq('id', batch[j].id)

      if (!updateErr) embedded++
    }

    // Brief pause between batches to respect rate limits
    if (i + BATCH_SIZE < chunks.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  console.log(`[Brain:Embed] Embedded ${embedded}/${chunks.length} chunks`)
  return embedded
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/brain/embed.ts
git commit -m "feat: add Brain embedding module with batch support"
```

---

## Task 4: YouTube Ingestion Pipeline

**Files:**
- Create: `lib/brain/ingest.ts`
- Modify: `package.json` (add youtube-transcript)

- [ ] **Step 1: Install youtube-transcript**

```bash
cd winbrostest && npm install youtube-transcript
```

- [ ] **Step 2: Write the ingestion module**

```typescript
// lib/brain/ingest.ts
// YouTube content ingestion: fetch video metadata, transcripts, chunk, and store.

import { getSupabaseServiceClient } from '../supabase'
import { CHUNK_CONFIG, DOMAIN_CLASSIFICATION_PROMPT } from './types'
import type { BrainSource, KnowledgeDomain } from './types'

// ── YouTube Transcript Fetching ─────────────────────────────────────

interface TranscriptSegment {
  text: string
  duration: number
  offset: number
  lang?: string
}

async function fetchTranscript(videoId: string): Promise<TranscriptSegment[]> {
  // Dynamic import to handle ESM module
  const { YoutubeTranscript } = await import('youtube-transcript')
  return YoutubeTranscript.fetchTranscript(videoId)
}

// ── YouTube Data API (metadata) ─────────────────────────────────────

interface YouTubeSearchItem {
  videoId: string
  title: string
  publishedAt: string
}

/**
 * List all video IDs from a YouTube channel using the Data API v3.
 * Requires YOUTUBE_API_KEY env var.
 */
export async function listChannelVideos(channelId: string): Promise<YouTubeSearchItem[]> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) throw new Error('YOUTUBE_API_KEY not configured')

  const videos: YouTubeSearchItem[] = []
  let pageToken = ''

  do {
    const params = new URLSearchParams({
      part: 'snippet',
      channelId,
      maxResults: '50',
      order: 'date',
      type: 'video',
      key: apiKey,
    })
    if (pageToken) params.set('pageToken', pageToken)

    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`)
    if (!res.ok) {
      const err = await res.text()
      console.error('[Brain:Ingest] YouTube search API error:', res.status, err)
      break
    }

    const data = await res.json()
    for (const item of data.items || []) {
      if (item.id?.videoId) {
        videos.push({
          videoId: item.id.videoId,
          title: item.snippet?.title || '',
          publishedAt: item.snippet?.publishedAt || '',
        })
      }
    }

    pageToken = data.nextPageToken || ''
  } while (pageToken)

  console.log(`[Brain:Ingest] Found ${videos.length} videos for channel ${channelId}`)
  return videos
}

/**
 * Fetch detailed metadata for a batch of video IDs.
 */
export async function fetchVideoDetails(videoIds: string[]): Promise<Record<string, {
  viewCount: number
  likeCount: number
  commentCount: number
  duration: string
  description: string
}>> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) return {}

  const results: Record<string, any> = {}

  // YouTube API accepts max 50 IDs per request
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50)
    const params = new URLSearchParams({
      part: 'statistics,contentDetails,snippet',
      id: batch.join(','),
      key: apiKey,
    })

    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`)
    if (!res.ok) continue

    const data = await res.json()
    for (const item of data.items || []) {
      results[item.id] = {
        viewCount: parseInt(item.statistics?.viewCount || '0', 10),
        likeCount: parseInt(item.statistics?.likeCount || '0', 10),
        commentCount: parseInt(item.statistics?.commentCount || '0', 10),
        duration: item.contentDetails?.duration || '',
        description: item.snippet?.description || '',
      }
    }
  }

  return results
}

/**
 * Parse ISO 8601 duration (PT1H23M45S) to seconds.
 */
function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  return (parseInt(match[1] || '0') * 3600) +
         (parseInt(match[2] || '0') * 60) +
         (parseInt(match[3] || '0'))
}

// ── Queue a Channel for Ingestion ───────────────────────────────────

/**
 * Add a YouTube channel to the ingestion queue.
 * Discovers all videos and creates brain_sources rows for each.
 */
export async function queueChannel(channelId: string, channelName: string): Promise<number> {
  const client = getSupabaseServiceClient()

  // Get all videos from the channel
  const videos = await listChannelVideos(channelId)
  if (!videos.length) return 0

  // Fetch detailed metadata
  const details = await fetchVideoDetails(videos.map(v => v.videoId))

  let queued = 0
  for (const video of videos) {
    const meta = details[video.videoId]

    // Skip if already exists
    const { data: existing } = await client
      .from('brain_sources')
      .select('id')
      .eq('video_id', video.videoId)
      .maybeSingle()

    if (existing) continue

    const { error } = await client
      .from('brain_sources')
      .insert({
        source_type: 'youtube_video',
        channel_id: channelId,
        channel_name: channelName,
        video_id: video.videoId,
        video_title: video.title,
        video_description: meta?.description || null,
        video_url: `https://www.youtube.com/watch?v=${video.videoId}`,
        published_at: video.publishedAt || null,
        view_count: meta?.viewCount || null,
        like_count: meta?.likeCount || null,
        comment_count: meta?.commentCount || null,
        duration_seconds: meta?.duration ? parseDuration(meta.duration) : null,
        title: video.title,
        author: channelName,
        status: 'queued',
      })

    if (!error) queued++
  }

  console.log(`[Brain:Ingest] Queued ${queued} new videos from ${channelName}`)
  return queued
}

// ── Process Queued Videos ───────────────────────────────────────────

/**
 * Process queued brain_sources: fetch transcript, chunk, classify, store.
 * Called by the brain-ingest cron.
 */
export async function processQueuedSources(limit: number = 10): Promise<number> {
  const client = getSupabaseServiceClient()

  const { data: sources, error } = await client
    .from('brain_sources')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error || !sources?.length) return 0

  let processed = 0

  for (const source of sources) {
    // Mark as processing
    await client
      .from('brain_sources')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', source.id)

    try {
      if (!source.video_id) {
        await client.from('brain_sources').update({ status: 'skipped', error_message: 'No video_id' }).eq('id', source.id)
        continue
      }

      // 1. Fetch transcript
      const segments = await fetchTranscript(source.video_id)
      if (!segments?.length) {
        await client.from('brain_sources').update({
          status: 'failed',
          error_message: 'No transcript available',
          updated_at: new Date().toISOString(),
        }).eq('id', source.id)
        continue
      }

      // 2. Combine into raw transcript
      const rawTranscript = segments.map(s => s.text).join(' ')

      // 3. Chunk the transcript
      const chunks = chunkTranscript(segments)

      // 4. Classify domains with AI (batch for efficiency)
      const domains = await classifyChunkDomains(chunks.map(c => c.text))

      // 5. Insert chunks
      const chunkRows = chunks.map((chunk, i) => ({
        source_id: source.id,
        chunk_index: i,
        chunk_text: chunk.text,
        token_count: Math.ceil(chunk.text.length / 4), // rough estimate
        timestamp_start: chunk.timestampStart,
        timestamp_end: chunk.timestampEnd,
        domain: domains[i] || 'general',
        sub_topics: [],
      }))

      const { error: insertErr } = await client
        .from('brain_chunks')
        .insert(chunkRows)

      if (insertErr) {
        console.error(`[Brain:Ingest] Chunk insert error for ${source.video_id}:`, insertErr.message)
        await client.from('brain_sources').update({
          status: 'failed',
          error_message: insertErr.message,
          updated_at: new Date().toISOString(),
        }).eq('id', source.id)
        continue
      }

      // 6. Mark source as completed
      await client.from('brain_sources').update({
        status: 'completed',
        transcript_raw: rawTranscript,
        updated_at: new Date().toISOString(),
      }).eq('id', source.id)

      processed++
      console.log(`[Brain:Ingest] Processed: ${source.video_title} (${chunks.length} chunks)`)

      // Rate limit: wait between videos to avoid YouTube blocking
      await new Promise(r => setTimeout(r, 2000))

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[Brain:Ingest] Error processing ${source.video_id}:`, message)
      await client.from('brain_sources').update({
        status: 'failed',
        error_message: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq('id', source.id)
    }
  }

  return processed
}

// ── Transcript Chunking ─────────────────────────────────────────────

interface TranscriptChunk {
  text: string
  timestampStart: number
  timestampEnd: number
}

function chunkTranscript(segments: TranscriptSegment[]): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = []
  let currentText = ''
  let currentStart = segments[0]?.offset || 0
  let currentEnd = 0

  for (const seg of segments) {
    const candidate = currentText ? `${currentText} ${seg.text}` : seg.text

    if (candidate.length > CHUNK_CONFIG.maxChars && currentText.length > 0) {
      // Save current chunk
      chunks.push({
        text: currentText.trim(),
        timestampStart: currentStart,
        timestampEnd: currentEnd,
      })

      // Start new chunk with overlap: include last ~400 chars
      const overlapStart = currentText.length - CHUNK_CONFIG.overlapChars
      if (overlapStart > 0) {
        currentText = currentText.slice(overlapStart) + ' ' + seg.text
      } else {
        currentText = seg.text
      }
      currentStart = seg.offset
    } else {
      currentText = candidate
    }
    currentEnd = seg.offset + seg.duration
  }

  // Don't forget the last chunk
  if (currentText.trim()) {
    chunks.push({
      text: currentText.trim(),
      timestampStart: currentStart,
      timestampEnd: currentEnd,
    })
  }

  return chunks
}

// ── Domain Classification ───────────────────────────────────────────

async function classifyChunkDomains(chunkTexts: string[]): Promise<(KnowledgeDomain | null)[]> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) return chunkTexts.map(() => 'general')

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: anthropicKey })

    // Batch classify: send all chunks in one request for efficiency
    const numberedChunks = chunkTexts
      .map((text, i) => `[${i}] ${text.slice(0, 300)}`)
      .join('\n\n')

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `${DOMAIN_CLASSIFICATION_PROMPT}\n\nClassify each numbered chunk below. Return ONLY a JSON array of domain strings, one per chunk.\n\n${numberedChunks}`,
      }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
    const match = text.match(/\[[\s\S]*\]/)
    if (match) {
      const domains = JSON.parse(match[0]) as string[]
      return domains.map(d => d as KnowledgeDomain)
    }
  } catch (err) {
    console.error('[Brain:Ingest] Domain classification failed:', err)
  }

  return chunkTexts.map(() => 'general')
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/brain/ingest.ts package.json package-lock.json
git commit -m "feat: add YouTube ingestion pipeline with chunking and domain classification"
```

---

## Task 5: Brain Query Engine (Core RAG)

**Files:**
- Create: `lib/brain/index.ts`

- [ ] **Step 1: Write the core Brain query engine**

```typescript
// lib/brain/index.ts
// Osiris Brain — Core query engine.
// Retrieves relevant knowledge chunks via vector similarity,
// combines with business context, and uses Claude to reason.

import { getSupabaseServiceClient } from '../supabase'
import { generateEmbedding } from './embed'
import type { BrainQueryOptions, BrainAnswer, MatchedChunk } from './types'

/**
 * Ask the Brain a question. Returns a reasoned answer backed by
 * cleaning industry knowledge and (optionally) live business context.
 *
 * This is the primary interface — VAPI, SMS responder, crons, and
 * the dashboard all call this function.
 */
export async function queryBrain(opts: BrainQueryOptions): Promise<BrainAnswer> {
  const {
    question,
    tenantId,
    domain,
    maxChunks = 8,
    minSimilarity = 0.55,
    businessContext = {},
    decisionType,
    triggeredBy,
  } = opts

  // 1. Embed the question
  const embedding = await generateEmbedding(question)
  if (!embedding) {
    return fallbackAnswer('Could not generate embedding for question')
  }

  // 2. Retrieve relevant knowledge chunks
  const client = getSupabaseServiceClient()
  const { data: matches, error } = await client.rpc('match_brain_chunks', {
    query_embedding: JSON.stringify(embedding),
    match_threshold: minSimilarity,
    match_count: maxChunks,
    filter_domain: domain || null,
  })

  if (error) {
    console.error('[Brain] Similarity search failed:', error.message)
    return fallbackAnswer('Knowledge retrieval failed')
  }

  const chunks = (matches || []) as MatchedChunk[]

  // 3. Build context for Claude
  const knowledgeContext = chunks.length > 0
    ? chunks.map((c, i) =>
        `[Source ${i + 1}: ${c.channel_name || 'Unknown'} — "${c.video_title || 'Untitled'}" (${c.domain})]\n${c.chunk_text}`
      ).join('\n\n---\n\n')
    : 'No relevant knowledge found in the database. Answer from general cleaning business expertise.'

  const businessCtxStr = Object.keys(businessContext).length > 0
    ? `\n\nBusiness context:\n${JSON.stringify(businessContext, null, 2)}`
    : ''

  // 4. Ask Claude to reason
  const answer = await reasonWithClaude(question, knowledgeContext, businessCtxStr)

  // 5. Log the decision (fire-and-forget)
  const decisionId = await logDecision(client, {
    tenantId: tenantId || null,
    queryText: question,
    queryContext: businessContext,
    decisionText: answer.answer,
    reasoning: answer.reasoning,
    confidence: answer.confidence,
    chunkIds: chunks.map(c => c.id),
    sourceIds: [...new Set(chunks.map(c => c.source_id))],
    decisionType: decisionType || null,
    triggeredBy: triggeredBy || null,
  })

  return { ...answer, sources: chunks.map(c => ({
    videoTitle: c.video_title,
    channelName: c.channel_name,
    chunkText: c.chunk_text.slice(0, 200),
    similarity: c.similarity,
  })), decisionId }
}

// ── Claude Reasoning ────────────────────────────────────────────────

async function reasonWithClaude(
  question: string,
  knowledgeContext: string,
  businessContext: string
): Promise<{ answer: string; reasoning: string; confidence: number }> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    return { answer: 'AI service unavailable', reasoning: '', confidence: 0 }
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: anthropicKey })

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: `You are the Osiris Brain — an expert autonomous AI that runs cleaning businesses.
You have deep knowledge of the cleaning industry from top coaches and operators.
You make decisions that maximize profit, customer satisfaction, and operational efficiency.

Your knowledge base contains real advice from successful cleaning business owners and coaches.
Use it to inform your answers, but adapt the advice to the specific situation.

ALWAYS return a JSON object with exactly these fields:
{
  "answer": "Direct, actionable answer to the question. Be specific and practical.",
  "reasoning": "Brief explanation of WHY this is the right approach, citing which sources informed your thinking.",
  "confidence": 0.0-1.0 (how confident you are based on the available knowledge)
}

If the knowledge base doesn't cover the question well, say so honestly and give your best answer with lower confidence.`,
      messages: [{
        role: 'user',
        content: `KNOWLEDGE BASE:\n${knowledgeContext}\n${businessContext}\n\nQUESTION: ${question}`,
      }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        answer: parsed.answer || text,
        reasoning: parsed.reasoning || '',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      }
    }

    return { answer: text, reasoning: '', confidence: 0.5 }
  } catch (err) {
    console.error('[Brain] Claude reasoning failed:', err)
    return { answer: 'Reasoning failed — try again', reasoning: '', confidence: 0 }
  }
}

// ── Decision Logging ────────────────────────────────────────────────

async function logDecision(
  client: ReturnType<typeof getSupabaseServiceClient>,
  data: {
    tenantId: string | null
    queryText: string
    queryContext: Record<string, unknown>
    decisionText: string
    reasoning: string
    confidence: number
    chunkIds: number[]
    sourceIds: number[]
    decisionType: string | null
    triggeredBy: string | null
  }
): Promise<number | null> {
  try {
    const { data: row, error } = await client
      .from('brain_decisions')
      .insert({
        tenant_id: data.tenantId,
        query_text: data.queryText,
        query_context: data.queryContext,
        decision_text: data.decisionText,
        reasoning: data.reasoning,
        confidence: data.confidence,
        chunk_ids: data.chunkIds,
        source_ids: data.sourceIds,
        outcome: 'pending',
        decision_type: data.decisionType,
        triggered_by: data.triggeredBy,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[Brain] Decision log failed:', error.message)
      return null
    }
    return row?.id || null
  } catch {
    return null
  }
}

/**
 * Record the outcome of a Brain decision (feedback loop).
 */
export async function recordDecisionOutcome(
  decisionId: number,
  outcome: 'positive' | 'negative' | 'neutral',
  details: Record<string, unknown> = {}
): Promise<void> {
  const client = getSupabaseServiceClient()
  await client
    .from('brain_decisions')
    .update({
      outcome,
      outcome_details: details,
      outcome_recorded_at: new Date().toISOString(),
    })
    .eq('id', decisionId)
}

// ── Helpers ─────────────────────────────────────────────────────────

function fallbackAnswer(reason: string): BrainAnswer {
  return {
    answer: reason,
    reasoning: '',
    confidence: 0,
    sources: [],
    decisionId: null,
  }
}

// ── Quick Knowledge Stats ───────────────────────────────────────────

export async function getBrainStats(): Promise<{
  totalSources: number
  completedSources: number
  totalChunks: number
  embeddedChunks: number
  totalDecisions: number
  domainBreakdown: Record<string, number>
}> {
  const client = getSupabaseServiceClient()

  const [sources, completed, chunks, embedded, decisions] = await Promise.all([
    client.from('brain_sources').select('id', { count: 'exact', head: true }),
    client.from('brain_sources').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
    client.from('brain_chunks').select('id', { count: 'exact', head: true }),
    client.from('brain_chunks').select('id', { count: 'exact', head: true }).not('embedded_at', 'is', null),
    client.from('brain_decisions').select('id', { count: 'exact', head: true }),
  ])

  // Domain breakdown
  const { data: domainData } = await client
    .from('brain_chunks')
    .select('domain')

  const domainBreakdown: Record<string, number> = {}
  for (const row of domainData || []) {
    const d = row.domain || 'unclassified'
    domainBreakdown[d] = (domainBreakdown[d] || 0) + 1
  }

  return {
    totalSources: sources.count || 0,
    completedSources: completed.count || 0,
    totalChunks: chunks.count || 0,
    embeddedChunks: embedded.count || 0,
    totalDecisions: decisions.count || 0,
    domainBreakdown,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/brain/index.ts
git commit -m "feat: add Brain query engine with RAG retrieval, Claude reasoning, and decision logging"
```

---

## Task 6: Cron Routes — Ingestion and Embedding

**Files:**
- Create: `app/api/cron/brain-ingest/route.ts`
- Create: `app/api/cron/brain-embed/route.ts`

- [ ] **Step 1: Write the ingestion cron**

```typescript
// app/api/cron/brain-ingest/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { processQueuedSources } from '@/lib/brain/ingest'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  try {
    const processed = await processQueuedSources(5)
    return NextResponse.json({ success: true, processed })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Cron:BrainIngest] Error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Write the embedding cron**

```typescript
// app/api/cron/brain-embed/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { embedPendingChunks } from '@/lib/brain/embed'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  try {
    const embedded = await embedPendingChunks(100)
    return NextResponse.json({ success: true, embedded })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Cron:BrainEmbed] Error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/brain-ingest/route.ts app/api/cron/brain-embed/route.ts
git commit -m "feat: add brain-ingest and brain-embed cron routes"
```

---

## Task 7: Dashboard Actions — Query and Add Sources

**Files:**
- Create: `app/api/actions/brain-query/route.ts`
- Create: `app/api/actions/brain-add-source/route.ts`

- [ ] **Step 1: Write the query action**

```typescript
// app/api/actions/brain-query/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { queryBrain } from '@/lib/brain'
import type { KnowledgeDomain } from '@/lib/brain/types'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: { question: string; domain?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.question?.trim()) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 })
  }

  const answer = await queryBrain({
    question: body.question,
    tenantId: tenant.id,
    domain: (body.domain as KnowledgeDomain) || undefined,
    triggeredBy: 'dashboard',
  })

  return NextResponse.json({ success: true, ...answer })
}
```

- [ ] **Step 2: Write the add-source action**

```typescript
// app/api/actions/brain-add-source/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { queueChannel } from '@/lib/brain/ingest'
import { getBrainStats } from '@/lib/brain'

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request)
  if (authResult instanceof NextResponse) return authResult

  let body: { channelId: string; channelName: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.channelId?.trim() || !body.channelName?.trim()) {
    return NextResponse.json({ error: 'channelId and channelName are required' }, { status: 400 })
  }

  const queued = await queueChannel(body.channelId, body.channelName)
  const stats = await getBrainStats()

  return NextResponse.json({ success: true, videosQueued: queued, stats })
}

export async function GET(request: NextRequest) {
  const authResult = await requireAdmin(request)
  if (authResult instanceof NextResponse) return authResult

  const stats = await getBrainStats()
  return NextResponse.json({ success: true, stats })
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/actions/brain-query/route.ts app/api/actions/brain-add-source/route.ts
git commit -m "feat: add brain-query and brain-add-source dashboard actions"
```

---

## Task 8: Register Crons in vercel.json

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add brain crons to vercel.json**

Add these two entries to the `crons` array in `vercel.json`:

```json
{
  "path": "/api/cron/brain-ingest",
  "schedule": "*/30 * * * *"
},
{
  "path": "/api/cron/brain-embed",
  "schedule": "*/15 * * * *"
}
```

The ingestion cron runs every 30 minutes (processes 5 videos per run = ~240/day).
The embedding cron runs every 15 minutes (embeds 100 chunks per run).

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "feat: register brain-ingest and brain-embed crons"
```

---

## Task 9: Wire Brain into AI Responder

**Files:**
- Modify: `lib/ai-responder.ts`

- [ ] **Step 1: Add Brain knowledge injection to the SMS responder**

At the top of `lib/ai-responder.ts`, add the import:

```typescript
import { queryBrain } from './brain'
```

Inside `generateClaudeResponse()`, before the Claude API call, add a Brain consultation:

```typescript
// Consult the Brain for relevant industry knowledge
let brainInsight = ''
try {
  const brainResult = await queryBrain({
    question: `Customer said: "${context.incomingMessage}". What's the best approach to respond to maximize booking conversion for a cleaning business?`,
    tenantId: context.customerInfo.tenant_id as string | undefined,
    domain: 'sales',
    maxChunks: 3,
    minSimilarity: 0.5,
    triggeredBy: 'sms',
    decisionType: 'sms_response',
  })
  if (brainResult.confidence > 0.3 && brainResult.answer) {
    brainInsight = `\n\nINDUSTRY INTELLIGENCE (from top cleaning business coaches):\n${brainResult.answer}`
  }
} catch {
  // Brain unavailable — proceed without it
}
```

Then append `brainInsight` to the system prompt before sending to Claude.

- [ ] **Step 2: Commit**

```bash
git add lib/ai-responder.ts
git commit -m "feat: inject Brain knowledge into SMS AI responder"
```

---

## Task 10: Seed Initial Channels

**Files:**
- Create: `scripts/seed-brain-channels.ts`

- [ ] **Step 1: Write the seed script**

```typescript
// scripts/seed-brain-channels.ts
// One-time script to queue initial YouTube channels for Brain ingestion.
// Run with: npx tsx scripts/seed-brain-channels.ts

import { queueChannel } from '../lib/brain/ingest'

const CHANNELS = [
  // Primary targets
  { id: 'UCLLSokiR2CvvZY7i-W-VWoQ', name: 'Jazmine Tates' },
  // Add channel IDs after looking them up:
  // { id: '<channel-id>', name: 'Cleaning Launch' },
  // { id: '<channel-id>', name: 'The Professional Cleaner' },
  // { id: '<channel-id>', name: 'Angela Brown Cleaning' },
  // { id: '<channel-id>', name: 'Mike Mak' },
]

async function main() {
  console.log('Seeding Brain with YouTube channels...\n')

  for (const channel of CHANNELS) {
    try {
      const count = await queueChannel(channel.id, channel.name)
      console.log(`  ${channel.name}: ${count} videos queued`)
    } catch (err) {
      console.error(`  ${channel.name}: FAILED -`, err)
    }
  }

  console.log('\nDone. Videos will be processed by the brain-ingest cron.')
}

main().catch(console.error)
```

- [ ] **Step 2: Look up channel IDs**

To find channel IDs, visit each channel URL and use the YouTube Data API:

```bash
# Example: look up channel ID from handle
curl "https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=jazminetates&key=$YOUTUBE_API_KEY"
curl "https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=CleaningLaunch&key=$YOUTUBE_API_KEY"
curl "https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=TheProfessionalCleaner&key=$YOUTUBE_API_KEY"
```

Update the CHANNELS array with the correct IDs.

- [ ] **Step 3: Set YOUTUBE_API_KEY**

Add `YOUTUBE_API_KEY` to your Vercel environment variables and local `.env.local`:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable YouTube Data API v3
3. Create an API key (restrict to YouTube Data API v3 only)
4. Add to `.env.local`: `YOUTUBE_API_KEY=your_key_here`
5. Add to Vercel: `vercel env add YOUTUBE_API_KEY`

- [ ] **Step 4: Run the seed script**

```bash
cd winbrostest && npx tsx scripts/seed-brain-channels.ts
```

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-brain-channels.ts
git commit -m "feat: add Brain channel seed script with initial YouTube sources"
```

---

## Task 11: Build Verification

- [ ] **Step 1: Run TypeScript check**

```bash
cd winbrostest && npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 2: Run build**

```bash
cd winbrostest && npm run build
```

Fix any build errors.

- [ ] **Step 3: Verify migration locally**

Open Supabase dashboard SQL editor and run `scripts/28-brain-knowledge.sql`. Verify:

```sql
SELECT count(*) FROM brain_sources;  -- should return 0
SELECT count(*) FROM brain_chunks;   -- should return 0
SELECT count(*) FROM brain_decisions; -- should return 0
```

- [ ] **Step 4: Test Brain query with no data**

```bash
curl -X POST http://localhost:3000/api/actions/brain-query \
  -H "Content-Type: application/json" \
  -d '{"question": "How should I price a 3 bedroom house cleaning?"}'
```

Expected: returns an answer with low confidence (no knowledge loaded yet).

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve build errors for Brain module"
```

---

## Summary: What You Get

After all 11 tasks:

1. **Knowledge tables** in Supabase with pgvector for semantic search
2. **YouTube ingestion pipeline** that fetches transcripts, chunks them, classifies by domain, and embeds them
3. **Brain query API** that does RAG (retrieve knowledge → Claude reasoning → structured answer)
4. **Decision logging** with outcome tracking for the feedback loop
5. **SMS integration** — every customer text response is informed by industry expertise
6. **Dashboard endpoints** — query the Brain directly, add new YouTube channels
7. **Crons** — automatic ingestion and embedding on schedule

### Next phases (not in this plan):
- Wire Brain into VAPI call handling
- Wire Brain into scheduling/dispatch decisions
- Build feedback loop cron that analyzes which Brain decisions led to bookings vs. lost leads
- Add more source types (podcasts, articles, Reddit, forums)
- Dashboard UI for Brain stats, query interface, and source management
