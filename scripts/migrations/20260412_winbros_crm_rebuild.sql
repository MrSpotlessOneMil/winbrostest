-- WinBros CRM Full Rebuild — Database Schema
-- Date: 2026-04-12
-- Scope: WinBros tenant only (window washing)
-- Creates: quotes, visits, visit_line_items, visit_checklists, checklist_templates,
--          customer_tags, service_plans, service_plan_jobs, payroll_weeks, payroll_entries,
--          pay_rates, tag_definitions, automated_messages
-- Alters:  jobs, cleaners

-- ============================================================================
-- QUOTES TABLE (does not exist yet)
-- ============================================================================

CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,

  -- Contact info (in case customer not yet created)
  customer_name TEXT,
  phone_number TEXT,
  email TEXT,
  address TEXT,

  -- Pricing
  total_price DECIMAL(10, 2) NOT NULL DEFAULT 0,

  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'sent', 'approved', 'converted', 'declined', 'expired'
  )),
  approved_by TEXT CHECK (approved_by IN ('customer', 'salesman')),
  approved_at TIMESTAMPTZ,
  converted_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,

  -- Sales attribution
  salesman_id INTEGER REFERENCES cleaners(id) ON DELETE SET NULL,

  -- Metadata
  notes TEXT,
  valid_until DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quotes
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_quotes_tenant ON quotes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_quotes_salesman ON quotes(salesman_id);

-- ============================================================================
-- QUOTE LINE ITEMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS quote_line_items (
  id SERIAL PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  service_name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE quote_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quote_line_items
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_quote_line_items_quote ON quote_line_items(quote_id);

-- ============================================================================
-- ALTER JOBS — add quote link, salesman, service plan source
-- ============================================================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salesman_id INTEGER REFERENCES cleaners(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS service_plan_id INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual' CHECK (source IN (
  'quote', 'service_plan', 'manual', 'vapi', 'sms', 'website', 'housecall_pro'
));

CREATE INDEX IF NOT EXISTS idx_jobs_quote ON jobs(quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_salesman ON jobs(salesman_id) WHERE salesman_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_service_plan ON jobs(service_plan_id) WHERE service_plan_id IS NOT NULL;

-- ============================================================================
-- VISITS TABLE — per-visit execution records
-- ============================================================================

CREATE TABLE IF NOT EXISTS visits (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Scheduling
  visit_date DATE NOT NULL,
  visit_number INTEGER DEFAULT 1,

  -- Sequential status flow
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'on_my_way', 'in_progress', 'stopped', 'completed',
    'checklist_done', 'payment_collected', 'closed'
  )),

  -- Timer
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,

  -- Crew on this visit
  technicians JSONB DEFAULT '[]',

  -- Checklist
  checklist_completed BOOLEAN DEFAULT FALSE,
  checklist_completed_at TIMESTAMPTZ,

  -- Payment
  payment_type TEXT CHECK (payment_type IN ('card', 'cash', 'check')),
  payment_amount DECIMAL(10, 2),
  tip_amount DECIMAL(10, 2) DEFAULT 0,
  payment_recorded BOOLEAN DEFAULT FALSE,
  stripe_payment_intent_id TEXT,

  -- Notes
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON visits
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_visits_job ON visits(job_id);
CREATE INDEX IF NOT EXISTS idx_visits_tenant_date ON visits(tenant_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits(tenant_id, status);

-- ============================================================================
-- VISIT LINE ITEMS — original quote services + technician upsells
-- ============================================================================

CREATE TABLE IF NOT EXISTS visit_line_items (
  id SERIAL PRIMARY KEY,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  service_name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL DEFAULT 0,

  -- THE critical revenue separation field
  revenue_type TEXT NOT NULL CHECK (revenue_type IN ('original_quote', 'technician_upsell')),
  added_by_cleaner_id INTEGER REFERENCES cleaners(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE visit_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON visit_line_items
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_visit_line_items_visit ON visit_line_items(visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_line_items_revenue ON visit_line_items(tenant_id, revenue_type);

-- ============================================================================
-- VISIT CHECKLISTS — per-visit checklist items
-- ============================================================================

CREATE TABLE IF NOT EXISTS visit_checklists (
  id SERIAL PRIMARY KEY,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  item_text TEXT NOT NULL,
  is_completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  completed_by INTEGER REFERENCES cleaners(id) ON DELETE SET NULL,
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE visit_checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON visit_checklists
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_visit_checklists_visit ON visit_checklists(visit_id);

-- ============================================================================
-- CHECKLIST TEMPLATES — reusable templates (admin configurable)
-- ============================================================================

CREATE TABLE IF NOT EXISTS checklist_templates (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  is_default BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON checklist_templates
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_checklist_templates_tenant ON checklist_templates(tenant_id);

-- ============================================================================
-- CUSTOMER TAGS — structured tags driving payroll, scheduling, plans
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_tags (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  tag_type TEXT NOT NULL CHECK (tag_type IN (
    'salesman', 'technician', 'team_lead', 'service_plan', 'service_months', 'custom'
  )),
  tag_value TEXT NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, tag_type, tag_value)
);

ALTER TABLE customer_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_tags
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_customer_tags_customer ON customer_tags(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_tags_type ON customer_tags(tenant_id, tag_type);

-- ============================================================================
-- TAG DEFINITIONS — admin-configurable tag bank
-- ============================================================================

CREATE TABLE IF NOT EXISTS tag_definitions (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  tag_type TEXT NOT NULL CHECK (tag_type IN (
    'salesman', 'technician', 'team_lead', 'service_plan', 'service_months', 'custom'
  )),
  tag_value TEXT NOT NULL,
  color TEXT DEFAULT '#6b7280',
  is_active BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, tag_type, tag_value)
);

ALTER TABLE tag_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tag_definitions
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_tag_definitions_tenant ON tag_definitions(tenant_id);

-- ============================================================================
-- SERVICE PLANS — customer recurring service contracts
-- ============================================================================

CREATE TABLE IF NOT EXISTS service_plans (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  plan_type TEXT NOT NULL CHECK (plan_type IN (
    'quarterly', 'triannual', 'triannual_exterior', 'monthly', 'biannual'
  )),
  service_months INTEGER[] NOT NULL DEFAULT '{}',
  plan_price DECIMAL(10, 2) NOT NULL,
  normal_price DECIMAL(10, 2),

  -- Contract
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'sent', 'signed', 'active', 'cancelled', 'expired'
  )),
  agreement_pdf_url TEXT,
  signature_data TEXT,
  signed_at TIMESTAMPTZ,

  -- Dates
  first_service_date DATE,
  start_date DATE,
  end_date DATE,

  -- Attribution
  salesman_id INTEGER REFERENCES cleaners(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE service_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_plans
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_service_plans_customer ON service_plans(customer_id);
CREATE INDEX IF NOT EXISTS idx_service_plans_tenant_status ON service_plans(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_service_plans_salesman ON service_plans(salesman_id);

-- Add FK from jobs to service_plans now that it exists
ALTER TABLE jobs ADD CONSTRAINT fk_jobs_service_plan
  FOREIGN KEY (service_plan_id) REFERENCES service_plans(id) ON DELETE SET NULL;

-- ============================================================================
-- SERVICE PLAN JOBS — auto-generated future jobs (the "bank")
-- ============================================================================

CREATE TABLE IF NOT EXISTS service_plan_jobs (
  id SERIAL PRIMARY KEY,
  service_plan_id INTEGER NOT NULL REFERENCES service_plans(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  scheduled_month INTEGER NOT NULL CHECK (scheduled_month BETWEEN 1 AND 12),
  scheduled_year INTEGER NOT NULL,
  target_week INTEGER CHECK (target_week BETWEEN 1 AND 5),

  -- Links to actual job once scheduled
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'unscheduled' CHECK (status IN (
    'unscheduled', 'scheduled', 'completed', 'cancelled'
  )),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE service_plan_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_plan_jobs
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_service_plan_jobs_plan ON service_plan_jobs(service_plan_id);
CREATE INDEX IF NOT EXISTS idx_service_plan_jobs_month ON service_plan_jobs(tenant_id, scheduled_year, scheduled_month);
CREATE INDEX IF NOT EXISTS idx_service_plan_jobs_status ON service_plan_jobs(tenant_id, status);

-- ============================================================================
-- PAY RATES — current pay configuration per employee
-- ============================================================================

CREATE TABLE IF NOT EXISTS pay_rates (
  id SERIAL PRIMARY KEY,
  cleaner_id INTEGER NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  role TEXT NOT NULL CHECK (role IN ('technician', 'team_lead', 'salesman')),

  -- For technicians/team leads
  hourly_rate DECIMAL(10, 2),
  pay_percentage DECIMAL(5, 2),

  -- For salesmen: commission rates by plan type
  commission_1time_pct DECIMAL(5, 2),
  commission_triannual_pct DECIMAL(5, 2),
  commission_quarterly_pct DECIMAL(5, 2),
  commission_monthly_pct DECIMAL(5, 2),

  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pay_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pay_rates
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_pay_rates_cleaner ON pay_rates(cleaner_id);
CREATE INDEX IF NOT EXISTS idx_pay_rates_tenant ON pay_rates(tenant_id, role);

-- ============================================================================
-- PAYROLL WEEKS — frozen weekly payroll snapshots
-- ============================================================================

CREATE TABLE IF NOT EXISTS payroll_weeks (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, week_start)
);

ALTER TABLE payroll_weeks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_weeks
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_payroll_weeks_tenant ON payroll_weeks(tenant_id, week_start);

-- ============================================================================
-- PAYROLL ENTRIES — individual pay records per person per week (FROZEN)
-- ============================================================================

CREATE TABLE IF NOT EXISTS payroll_entries (
  id SERIAL PRIMARY KEY,
  payroll_week_id INTEGER NOT NULL REFERENCES payroll_weeks(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  cleaner_id INTEGER NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('technician', 'team_lead', 'salesman')),

  -- Technician/Team Lead fields
  revenue_completed DECIMAL(10, 2) DEFAULT 0,
  pay_percentage DECIMAL(5, 2),
  hours_worked DECIMAL(5, 2) DEFAULT 0,
  overtime_hours DECIMAL(5, 2) DEFAULT 0,
  overtime_rate DECIMAL(3, 1) DEFAULT 1.5,
  hourly_rate DECIMAL(10, 2),

  -- Salesman fields
  revenue_1time DECIMAL(10, 2) DEFAULT 0,
  revenue_triannual DECIMAL(10, 2) DEFAULT 0,
  revenue_quarterly DECIMAL(10, 2) DEFAULT 0,
  commission_1time_pct DECIMAL(5, 2),
  commission_triannual_pct DECIMAL(5, 2),
  commission_quarterly_pct DECIMAL(5, 2),

  -- Calculated total
  total_pay DECIMAL(10, 2) DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_entries
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_payroll_entries_week ON payroll_entries(payroll_week_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_cleaner ON payroll_entries(cleaner_id);

-- ============================================================================
-- AUTOMATED MESSAGES — admin-configurable message templates
-- ============================================================================

CREATE TABLE IF NOT EXISTS automated_messages (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'on_my_way', 'visit_started', 'receipt', 'review_request', 'thank_you_tip',
    'quote_sent', 'quote_approved', 'service_plan_sent', 'appointment_reminder',
    'reschedule_notice'
  )),
  message_template TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, trigger_type)
);

ALTER TABLE automated_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automated_messages
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_automated_messages_tenant ON automated_messages(tenant_id);

-- ============================================================================
-- ALTER CLEANERS — add role column for salesman/technician distinction
-- ============================================================================

ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'technician'
  CHECK (role IN ('technician', 'team_lead', 'salesman'));

-- ============================================================================
-- SEED DEFAULT CHECKLIST TEMPLATE FOR WINBROS
-- ============================================================================

-- This will be inserted via API when WinBros tenant is identified
-- Example items: Arrival confirmed, Before photos taken, After photos taken,
--                All windows cleaned, Screens replaced, Debris cleaned up

-- ============================================================================
-- SEED DEFAULT AUTOMATED MESSAGES FOR WINBROS
-- ============================================================================

-- Will be inserted via Control Center UI or seed script
-- Templates use {{variable}} syntax:
-- {{customer_name}}, {{address}}, {{date}}, {{time}}, {{services}},
-- {{total}}, {{payment_method}}, {{review_link}}, {{tip_link}}
