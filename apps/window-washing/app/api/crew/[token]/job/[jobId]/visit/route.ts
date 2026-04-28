/**
 * Visit Flow API for Crew Portal
 *
 * GET  /api/crew/[token]/job/[jobId]/visit — Visit data + checklist + line items
 * POST /api/crew/[token]/job/[jobId]/visit — Visit actions (transition, upsell, checklist, payment)
 *
 * Public (no auth — token = access).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getTenantById } from '@/lib/tenant'
import { transitionVisit, addUpsell, recordPayment, type VisitStatus } from '@/lib/visit-flow'
import { executeCloseJobAutomation } from '@/lib/close-job'
import { sendSMS } from '@/lib/openphone'
import { renderTemplate, resolveAutomatedMessage } from '@/lib/automated-messages'

const ON_MY_WAY_FALLBACK_BODY =
  'Hey {{customer_name}}! Your {{business_name}} technician is on the way!'

type RouteParams = { params: Promise<{ token: string; jobId: string }> }

/** Resolve cleaner + verify they have access to this job */
async function resolveContext(token: string, jobId: string) {
  const client = getSupabaseServiceClient()

  const { data: cleaner } = await client
    .from('cleaners')
    .select('id, name, phone, portal_token, tenant_id')
    .eq('portal_token', token)
    .is('deleted_at', null)
    .maybeSingle()

  if (!cleaner) return null

  // Verify cleaner has access via:
  // 1. cleaner_assignments (broadcast system)
  // 2. direct cleaner_id on the job (TL owns the job)
  // 3. crew_day_members (assigned to TL who owns the job via crew board)
  const { data: assignment } = await client
    .from('cleaner_assignments')
    .select('id, status, tenant_id')
    .eq('cleaner_id', cleaner.id)
    .eq('job_id', parseInt(jobId))
    .eq('tenant_id', cleaner.tenant_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!assignment) {
    const { data: jobCheck } = await client
      .from('jobs')
      .select('id, cleaner_id, date')
      .eq('id', parseInt(jobId))
      .eq('tenant_id', cleaner.tenant_id)
      .maybeSingle()

    if (!jobCheck) return null

    const isDirectTL = jobCheck.cleaner_id === cleaner.id
    let isCrewMember = false

    if (!isDirectTL && jobCheck.cleaner_id) {
      const { data: crewCheck } = await client
        .from('crew_day_members')
        .select('id, crew_days!inner(date, team_lead_id)')
        .eq('cleaner_id', cleaner.id)

      isCrewMember = (crewCheck || []).some((cm: any) =>
        cm.crew_days?.team_lead_id === jobCheck.cleaner_id && cm.crew_days?.date === jobCheck.date
      )
    }

    if (!isDirectTL && !isCrewMember) return null
  }

  return { cleaner, client }
}

// ---------------------------------------------------------------------------
// GET — Return visit data with checklist + line items
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { token, jobId } = await params
  const ctx = await resolveContext(token, jobId)
  if (!ctx) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { cleaner, client } = ctx
  const jobIdNum = parseInt(jobId)

  // Fetch the job with customer data
  const { data: job } = await client
    .from('jobs')
    .select(`
      id, date, address, price, status, service_type, phone_number,
      customers(first_name, last_name, phone_number)
    `)
    .eq('id', jobIdNum)
    .eq('tenant_id', cleaner.tenant_id)
    .maybeSingle()

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const tenant = await getTenantById(cleaner.tenant_id)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  // Fetch or auto-create visit for this job
  let { data: visit } = await client
    .from('visits')
    .select('id, status, visit_date, started_at, stopped_at, completed_at, closed_at, checklist_completed, payment_recorded, payment_type, payment_amount, tip_amount, technicians')
    .eq('job_id', jobIdNum)
    .eq('tenant_id', cleaner.tenant_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!visit) {
    // Auto-create a visit for legacy jobs that don't have one
    const today = new Date().toISOString().split('T')[0]
    const { data: newVisit, error: createErr } = await client
      .from('visits')
      .insert({
        job_id: jobIdNum,
        tenant_id: cleaner.tenant_id,
        status: 'not_started',
        visit_date: job.date || today,
        checklist_completed: false,
        payment_recorded: false,
        technicians: [],
      })
      .select('id, status, visit_date, started_at, stopped_at, completed_at, closed_at, checklist_completed, payment_recorded, payment_type, payment_amount, tip_amount, technicians')
      .single()

    if (createErr || !newVisit) {
      return NextResponse.json({ error: 'Failed to create visit' }, { status: 500 })
    }

    visit = newVisit

    // ── Auto-populate default checklist items ──
    // Try checklist_templates first, fall back to hardcoded defaults
    let checklistItemTexts: string[] = []

    const { data: template } = await client
      .from('checklist_templates')
      .select('items')
      .eq('tenant_id', cleaner.tenant_id)
      .eq('is_default', true)
      .limit(1)
      .maybeSingle()

    if (template?.items && Array.isArray(template.items) && template.items.length > 0) {
      checklistItemTexts = template.items as string[]
    } else {
      checklistItemTexts = [
        'Sent "on my way" text',
        'Arrived and confirmed with customer',
        'Uploaded pre-existing damage photos',
        'Counted window panes',
        'Completed all services',
        'Uploaded before/after photos',
        'Put up yard sign',
        'Sent Google review link',
        'Asked for referrals',
      ]
    }

    if (checklistItemTexts.length > 0) {
      const checklistRows = checklistItemTexts.map((text, idx) => ({
        visit_id: newVisit.id,
        tenant_id: cleaner.tenant_id,
        item_text: text,
        is_completed: false,
        sort_order: idx + 1,
      }))
      await client.from('visit_checklists').insert(checklistRows)
    }

    // ── Auto-populate visit line items from quote or job ──
    const { data: fullJob } = await client
      .from('jobs')
      .select('quote_id, price, service_type')
      .eq('id', jobIdNum)
      .eq('tenant_id', cleaner.tenant_id)
      .maybeSingle()

    if (fullJob?.quote_id) {
      const { data: quoteLineItems } = await client
        .from('quote_line_items')
        .select('service_name, description, price, quantity')
        .eq('quote_id', fullJob.quote_id)
        .order('sort_order', { ascending: true })

      if (quoteLineItems && quoteLineItems.length > 0) {
        const visitLineItems = quoteLineItems.map((item: { service_name: string; description: string | null; price: number; quantity: number }) => ({
          visit_id: newVisit.id,
          job_id: jobIdNum,
          tenant_id: cleaner.tenant_id,
          service_name: item.service_name,
          description: item.description,
          price: item.price * (item.quantity || 1),
          revenue_type: 'original_quote',
          added_by_cleaner_id: null,
        }))
        await client.from('visit_line_items').insert(visitLineItems)
      }
    } else if (fullJob?.price) {
      // No quote — create a single line item from job data
      await client.from('visit_line_items').insert({
        visit_id: newVisit.id,
        job_id: jobIdNum,
        tenant_id: cleaner.tenant_id,
        service_name: fullJob.service_type
          ? fullJob.service_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
          : 'Service',
        description: null,
        price: fullJob.price,
        revenue_type: 'original_quote',
        added_by_cleaner_id: null,
      })
    }
  }

  // Fetch checklist items for this visit
  const { data: checklistItems } = await client
    .from('visit_checklists')
    .select('id, item_text, is_completed, completed_at')
    .eq('visit_id', visit.id)
    .order('sort_order', { ascending: true })

  // Fetch line items for this visit
  const { data: lineItems } = await client
    .from('visit_line_items')
    .select('id, service_name, description, price, revenue_type, added_by_cleaner_id')
    .eq('visit_id', visit.id)
    .order('created_at', { ascending: true })

  // Fetch tech upsell catalog for this tenant (Q1=C — picker source)
  const { data: catalog } = await client
    .from('tech_upsell_catalog')
    .select('id, name, description, price, sort_order')
    .eq('tenant_id', cleaner.tenant_id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const customer = (job as any).customers

  return NextResponse.json({
    visit: {
      id: visit.id,
      status: visit.status,
      visit_date: visit.visit_date,
      started_at: visit.started_at,
      stopped_at: visit.stopped_at,
      completed_at: visit.completed_at,
      closed_at: visit.closed_at,
      checklist_completed: visit.checklist_completed,
      payment_recorded: visit.payment_recorded,
      payment_type: visit.payment_type,
      payment_amount: visit.payment_amount,
      tip_amount: visit.tip_amount,
      technicians: visit.technicians,
    },
    checklist: (checklistItems || []).map((item: any) => ({
      id: item.id,
      item_text: item.item_text,
      is_completed: item.is_completed,
      completed_at: item.completed_at,
    })),
    line_items: (lineItems || []).map((item: any) => ({
      id: item.id,
      service_name: item.service_name,
      description: item.description,
      price: item.price,
      revenue_type: item.revenue_type,
      added_by_cleaner_id: item.added_by_cleaner_id,
    })),
    catalog: (catalog || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      price: Number(c.price),
    })),
    job: {
      id: job.id,
      date: job.date,
      address: job.address,
      price: job.price,
      status: job.status,
      service_type: job.service_type,
      phone_number: job.phone_number,
    },
    customer: {
      first_name: customer?.first_name || null,
      last_name: customer?.last_name || null,
      phone_number: customer?.phone_number || job.phone_number || null,
    },
    tenant: {
      name: (tenant as any).business_name_short || tenant.name,
      slug: tenant.slug,
    },
  })
}

// ---------------------------------------------------------------------------
// POST — Handle visit actions
// ---------------------------------------------------------------------------

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
  if (!action) {
    return NextResponse.json({ error: 'Missing action' }, { status: 400 })
  }

  const { cleaner, client } = ctx
  const jobIdNum = parseInt(jobId)

  // Fetch the visit for this job
  const { data: visit } = await client
    .from('visits')
    .select('id, status, tenant_id, job_id')
    .eq('job_id', jobIdNum)
    .eq('tenant_id', cleaner.tenant_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!visit) {
    return NextResponse.json({ error: 'No visit found for this job. GET first to auto-create.' }, { status: 404 })
  }

  const tenant = await getTenantById(cleaner.tenant_id)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  // -----------------------------------------------------------------------
  // Action: transition
  // -----------------------------------------------------------------------
  if (action === 'transition') {
    const targetStatus = body.target_status as VisitStatus
    if (!targetStatus) {
      return NextResponse.json({ error: 'Missing target_status' }, { status: 400 })
    }

    const validStatuses: VisitStatus[] = [
      'on_my_way', 'in_progress', 'stopped', 'completed',
      'checklist_done', 'payment_collected', 'closed',
    ]
    if (!validStatuses.includes(targetStatus)) {
      return NextResponse.json({ error: `Invalid target_status: ${targetStatus}` }, { status: 400 })
    }

    const options: { technicians?: number[] } = {}
    if (targetStatus === 'in_progress' && Array.isArray(body.technicians)) {
      options.technicians = body.technicians
    }

    const result = await transitionVisit(client, visit.id, targetStatus, options)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // Side effects per status
    if (targetStatus === 'on_my_way') {
      // Send SMS to customer: technician on the way
      const { data: job } = await client
        .from('jobs')
        .select('phone_number, customers(first_name, phone_number)')
        .eq('id', jobIdNum)
        .eq('tenant_id', cleaner.tenant_id)
        .maybeSingle()

      const customer = (job as any)?.customers
      const customerPhone = customer?.phone_number || job?.phone_number
      if (customerPhone) {
        try {
          const resolved = await resolveAutomatedMessage(client, {
            tenantId: cleaner.tenant_id,
            trigger: 'on_my_way',
            fallbackBody: ON_MY_WAY_FALLBACK_BODY,
          })
          if (resolved.isActive) {
            const businessName = (tenant as any).business_name_short || tenant.name || 'WinBros'
            const custName = customer?.first_name || 'there'
            const message = renderTemplate(resolved.body, {
              customer_name: custName,
              business_name: businessName,
            })
            await sendSMS(tenant, customerPhone, message)
          }
        } catch {
          // SMS failure should not block the transition
        }
      }
    }

    if (targetStatus === 'closed') {
      // Execute close-job automation (receipt, review request, thank you)
      try {
        await executeCloseJobAutomation(
          client,
          visit.id,
          async (tenantId: string, to: string, message: string) => {
            const senderTenant = await getTenantById(tenantId)
            if (senderTenant) {
              await sendSMS(senderTenant, to, message)
            }
          }
        )
      } catch {
        // Close automation failure should not block the transition
      }
    }

    return NextResponse.json({ success: true, new_status: result.new_status })
  }

  // -----------------------------------------------------------------------
  // Action: upsell
  // Round 2 (Q1=C): tech picks from tech_upsell_catalog only — no free-form entry.
  // -----------------------------------------------------------------------
  if (action === 'upsell') {
    const { catalog_item_id, quantity } = body
    if (!catalog_item_id || typeof catalog_item_id !== 'number') {
      return NextResponse.json({ error: 'Missing or invalid catalog_item_id' }, { status: 400 })
    }
    const qty = typeof quantity === 'number' && quantity > 0 ? Math.floor(quantity) : 1

    // Look up catalog row (tenant-scoped)
    const { data: catalogItem } = await client
      .from('tech_upsell_catalog')
      .select('id, name, description, price, is_active')
      .eq('id', catalog_item_id)
      .eq('tenant_id', cleaner.tenant_id)
      .maybeSingle()

    if (!catalogItem || !catalogItem.is_active) {
      return NextResponse.json({ error: 'Catalog item not found or inactive' }, { status: 404 })
    }

    const result = await addUpsell(client, visit.id, {
      service_name: catalogItem.name,
      description: catalogItem.description || undefined,
      price: Number(catalogItem.price) * qty,
      added_by_cleaner_id: cleaner.id,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ success: true, line_item_id: result.line_item_id })
  }

  // -----------------------------------------------------------------------
  // Action: toggle_checklist
  // -----------------------------------------------------------------------
  if (action === 'toggle_checklist') {
    const { item_id, completed } = body
    if (item_id == null || completed == null) {
      return NextResponse.json({ error: 'Missing item_id or completed' }, { status: 400 })
    }

    // Verify the checklist item belongs to this visit (tenant isolation)
    const { data: checkItem } = await client
      .from('visit_checklists')
      .select('id, visit_id')
      .eq('id', item_id)
      .eq('visit_id', visit.id)
      .maybeSingle()

    if (!checkItem) {
      return NextResponse.json({ error: 'Checklist item not found' }, { status: 404 })
    }

    const { error: updateErr } = await client
      .from('visit_checklists')
      .update({
        is_completed: !!completed,
        completed_at: completed ? new Date().toISOString() : null,
      })
      .eq('id', item_id)
      .eq('visit_id', visit.id)

    if (updateErr) {
      return NextResponse.json({ error: 'Failed to update checklist item' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  }

  // -----------------------------------------------------------------------
  // Action: add_checklist_item
  // -----------------------------------------------------------------------
  if (action === 'add_checklist_item') {
    const { text } = body
    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'Missing or empty text' }, { status: 400 })
    }

    // Get the max sort_order for this visit to append at the end
    const { data: existingItems } = await client
      .from('visit_checklists')
      .select('sort_order')
      .eq('visit_id', visit.id)
      .order('sort_order', { ascending: false })
      .limit(1)

    const nextOrder = (existingItems?.[0]?.sort_order ?? 0) + 1

    const { data: newItem, error: insertErr } = await client
      .from('visit_checklists')
      .insert({
        visit_id: visit.id,
        tenant_id: cleaner.tenant_id,
        item_text: text.trim(),
        sort_order: nextOrder,
        is_completed: false,
      })
      .select('id, item_text, is_completed, completed_at')
      .single()

    if (insertErr || !newItem) {
      return NextResponse.json({ error: 'Failed to add checklist item' }, { status: 500 })
    }

    return NextResponse.json({ success: true, item: newItem })
  }

  // -----------------------------------------------------------------------
  // Action: record_payment
  // -----------------------------------------------------------------------
  if (action === 'record_payment') {
    const { payment_type, payment_amount, tip_amount } = body
    if (!payment_type || payment_amount == null) {
      return NextResponse.json({ error: 'Missing payment_type or payment_amount' }, { status: 400 })
    }

    const validPaymentTypes = ['card', 'cash', 'check']
    if (!validPaymentTypes.includes(payment_type)) {
      return NextResponse.json({ error: `Invalid payment_type: ${payment_type}` }, { status: 400 })
    }

    if (typeof payment_amount !== 'number' || payment_amount < 0) {
      return NextResponse.json({ error: 'payment_amount must be a non-negative number' }, { status: 400 })
    }

    const result = await recordPayment(client, visit.id, {
      payment_type,
      payment_amount,
      tip_amount: typeof tip_amount === 'number' ? tip_amount : undefined,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
