/**
 * Service Plan Signing API
 *
 * GET  /api/service-plans/sign?planId=<uuid>  — Fetch plan + customer details (public, no auth)
 * POST /api/service-plans/sign               — Sign the agreement (public, no auth)
 *
 * Body: { planId: string, signature_name: string, agreed_to_terms: boolean }
 */

// route-check:no-vercel-cron

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { generateServicePlanJobs } from '@/lib/service-plans'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const planId = url.searchParams.get('planId')

  if (!planId) {
    return NextResponse.json(
      { success: false, error: 'Plan ID is required' },
      { status: 400 }
    )
  }

  const client = getSupabaseServiceClient()

  // Fetch plan with customer and tenant info
  const { data: plan, error: planError } = await client
    .from('service_plans')
    .select(`
      id,
      plan_type,
      service_months,
      plan_price,
      normal_price,
      status,
      first_service_date,
      signed_at,
      customer_id,
      tenant_id
    `)
    .eq('id', planId)
    .single()

  if (planError || !plan) {
    return NextResponse.json(
      { success: false, error: 'Service plan not found' },
      { status: 404 }
    )
  }

  // Fetch customer details
  const { data: customer } = await client
    .from('customers')
    .select('first_name, last_name, phone_number, address')
    .eq('id', plan.customer_id)
    .single()

  // Fetch tenant details (public info only)
  const { data: tenant } = await client
    .from('tenants')
    .select('name, slug, openphone_phone_number')
    .eq('id', plan.tenant_id)
    .single()

  return NextResponse.json({
    success: true,
    plan: {
      id: plan.id,
      plan_type: plan.plan_type,
      service_months: plan.service_months || [],
      plan_price: Number(plan.plan_price || 0),
      normal_price: plan.normal_price ? Number(plan.normal_price) : null,
      status: plan.status,
      first_service_date: plan.first_service_date,
      signed_at: plan.signed_at,
      customer: {
        first_name: customer?.first_name || null,
        last_name: customer?.last_name || null,
        phone_number: customer?.phone_number || null,
        address: customer?.address || null,
      },
      tenant: {
        name: tenant?.name || 'WinBros',
        slug: tenant?.slug || 'winbros',
        phone: tenant?.openphone_phone_number || null,
      },
    },
  })
}

export async function POST(request: NextRequest) {
  let body: { planId?: string; signature_name?: string; agreed_to_terms?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    )
  }

  const { planId, signature_name, agreed_to_terms } = body

  if (!planId) {
    return NextResponse.json(
      { success: false, error: 'Plan ID is required' },
      { status: 400 }
    )
  }

  if (!signature_name || !signature_name.trim()) {
    return NextResponse.json(
      { success: false, error: 'Signature name is required' },
      { status: 400 }
    )
  }

  if (!agreed_to_terms) {
    return NextResponse.json(
      { success: false, error: 'You must agree to the terms' },
      { status: 400 }
    )
  }

  const client = getSupabaseServiceClient()

  // Fetch the plan and verify status
  const { data: plan, error: planError } = await client
    .from('service_plans')
    .select('id, status, tenant_id, customer_id')
    .eq('id', planId)
    .single()

  if (planError || !plan) {
    return NextResponse.json(
      { success: false, error: 'Service plan not found' },
      { status: 404 }
    )
  }

  // Only allow signing on sent or draft plans
  if (plan.status !== 'sent' && plan.status !== 'draft') {
    if (plan.status === 'active') {
      return NextResponse.json(
        { success: false, error: 'This agreement has already been signed' },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { success: false, error: `This plan cannot be signed (status: ${plan.status})` },
      { status: 400 }
    )
  }

  // Atomic status transition: update only if still in sent/draft status
  const { error: updateError, count } = await client
    .from('service_plans')
    .update({
      status: 'active',
      signature_data: signature_name.trim(),
      signed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', planId)
    .in('status', ['sent', 'draft'])

  if (updateError) {
    console.error('[service-plans/sign] Failed to update plan:', updateError)
    return NextResponse.json(
      { success: false, error: 'Failed to activate service plan' },
      { status: 500 }
    )
  }

  if (count === 0) {
    return NextResponse.json(
      { success: false, error: 'Plan was already signed or status changed' },
      { status: 409 }
    )
  }

  // Generate service plan jobs for current year and next year
  const jobResult = await generateServicePlanJobs(client, plan.id)

  if (!jobResult.success) {
    console.error('[service-plans/sign] Failed to generate jobs:', jobResult.error)
    // Plan is already active — don't fail the signing, just log the job gen failure
  }

  return NextResponse.json({
    success: true,
    jobs_created: jobResult.jobs_created || 0,
  })
}
