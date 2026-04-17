/**
 * Visit Transition Endpoint
 *
 * POST /api/actions/visits/transition
 * Body: { visitId: number, targetStatus: string, technicians?: number[] }
 *
 * Moves a visit to its next step in the sequential flow.
 * Enforces step order, upsell time-locking, checklist blocking.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { transitionVisit, type VisitStatus } from '@/lib/visit-flow'
import { executeCloseJobAutomation } from '@/lib/close-job'
import { sendSMS } from '@/lib/openphone'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  let body: { visitId: number; targetStatus: VisitStatus; technicians?: number[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { visitId, targetStatus, technicians } = body
  if (!visitId || !targetStatus) {
    return NextResponse.json({ error: 'visitId and targetStatus are required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  // Verify visit belongs to tenant
  const { data: visit } = await client
    .from('visits')
    .select('tenant_id')
    .eq('id', visitId)
    .single()

  if (!visit || visit.tenant_id !== authResult.tenant.id) {
    return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
  }

  // Handle "on_my_way" — send text to customer
  if (targetStatus === 'on_my_way') {
    const { data: visitData } = await client
      .from('visits')
      .select('job_id, jobs!inner(customer_id, customers!inner(phone_number, first_name))')
      .eq('id', visitId)
      .single()

    const customer = (visitData as any)?.jobs?.customers
    if (customer?.phone_number) {
      const name = customer.first_name || 'there'
      await sendSMS(
        authResult.tenant,
        customer.phone_number,
        `Hi ${name}! Your WinBros technician is on the way. See you soon!`
      )
    }
  }

  const result = await transitionVisit(client, visitId, targetStatus, { technicians })

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  // Handle "closed" — trigger close-job automation
  if (targetStatus === 'closed') {
    const googleReviewLink = authResult.tenant.workflow_config?.google_review_link
    await executeCloseJobAutomation(
      client,
      visitId,
      (tenantId, to, message) => sendSMS(authResult.tenant, to, message),
      googleReviewLink
    )
  }

  return NextResponse.json({ success: true, new_status: result.new_status })
}
