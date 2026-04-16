/**
 * Send Service Plan Link
 *
 * POST /api/actions/service-plans/send
 * Body: { planId: string }
 *
 * Sends the signing link to the customer via SMS and updates plan status to 'sent'.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  let body: { planId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    )
  }

  const { planId } = body

  if (!planId) {
    return NextResponse.json(
      { success: false, error: 'Plan ID is required' },
      { status: 400 }
    )
  }

  const client = getSupabaseServiceClient()

  // Fetch plan + verify it belongs to this tenant
  const { data: plan, error: planError } = await client
    .from('service_plans')
    .select('id, status, customer_id, tenant_id')
    .eq('id', planId)
    .single()

  if (planError || !plan) {
    return NextResponse.json(
      { success: false, error: 'Service plan not found' },
      { status: 404 }
    )
  }

  // Cross-tenant check
  if (plan.tenant_id !== authTenant.id) {
    return NextResponse.json(
      { success: false, error: 'Service plan not found' },
      { status: 404 }
    )
  }

  // Only send if draft or sent (re-send allowed)
  if (plan.status !== 'draft' && plan.status !== 'sent') {
    return NextResponse.json(
      { success: false, error: `Cannot send plan in ${plan.status} status` },
      { status: 400 }
    )
  }

  // Fetch customer phone + name
  const { data: customer, error: customerError } = await client
    .from('customers')
    .select('first_name, last_name, phone_number')
    .eq('id', plan.customer_id)
    .single()

  if (customerError || !customer) {
    return NextResponse.json(
      { success: false, error: 'Customer not found for this plan' },
      { status: 404 }
    )
  }

  if (!customer.phone_number) {
    return NextResponse.json(
      { success: false, error: 'Customer has no phone number' },
      { status: 400 }
    )
  }

  // Build signing URL
  const baseUrl = authTenant.slug === 'winbros'
    ? 'https://winbros.cleanmachine.live'
    : `https://${authTenant.slug}.cleanmachine.live`
  const signingUrl = `${baseUrl}/service-plan/${planId}`

  const customerName = customer.first_name || 'there'
  const tenantName = authTenant.name || 'WinBros'

  const message = `Hi ${customerName}! Here's your ${tenantName} service plan agreement. Please review and sign: ${signingUrl}`

  // Update plan status to 'sent'
  const { error: updateError } = await client
    .from('service_plans')
    .update({
      status: 'sent',
      updated_at: new Date().toISOString(),
    })
    .eq('id', planId)

  if (updateError) {
    console.error('[service-plans/send] Failed to update status:', updateError)
    return NextResponse.json(
      { success: false, error: 'Failed to update plan status' },
      { status: 500 }
    )
  }

  // Send SMS
  const smsResult = await sendSMS(authTenant, customer.phone_number, message, {
    source: 'service_plan_send',
    customerId: plan.customer_id,
  })

  if (!smsResult.success) {
    console.error('[service-plans/send] SMS failed:', smsResult.error)
    // Plan is already marked 'sent' — return success but warn about SMS
    return NextResponse.json({
      success: true,
      warning: 'Plan status updated but SMS failed to send',
      smsError: smsResult.error,
    })
  }

  return NextResponse.json({
    success: true,
    message: `Service plan sent to ${customer.phone_number}`,
  })
}
