-- 30-brain-metadata-enrichment.sql
-- Add metadata enrichment columns for source authority weighting
-- Real business data should be weighted higher than YouTube theory

-- Source authority score (0-1): how much to trust this source
ALTER TABLE brain_sources ADD COLUMN IF NOT EXISTS authority_score REAL DEFAULT 0.5;

-- Chunk-level metadata for smarter retrieval
ALTER TABLE brain_chunks ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Is this chunk from real operational data vs external content?
ALTER TABLE brain_chunks ADD COLUMN IF NOT EXISTS is_operational BOOLEAN DEFAULT false;

-- Set authority scores: real data > guru channels > random discoveries
-- Real operational data gets highest authority
UPDATE brain_sources SET authority_score = 1.0 WHERE source_type = 'manual' AND author LIKE '%Spotless%';
UPDATE brain_sources SET authority_score = 1.0 WHERE source_type = 'manual' AND author LIKE '%Osiris Brain%';

-- Known expert channels get high authority
UPDATE brain_sources SET authority_score = 0.85 WHERE channel_name = 'Jazmine Tates';
UPDATE brain_sources SET authority_score = 0.80 WHERE channel_name = 'Angela Brown Cleaning';
UPDATE brain_sources SET authority_score = 0.80 WHERE channel_name = 'Cleaning Launch';
UPDATE brain_sources SET authority_score = 0.80 WHERE channel_name = 'The Professional Cleaner';

-- Mark operational chunks
UPDATE brain_chunks SET is_operational = true
WHERE source_id IN (SELECT id FROM brain_sources WHERE source_type = 'manual');

-- Updated similarity search that factors in authority
CREATE OR REPLACE FUNCTION match_brain_chunks_weighted(
  query_embedding extensions.vector(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10,
  filter_domain TEXT DEFAULT NULL,
  prefer_operational BOOLEAN DEFAULT false
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
  authority FLOAT,
  is_operational BOOLEAN,
  weighted_score FLOAT
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
    (1 - (bc.embedding <=> query_embedding))::FLOAT AS similarity,
    COALESCE(bs.authority_score, 0.5)::FLOAT AS authority,
    COALESCE(bc.is_operational, false) AS is_operational,
    (
      (1 - (bc.embedding <=> query_embedding)) * 0.6 +
      COALESCE(bs.authority_score, 0.5) * 0.3 +
      CASE WHEN prefer_operational AND bc.is_operational THEN 0.1 ELSE 0 END
    )::FLOAT AS weighted_score
  FROM brain_chunks bc
  JOIN brain_sources bs ON bs.id = bc.source_id
  WHERE bc.embedding IS NOT NULL
    AND (filter_domain IS NULL OR bc.domain = filter_domain)
    AND 1 - (bc.embedding <=> query_embedding) > match_threshold
  ORDER BY (
    (1 - (bc.embedding <=> query_embedding)) * 0.6 +
    COALESCE(bs.authority_score, 0.5) * 0.3 +
    CASE WHEN prefer_operational AND bc.is_operational THEN 0.1 ELSE 0 END
  ) DESC
  LIMIT match_count;
END;
$$;
