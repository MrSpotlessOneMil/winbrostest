import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { notifyCleanerPreconfirm } from "@/lib/cleaner-sms"
import { getTenantById } from "@/lib/tenant"

/**
 * POST — Send pre-confirm SMS to selected cleaners for a quote
 * GET  — Get pre-confirm status for a quote
 */

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const { searchParams } = new URL(request.url)
  const quoteId = searchParams.get("quote_id")

  if (!quoteId) {
    return NextResponse.json({ error: "quote_id is required" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Verify quote belongs to tenant
  const { data: quote } = await supabase
    .from("quotes")
    .select("id, preconfirm_status, customer_name, description, cleaner_pay")
    .eq("id", quoteId)
    .eq("tenant_id", tenant.id)
    .single()

  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  // Get preconfirm rows with cleaner names
  const { data: preconfirms } = await supabase
    .from("quote_cleaner_preconfirms")
    .select("id, cleaner_id, cleaner_pay, status, notified_at, responded_at, cleaners(name, phone)")
    .eq("quote_id", quoteId)
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: true })

  return NextResponse.json({
    success: true,
    quote_id: quote.id,
    preconfirm_status: quote.preconfirm_status,
    preconfirms: (preconfirms || []).map(p => ({
      id: p.id,
      cleaner_id: p.cleaner_id,
      cleaner_name: (p as any).cleaners?.name || 'Unknown',
      cleaner_pay: p.cleaner_pay,
      status: p.status,
      notified_at: p.notified_at,
      responded_at: p.responded_at,
    })),
  })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { quote_id } = body
  if (!quote_id) {
    return NextResponse.json({ error: "quote_id is required" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Fetch quote and verify tenant
  const { data: quote } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", quote_id)
    .eq("tenant_id", tenant.id)
    .single()

  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  if (quote.preconfirm_status !== 'awaiting_cleaners') {
    return NextResponse.json({ error: `Cannot send — preconfirm status is ${quote.preconfirm_status || 'not set'}` }, { status: 400 })
  }

  // Get pending preconfirm rows with cleaner details
  const { data: preconfirms } = await supabase
    .from("quote_cleaner_preconfirms")
    .select("id, cleaner_id, cleaner_pay, status, cleaners(name, phone, portal_token)")
    .eq("quote_id", quote_id)
    .eq("tenant_id", tenant.id)
    .eq("status", "pending")

  if (!preconfirms?.length) {
    return NextResponse.json({ error: "No pending cleaners to notify" }, { status: 400 })
  }

  const fullTenant = await getTenantById(tenant.id)
  if (!fullTenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 })
  }

  let sent = 0
  let errors = 0

  for (const pc of preconfirms) {
    const cleaner = (pc as any).cleaners
    if (!cleaner?.phone) {
      errors++
      continue
    }

    const result = await notifyCleanerPreconfirm(fullTenant, {
      id: pc.cleaner_id,
      name: cleaner.name,
      phone: cleaner.phone,
      portal_token: cleaner.portal_token,
    }, {
      id: pc.id,
      quote_id: Number(quote_id),
      cleaner_pay: pc.cleaner_pay,
      description: quote.description,
      customer_name: quote.customer_name,
      customer_address: quote.customer_address,
      service_category: quote.service_category,
    })

    if (result.success) {
      await supabase
        .from("quote_cleaner_preconfirms")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", pc.id)
      sent++
    } else {
      errors++
    }
  }

  return NextResponse.json({
    success: true,
    sent,
    errors,
    total: preconfirms.length,
  })
}
