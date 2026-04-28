-- Build 2 (HC follow-ups + retargeting rebuild): schema additions
-- Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
-- Source spec: clean_machine_rebuild/04_FOLLOW_UPS.md + 07_RETARGETING.md
--
-- Additive only — no destructive changes. Backwards-compat trigger keeps
-- legacy sms_opt_out_at and new unsubscribed_at in sync during transition.

-- ── customers: new lifecycle flags ──────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS retargeting_active BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_retargeting_template_key TEXT NULL;

COMMENT ON COLUMN customers.unsubscribed_at IS
  'Set when customer texts STOP / unsubscribe / opt out. Belt+suspenders alongside legacy sms_opt_out_at — kept in sync via trigger. The messaging service refuses sends when this is non-null.';
COMMENT ON COLUMN customers.retargeting_active IS
  'True while the customer has exactly one pending retargeting.win_back task. Enforces the next-task-on-fire invariant.';
COMMENT ON COLUMN customers.last_retargeting_template_key IS
  'Last evergreen template_key sent. Used by offer-engine to exclude back-to-back repeats.';

-- Backfill unsubscribed_at from legacy sms_opt_out_at (one-time)
UPDATE customers
   SET unsubscribed_at = sms_opt_out_at
 WHERE sms_opt_out_at IS NOT NULL
   AND unsubscribed_at IS NULL;

-- Two-way sync trigger so legacy code paths and new code paths stay consistent
-- during the rollout. Drop after Texas Nova is 7 days green on the new system.
CREATE OR REPLACE FUNCTION sync_unsubscribed_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sms_opt_out_at IS DISTINCT FROM OLD.sms_opt_out_at AND NEW.unsubscribed_at IS NOT DISTINCT FROM OLD.unsubscribed_at THEN
    NEW.unsubscribed_at := NEW.sms_opt_out_at;
  ELSIF NEW.unsubscribed_at IS DISTINCT FROM OLD.unsubscribed_at AND NEW.sms_opt_out_at IS NOT DISTINCT FROM OLD.sms_opt_out_at THEN
    NEW.sms_opt_out_at := NEW.unsubscribed_at;
    IF NEW.unsubscribed_at IS NOT NULL THEN
      NEW.sms_opt_out := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_unsubscribed_columns ON customers;
CREATE TRIGGER trg_sync_unsubscribed_columns
  BEFORE UPDATE OF sms_opt_out_at, unsubscribed_at ON customers
  FOR EACH ROW
  EXECUTE FUNCTION sync_unsubscribed_columns();

-- ── scheduled_tasks: partial unique index for retargeting safety net ────────
-- Per 07_RETARGETING.md §4: an active retargeting customer must have EXACTLY
-- ONE pending retargeting.win_back task. This index is the database-level
-- guarantee against accidental duplicate scheduling bugs.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_retargeting_active_task
  ON scheduled_tasks (tenant_id, ((payload->>'customer_id')))
  WHERE task_type = 'retargeting.win_back' AND status = 'pending';

COMMENT ON INDEX uniq_retargeting_active_task IS
  'Enforces 04_FOLLOW_UPS.md §4 invariant: at most one pending retargeting.win_back task per customer per tenant. Insert fails loudly if a bug ever tries to schedule a duplicate.';

-- ── scheduled_tasks: index to speed up cancellation-by-customer ─────────────
-- Cancellation is keyed off (tenant_id, payload->>customer_id) — common pattern
-- for STOP handler global cancel and ghost-chase cancel-on-reply.

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_pending_by_customer
  ON scheduled_tasks (tenant_id, ((payload->>'customer_id')), task_type)
  WHERE status = 'pending';

-- ── tenants.workflow_config: add v2 feature flag default (off) ──────────────
-- The flag itself is a JSONB key — no schema change needed. This UPDATE just
-- ensures every existing tenant has the key explicitly false rather than
-- undefined, so feature-flag checks behave deterministically.

UPDATE tenants
   SET workflow_config = COALESCE(workflow_config, '{}'::jsonb)
       || jsonb_build_object('followup_rebuild_v2_enabled', false)
 WHERE NOT (workflow_config ? 'followup_rebuild_v2_enabled');

-- ── Backfill: migrate any customer mid-retargeting on legacy system ─────────
-- Anyone with retargeting_step IS NOT NULL who never completed gets marked
-- retargeting_active=true. The legacy-followup-flush script will schedule them
-- onto the new system in code (it can read tenant flags etc).

UPDATE customers
   SET retargeting_active = true
 WHERE retargeting_step IS NOT NULL
   AND retargeting_completed_at IS NULL
   AND unsubscribed_at IS NULL
   AND retargeting_stopped_reason IS NULL
   AND NOT retargeting_active;
