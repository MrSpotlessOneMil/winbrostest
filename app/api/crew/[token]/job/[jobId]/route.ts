/**
 * Job Actions API for Cleaner Portal
 *
 * GET   /api/crew/[token]/job/[jobId] — Job details + checklist + status
 * PATCH /api/crew/[token]/job/[jobId] — Update status, checklist, payment method
 * POST  /api/crew/[token]/job/[jobId] — Accept or decline assignment
 *
 * Public (no auth — token = access).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getTenantById, tenantUsesFeature } from '@/lib/tenant'
import { notifyCustomerStatus } from '@/lib/cleaner-sms'

type RouteParams = { params: Promise<{ token: string; jobId: string }> }

/** Resolve cleaner + verify they're assigned to this job */
async function resolveContext(token: string, jobId: string) {
  const client = getSupabaseServiceClient()

  const { data: cleaner } = await client
    .from('cleaners')
    .select('id, name, phone, portal_token, tenant_id')
    .eq('portal_token', token)
    .is('deleted_at', null)
    .maybeSingle()

  if (!cleaner) return null

  // Verify cleaner has an assignment for this job
  const { data: assignment } = await client
    .from('cleaner_assignments')
    .select('id, status, tenant_id')
    .eq('cleaner_id', cleaner.id)
    .eq('job_id', parseInt(jobId))
    .eq('tenant_id', cleaner.tenant_id)
    .in('status', ['pending', 'accepted', 'confirmed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!assignment) return null

  const { data: job } = await client
    .from('jobs')
    .select(`
      id, date, scheduled_at, address, service_type, status, notes,
      bedrooms, bathrooms, sqft, hours, price, paid, payment_status,
      cleaner_omw_at, cleaner_arrived_at, payment_method,
      customer_id, phone_number,
      customers(id, first_name, last_name, address, phone_number, stripe_customer_id, card_on_file_at)
    `)
    .eq('id', parseInt(jobId))
    .eq('tenant_id', cleaner.tenant_id)
    .maybeSingle()

  if (!job) return null

  const tenant = await getTenantById(cleaner.tenant_id)
  if (!tenant) return null

  return { cleaner, assignment, job, tenant, client }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { token, jobId } = await params
  const ctx = await resolveContext(token, jobId)
  if (!ctx) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { cleaner, assignment, job, tenant, client } = ctx

  // Determine service category for checklist
  const serviceType = (job.service_type || 'standard_cleaning').toLowerCase()
  let serviceCategory = 'standard_cleaning'
  if (serviceType.includes('deep')) serviceCategory = 'deep_cleaning'
  else if (serviceType.includes('move')) serviceCategory = 'move_in_out'

  // Get checklist items for this service category
  const { data: checklistItems } = await client
    .from('cleaning_checklists')
    .select('id, item_text, item_order, required')
    .eq('tenant_id', tenant.id)
    .eq('service_category', serviceCategory)
    .order('item_order', { ascending: true })

  // Get completion status for this job
  const { data: completedItems } = await client
    .from('job_checklist_items')
    .select('checklist_item_id, completed, completed_at')
    .eq('job_id', parseInt(jobId))

  const completedMap = new Map(
    (completedItems || []).map((i: any) => [i.checklist_item_id, i])
  )

  const checklist = (checklistItems || []).map((item: any) => ({
    id: item.id,
    text: item.item_text,
    order: item.item_order,
    required: item.required,
    completed: completedMap.get(item.id)?.completed || false,
    completed_at: completedMap.get(item.id)?.completed_at || null,
  }))

  // Show customer phone only for WinBros (use_hcp_mirror feature flag)
  const showCustomerPhone = tenantUsesFeature(tenant, 'use_hcp_mirror')
  const customer = (job as any).customers
  const customerData: any = {
    first_name: customer?.first_name || null,
  }
  if (showCustomerPhone) {
    customerData.phone = customer?.phone_number || job.phone_number || null
  }

  const hasCardOnFile = !!(customer?.stripe_customer_id && customer?.card_on_file_at)

  return NextResponse.json({
    job: {
      id: job.id,
      date: job.date,
      scheduled_at: job.scheduled_at,
      address: job.address,
      service_type: job.service_type,
      status: job.status,
      notes: job.notes,
      bedrooms: job.bedrooms,
      bathrooms: job.bathrooms,
      sqft: job.sqft,
      hours: job.hours,
      price: job.price,
      paid: (job as any).paid || false,
      payment_status: (job as any).payment_status || null,
      cleaner_omw_at: job.cleaner_omw_at,
      cleaner_arrived_at: job.cleaner_arrived_at,
      payment_method: job.payment_method,
      card_on_file: hasCardOnFile,
    },
    assignment: {
      id: assignment.id,
      status: assignment.status,
    },
    customer: customerData,
    checklist,
    tenant: {
      name: tenant.business_name_short || tenant.name,
      slug: tenant.slug,
    },
  })
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { token, jobId } = await params
  const ctx = await resolveContext(token, jobId)
  if (!ctx) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { cleaner, assignment, job, tenant, client } = ctx

  // Handle status update (OMW / HERE / DONE)
  if (body.status) {
    const validStatuses = ['omw', 'here', 'done']
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    // Enforce sequential: can't skip steps
    if (body.status === 'here' && !job.cleaner_omw_at) {
      return NextResponse.json({ error: 'Must mark OMW first' }, { status: 400 })
    }
    if (body.status === 'done' && !job.cleaner_arrived_at) {
      return NextResponse.json({ error: 'Must mark HERE first' }, { status: 400 })
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.status === 'omw') {
      updates.cleaner_omw_at = new Date().toISOString()
      if (job.status === 'scheduled') updates.status = 'in_progress'
    } else if (body.status === 'here') {
      updates.cleaner_arrived_at = new Date().toISOString()
    } else if (body.status === 'done') {
      updates.status = 'completed'
      updates.completed_at = new Date().toISOString()
    }

    await client.from('jobs').update(updates).eq('id', parseInt(jobId))

    // Notify customer
    const customer = (job as any).customers
    const customerPhone = customer?.phone_number || job.phone_number
    if (customerPhone) {
      const statusMap = { omw: 'omw', here: 'arrived', done: 'done' } as const
      await notifyCustomerStatus(tenant, customerPhone, customer?.first_name || null, statusMap[body.status as keyof typeof statusMap])
    }

    return NextResponse.json({ success: true, status: body.status })
  }

  // Handle checklist update
  if (body.checklist_item_id !== undefined) {
    const completed = !!body.completed

    await client.from('job_checklist_items').upsert(
      {
        job_id: parseInt(jobId),
        checklist_item_id: body.checklist_item_id,
        completed,
        completed_at: completed ? new Date().toISOString() : null,
        completed_by: typeof cleaner.id === 'string' ? parseInt(cleaner.id) : cleaner.id,
      },
      { onConflict: 'job_id,checklist_item_id' }
    )

    return NextResponse.json({ success: true })
  }

  // Handle payment method
  if (body.payment_method) {
    const validMethods = ['card', 'cash', 'check', 'venmo']
    if (!validMethods.includes(body.payment_method)) {
      return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 })
    }

    await client
      .from('jobs')
      .update({ payment_method: body.payment_method, updated_at: new Date().toISOString() })
      .eq('id', parseInt(jobId))

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'No valid update provided' }, { status: 400 })
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { token, jobId } = await params
  const ctx = await resolveContext(token, jobId)
  if (!ctx) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { action } = body
  if (!action || !['accept', 'decline'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const { cleaner, assignment, job, tenant, client } = ctx

  if (assignment.status !== 'pending') {
    return NextResponse.json({ error: 'Assignment already responded to' }, { status: 400 })
  }

  const { processCleanerAssignmentReply } = await import('@/lib/cleaner-sms')
  // Resolve any pending_sms_assignments too
  await client
    .from('pending_sms_assignments')
    .update({ status: 'resolved' })
    .eq('assignment_id', assignment.id)
    .eq('status', 'active')

  if (action === 'accept') {
    await client
      .from('cleaner_assignments')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('id', assignment.id)
      .eq('status', 'pending')

    await client
      .from('jobs')
      .update({ status: 'scheduled', updated_at: new Date().toISOString() })
      .eq('id', parseInt(jobId))
      .in('status', ['pending', 'new'])

    // Cancel other pending assignments for this job
    const { data: others } = await client
      .from('cleaner_assignments')
      .select('id, cleaner_id')
      .eq('job_id', parseInt(jobId))
      .eq('status', 'pending')
      .neq('id', assignment.id)

    if (others) {
      for (const other of others) {
        await client
          .from('cleaner_assignments')
          .update({ status: 'cancelled' })
          .eq('id', other.id)

        const { notifyCleanerNotSelected } = await import('@/lib/cleaner-sms')
        const { data: otherCleaner } = await client
          .from('cleaners')
          .select('name, phone')
          .eq('id', other.cleaner_id)
          .maybeSingle()

        if (otherCleaner) {
          await notifyCleanerNotSelected(tenant, otherCleaner, job as any)
        }
      }
    }

    return NextResponse.json({ success: true, action: 'accepted' })
  } else {
    // Decline
    await client
      .from('cleaner_assignments')
      .update({ status: 'declined', responded_at: new Date().toISOString() })
      .eq('id', assignment.id)
      .eq('status', 'pending')

    // Cascade to next cleaner
    try {
      const { triggerCleanerAssignment } = await import('@/lib/cleaner-assignment')
      await triggerCleanerAssignment(jobId)
    } catch (err) {
      console.error('[crew-api] Failed to cascade assignment:', err)
    }

    return NextResponse.json({ success: true, action: 'declined' })
  }
}
