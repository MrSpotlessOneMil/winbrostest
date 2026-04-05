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
import { sendSMS } from '@/lib/openphone'
import { maybeMarkBooked } from '@/lib/maybe-mark-booked'
import { getEstimateFromNotes } from '@/lib/pricing-config'
import { getPricingAddons } from '@/lib/pricing-db'

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

  // Verify cleaner has access to this job via:
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
    // Check if this job is directly assigned to this cleaner (TL) or via crew board
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
      // Check if cleaner is assigned to this job's TL on this date via crew_day_members
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

  const { data: job } = await client
    .from('jobs')
    .select(`
      id, date, scheduled_at, address, service_type, status, notes, addons,
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

  const checklist: any[] = (checklistItems || []).map((item: any) => ({
    id: item.id,
    text: item.item_text,
    order: item.item_order,
    required: item.required,
    completed: completedMap.get(item.id)?.completed || false,
    completed_at: completedMap.get(item.id)?.completed_at || null,
  }))

  // Inject add-on items that aren't already covered by the static checklist
  // e.g. "inside fridge" added to a standard cleaning should still appear
  // Dynamic lookup from pricing_addons table so ALL tenant addons are covered
  const tenantAddons = await getPricingAddons(tenant.id)
  const addonLabelMap: Record<string, string> = {}
  for (const a of tenantAddons) {
    addonLabelMap[a.addon_key] = a.label
  }
  try {
    const jobAddons: { key: string; label?: string; price?: number }[] = job.addons ? (typeof job.addons === 'string' ? JSON.parse(job.addons) : job.addons) : []
    const existingTexts = new Set(checklist.map((c) => c.text.toLowerCase()))
    let nextOrder = checklist.length > 0 ? Math.max(...checklist.map((c) => c.order)) + 1 : 1
    for (const addon of jobAddons) {
      // Priority: stored label from job data → pricing_addons DB → humanize key
      const label = addon.label || addonLabelMap[addon.key] || addon.key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      // Skip if the checklist already has this item (case-insensitive partial match)
      if ([...existingTexts].some((t) => t.includes(label.toLowerCase().split(' ')[0]) && t.includes(label.toLowerCase().split(' ').slice(-1)[0]))) continue
      checklist.push({
        id: `addon_${addon.key}`,
        text: label,
        order: nextOrder++,
        required: true,
        completed: false,
        completed_at: null,
      })
    }
  } catch {}

  // Show customer phone only for WinBros (use_hcp_mirror feature flag)
  const showCustomerPhone = tenantUsesFeature(tenant, 'use_hcp_mirror')
  const customer = (job as any).customers
  const customerData: any = {
    first_name: customer?.first_name || null,
    last_name: customer?.last_name || null,
  }
  if (showCustomerPhone) {
    customerData.phone = customer?.phone_number || job.phone_number || null
  }

  const hasCardOnFile = !!(customer?.stripe_customer_id && customer?.card_on_file_at)

  // Parse structured tags from notes
  const estimate = getEstimateFromNotes(job.notes)

  // Cleaner pay: use PAY tag from notes, fallback to price × cleaner_pay_percentage
  let cleanerPay = estimate.cleanerPay ?? null
  if (cleanerPay == null && job.price) {
    const payPercentage = tenant.workflow_config?.cleaner_pay_percentage
    if (payPercentage) {
      cleanerPay = parseFloat(String(job.price)) * (payPercentage / 100)
    }
  }

  // Strip structured tags from notes so frontend only shows human-readable instructions
  const cleanedNotes = job.notes
    ? job.notes
        .split('\n')
        .filter((line: string) => {
          const trimmed = line.trim().toUpperCase()
          return (
            !trimmed.startsWith('OVERRIDE:') &&
            !trimmed.startsWith('PAYMENT:') &&
            !trimmed.startsWith('HOURS:') &&
            !trimmed.startsWith('PAY:')
          )
        })
        .join('\n')
        .trim() || null
    : null

  return NextResponse.json({
    job: {
      id: job.id,
      date: job.date,
      scheduled_at: job.scheduled_at,
      address: job.address,
      service_type: job.service_type,
      status: job.status,
      notes: cleanedNotes,
      bedrooms: job.bedrooms,
      bathrooms: job.bathrooms,
      sqft: job.sqft,
      hours: job.hours,
      cleaner_pay: cleanerPay,
      currency: tenant.currency || 'usd',
      total_hours: estimate.totalHours ?? null,
      hours_per_cleaner: estimate.hoursPerCleaner ?? null,
      num_cleaners: estimate.cleaners ?? null,
      paid: (job as any).paid || false,
      payment_status: (job as any).payment_status || null,
      cleaner_omw_at: job.cleaner_omw_at,
      cleaner_arrived_at: job.cleaner_arrived_at,
      payment_method: job.payment_method,
      card_on_file: hasCardOnFile,
    },
    assignment: assignment ? {
      id: assignment.id,
      status: assignment.status,
    } : {
      id: null,
      status: 'confirmed', // crew board assignments are implicitly confirmed
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

    // Notify customer (OMW / HERE only - DONE has its own flow below)
    const customer = (job as any).customers
    const customerPhone = customer?.phone_number || job.phone_number
    if (customerPhone && body.status !== 'done') {
      const statusMap = { omw: 'omw', here: 'arrived' } as const
      await notifyCustomerStatus(tenant, customerPhone, customer?.first_name || null, statusMap[body.status as keyof typeof statusMap], cleaner.name)
    }

    // On DONE: auto-charge card + single satisfaction check
    if (body.status === 'done') {
      const businessName = tenant.business_name_short || tenant.name
      const custName = customer?.first_name || 'there'

      // Set post_job_stage + satisfaction_sent_at FIRST (before any SMS)
      // Both are needed: post_job_stage for routing, satisfaction_sent_at for job lookup
      if (customer?.id) {
        await client.from('customers').update({
          post_job_stage: 'satisfaction_sent',
          post_job_stage_updated_at: new Date().toISOString(),
        }).eq('id', customer.id)
      }
      await client.from('jobs').update({
        satisfaction_sent_at: new Date().toISOString(),
      }).eq('id', parseInt(jobId))

      // 1. Auto-charge card if customer has card on file
      try {
        const stripeCustomerId = (customer as any)?.stripe_customer_id as string | null
        const jobPrice = job.price ? parseFloat(String(job.price)) : 0

        if (stripeCustomerId && jobPrice > 0 && tenant.stripe_secret_key) {
          const { chargeCardOnFile } = await import('@/lib/stripe-client')
          const chargeCents = Math.round(jobPrice * 1.03 * 100) // price + 3% processing
          const chargeResult = await chargeCardOnFile(
            tenant.stripe_secret_key,
            stripeCustomerId,
            chargeCents,
            { job_id: jobId, phone_number: customerPhone || '', payment_type: 'AUTO_CHARGE_ON_DONE' }
          )

          if (chargeResult.success) {
            await client.from('jobs').update({
              payment_status: 'fully_paid',
              paid: true,
            }).eq('id', parseInt(jobId))

            if (customerPhone) {
              await sendSMS(tenant, customerPhone, `Hey ${custName}! Your ${businessName} service is complete. Your card on file has been charged $${(chargeCents / 100).toFixed(2)}. Thank you for choosing ${businessName}!`)
            }
            console.log(`[crew/job] Auto-charged $${(chargeCents / 100).toFixed(2)} for job ${jobId}`)
          } else {
            console.error(`[crew/job] Auto-charge failed for job ${jobId}: ${chargeResult.error}`)
            if (tenant.owner_phone) {
              await sendSMS(tenant, tenant.owner_phone, `Auto-charge FAILED for job ${jobId}. Error: ${chargeResult.error}. Will retry via cron.`)
            }
          }
        }
      } catch (chargeErr) {
        console.error(`[crew/job] Auto-charge error for job ${jobId}:`, chargeErr)
      }

      // 2. Send ONE satisfaction check (replaces the generic "all done" notification)
      if (customerPhone) {
        try {
          await sendSMS(
            tenant,
            customerPhone,
            `Hey ${custName}, your ${businessName} cleaning is all done! How did everything turn out?`
          )
          console.log(`[crew/job] Satisfaction check sent for job ${jobId}`)
        } catch (satErr) {
          console.error(`[crew/job] Failed to send satisfaction check for job ${jobId}:`, satErr)
        }
      }
    }

    return NextResponse.json({ success: true, status: body.status })
  }

  // Handle checklist update
  if (body.checklist_item_id !== undefined) {
    const completed = !!body.completed
    const itemId = body.checklist_item_id

    // Add-on checklist items have string IDs (e.g. "addon_inside_fridge")
    // — can't store in job_checklist_items FK. Accept toggle silently.
    if (typeof itemId === 'string' && String(itemId).startsWith('addon_')) {
      return NextResponse.json({ success: true })
    }

    await client.from('job_checklist_items').upsert(
      {
        job_id: parseInt(jobId),
        checklist_item_id: itemId,
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
  if (!action || !['accept', 'decline', 'cancel_accepted'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const { cleaner, assignment, job, tenant, client } = ctx

  // Accept/decline/cancel only works for broadcast assignments, not crew board
  if (!assignment) {
    return NextResponse.json({ error: 'Crew board assignments cannot be accepted/declined here' }, { status: 400 })
  }

  // Handle cancel after accepting — cleaner backs out of an accepted/confirmed job
  if (action === 'cancel_accepted') {
    if (!['accepted', 'confirmed'].includes(assignment.status)) {
      return NextResponse.json({ error: 'Can only cancel accepted or confirmed assignments' }, { status: 400 })
    }

    // Don't allow cancel if cleaner already marked OMW
    if (job.cleaner_omw_at) {
      return NextResponse.json({ error: 'Cannot cancel after marking On My Way' }, { status: 400 })
    }

    // Cancel the assignment
    await client
      .from('cleaner_assignments')
      .update({ status: 'cancelled', responded_at: new Date().toISOString() })
      .eq('id', assignment.id)

    // Reset job booked status since cleaner dropped
    await client
      .from('jobs')
      .update({ booked: false, cleaner_confirmed: false, customer_notified: false, updated_at: new Date().toISOString() })
      .eq('id', parseInt(jobId))

    // Alert owner
    const { alertOwner } = await import('@/lib/owner-alert')
    await alertOwner(`Cleaner Dropped Job\n\n${cleaner.name} cancelled job #${jobId} after accepting.\nCustomer: ${(job as any).customers?.first_name || 'Unknown'}\nDate: ${job.date || 'TBD'}\nAddress: ${job.address || 'N/A'}\n\nRe-broadcasting to available cleaners...`, {
      jobId,
    })

    // Re-broadcast to all available cleaners
    const { triggerCleanerAssignment } = await import('@/lib/cleaner-assignment')
    const rebroadcastResult = await triggerCleanerAssignment(jobId)

    if (!rebroadcastResult.success) {
      console.error(`[crew-api] Re-broadcast failed after ${cleaner.name} cancelled: ${rebroadcastResult.error}`)
    } else {
      console.log(`[crew-api] Re-broadcast triggered after ${cleaner.name} cancelled job ${jobId}`)
    }

    return NextResponse.json({ success: true, action: 'cancel_accepted', rebroadcast: rebroadcastResult.success })
  }

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

    // Cleaner accepted — check if payment is also confirmed → mark booked
    await maybeMarkBooked(jobId)

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
