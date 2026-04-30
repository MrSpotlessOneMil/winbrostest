-- Phase J — Quote Builder rework (Blake call 2026-04-28).
--
-- Why: Blake locked in two changes to how quotes get built.
--
-- 1. Exterior windows is its own line-item section, not just another
--    "additional services" row. The salesman flags it explicitly so the
--    line price can drive service-plan auto-pricing.
--
-- 2. Service plan templates carry a pricing FORMULA, not just a flat
--    recurring_price. The default formula is `{kind: "flat"}` (preserves
--    Phase E behavior) but admins can switch a template to
--    `{kind: "exterior_multiplier", factor: 0.5}` so its recurring price
--    auto-derives from the quote's exterior_windows line. Salesman can
--    still override per quote.

----------------------------------------------------------------------------
-- 1. quote_line_items.kind — flag a row as exterior windows.
----------------------------------------------------------------------------

ALTER TABLE public.quote_line_items
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'standard'
    CHECK (kind IN ('standard', 'exterior_windows'));

COMMENT ON COLUMN public.quote_line_items.kind IS
  'Phase J classification. ''standard'' (default) is any line item. ''exterior_windows'' marks the row whose price drives service-plan multiplier formulas. At most one row per quote should carry exterior_windows.';

CREATE INDEX IF NOT EXISTS idx_quote_line_items_exterior_windows
  ON public.quote_line_items (quote_id)
  WHERE kind = 'exterior_windows';

----------------------------------------------------------------------------
-- 2. service_plan_templates.pricing_formula — admin-configurable formula.
----------------------------------------------------------------------------

ALTER TABLE public.service_plan_templates
  ADD COLUMN IF NOT EXISTS pricing_formula JSONB NOT NULL DEFAULT '{"kind":"flat"}'::jsonb;

COMMENT ON COLUMN public.service_plan_templates.pricing_formula IS
  'Phase J. {"kind":"flat"} → use recurring_price as-is. {"kind":"exterior_multiplier","factor":0.5} → quote-builder computes recurring_price as factor × the quote''s exterior_windows line total. Salesman can still override per quote.';

----------------------------------------------------------------------------
-- 3. quote_service_plans.formula_applied — audit trail.
----------------------------------------------------------------------------

ALTER TABLE public.quote_service_plans
  ADD COLUMN IF NOT EXISTS formula_applied JSONB;

COMMENT ON COLUMN public.quote_service_plans.formula_applied IS
  'Phase J. The pricing_formula from the template that this plan row was derived from, frozen at attach-time. NULL means flat / freeform / pre-Phase-J. Used to render "auto-priced from exterior windows" hints in the builder.';
