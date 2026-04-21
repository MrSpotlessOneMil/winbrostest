/**
 * Customer-level confirmed-booking check.
 *
 * A "confirmed booking" is a `jobs` row with status IN ('scheduled','in_progress').
 * 'quoted' does NOT count — a quote is not a confirmation.
 *
 * Use this before sending ANY follow-up / retargeting / cold-outreach SMS to
 * prevent the "cold nurture to already-booked customer" bug (W2, Paige
 * Elizabeth, West Niagara, 2026-04-20). Dominic's AI followed up with "did you
 * get a chance to look at your quote?" AFTER the customer was already booked —
 * because the cron query only filtered on the quote row, not the customer's
 * overall booking state.
 *
 * Rule: if this returns true for (tenantId, customerId), do NOT send any
 * outreach template. Transactional replies to inbound messages are still fine
 * and should go through the intake/booking flow.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export async function customerHasConfirmedBooking(
  client: SupabaseClient,
  tenantId: string,
  customerId: number | string | null | undefined,
): Promise<boolean> {
  if (!customerId) return false

  const { data, error } = await client
    .from('jobs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .in('status', ['scheduled', 'in_progress'])
    .limit(1)
    .maybeSingle()

  if (error) {
    // Fail CLOSED: if we can't verify, assume they might be booked and skip outreach.
    // Better to miss a follow-up than to cold-nurture someone already on the calendar.
    return true
  }

  return !!data
}

/**
 * Batch variant for crons that already loaded customer IDs.
 * Returns a Set of customerIds that have confirmed bookings — use as a skip-list.
 */
export async function customersWithConfirmedBookings(
  client: SupabaseClient,
  tenantId: string,
  customerIds: Array<number | string>,
): Promise<Set<string>> {
  if (customerIds.length === 0) return new Set()

  const { data, error } = await client
    .from('jobs')
    .select('customer_id')
    .eq('tenant_id', tenantId)
    .in('customer_id', customerIds)
    .in('status', ['scheduled', 'in_progress'])

  if (error || !data) {
    // Fail closed — return the whole input set as "booked" so callers skip everyone.
    return new Set(customerIds.map(String))
  }

  return new Set(data.map(r => String(r.customer_id)))
}
