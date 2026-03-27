-- ============================================================================
-- 27: Multi-Tenant Google LSA Support
-- ============================================================================
-- Adds per-tenant Google LSA credentials so each tenant can have its own
-- Google account for Local Services Ads polling.
--
-- Spotless Scrubbers continues using env var fallback (columns stay NULL).
-- Cedar Rapids (and future tenants) store their own credentials here.
-- ============================================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS google_lsa_client_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS google_lsa_client_secret TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS google_lsa_refresh_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS google_lsa_account_id TEXT;

-- Index for quick lookups when routing leads by account
CREATE INDEX IF NOT EXISTS idx_tenants_lsa_account_id
  ON tenants (google_lsa_account_id)
  WHERE google_lsa_account_id IS NOT NULL;
