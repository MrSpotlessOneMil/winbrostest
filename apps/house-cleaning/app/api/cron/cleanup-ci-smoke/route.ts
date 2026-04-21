/**
 * CI Smoke Lead Cleanup
 *
 * Runs daily. Deletes rows from `leads` and `customers` where source='ci-smoke'
 * and they're older than 1 hour. Keeps Playwright landing-smoke test leads
 * from polluting the dashboard, brain, SAM feedback loops, etc.
 *
 * The smoke test posts a lead on every push to main. Over a week that's
 * roughly 10-30 junk leads; this cron keeps the count at zero.
 *
 * Endpoint: GET /api/cron/cleanup-ci-smoke
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const client = getSupabaseServiceClient()
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  // Leads go first (they reference customers).
  const { data: deletedLeads, error: leadsErr } = await client
    .from('leads')
    .delete()
    .eq('source', 'ci-smoke')
    .lt('created_at', cutoff)
    .select('id')

  if (leadsErr) {
    console.error('[CleanupCiSmoke] leads delete failed:', leadsErr.message)
    return NextResponse.json({ success: false, error: leadsErr.message }, { status: 500 })
  }

  // Customers created from those ci-smoke leads. Safe to match on both
  // source AND the synthetic phone prefix (+1555 comes from the smoke spec).
  const { data: deletedCustomers, error: custErr } = await client
    .from('customers')
    .delete()
    .eq('source', 'ci-smoke')
    .lt('created_at', cutoff)
    .select('id')

  if (custErr) {
    console.error('[CleanupCiSmoke] customers delete failed:', custErr.message)
    // Non-fatal — leads already deleted.
  }

  const leadsCount = deletedLeads?.length ?? 0
  const custCount = deletedCustomers?.length ?? 0
  console.log(`[CleanupCiSmoke] purged ${leadsCount} leads, ${custCount} customers (source=ci-smoke, >1h old)`)

  return NextResponse.json({
    success: true,
    deleted: { leads: leadsCount, customers: custCount },
  })
}
