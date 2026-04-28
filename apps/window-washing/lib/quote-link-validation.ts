/**
 * Phase I — quote ↔ appointment ↔ salesman link guard.
 *
 * If a quote points at an originating appointment_job_id, it MUST also
 * have a salesman_id, otherwise:
 *   - Phase F's appointment-set commission can't flip "pending" → "earned"
 *     on conversion (no salesman to credit).
 *   - The DB-level CHECK constraint quotes_appointment_needs_salesman
 *     fails the insert/update with a generic 23514, which is opaque to
 *     the user.
 *
 * This validator runs first in the app layer so users see a clean 422
 * with a fixable message ("link a salesman before saving"). The DB
 * constraint is the backstop.
 *
 * Pure function — no Supabase, no I/O. Drop-in for both POST and PATCH
 * paths in /api/actions/quotes/* and the crew-side quote-draft routes.
 */

export type QuoteSalesmanLinkInput = {
  appointment_job_id: number | null | undefined
  salesman_id: number | null | undefined
}

export type QuoteSalesmanLinkResult =
  | { ok: true }
  | { ok: false; error: string }

export function validateQuoteSalesmanLink(
  input: QuoteSalesmanLinkInput
): QuoteSalesmanLinkResult {
  const linkedToAppointment =
    input.appointment_job_id != null && input.appointment_job_id > 0
  const hasSalesman =
    input.salesman_id != null && input.salesman_id > 0

  if (linkedToAppointment && !hasSalesman) {
    return {
      ok: false,
      error:
        'Quotes created from an appointment must have a salesman attached. Pick a salesman before saving (their 12.5% commission depends on this link).',
    }
  }
  return { ok: true }
}

/**
 * Merge intent helper: when a PATCH only touches one of (appointment_job_id,
 * salesman_id), we still need to validate the post-merge state. Pass the
 * existing row + the inbound update; this returns the resulting linkage
 * the validator should check.
 *
 * If a key is `undefined` in the update, the existing row's value is kept;
 * if a key is explicitly `null`, the update wins (intentional unlink).
 */
export function mergeQuoteLinkUpdate(args: {
  existing: { appointment_job_id: number | null; salesman_id: number | null }
  update: {
    appointment_job_id?: number | null | undefined
    salesman_id?: number | null | undefined
  }
}): QuoteSalesmanLinkInput {
  const { existing, update } = args
  return {
    appointment_job_id:
      update.appointment_job_id === undefined
        ? existing.appointment_job_id
        : update.appointment_job_id,
    salesman_id:
      update.salesman_id === undefined ? existing.salesman_id : update.salesman_id,
  }
}
