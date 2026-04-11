/**
 * Osiris Brain - Nightly Learning Cron
 *
 * Runs daily at 3am CT (8:00 UTC). Recomputes ML scores for all
 * customers across all tenants. Scores power the Inbox priority,
 * retargeting timing, and cleaner matching.
 *
 * Endpoint: GET /api/cron/osiris-learn
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAllActiveTenants } from '@/lib/tenant'
import { scoreAllCustomers } from '@/lib/osiris-brain'
import { logSystemEvent } from '@/lib/system-events'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'

// route-check:no-vercel-cron

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const startTime = Date.now()
  const results: Record<string, { scored: number; error?: string }> = {}

  try {
    const tenants = await getAllActiveTenants()
    console.log(`[osiris-learn] Starting scoring for ${tenants.length} tenants`)

    for (const tenant of tenants) {
      try {
        const scored = await scoreAllCustomers(tenant.id)
        results[tenant.slug || tenant.id] = { scored }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[osiris-learn] Error scoring tenant ${tenant.slug}:`, msg)
        results[tenant.slug || tenant.id] = { scored: 0, error: msg }
      }
    }

    const elapsed = Date.now() - startTime
    const totalScored = Object.values(results).reduce((sum, r) => sum + r.scored, 0)

    await logSystemEvent({
      source: 'osiris-brain',
      event_type: 'SCORING_COMPLETED',
      message: `Scored ${totalScored} customers across ${tenants.length} tenants in ${elapsed}ms`,
      metadata: results,
    })

    console.log(`[osiris-learn] Done: ${totalScored} customers scored in ${elapsed}ms`)

    return NextResponse.json({
      success: true,
      totalScored,
      elapsed_ms: elapsed,
      tenants: results,
    })
  } catch (error) {
    console.error('[osiris-learn] Fatal error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
