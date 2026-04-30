-- Phase O — service_book.is_upsell flag (Blake call 2026-04-28).
--
-- Why: Blake said "we don't even need a separate tab for tech upsells.
-- It can be the same price book as everyone else." The Price Book
-- (`service_book`) becomes the single source of truth for both
-- quote-builder catalog items and on-site tech upsells. The new flag
-- lets admins mark which items are eligible for tech upsell on a visit.
--
-- The legacy `tech_upsell_catalog` table stays for now — there's no
-- automatic data migration because (a) it's small, (b) admins should
-- review which items are kept, and (c) the tech-portal "+ add line item"
-- still reads from it via the existing /api/actions/tech-upsell-catalog
-- endpoint until the Control Center editor (later in Phase O) provides
-- a UI to flip is_upsell on existing service_book rows.

ALTER TABLE public.service_book
  ADD COLUMN IF NOT EXISTS is_upsell BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.service_book.is_upsell IS
  'Phase O: when TRUE, this catalog item is eligible to appear in the tech-portal "+ add line item" picker on a visit. FALSE-only items are quote-builder-only.';

CREATE INDEX IF NOT EXISTS idx_service_book_tenant_upsell
  ON public.service_book (tenant_id, is_upsell)
  WHERE is_upsell = TRUE;
