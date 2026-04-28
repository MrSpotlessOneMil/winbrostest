-- Build 1 (HC messaging rebuild): track when rapport message was sent before quote
-- Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
--
-- The auto-response flow inserts ONE rapport / value-build turn before sending
-- the quote link. We track this per customer so the rapport only fires once per
-- lead lifecycle. Resets when customer enters retargeting (handled in code).

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS pre_quote_rapport_sent_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN customers.pre_quote_rapport_sent_at IS
  'Timestamp when AI sent the rapport+value turn before the first quote link. NULL = rapport not yet sent. Reset by retargeting service on re-enrollment.';

CREATE INDEX IF NOT EXISTS idx_customers_pre_quote_rapport_null
  ON customers (tenant_id)
  WHERE pre_quote_rapport_sent_at IS NULL;
