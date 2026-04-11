-- 35-curiosity-engine.sql
-- Extends the Brain for the Curiosity Engine:
-- 1. Add new domain values (sales_learning, knowledge_gap, customer_faq)
-- 2. Index for tracking analyzed conversations via metadata

-- Drop and recreate the domain CHECK constraint to add new values
ALTER TABLE brain_chunks DROP CONSTRAINT IF EXISTS brain_chunks_domain_check;
ALTER TABLE brain_chunks ADD CONSTRAINT brain_chunks_domain_check CHECK (domain IN (
  'hiring', 'pricing', 'marketing', 'retention', 'quality',
  'scaling', 'scheduling', 'complaints', 'sales', 'operations',
  'legal', 'financial', 'tools', 'mindset', 'general',
  'sales_learning', 'knowledge_gap', 'customer_faq'
));

-- Index for curiosity engine to quickly find chunks by domain + recency
CREATE INDEX IF NOT EXISTS idx_brain_chunks_domain_created
  ON brain_chunks(domain, created_at DESC);

-- Index for finding knowledge gaps by confidence in brain_decisions
CREATE INDEX IF NOT EXISTS idx_brain_decisions_confidence
  ON brain_decisions(confidence, created_at DESC)
  WHERE confidence IS NOT NULL;
