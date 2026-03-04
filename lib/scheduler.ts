/**
 * Internal Task Scheduler
 *
 * Replaces QStash with a database-backed scheduler.
 * Tasks are stored in the `scheduled_tasks` table and processed by a cron job.
 */

import { createClient } from '@supabase/supabase-js'

// Lazy-initialize Supabase client
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export type TaskType =
  | 'lead_followup'
  | 'job_broadcast'
  | 'day_before_reminder'
  | 'job_reminder'
  | 'post_cleaning_followup'
  | 'sms_retry'
  | 'retargeting'

export interface ScheduledTask {
  id: string
  tenant_id?: string
  task_type: TaskType
  task_key?: string
  scheduled_for: string
  payload: Record<string, unknown>
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  attempts: number
  max_attempts: number
  last_error?: string
  created_at: string
  updated_at: string
  executed_at?: string
}

export interface ScheduleTaskOptions {
  tenantId?: string
  taskType: TaskType
  taskKey?: string // For deduplication
  scheduledFor: Date
  payload: Record<string, unknown>
  maxAttempts?: number
}

/**
 * Schedule a task for future execution
 */
export async function scheduleTask(
  options: ScheduleTaskOptions
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const supabase = getSupabase()

  try {
    // First, try to find an existing task with this key (might be cancelled)
    if (options.taskKey) {
      const { data: existing } = await supabase
        .from('scheduled_tasks')
        .select('id, status')
        .eq('task_key', options.taskKey)
        .maybeSingle()

      if (existing) {
        // If task exists (even if cancelled), update it to pending with new schedule
        const { data: updated, error: updateError } = await supabase
          .from('scheduled_tasks')
          .update({
            tenant_id: options.tenantId,
            task_type: options.taskType,
            scheduled_for: options.scheduledFor.toISOString(),
            payload: options.payload,
            max_attempts: options.maxAttempts || 3,
            status: 'pending',
            attempts: 0,
            last_error: null,
          })
          .eq('id', existing.id)
          .select('id')
          .single()

        if (updateError) throw updateError

        console.log(`[scheduler] Re-scheduled task ${options.taskType}: ${updated.id} (was ${existing.status})`)
        return { success: true, taskId: updated.id }
      }
    }

    // No existing task, insert a new one
    const { data, error } = await supabase
      .from('scheduled_tasks')
      .insert({
        tenant_id: options.tenantId,
        task_type: options.taskType,
        task_key: options.taskKey,
        scheduled_for: options.scheduledFor.toISOString(),
        payload: options.payload,
        max_attempts: options.maxAttempts || 3,
        status: 'pending',
      })
      .select('id')
      .single()

    if (error) {
      // Handle unique constraint violation (race condition)
      if (error.code === '23505') {
        console.log(`[scheduler] Task already scheduled: ${options.taskKey}`)
        return { success: true, taskId: 'existing' }
      }
      throw error
    }

    console.log(`[scheduler] Scheduled task ${options.taskType}: ${data.id}`)
    return { success: true, taskId: data.id }
  } catch (error) {
    console.error('[scheduler] Error scheduling task:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Cancel a scheduled task by task_key
 */
export async function cancelTask(
  taskKey: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase()

  try {
    const { error } = await supabase
      .from('scheduled_tasks')
      .update({ status: 'cancelled' })
      .eq('task_key', taskKey)
      .eq('status', 'pending')

    if (error) throw error

    console.log(`[scheduler] Cancelled task: ${taskKey}`)
    return { success: true }
  } catch (error) {
    console.error('[scheduler] Error cancelling task:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get tasks that are due for execution
 */
export async function getDueTasks(
  limit: number = 50
): Promise<ScheduledTask[]> {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('scheduled_tasks')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[scheduler] Error getting due tasks:', error)
    return []
  }

  return data || []
}

/**
 * Mark a task as processing (claim it)
 */
export async function claimTask(
  taskId: string
): Promise<{ success: boolean; task?: ScheduledTask }> {
  const supabase = getSupabase()

  // Use optimistic locking to prevent double-processing
  const { data, error } = await supabase
    .from('scheduled_tasks')
    .update({
      status: 'processing',
    })
    .eq('id', taskId)
    .eq('status', 'pending')
    .select('*')
    .single()

  if (error || !data) {
    // Task was already claimed by another worker
    return { success: false }
  }

  // Increment attempts
  await supabase
    .from('scheduled_tasks')
    .update({ attempts: (data.attempts || 0) + 1 })
    .eq('id', taskId)

  return { success: true, task: data }
}

/**
 * Mark a task as completed
 */
export async function completeTask(taskId: string): Promise<void> {
  const supabase = getSupabase()

  await supabase
    .from('scheduled_tasks')
    .update({
      status: 'completed',
      executed_at: new Date().toISOString(),
    })
    .eq('id', taskId)

  console.log(`[scheduler] Task completed: ${taskId}`)
}

/**
 * Mark a task as failed
 */
export async function failTask(taskId: string, error: string): Promise<void> {
  const supabase = getSupabase()

  // Get current task to check attempts
  const { data: task } = await supabase
    .from('scheduled_tasks')
    .select('attempts, max_attempts')
    .eq('id', taskId)
    .single()

  const shouldRetry = task && task.attempts < task.max_attempts

  await supabase
    .from('scheduled_tasks')
    .update({
      status: shouldRetry ? 'pending' : 'failed',
      last_error: error,
    })
    .eq('id', taskId)

  if (shouldRetry) {
    console.log(`[scheduler] Task ${taskId} will retry (attempt ${task.attempts}/${task.max_attempts})`)
  } else {
    console.error(`[scheduler] Task ${taskId} failed permanently: ${error}`)
  }
}

// ============================================
// OSIRIS-Specific Scheduling Functions
// ============================================

/**
 * Schedule lead follow-up sequence
 * Stages: 1 (immediate text), 2 (10min call), 3 (15min double call), 4 (20min text), 5 (30min call)
 */
export async function scheduleLeadFollowUp(
  tenantId: string,
  leadId: string,
  leadPhone: string,
  leadName: string,
  delays: number[] = [0, 10, 15, 20, 30] // Default delays in minutes
): Promise<{ success: boolean; taskIds: string[] }> {
  const taskIds: string[] = []
  const now = new Date()

  const stages = [
    { stage: 1, action: 'text' },
    { stage: 2, action: 'call' },
    { stage: 3, action: 'double_call' },
    { stage: 4, action: 'text' },
    { stage: 5, action: 'call' },
  ]

  for (let i = 0; i < stages.length && i < delays.length; i++) {
    const scheduledFor = new Date(now.getTime() + delays[i] * 60 * 1000)

    const result = await scheduleTask({
      tenantId,
      taskType: 'lead_followup',
      taskKey: `lead-${leadId}-stage-${stages[i].stage}`,
      scheduledFor,
      payload: {
        leadId,
        leadPhone,
        leadName,
        stage: stages[i].stage,
        action: stages[i].action,
      },
    })

    if (result.taskId) {
      taskIds.push(result.taskId)
    }
  }

  return { success: true, taskIds }
}

/**
 * Schedule job assignment broadcast with escalation
 */
export async function scheduleJobBroadcast(
  tenantId: string,
  jobId: string,
  teamLeadIds: string[]
): Promise<{ success: boolean; taskIds: string[] }> {
  const taskIds: string[] = []
  const now = new Date()

  const phases = [
    { phase: 'initial', delay: 0 },
    { phase: 'urgent', delay: 10 * 60 * 1000 }, // 10 minutes
    { phase: 'escalate', delay: 20 * 60 * 1000 }, // 20 minutes
  ]

  for (const { phase, delay } of phases) {
    const result = await scheduleTask({
      tenantId,
      taskType: 'job_broadcast',
      taskKey: `job-${jobId}-broadcast-${phase}`,
      scheduledFor: new Date(now.getTime() + delay),
      payload: {
        jobId,
        teamLeadIds,
        phase,
      },
    })

    if (result.taskId) {
      taskIds.push(result.taskId)
    }
  }

  return { success: true, taskIds }
}

/**
 * Schedule day-before reminder for a job
 */
export async function scheduleDayBeforeReminder(
  tenantId: string,
  jobId: string,
  customerPhone: string,
  customerName: string,
  appointmentDate: string
): Promise<{ success: boolean; taskId?: string }> {
  // Calculate timestamp for day before at 4 PM local time
  const appointmentDateObj = new Date(appointmentDate)
  appointmentDateObj.setDate(appointmentDateObj.getDate() - 1)
  appointmentDateObj.setHours(16, 0, 0, 0)

  return await scheduleTask({
    tenantId,
    taskType: 'day_before_reminder',
    taskKey: `reminder-${jobId}-day-before`,
    scheduledFor: appointmentDateObj,
    payload: {
      jobId,
      customerPhone,
      customerName,
      type: 'day_before',
    },
  })
}

// ==================== RETARGETING SEQUENCES ====================

export type RetargetingSequenceType = 'unresponsive' | 'quoted_not_booked' | 'one_time' | 'lapsed' | 'new_lead' | 'repeat' | 'active' | 'lost'

interface RetargetingStep {
  step: number
  delay_days: number
  template: string // template key — message is built at send time using customer name + tenant context
}

/**
 * Sequence definitions based on research:
 * - unresponsive: 9-word reactivation (3 texts over 7 days)
 * - quoted_not_booked: Quote follow-up (4 texts over 7 days)
 * - one_time: Win-back (3 texts over 14 days)
 * - lapsed: "We miss you" (3 texts over 10 days)
 */
export const RETARGETING_SEQUENCES: Record<RetargetingSequenceType, RetargetingStep[]> = {
  unresponsive: [
    { step: 1, delay_days: 0, template: '9_word' },
    { step: 2, delay_days: 3, template: 'value_nudge' },
    { step: 3, delay_days: 7, template: 'closing_file' },
  ],
  quoted_not_booked: [
    { step: 1, delay_days: 0, template: 'quote_followup' },
    { step: 2, delay_days: 2, template: 'question_based' },
    { step: 3, delay_days: 5, template: 'limited_time' },
    { step: 4, delay_days: 7, template: 'closing_file' },
  ],
  one_time: [
    { step: 1, delay_days: 0, template: 'we_miss_you' },
    { step: 2, delay_days: 7, template: 'seasonal_nudge' },
    { step: 3, delay_days: 14, template: 'closing_file' },
  ],
  lapsed: [
    { step: 1, delay_days: 0, template: 'feedback_ask' },
    { step: 2, delay_days: 5, template: 'incentive_offer' },
    { step: 3, delay_days: 10, template: 'closing_file' },
  ],
  new_lead: [
    { step: 1, delay_days: 0, template: '9_word' },
    { step: 2, delay_days: 2, template: 'value_nudge' },
    { step: 3, delay_days: 5, template: 'closing_file' },
  ],
  repeat: [
    { step: 1, delay_days: 0, template: 'seasonal_nudge' },
    { step: 2, delay_days: 7, template: 'incentive_offer' },
  ],
  active: [
    { step: 1, delay_days: 0, template: 'seasonal_nudge' },
    { step: 2, delay_days: 7, template: 'value_nudge' },
  ],
  lost: [
    { step: 1, delay_days: 0, template: 'feedback_ask' },
    { step: 2, delay_days: 5, template: 'incentive_offer' },
    { step: 3, delay_days: 10, template: 'closing_file' },
  ],
}

/**
 * SMS templates per retargeting step.
 * {name} = customer first name, {service} = tenant service type (e.g. "cleaning", "window washing")
 */
export const RETARGETING_TEMPLATES: Record<string, string> = {
  // 9-word reactivation — proven highest response rate for dead leads
  '9_word': 'Hi {name}, are you still looking for {service}?',
  // Gentle value nudge
  'value_nudge': 'Hi {name}, just checking in — we have availability this week for {service}. Want me to get you on the schedule?',
  // Quote follow-up
  'quote_followup': 'Hi {name}, following up on your {service} quote. Any questions? Happy to adjust — just reply here.',
  // Question-based
  'question_based': 'Hi {name}, was there anything holding you back from booking? We\'re happy to work with your schedule or budget.',
  // Limited time
  'limited_time': 'Hi {name}, we have a couple openings this week for {service}. Want me to hold a spot for you?',
  // We miss you — for one-time customers
  'we_miss_you': 'Hi {name}! It\'s been a while since we took care of your {service}. Ready for another round? Reply to book.',
  // Seasonal nudge
  'seasonal_nudge': 'Hi {name}, the season is changing — perfect time for {service}. Want us to get you scheduled?',
  // Feedback ask — for lapsed
  'feedback_ask': 'Hi {name}, we noticed it\'s been a while. Was there anything we could\'ve done better? We\'d love to earn your business back.',
  // Incentive offer
  'incentive_offer': 'Hi {name}, we\'d love to have you back. Reply YES and we\'ll get you priority scheduling for your next {service}.',
  // Closing file — triggers loss aversion, highest response message in any sequence
  'closing_file': 'Hi {name}, we\'re updating our records. Should I close out your file, or are you still interested in {service}? No pressure either way.',
}

/**
 * Schedule a retargeting sequence for a customer.
 * Creates scheduled_tasks for each step in the sequence.
 */
export async function scheduleRetargetingSequence(
  tenantId: string,
  customerId: number,
  customerPhone: string,
  customerName: string,
  sequence: RetargetingSequenceType,
): Promise<{ success: boolean; taskIds: string[] }> {
  const steps = RETARGETING_SEQUENCES[sequence]
  if (!steps) return { success: false, taskIds: [] }

  const taskIds: string[] = []
  const now = new Date()

  for (const step of steps) {
    const scheduledFor = new Date(now.getTime() + step.delay_days * 24 * 60 * 60 * 1000)

    const result = await scheduleTask({
      tenantId,
      taskType: 'retargeting',
      taskKey: `retarget-${customerId}-${sequence}-step-${step.step}`,
      scheduledFor,
      payload: {
        customerId,
        customerPhone,
        customerName,
        sequence,
        step: step.step,
        template: step.template,
      },
    })

    if (result.taskId) {
      taskIds.push(result.taskId)
    }
  }

  // Update customer retargeting status
  const supabase = getSupabase()
  await supabase
    .from('customers')
    .update({
      retargeting_sequence: sequence,
      retargeting_step: 1,
      retargeting_enrolled_at: now.toISOString(),
      retargeting_completed_at: null,
      retargeting_stopped_reason: null,
    })
    .eq('id', customerId)

  return { success: true, taskIds }
}
