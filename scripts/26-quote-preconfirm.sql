-- 26-quote-preconfirm.sql
-- Pre-confirm cleaners on quotes BEFORE sending to the client.
-- Flow: Dominic creates quote → selects cleaners → cleaners confirm → client gets quote → client books → cleaner already assigned.

-- Track which cleaners were invited and their confirmation status
CREATE TABLE IF NOT EXISTS quote_cleaner_preconfirms (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_id INTEGER NOT NULL,
  cleaner_id INTEGER NOT NULL REFERENCES cleaners(id),
  cleaner_pay NUMERIC(10,2),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled')),
  notified_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_preconfirms_quote ON quote_cleaner_preconfirms(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_preconfirms_tenant ON quote_cleaner_preconfirms(tenant_id);

ALTER TABLE quote_cleaner_preconfirms ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quote_cleaner_preconfirms
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

-- New columns on quotes table
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS cleaner_pay NUMERIC(10,2);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS preconfirm_status TEXT DEFAULT NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS description TEXT;
