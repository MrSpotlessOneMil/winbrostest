/**
 * GET /api/actions/service-plan-templates
 *
 * Returns the active service-plan templates for the authenticated tenant
 * sorted by sort_order. The QuoteBuilder uses this to render the
 * "Add a recurring plan" picker; the customer-facing /quote/<token> view
 * (which uses /api/quotes/[token]) reads templates separately.
 *
 * Phase E (2026-04-28): WinBros tenant has 3 seeded templates — Monthly,
 * Quarterly, Triannual. Other tenants get an empty list until templates
 * are seeded for them.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

interface PlanTemplate {
  id: string
  slug: string
  name: string
  recurring_price: number
  recurrence: { interval_months?: number; visits_per_year?: number } | null
  agreement_pdf_url: string | null
  description: string | null
  sort_order: number
  commission_rule: Record<string, unknown> | null
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  const client = getSupabaseServiceClient()
  const { data, error } = await client
    .from('service_plan_templates')
    .select(
      'id, slug, name, recurring_price, recurrence, agreement_pdf_url, description, sort_order, commission_rule'
    )
    .eq('tenant_id', authResult.tenant.id)
    .eq('active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Cast each price to number on the wire so the QuoteBuilder doesn't have
  // to handle PostgREST's stringified numerics.
  const templates: PlanTemplate[] = (data ?? []).map((row) => ({
    ...row,
    recurring_price: Number(row.recurring_price),
  }))

  return NextResponse.json({ templates })
}
