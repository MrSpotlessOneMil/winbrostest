/**
 * Customer-level active-job check.
 *
 * Per OUTREACH-SPEC v1.0 Hard Rule #2 (updated 2026-04-22): an "active job"
 * for the purpose of blocking outreach is ANY job with status in
 * ('pending', 'quoted', 'scheduled', 'in_progress'). Previously this only
 * covered scheduled + in_progress, which caused the OH Nass / Paul bug
 * (West Niagara, 2026-04-22): customers with pending jobs were cold-nurtured
 * because the skip list was too narrow.
 *
 * Rule: if this returns true for (tenantId, customerId), do NOT send any
 * outreach template (Pipeline A / B / C). Transactional replies to inbound
 * messages are still fine and should go through the intake/booking flow.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const ACTIVE_JOB_STATUSES = ['pending', 'quoted', 'scheduled', 'in_progress'] as const

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
    .in('status', ACTIVE_JOB_STATUSES as unknown as string[])
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
 * Returns a Set of customerIds that have active jobs — use as a skip-list.
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
    .in('status', ACTIVE_JOB_STATUSES as unknown as string[])

  if (error || !data) {
    // Fail closed — return the whole input set as "booked" so callers skip everyone.
    return new Set(customerIds.map(String))
  }

  return new Set(data.map(r => String(r.customer_id)))
}
