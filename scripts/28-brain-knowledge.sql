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
  decision_type TEXT,
  triggered_by TEXT,

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
