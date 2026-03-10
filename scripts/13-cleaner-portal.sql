-- ============================================================================
-- Migration 13: Cleaner Portal
-- Adds portal tokens, job status tracking, checklists, and SMS assignments
-- ============================================================================

-- Cleaner portal tokens (UUID-based, unguessable, like quote tokens)
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS portal_token TEXT UNIQUE DEFAULT gen_random_uuid()::text;

-- Backfill existing cleaners that don't have a token
UPDATE cleaners SET portal_token = gen_random_uuid()::text WHERE portal_token IS NULL;

-- Job status tracking (OMW/HERE/DONE timestamps)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cleaner_omw_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cleaner_arrived_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- Cleaning checklists (per service category, per tenant)
CREATE TABLE IF NOT EXISTS cleaning_checklists (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_category TEXT NOT NULL, -- 'standard_cleaning', 'deep_cleaning', 'move_in_out'
  item_order INTEGER NOT NULL DEFAULT 0,
  item_text TEXT NOT NULL,
  required BOOLEAN DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_checklists_tenant ON cleaning_checklists(tenant_id, service_category);

-- Job checklist completion tracking
CREATE TABLE IF NOT EXISTS job_checklist_items (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  checklist_item_id INTEGER NOT NULL REFERENCES cleaning_checklists(id),
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  completed_by INTEGER REFERENCES cleaners(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_checklist_unique ON job_checklist_items(job_id, checklist_item_id);

-- Pending SMS assignments (for accept/decline via text)
CREATE TABLE IF NOT EXISTS pending_sms_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cleaner_id INTEGER NOT NULL REFERENCES cleaners(id),
  assignment_id INTEGER NOT NULL REFERENCES cleaner_assignments(id),
  job_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + interval '4 hours',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'expired'))
);
CREATE INDEX IF NOT EXISTS idx_pending_sms_cleaner ON pending_sms_assignments(tenant_id, cleaner_id, status);

-- RLS on new tables
ALTER TABLE cleaning_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_sms_assignments ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policies
CREATE POLICY tenant_isolation ON cleaning_checklists
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE POLICY tenant_isolation ON pending_sms_assignments
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

-- ============================================================================
-- Seed default checklists for all active tenants
-- ============================================================================

-- Standard Cleaning
INSERT INTO cleaning_checklists (tenant_id, service_category, item_order, item_text, required)
SELECT t.id, 'standard_cleaning', item_order, item_text, true
FROM tenants t
CROSS JOIN (VALUES
  (1, 'Kitchen counters & sink'),
  (2, 'Bathroom sanitized'),
  (3, 'Floors vacuumed & mopped'),
  (4, 'Dusting (surfaces & shelves)'),
  (5, 'Trash emptied'),
  (6, 'Mirrors & glass cleaned')
) AS items(item_order, item_text)
WHERE t.active = true
ON CONFLICT DO NOTHING;

-- Deep Cleaning (includes standard + extras)
INSERT INTO cleaning_checklists (tenant_id, service_category, item_order, item_text, required)
SELECT t.id, 'deep_cleaning', item_order, item_text, true
FROM tenants t
CROSS JOIN (VALUES
  (1, 'Kitchen counters & sink'),
  (2, 'Bathroom sanitized'),
  (3, 'Floors vacuumed & mopped'),
  (4, 'Dusting (surfaces & shelves)'),
  (5, 'Trash emptied'),
  (6, 'Mirrors & glass cleaned'),
  (7, 'Baseboards wiped'),
  (8, 'Inside oven & microwave'),
  (9, 'Inside fridge'),
  (10, 'Window sills & tracks'),
  (11, 'Light fixtures & fans'),
  (12, 'Cabinet fronts wiped')
) AS items(item_order, item_text)
WHERE t.active = true
ON CONFLICT DO NOTHING;

-- Move-in/Move-out (includes deep + extras)
INSERT INTO cleaning_checklists (tenant_id, service_category, item_order, item_text, required)
SELECT t.id, 'move_in_out', item_order, item_text, true
FROM tenants t
CROSS JOIN (VALUES
  (1, 'Kitchen counters & sink'),
  (2, 'Bathroom sanitized'),
  (3, 'Floors vacuumed & mopped'),
  (4, 'Dusting (surfaces & shelves)'),
  (5, 'Trash emptied'),
  (6, 'Mirrors & glass cleaned'),
  (7, 'Baseboards wiped'),
  (8, 'Inside oven & microwave'),
  (9, 'Inside fridge'),
  (10, 'Window sills & tracks'),
  (11, 'Light fixtures & fans'),
  (12, 'Cabinet fronts wiped'),
  (13, 'Inside all cabinets & drawers'),
  (14, 'Inside closets'),
  (15, 'Garage sweep'),
  (16, 'Patio/balcony'),
  (17, 'Wall spot cleaning')
) AS items(item_order, item_text)
WHERE t.active = true
ON CONFLICT DO NOTHING;
