-- Wave 3a: Quote builder schema (plan task 6)
-- UP

ALTER TABLE quote_line_items
  ADD COLUMN IF NOT EXISTS optionality TEXT
    CHECK (optionality IN ('required','recommended','optional'))
    DEFAULT 'required';

-- quote_line_items.description already exists (pre-round-2), skip.

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS original_price DECIMAL(10,2);

ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS signed_ip TEXT;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS agreement_pdf_url TEXT;

CREATE TABLE IF NOT EXISTS service_book (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  default_price DECIMAL(10,2),
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE service_book ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON service_book;
CREATE POLICY tenant_isolation ON service_book
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
CREATE INDEX IF NOT EXISTS idx_service_book_tenant ON service_book(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS quote_service_plans (
  id SERIAL PRIMARY KEY,
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  discount_label TEXT,
  recurring_price DECIMAL(10,2) NOT NULL,
  first_visit_keeps_original_price BOOLEAN DEFAULT FALSE,
  offered_to_customer BOOLEAN DEFAULT FALSE,
  recurrence JSONB,
  commission_rule JSONB DEFAULT
    '{"salesman_first_visit":true,"salesman_recurring":false,"salesman_residual_months":0}'::jsonb,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE quote_service_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON quote_service_plans;
CREATE POLICY tenant_isolation ON quote_service_plans
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
CREATE INDEX IF NOT EXISTS idx_quote_service_plans_quote ON quote_service_plans(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_service_plans_tenant ON quote_service_plans(tenant_id);

-- DOWN
-- DROP INDEX IF EXISTS idx_quote_service_plans_tenant;
-- DROP INDEX IF EXISTS idx_quote_service_plans_quote;
-- DROP TABLE IF EXISTS quote_service_plans;
-- DROP INDEX IF EXISTS idx_service_book_tenant;
-- DROP TABLE IF EXISTS service_book;
-- ALTER TABLE tenants DROP COLUMN IF EXISTS agreement_pdf_url;
-- ALTER TABLE service_plans DROP COLUMN IF EXISTS signed_ip;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS original_price;
-- ALTER TABLE quote_line_items DROP COLUMN IF EXISTS optionality;
