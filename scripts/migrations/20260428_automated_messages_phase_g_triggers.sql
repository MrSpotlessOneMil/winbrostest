-- Phase G — extend automated_messages.trigger_type CHECK to cover the
-- 5 new slots from Blake's IMG_0996 lead → close flow.
--
-- Existing whitelist: on_my_way, visit_started, receipt, review_request,
--   thank_you_tip, quote_sent, quote_approved, service_plan_sent,
--   appointment_reminder, reschedule_notice
--
-- New additions:
--   lead_thanks          — auto-sent on new lead intake (msg 1)
--   appointment_confirm  — sent when an appointment is BOOKED (msg 2)
--   day_before_reminder  — service day-before reminder (msg 5)
--
-- (`on_my_way` already exists as msg 3; `receipt` covers msg 4;
--  `review_request` and `thank_you_tip` cover the post-job stage.)
--
-- Audit: zero existing rows reference the new slot names, so this is
-- additive only — no risk of breaking existing data.

ALTER TABLE public.automated_messages
  DROP CONSTRAINT IF EXISTS automated_messages_trigger_type_check;

ALTER TABLE public.automated_messages
  ADD CONSTRAINT automated_messages_trigger_type_check
    CHECK (trigger_type = ANY (ARRAY[
      -- Existing slots (kept for back-compat)
      'on_my_way'::text,
      'visit_started'::text,
      'receipt'::text,
      'review_request'::text,
      'thank_you_tip'::text,
      'quote_sent'::text,
      'quote_approved'::text,
      'service_plan_sent'::text,
      'appointment_reminder'::text,
      'reschedule_notice'::text,
      -- Phase G additions (2026-04-28)
      'lead_thanks'::text,
      'appointment_confirm'::text,
      'day_before_reminder'::text
    ]));

COMMENT ON CONSTRAINT automated_messages_trigger_type_check
  ON public.automated_messages IS
  'Phase G (2026-04-28): whitelist must include every slot referenced by Control Center MESSAGE_FIELDS in apps/window-washing/app/(dashboard)/control-center/page.tsx. Adding a new slot in the UI requires extending this CHECK in the same PR.';
