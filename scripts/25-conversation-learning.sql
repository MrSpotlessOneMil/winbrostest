-- 25-conversation-learning.sql
-- AI learning system: track conversation outcomes with vector embeddings
-- for similarity search to inject winning patterns into future AI responses.

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Conversation outcomes with embeddings
CREATE TABLE IF NOT EXISTS conversation_outcomes (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,

  -- Conversation reference
  conversation_type TEXT NOT NULL CHECK (conversation_type IN ('sms', 'vapi_call')),
  source_phone TEXT,

  -- Outcome
  outcome TEXT NOT NULL CHECK (outcome IN ('won', 'lost', 'pending')),
  outcome_reason TEXT, -- 'booked', 'price_objection', 'ghosted', 'too_many_questions', 'name_refusal', 'competitor', 'not_interested', 'timing'
  revenue NUMERIC(10,2),

  -- Conversation content
  conversation_text TEXT NOT NULL,
  conversation_summary TEXT,
  message_count INTEGER DEFAULT 0,
  duration_seconds INTEGER,

  -- Vector embedding for similarity search
  embedding extensions.vector(1536),

  -- Extracted patterns
  patterns JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  conversation_started_at TIMESTAMPTZ,
  conversation_ended_at TIMESTAMPTZ,
  scored_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tenant_id, conversation_type, source_phone, conversation_started_at)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conv_outcomes_tenant ON conversation_outcomes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conv_outcomes_outcome ON conversation_outcomes(tenant_id, outcome);
CREATE INDEX IF NOT EXISTS idx_conv_outcomes_scored ON conversation_outcomes(tenant_id, scored_at DESC);

-- HNSW index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_conv_outcomes_embedding ON conversation_outcomes
  USING hnsw (embedding extensions.vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- RLS
ALTER TABLE conversation_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_conversation_outcomes ON conversation_outcomes
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Similarity search function
CREATE OR REPLACE FUNCTION match_winning_conversations(
  query_embedding extensions.vector(1536),
  p_tenant_id UUID,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id INT,
  conversation_summary TEXT,
  outcome TEXT,
  outcome_reason TEXT,
  patterns JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    co.id,
    co.conversation_summary,
    co.outcome,
    co.outcome_reason,
    co.patterns,
    (1 - (co.embedding <=> query_embedding))::FLOAT AS similarity
  FROM conversation_outcomes co
  WHERE co.tenant_id = p_tenant_id
    AND co.embedding IS NOT NULL
    AND co.outcome = 'won'
    AND 1 - (co.embedding <=> query_embedding) > match_threshold
  ORDER BY co.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
