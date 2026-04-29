/**
 * Role-scoped customer filter (PRD §5.2 — unified Customers tab).
 *
 * Returns the set of customer_ids a given cleaner is allowed to see in
 * their Customers list, or `null` to mean "no scope, return everything"
 * (used for admin sessions).
 *
 * Scope rules per role:
 *   - Technician → customers with at least one job where cleaner_id = me
 *   - Salesman   → customers with a job where salesman_id OR
 *                  credited_salesman_id = me, OR a quote where
 *                  salesman_id = me, OR a service plan where salesman_id = me
 *   - Team Lead  → customers serviced by anyone on the TL's recent crews
 *                  (last 90 days of crew_days where team_lead_id = me)
 *   - Admin      → null (unscoped)
 *
 * Returning a Set<number> instead of a query lets callers .in() filter
 * without re-running the underlying lookups, and makes unit testing the
 * scoping logic trivial without a Supabase mock.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ScopeCleaner {
  id: number
  employee_type: string | null
  is_team_lead: boolean
}

const CREW_LOOKBACK_DAYS = 90

/** Scope a customer-list query for a given cleaner role. */
export async function scopeCustomerIdsForCleaner(
  client: SupabaseClient,
  cleaner: ScopeCleaner | null | undefined,
): Promise<Set<number> | null> {
  if (!cleaner) return null // admin / unauthenticated → caller handles

  const allowedCustomerIds = new Set<number>()

  // Tech + TL: scope by cleaner_id on jobs. Skipped for pure salesmen
  // since they don't physically clean — their scope is salesman_id /
  // credited_salesman_id below.
  const isPureSalesman =
    cleaner.employee_type === 'salesman' && !cleaner.is_team_lead
  if (!isPureSalesman) {
    const cleanerIds = await resolveCleanerScopeIds(client, cleaner)
    if (cleanerIds.length > 0) {
      const { data: jobsByCleaner } = await client
        .from('jobs')
        .select('customer_id')
        .in('cleaner_id', cleanerIds)
      for (const j of jobsByCleaner ?? []) {
        if (j.customer_id != null) allowedCustomerIds.add(Number(j.customer_id))
      }
    }
  }

  // Salesman path: jobs.salesman_id / credited_salesman_id / quotes.salesman_id
  if (cleaner.employee_type === 'salesman') {
    const { data: jobsBySalesman } = await client
      .from('jobs')
      .select('customer_id')
      .or(`salesman_id.eq.${cleaner.id},credited_salesman_id.eq.${cleaner.id}`)
    for (const j of jobsBySalesman ?? []) {
      if (j.customer_id != null) allowedCustomerIds.add(Number(j.customer_id))
    }

    const { data: quotesBySalesman } = await client
      .from('quotes')
      .select('customer_id')
      .eq('salesman_id', cleaner.id)
    for (const q of quotesBySalesman ?? []) {
      if (q.customer_id != null) allowedCustomerIds.add(Number(q.customer_id))
    }

    const { data: plansBySalesman } = await client
      .from('service_plans')
      .select('customer_id')
      .eq('salesman_id', cleaner.id)
    for (const p of plansBySalesman ?? []) {
      if (p.customer_id != null) allowedCustomerIds.add(Number(p.customer_id))
    }
  }

  return allowedCustomerIds
}

/**
 * Build the list of cleaner_ids whose jobs this user should see — covers
 * the TL-includes-crew-members case. Always includes the user's own id.
 */
async function resolveCleanerScopeIds(
  client: SupabaseClient,
  cleaner: ScopeCleaner,
): Promise<number[]> {
  const ids = new Set<number>([cleaner.id])

  if (cleaner.is_team_lead) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - CREW_LOOKBACK_DAYS)
    const cutoffISO = cutoff.toISOString().slice(0, 10)
    const { data: crewDays } = await client
      .from('crew_days')
      .select('cleaner_id')
      .eq('team_lead_id', cleaner.id)
      .gte('date', cutoffISO)
    for (const cd of crewDays ?? []) {
      if (cd.cleaner_id != null) ids.add(Number(cd.cleaner_id))
    }
  }

  return Array.from(ids)
}
