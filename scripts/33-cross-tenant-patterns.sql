-- Cross-tenant winning conversation pattern matching
-- Allows house cleaning tenants to share winning patterns (excludes WinBros)
-- Used by findCrossTenantWinningConversations() in conversation-scoring.ts

CREATE OR REPLACE FUNCTION match_winning_conversations_cross_tenant(
  query_embedding extensions.vector(1536),
  p_tenant_ids UUID[],
  match_threshold FLOAT DEFAULT 0.65,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id INT,
  tenant_id UUID,
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
    co.id::INT,
    co.tenant_id,
    co.conversation_summary,
    co.outcome,
    co.outcome_reason,
    co.patterns,
    (1 - (co.embedding <=> query_embedding))::FLOAT AS similarity
  FROM conversation_outcomes co
  WHERE co.tenant_id = ANY(p_tenant_ids)
    AND co.embedding IS NOT NULL
    AND co.outcome = 'won'
    AND 1 - (co.embedding <=> query_embedding) > match_threshold
  ORDER BY co.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
