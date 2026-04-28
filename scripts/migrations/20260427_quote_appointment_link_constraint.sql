-- Phase I — hard-link enforcement: a quote that originated from an
-- appointment MUST have a salesman attached.
--
-- Audit (2026-04-27): zero quotes violate this rule across all tenants:
--   SELECT t.slug, COUNT(*) FROM quotes q JOIN tenants t ON t.id=q.tenant_id
--    WHERE q.appointment_job_id IS NOT NULL AND q.salesman_id IS NULL
--    GROUP BY t.slug;
--   → []
--
-- Why: Phase F's appointment-set commission only flips from "pending" to
-- "earned" on conversion if the converted quote points at the originating
-- appointment_job_id AND has a salesman_id to credit. A quote with the
-- linkage but no salesman silently breaks the commission flow.
--
-- App-layer guard runs first (see lib/quote-link-validation.ts) so users
-- get a friendly 422; this constraint is a backstop for direct DB writes
-- and any future code path that bypasses the validator.

ALTER TABLE public.quotes
  DROP CONSTRAINT IF EXISTS quotes_appointment_needs_salesman;

ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_appointment_needs_salesman
    CHECK (appointment_job_id IS NULL OR salesman_id IS NOT NULL);

COMMENT ON CONSTRAINT quotes_appointment_needs_salesman ON public.quotes IS
  'Phase I (2026-04-27): a quote derived from an appointment must credit a salesman. App-layer validator: lib/quote-link-validation.ts';
