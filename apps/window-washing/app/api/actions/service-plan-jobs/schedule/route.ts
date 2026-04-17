/**
 * Schedule a Service Plan Job
 *
 * POST /api/actions/service-plan-jobs/schedule
 * Body: { planJobId: number, targetDate: string, crewLeadId?: number }
 *
 * Creates a real job + visit from a service plan job, then marks it scheduled.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  let body: { planJobId: number; targetDate: string; crewLeadId?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { planJobId, targetDate, crewLeadId } = body
  if (!planJobId || !targetDate) {
    return NextResponse.json(
      { error: 'planJobId and targetDate are required' },
      { status: 400 }
    )
  }

  // Validate date format
  const parsedDate = new Date(targetDate)
  if (isNaN(parsedDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const tenantId = authResult.tenant.id

  // Fetch the service plan job with plan + customer data
  const { data: planJob, error: fetchError } = await client
    .from('service_plan_jobs')
    .select(`
      id, service_plan_id, customer_id, tenant_id, status,
      service_plans!inner(plan_type, plan_price),
      customers!inner(first_name, last_name, address, phone_number)
    `)
    .eq('id', planJobId)
    .single()

  if (fetchError || !planJob) {
    return NextResponse.json({ error: 'Service plan job not found' }, { status: 404 })
  }

  if (planJob.tenant_id !== tenantId) {
    return NextResponse.json({ error: 'Service plan job not found' }, { status: 404 })
  }

  if (planJob.status !== 'unscheduled') {
    return NextResponse.json(
      { error: `Job is already ${planJob.status}` },
      { status: 400 }
    )
  }

  const customer = (planJob as any).customers
  const plan = (planJob as any).service_plans
  const customerName = [customer?.first_name, customer?.last_name]
    .filter(Boolean)
    .join(' ') || 'Unknown'

  // Create the real job
  const { data: job, error: jobError } = await client
    .from('jobs')
    .insert({
      tenant_id: tenantId,
      customer_id: planJob.customer_id,
      phone_number: customer?.phone_number || null,
      address: customer?.address || null,
      service_type: `Service Plan - ${plan?.plan_type || 'recurring'}`,
      date: targetDate,
      price: plan?.plan_price || null,
      status: 'scheduled',
      booked: true,
      cleaner_id: crewLeadId || null,
      notes: `Auto-created from service plan job #${planJobId}`,
    })
    .select('id')
    .single()

  if (jobError || !job) {
    return NextResponse.json(
      { error: `Failed to create job: ${jobError?.message || 'unknown error'}` },
      { status: 500 }
    )
  }

  // Create a visit for the job
  const { data: visit, error: visitError } = await client
    .from('visits')
    .insert({
      job_id: job.id,
      tenant_id: tenantId,
      visit_date: targetDate,
      visit_number: 1,
      status: 'not_started',
    })
    .select('id')
    .single()

  if (visitError) {
    // Job was created but visit failed — log but don't roll back
    // The job is still valid without a visit
  }

  // Update the service plan job: mark as scheduled and link job_id
  const { error: updateError } = await client
    .from('service_plan_jobs')
    .update({
      status: 'scheduled',
      job_id: job.id,
    })
    .eq('id', planJobId)
    .eq('status', 'unscheduled') // Atomic: only if still unscheduled

  if (updateError) {
    return NextResponse.json(
      { error: `Failed to update plan job: ${updateError.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    job_id: job.id,
    visit_id: visit?.id || null,
  })
}
