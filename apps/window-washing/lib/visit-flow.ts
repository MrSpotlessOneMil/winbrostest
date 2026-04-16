/**
 * Visit Flow State Machine for WinBros
 *
 * Enforces strict sequential visit execution:
 * not_started → on_my_way → in_progress → stopped → completed → checklist_done → payment_collected → closed
 *
 * Rules:
 * - Upsells ONLY allowed during in_progress (between Start Visit and Stop Visit)
 * - Close Job BLOCKED unless checklist is complete AND payment is recorded
 * - Each step must be completed in order — no skipping
 */

import { SupabaseClient } from '@supabase/supabase-js'

// Valid status transitions
const VALID_TRANSITIONS: Record<string, string> = {
  not_started: 'on_my_way',
  on_my_way: 'in_progress',
  in_progress: 'stopped',
  stopped: 'completed',
  completed: 'checklist_done',
  checklist_done: 'payment_collected',
  payment_collected: 'closed',
}

export type VisitStatus =
  | 'not_started'
  | 'on_my_way'
  | 'in_progress'
  | 'stopped'
  | 'completed'
  | 'checklist_done'
  | 'payment_collected'
  | 'closed'

interface Visit {
  id: number
  job_id: number
  tenant_id: string
  status: VisitStatus
  visit_date: string
  started_at: string | null
  stopped_at: string | null
  completed_at: string | null
  closed_at: string | null
  checklist_completed: boolean
  payment_recorded: boolean
  technicians: number[]
}

interface TransitionResult {
  success: boolean
  new_status?: VisitStatus
  error?: string
}

/**
 * Check if a transition from current status to target status is valid.
 */
export function isValidTransition(current: VisitStatus, target: VisitStatus): boolean {
  return VALID_TRANSITIONS[current] === target
}

/**
 * Get the next valid status from the current status.
 */
export function getNextStatus(current: VisitStatus): VisitStatus | null {
  return (VALID_TRANSITIONS[current] as VisitStatus) || null
}

/**
 * Transition a visit to its next step.
 * Validates order, applies side effects (timer, SMS, etc.)
 */
export async function transitionVisit(
  client: SupabaseClient,
  visitId: number,
  targetStatus: VisitStatus,
  options?: {
    technicians?: number[]
  }
): Promise<TransitionResult> {
  // Fetch current visit state
  const { data: visit, error: fetchError } = await client
    .from('visits')
    .select('*')
    .eq('id', visitId)
    .single()

  if (fetchError || !visit) {
    return { success: false, error: `Visit not found: ${fetchError?.message}` }
  }

  // Validate transition
  if (!isValidTransition(visit.status as VisitStatus, targetStatus)) {
    return {
      success: false,
      error: `Invalid transition: ${visit.status} → ${targetStatus}. Expected: ${visit.status} → ${VALID_TRANSITIONS[visit.status]}`,
    }
  }

  // Pre-transition validation
  const validationError = validatePreTransition(visit, targetStatus)
  if (validationError) {
    return { success: false, error: validationError }
  }

  // Build update payload
  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    status: targetStatus,
    updated_at: now,
  }

  switch (targetStatus) {
    case 'on_my_way':
      // No special fields
      break

    case 'in_progress':
      updates.started_at = now
      if (options?.technicians) {
        updates.technicians = options.technicians
      }
      break

    case 'stopped':
      updates.stopped_at = now
      break

    case 'completed':
      updates.completed_at = now
      break

    case 'checklist_done':
      updates.checklist_completed = true
      updates.checklist_completed_at = now
      break

    case 'payment_collected':
      updates.payment_recorded = true
      break

    case 'closed':
      updates.closed_at = now
      break
  }

  // Apply transition atomically
  const { error: updateError } = await client
    .from('visits')
    .update(updates)
    .eq('id', visitId)
    .eq('status', visit.status) // Optimistic lock — prevent double transitions

  if (updateError) {
    return { success: false, error: `Failed to transition: ${updateError.message}` }
  }

  return { success: true, new_status: targetStatus }
}

/**
 * Pre-transition validation rules.
 */
function validatePreTransition(visit: Record<string, unknown>, target: VisitStatus): string | null {
  // Checklist must be complete before marking checklist_done
  if (target === 'checklist_done') {
    // This will be validated by checking all checklist items are completed
    // The actual check happens in the API route before calling transitionVisit
  }

  // Payment must be recorded before marking payment_collected
  if (target === 'payment_collected' && !visit.payment_recorded) {
    return 'Payment must be recorded before collecting payment'
  }

  // Close requires both checklist and payment
  if (target === 'closed') {
    if (!visit.checklist_completed) {
      return 'Checklist must be completed before closing job'
    }
    if (!visit.payment_recorded) {
      return 'Payment must be recorded before closing job'
    }
  }

  return null
}

/**
 * Check if upsells can be added to a visit.
 * Only allowed when status is "in_progress" (between Start and Stop).
 */
export function canAddUpsell(visitStatus: VisitStatus): boolean {
  return visitStatus === 'in_progress'
}

/**
 * Add an upsell line item to a visit.
 * Validates that the visit is in the correct state.
 */
export async function addUpsell(
  client: SupabaseClient,
  visitId: number,
  data: {
    service_name: string
    description?: string
    price: number
    added_by_cleaner_id: number | null
  }
): Promise<{ success: boolean; line_item_id?: number; error?: string }> {
  // Fetch visit to check status
  const { data: visit, error: fetchError } = await client
    .from('visits')
    .select('id, job_id, tenant_id, status')
    .eq('id', visitId)
    .single()

  if (fetchError || !visit) {
    return { success: false, error: `Visit not found: ${fetchError?.message}` }
  }

  if (!canAddUpsell(visit.status as VisitStatus)) {
    return {
      success: false,
      error: `Upsells can only be added during an active visit (status: in_progress). Current status: ${visit.status}`,
    }
  }

  const { data: lineItem, error: insertError } = await client
    .from('visit_line_items')
    .insert({
      visit_id: visit.id,
      job_id: visit.job_id,
      tenant_id: visit.tenant_id,
      service_name: data.service_name,
      description: data.description || null,
      price: data.price,
      revenue_type: 'technician_upsell',
      added_by_cleaner_id: data.added_by_cleaner_id,
    })
    .select('id')
    .single()

  if (insertError || !lineItem) {
    return { success: false, error: `Failed to add upsell: ${insertError?.message}` }
  }

  return { success: true, line_item_id: lineItem.id }
}

/**
 * Record payment for a visit.
 */
export async function recordPayment(
  client: SupabaseClient,
  visitId: number,
  data: {
    payment_type: 'card' | 'cash' | 'check'
    payment_amount: number
    tip_amount?: number
    stripe_payment_intent_id?: string
  }
): Promise<{ success: boolean; error?: string }> {
  const { data: visit, error: fetchError } = await client
    .from('visits')
    .select('id, status')
    .eq('id', visitId)
    .single()

  if (fetchError || !visit) {
    return { success: false, error: `Visit not found: ${fetchError?.message}` }
  }

  // Payment can be recorded after completion or checklist done
  const payableStatuses: VisitStatus[] = ['completed', 'checklist_done', 'payment_collected']
  if (!payableStatuses.includes(visit.status as VisitStatus)) {
    return {
      success: false,
      error: `Payment can only be recorded after job completion. Current status: ${visit.status}`,
    }
  }

  const { error: updateError } = await client
    .from('visits')
    .update({
      payment_type: data.payment_type,
      payment_amount: data.payment_amount,
      tip_amount: data.tip_amount || 0,
      payment_recorded: true,
      stripe_payment_intent_id: data.stripe_payment_intent_id || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', visitId)

  if (updateError) {
    return { success: false, error: `Failed to record payment: ${updateError.message}` }
  }

  return { success: true }
}

/**
 * Check if all checklist items for a visit are completed.
 */
export async function isChecklistComplete(
  client: SupabaseClient,
  visitId: number
): Promise<boolean> {
  const { data: items, error } = await client
    .from('visit_checklists')
    .select('is_completed')
    .eq('visit_id', visitId)

  if (error || !items || items.length === 0) {
    return false
  }

  return items.every((item: { is_completed: boolean }) => item.is_completed)
}

/**
 * Calculate visit revenue totals, split by type.
 */
export async function getVisitRevenue(
  client: SupabaseClient,
  visitId: number
): Promise<{
  original_quote_total: number
  technician_upsell_total: number
  total: number
  tip: number
  grand_total: number
}> {
  const { data: lineItems } = await client
    .from('visit_line_items')
    .select('price, revenue_type')
    .eq('visit_id', visitId)

  const { data: visit } = await client
    .from('visits')
    .select('tip_amount')
    .eq('id', visitId)
    .single()

  const originalTotal = (lineItems || [])
    .filter((i: { revenue_type: string }) => i.revenue_type === 'original_quote')
    .reduce((sum: number, i: { price: number }) => sum + Number(i.price), 0)

  const upsellTotal = (lineItems || [])
    .filter((i: { revenue_type: string }) => i.revenue_type === 'technician_upsell')
    .reduce((sum: number, i: { price: number }) => sum + Number(i.price), 0)

  const tip = Number(visit?.tip_amount || 0)
  const total = originalTotal + upsellTotal

  return {
    original_quote_total: originalTotal,
    technician_upsell_total: upsellTotal,
    total,
    tip,
    grand_total: total + tip,
  }
}
