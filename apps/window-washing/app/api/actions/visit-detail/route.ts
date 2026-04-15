/**
 * Visit Detail API — Dashboard endpoint
 *
 * GET /api/actions/visit-detail?job_id=123
 *
 * Returns full visit data for the job detail page:
 *   - Job info (price, services, status, assigned crew, salesman)
 *   - Visit state (status, timer, checklist, payment)
 *   - Line items (original quote + upsells)
 *   - Checklist items
 *   - Customer info + membership/service plan
 *   - Visit history for this customer
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  const { tenant } = authResult
  const jobId = request.nextUrl.searchParams.get('job_id')
  if (!jobId) {
    return NextResponse.json({ error: 'job_id required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  // 1. Fetch job with customer join
  const { data: job, error: jobErr } = await client
    .from('jobs')
    .select(`
      id, date, scheduled_at, address, phone_number, service_type,
      status, notes, price, hours, frequency, quote_id,
      cleaner_id, customer_id, parent_job_id, membership_id,
      customers(id, first_name, last_name, phone_number, email, address, stripe_customer_id, card_on_file_at),
      cleaners:cleaner_id(id, name)
    `)
    .eq('id', Number(jobId))
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (jobErr || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // 2. Get or auto-create visit
  let { data: visit } = await client
    .from('visits')
    .select(`
      id, status, visit_date, started_at, stopped_at, completed_at, closed_at,
      checklist_completed, payment_recorded, payment_type, payment_amount,
      tip_amount, technicians
    `)
    .eq('job_id', Number(jobId))
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!visit) {
    const today = new Date().toISOString().split('T')[0]
    const { data: newVisit, error: createErr } = await client
      .from('visits')
      .insert({
        job_id: Number(jobId),
        tenant_id: tenant.id,
        status: 'not_started',
        visit_date: (job as any).date || today,
        checklist_completed: false,
        payment_recorded: false,
        technicians: [],
      })
      .select(`
        id, status, visit_date, started_at, stopped_at, completed_at, closed_at,
        checklist_completed, payment_recorded, payment_type, payment_amount,
        tip_amount, technicians
      `)
      .single()

    if (createErr || !newVisit) {
      return NextResponse.json({ error: 'Failed to create visit' }, { status: 500 })
    }
    visit = newVisit

    // ── Auto-populate default checklist items ──
    let checklistItemTexts: string[] = []

    const { data: template } = await client
      .from('checklist_templates')
      .select('items')
      .eq('tenant_id', tenant.id)
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
        tenant_id: tenant.id,
        item_text: text,
        is_completed: false,
        sort_order: idx + 1,
      }))
      await client.from('visit_checklists').insert(checklistRows)
    }

    // ── Auto-populate visit line items from quote or job ──
    if ((job as any).quote_id) {
      const { data: quoteLineItems } = await client
        .from('quote_line_items')
        .select('service_name, description, price, quantity')
        .eq('quote_id', (job as any).quote_id)
        .order('sort_order', { ascending: true })

      if (quoteLineItems && quoteLineItems.length > 0) {
        const visitLineItems = quoteLineItems.map((item: { service_name: string; description: string | null; price: number; quantity: number }) => ({
          visit_id: newVisit.id,
          job_id: Number(jobId),
          tenant_id: tenant.id,
          service_name: item.service_name,
          description: item.description,
          price: item.price * (item.quantity || 1),
          revenue_type: 'original_quote',
          added_by_cleaner_id: null,
        }))
        await client.from('visit_line_items').insert(visitLineItems)
      }
    } else if ((job as any).price) {
      await client.from('visit_line_items').insert({
        visit_id: newVisit.id,
        job_id: Number(jobId),
        tenant_id: tenant.id,
        service_name: (job as any).service_type
          ? (job as any).service_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
          : 'Service',
        description: null,
        price: (job as any).price,
        revenue_type: 'original_quote',
        added_by_cleaner_id: null,
      })
    }
  }

  // 3. Fetch checklist items
  const { data: checklistItems } = await client
    .from('visit_checklists')
    .select('id, item_text, is_completed, completed_at, sort_order')
    .eq('visit_id', visit.id)
    .order('sort_order', { ascending: true })

  // 4. Fetch line items
  const { data: lineItems } = await client
    .from('visit_line_items')
    .select('id, service_name, description, price, revenue_type, added_by_cleaner_id')
    .eq('visit_id', visit.id)
    .order('created_at', { ascending: true })

  // 5. Assigned crew / team info
  const { data: assignments } = await client
    .from('cleaner_assignments')
    .select('id, status, cleaners:cleaner_id(id, name)')
    .eq('job_id', Number(jobId))
    .eq('tenant_id', tenant.id)
    .in('status', ['accepted', 'confirmed'])

  // 6. Credited salesman
  const { data: salesmanData } = await client
    .from('jobs')
    .select('credited_salesman_id, cleaners:credited_salesman_id(id, name)')
    .eq('id', Number(jobId))
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  // 7. Service plan / membership (if customer has one)
  let membership = null
  const customerId = (job as any).customer_id
  if (customerId) {
    const { data: mem } = await client
      .from('memberships')
      .select(`
        id, status, visits_completed, next_visit_at,
        service_plans(id, name, slug, visits_per_year, interval_months, discount_per_visit)
      `)
      .eq('customer_id', customerId)
      .eq('tenant_id', tenant.id)
      .eq('status', 'active')
      .maybeSingle()
    membership = mem
  }

  // 8. Visit history for this customer
  let visitHistory: Array<{
    id: number
    visit_date: string
    status: string
    services: string[]
    total: number
  }> = []

  if (customerId) {
    const { data: customerJobs } = await client
      .from('jobs')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', customerId)

    if (customerJobs && customerJobs.length > 0) {
      const jobIds = customerJobs.map(j => j.id)

      const { data: pastVisits } = await client
        .from('visits')
        .select('id, visit_date, status, payment_amount, job_id')
        .eq('tenant_id', tenant.id)
        .in('job_id', jobIds)
        .neq('id', visit.id) // exclude current visit
        .order('visit_date', { ascending: false })
        .limit(20)

      if (pastVisits && pastVisits.length > 0) {
        const pastVisitIds = pastVisits.map(v => v.id)
        const { data: pastLineItems } = await client
          .from('visit_line_items')
          .select('visit_id, service_name')
          .in('visit_id', pastVisitIds)

        const liMap: Record<number, string[]> = {}
        if (pastLineItems) {
          for (const li of pastLineItems) {
            if (!liMap[li.visit_id]) liMap[li.visit_id] = []
            liMap[li.visit_id].push(li.service_name)
          }
        }

        visitHistory = pastVisits.map(v => ({
          id: v.id,
          visit_date: v.visit_date,
          status: v.status,
          services: liMap[v.id] || [],
          total: Number(v.payment_amount || 0),
        }))
      }
    }
  }

  const customer = (job as any).customers
  const assignedCrew = (assignments || []).map((a: any) => ({
    id: a.cleaners?.id,
    name: a.cleaners?.name,
    status: a.status,
  }))

  return NextResponse.json({
    job: {
      id: (job as any).id,
      date: (job as any).date,
      scheduled_at: (job as any).scheduled_at,
      scheduled_time: (job as any).scheduled_time,
      address: (job as any).address,
      phone_number: (job as any).phone_number,
      service_type: (job as any).service_type,
      status: (job as any).status,
      notes: (job as any).notes,
      price: (job as any).price,
      hours: (job as any).hours,
      bedrooms: (job as any).bedrooms,
      bathrooms: (job as any).bathrooms,
      sqft: (job as any).sqft,
      frequency: (job as any).frequency,
      parent_job_id: (job as any).parent_job_id,
      membership_id: (job as any).membership_id,
      lead_source: (job as any).leads?.[0]?.source || null,
    },
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
      price: Number(item.price),
      revenue_type: item.revenue_type,
    })),
    customer: {
      id: customer?.id || null,
      first_name: customer?.first_name || null,
      last_name: customer?.last_name || null,
      phone_number: customer?.phone_number || (job as any).phone_number || null,
      email: customer?.email || null,
      address: customer?.address || (job as any).address || null,
      card_on_file: !!(customer?.stripe_customer_id && customer?.card_on_file_at),
    },
    assigned_crew: assignedCrew,
    salesman: salesmanData?.cleaners
      ? { id: (salesmanData.cleaners as any).id, name: (salesmanData.cleaners as any).name }
      : null,
    membership,
    visit_history: visitHistory,
  })
}

