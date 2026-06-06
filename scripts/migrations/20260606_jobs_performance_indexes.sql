-- 20260606_jobs_performance_indexes.sql
--
-- ROOT CAUSE
-- ----------
-- Queries against the `jobs` table sequential-scan and exceed Postgres'
-- statement_timeout (error code 57014 "canceling statement due to statement
-- timeout"). Symptoms observed:
--   * Cedar Rapids calendar blank: /api/calendar times out -> route catch
--     returns no rows -> calendar renders empty.
--   * Dashboard "never finishes loading": every Overview widget hits a
--     jobs-backed endpoint (/api/metrics x2, /api/calendar, /api/jobs ...),
--     each 6-16s or timing out.
-- Cedar Rapids surfaces first because it has the most rows (recurring jobs
-- generated out to 2027); Spotless is already on the edge (~6.5s).
--
-- Measured (read-only, production):
--   tenant filter only, LIMIT 1 ............ 6.4s
--   tenant filter + ORDER BY date, LIMIT 1 . 11.0s   <- no usable (tenant_id,date) index
--   tenant filter + ORDER BY id (PK) ....... 1.8s    <- PK index works
--   light windowed query, LIMIT 2000 ....... timeout (57014)
--
-- The indexes below are DEFINED in scripts/01-schema.sql but are missing,
-- unused, or bloated in the production database.
--
-- HOW TO RUN (Supabase SQL editor)
-- --------------------------------
--   1. Run PART 1 and read the output (tells us missing vs. bloated).
--   2. Run each PART 2 statement INDIVIDUALLY. CREATE INDEX CONCURRENTLY
--      cannot run inside a transaction block, so do not wrap these in BEGIN/COMMIT
--      and do not run them all in one multi-statement batch if your client wraps
--      batches in a transaction.
--   3. Run PART 3 (ANALYZE).
--   4. PART 4 is CONDITIONAL — only if PART 1 shows the indexes already existed
--      (i.e. they are bloated, not missing) and/or dead-tuple % is high.
--   5. Re-run the EXPLAIN in PART 1c to confirm an Index Scan (not Seq Scan)
--      and sub-second timing.


-- ============================================================================
-- PART 1 — DIAGNOSE (read-only, safe)
-- ============================================================================

-- 1a. Which indexes currently exist on jobs?
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'jobs'
ORDER BY indexname;

-- 1b. Table size, dead-tuple bloat, and last (auto)vacuum/analyze.
SELECT
  pg_size_pretty(pg_total_relation_size('jobs')) AS total_size,
  n_live_tup,
  n_dead_tup,
  CASE WHEN n_live_tup > 0
       THEN round(100.0 * n_dead_tup / n_live_tup, 1)
       ELSE 0 END AS dead_pct,
  last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
FROM pg_stat_user_tables
WHERE relname = 'jobs';

-- 1c. Is the real calendar query seq-scanning? (Cedar Rapids tenant_id shown.)
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id, date, status
FROM jobs
WHERE tenant_id = '583eee3f-fc92-431b-b555-8f0ea5fe42c7'
  AND status IN ('scheduled', 'in_progress', 'completed')
  AND date >= '2026-04-06'::date
  AND date <= '2027-02-06'::date
ORDER BY date ASC
LIMIT 2000;


-- ============================================================================
-- PART 2 — ENSURE INDEXES (run EACH statement individually)
-- ============================================================================
-- CONCURRENTLY = builds without locking the table against writes.
-- IF NOT EXISTS = no-op if the (same-named) index already exists.

-- Primary fix for the calendar query (tenant + date range + ORDER BY date):
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_date
  ON jobs (tenant_id, date);

-- Plain tenant lookups:
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_tenant
  ON jobs (tenant_id);

-- Status-filtered tenant lookups:
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_status
  ON jobs (tenant_id, status);

-- Supports /api/metrics completed_at range (and follow-up crons):
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_tenant_completed_at
  ON jobs (tenant_id, completed_at);


-- ============================================================================
-- PART 3 — REFRESH PLANNER STATISTICS
-- ============================================================================
-- If the indexes already existed but the planner chose Seq Scan, stale stats
-- are a likely cause. ANALYZE is cheap and safe.
ANALYZE jobs;


-- ============================================================================
-- PART 4 — CONDITIONAL: rebuild bloated indexes / table
-- ============================================================================
-- Only run if PART 1a showed the indexes already present (so "missing" is NOT
-- the cause) AND PART 1b shows high dead_pct or the EXPLAIN still seq-scans
-- after PART 2/3. REINDEX ... CONCURRENTLY avoids locking (Postgres 12+).
--
--   REINDEX TABLE CONCURRENTLY jobs;
--
-- If dead_pct is very high (e.g. > 20%) and autovacuum is behind:
--
--   VACUUM (ANALYZE) jobs;
--
-- (VACUUM cannot run inside a transaction block either — run it on its own.)
