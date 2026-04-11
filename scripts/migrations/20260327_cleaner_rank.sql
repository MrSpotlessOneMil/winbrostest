-- Add rank column to cleaners table for ranked assignment mode
-- Lower rank = higher priority (rank 1 is best). NULL = unranked (sorted last).
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS rank INTEGER;

CREATE INDEX IF NOT EXISTS idx_cleaners_rank
  ON cleaners(tenant_id, rank)
  WHERE rank IS NOT NULL AND active = TRUE AND deleted_at IS NULL;
