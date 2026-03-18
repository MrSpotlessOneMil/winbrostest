-- Osiris Brain: ML-computed customer scores
-- Recomputed nightly by the osiris-learn cron

CREATE TABLE IF NOT EXISTS customer_scores (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- Core scores
  lead_score INTEGER DEFAULT 0,          -- 0-100, likelihood to book
  best_contact_hour INTEGER,             -- 0-23, when they respond fastest
  response_likelihood REAL DEFAULT 0.5,  -- 0-1, will they reply?
  churn_risk REAL DEFAULT 0.5,           -- 0-1, likelihood to stop booking
  lifetime_value REAL DEFAULT 0,         -- estimated total $ value

  -- Segment
  segment TEXT,  -- new, active, recurring, one_timer, price_shopper, ghost, vip

  -- Detailed breakdown for debugging and iteration
  scoring_factors JSONB DEFAULT '{}',

  -- Timestamps
  scored_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tenant_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_scores_tenant ON customer_scores(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_scores_lead ON customer_scores(tenant_id, lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_customer_scores_segment ON customer_scores(tenant_id, segment);

-- RLS
ALTER TABLE customer_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_customer_scores ON customer_scores
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
