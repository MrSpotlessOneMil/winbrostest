-- Phase E — service plan templates.
--
-- WinBros today: every quote_service_plans row is freeform copy. Salesman
-- types "Monthly" + $99 each time. Templates table standardizes the
-- offerings so the QuoteBuilder can present a 3-button picker (Monthly /
-- Quarterly / Triannual) and the customer-facing /quote/<token> view
-- shows a clean 3-card menu with linked agreement PDFs.
--
-- Pricing is NOT a multiplier of an "exterior windows" line — that
-- approach was floated in the original plan but contradicts real data:
-- per-visit pricing reflects frequency dynamics (more frequent = cheaper
-- per visit because less buildup). Real data from quote_service_plans
-- (2026-04-28 audit):
--    Monthly      → $99 / visit, 12 visits/yr (used 126 times)
--    Quarterly    → $225 / visit, 4 visits/yr
--    Triannual    → $285 / visit, 3 visits/yr
--
-- Variants (e.g. "Exterior only", "1 Interior") are intentionally NOT
-- separate template rows. The QuoteBuilder lets the salesman tweak
-- recurring_price + scope on the per-quote_service_plans row after
-- picking a template.
--
-- Agreement PDFs are mockup placeholders for now (Dominic 2026-04-28);
-- real agreement language gets dropped in later via the admin UI.

CREATE TABLE IF NOT EXISTS public.service_plan_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug          text NOT NULL,
  name          text NOT NULL,
  -- Per-visit price the salesman starts with. Editable per quote.
  recurring_price numeric NOT NULL CHECK (recurring_price >= 0),
  -- {interval_months: int, visits_per_year: int}. Visits/yr × interval ≈ 12.
  recurrence    jsonb NOT NULL,
  -- Salesman commission rule for plans tied to this template. Mirrors the
  -- shape already used in quote_service_plans.commission_rule so we don't
  -- introduce a new schema. Default: first-visit only, no residuals.
  commission_rule jsonb NOT NULL DEFAULT
    '{"salesman_first_visit": true, "salesman_recurring": false, "salesman_residual_months": 0}'::jsonb,
  -- Static URL for the mockup agreement PDF. Updated when admin uploads
  -- a real PDF later. NULL = no agreement attached yet.
  agreement_pdf_url text,
  -- Free-form description shown above the agreement download button on
  -- the customer-facing quote view. Markdown allowed.
  description   text,
  sort_order    integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

-- RLS: tenant_isolation policy matches the rest of the schema.
ALTER TABLE public.service_plan_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.service_plan_templates;
CREATE POLICY tenant_isolation ON public.service_plan_templates
  USING (tenant_id::text = current_setting('request.jwt.claim.tenant_id', true));

CREATE INDEX IF NOT EXISTS idx_service_plan_templates_tenant_active
  ON public.service_plan_templates (tenant_id, active, sort_order);

COMMENT ON TABLE public.service_plan_templates IS
  'Phase E (2026-04-28): per-tenant catalog of service plan offerings. QuoteBuilder picks from these instead of freeform.';

-- Seed WinBros tenant templates.
-- Pricing comes from real quote_service_plans data audit 2026-04-28.
INSERT INTO public.service_plan_templates
  (tenant_id, slug, name, recurring_price, recurrence, agreement_pdf_url, description, sort_order)
VALUES
  (
    'e954fbd6-b3e1-4271-88b0-341c9df56beb',
    'monthly',
    'Monthly',
    99,
    '{"interval_months": 1, "visits_per_year": 12}'::jsonb,
    '/service-plans/winbros-monthly-agreement.pdf',
    'Best for high-traffic homes and short-cycle commercial. We''re on-site every month, so each visit is fast and the price stays low.',
    0
  ),
  (
    'e954fbd6-b3e1-4271-88b0-341c9df56beb',
    'quarterly',
    'Quarterly',
    225,
    '{"interval_months": 3, "visits_per_year": 4}'::jsonb,
    '/service-plans/winbros-quarterly-agreement.pdf',
    'Most popular. We come out every 3 months — keeps your windows looking great year-round without overpaying for visits you don''t need.',
    1
  ),
  (
    'e954fbd6-b3e1-4271-88b0-341c9df56beb',
    'triannual',
    'Triannual',
    285,
    '{"interval_months": 4, "visits_per_year": 3}'::jsonb,
    '/service-plans/winbros-triannual-agreement.pdf',
    'Three visits a year, perfectly timed for spring, mid-summer, and fall. Best value per visit if you''re happy with windows that look great most of the year.',
    2
  )
ON CONFLICT (tenant_id, slug) DO NOTHING;
