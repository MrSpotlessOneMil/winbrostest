-- 29-brain-hybrid-search.sql
-- Add full-text search to brain_chunks for hybrid (vector + keyword) retrieval

-- Add tsvector column for keyword search
ALTER TABLE brain_chunks ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED;

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_brain_chunks_fts ON brain_chunks USING gin(fts);

-- Hybrid search RPC: combines vector similarity with BM25 keyword relevance
-- Returns results ranked by a weighted combination of both scores
CREATE OR REPLACE FUNCTION match_brain_chunks_hybrid(
  query_text TEXT,
  query_embedding extensions.vector(1536),
  match_count INT DEFAULT 10,
  filter_domain TEXT DEFAULT NULL,
  keyword_weight FLOAT DEFAULT 0.3,
  semantic_weight FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id INT,
  source_id INT,
  chunk_text TEXT,
  domain TEXT,
  sub_topics TEXT[],
  video_title TEXT,
  channel_name TEXT,
  similarity FLOAT,
  keyword_rank FLOAT,
  combined_score FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH semantic AS (
    SELECT
      bc.id,
      bc.source_id,
      bc.chunk_text,
      bc.domain,
      bc.sub_topics,
      (1 - (bc.embedding <=> query_embedding))::FLOAT AS similarity
    FROM brain_chunks bc
    WHERE bc.embedding IS NOT NULL
      AND (filter_domain IS NULL OR bc.domain = filter_domain)
  ),
  keyword AS (
    SELECT
      bc.id,
      ts_rank_cd(bc.fts, websearch_to_tsquery('english', query_text))::FLOAT AS rank
    FROM brain_chunks bc
    WHERE bc.fts @@ websearch_to_tsquery('english', query_text)
      AND (filter_domain IS NULL OR bc.domain = filter_domain)
  ),
  combined AS (
    SELECT
      COALESCE(s.id, k.id) AS id,
      COALESCE(s.source_id, (SELECT bc2.source_id FROM brain_chunks bc2 WHERE bc2.id = k.id)) AS source_id,
      COALESCE(s.chunk_text, (SELECT bc2.chunk_text FROM brain_chunks bc2 WHERE bc2.id = k.id)) AS chunk_text,
      COALESCE(s.domain, (SELECT bc2.domain FROM brain_chunks bc2 WHERE bc2.id = k.id)) AS domain,
      COALESCE(s.sub_topics, (SELECT bc2.sub_topics FROM brain_chunks bc2 WHERE bc2.id = k.id)) AS sub_topics,
      COALESCE(s.similarity, 0)::FLOAT AS similarity,
      COALESCE(k.rank, 0)::FLOAT AS keyword_rank,
      (COALESCE(s.similarity, 0) * semantic_weight + COALESCE(k.rank, 0) * keyword_weight)::FLOAT AS combined_score
    FROM semantic s
    FULL OUTER JOIN keyword k ON s.id = k.id
    WHERE COALESCE(s.similarity, 0) > 0.4 OR COALESCE(k.rank, 0) > 0
  )
  SELECT
    c.id,
    c.source_id,
    c.chunk_text,
    c.domain,
    c.sub_topics,
    bs.video_title,
    bs.channel_name,
    c.similarity,
    c.keyword_rank,
    c.combined_score
  FROM combined c
  JOIN brain_sources bs ON bs.id = c.source_id
  ORDER BY c.combined_score DESC
  LIMIT match_count;
END;
$$;
