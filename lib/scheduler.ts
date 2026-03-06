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
 * - quoted_not_booked: Quote follow-up (6 texts over 14 days)
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
    { step: 3, delay_days: 4, template: 'limited_time' },
    { step: 4, delay_days: 7, template: 'check_in' },
    { step: 5, delay_days: 10, template: 'social_proof' },
    { step: 6, delay_days: 14, template: 'closing_file' },
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
 * SMS templates per retargeting step — A/B tested.
 * Each template has variant 'a' (default) and 'b' (challenger).
 * {name} = customer first name, {service} = tenant service type (e.g. "cleaning", "window washing")
 */
export const RETARGETING_TEMPLATES: Record<string, { a: string; b: string }> = {
  '9_word': {
    a: 'Hey {name}! We have a couple openings for {service} this week — want me to save you a spot?',
    b: 'Hey {name}, quick question — are you still needing {service}? Reply YES and I\'ll get you on the schedule.',
  },
  'value_nudge': {
    a: 'Hi {name}, just finished a job near you and thought of you! We\'ve got one more opening this week for {service}. Want me to pencil you in?',
    b: 'Hi {name}, we have 2 spots left this week for {service}. Want me to grab one for you before they fill up?',
  },
  'quote_followup': {
    a: 'Hey {name}, your {service} quote is still good! Any questions or want to adjust anything? Just reply here — happy to work with you.',
    b: 'Hi {name}, following up on your quote — I can hold your spot if you want to lock it in this week. Just say the word!',
  },
  'question_based': {
    a: 'Hey {name}, totally get that timing matters. Is there anything we can do to make booking easier for you? We\'re flexible on scheduling.',
    b: 'Hi {name}, was there something we could do differently? Happy to work around your schedule or adjust the price.',
  },
  'limited_time': {
    a: 'Hey {name}, only 2 openings left this week for {service} — want me to hold one for you? They go fast!',
    b: 'Hi {name}, we just had a cancellation and have a spot open for {service}. Want it? Reply YES to grab it.',
  },
  'we_miss_you': {
    a: 'Hey {name}! It\'s been a minute — your place is probably due for {service} again. Want us to swing by? Reply YES to book.',
    b: 'Hi {name}, we were just in your area doing {service} and thought of you! Ready for another round? Just say when.',
  },
  'seasonal_nudge': {
    a: 'Hey {name}, perfect time of year for {service}! We\'re booking up this week — want me to squeeze you in?',
    b: 'Hi {name}, most of our customers are getting their {service} done right now. Want me to get you on the schedule too?',
  },
  'feedback_ask': {
    a: 'Hey {name}, real quick — was there anything we could\'ve done better last time? We\'d love another chance to impress you.',
    b: 'Hi {name}, just checking in. If there\'s anything we can improve, I\'d love to hear it. Either way, we\'d love to have you back!',
  },
  'incentive_offer': {
    a: 'Hey {name}, we\'d love to have you back! Reply YES and I\'ll get you priority scheduling for your next {service}.',
    b: 'Hi {name}, we\'re offering priority booking to returning customers this week. Want me to put you at the top of the list for {service}?',
  },
  'check_in': {
    a: 'Hey {name}, just circling back — still interested in {service}? I can work with you on timing or price. What would make this a yes?',
    b: 'Hi {name}, wanted to make sure your quote didn\'t slip through the cracks. We\'ve got availability this week — want me to book you in?',
  },
  'social_proof': {
    a: 'Hey {name}, just wrapped up {service} for a neighbor nearby and they loved it! We\'d love to take care of your place too. Reply YES to book.',
    b: 'Hi {name}, we\'ve been busy in your area doing {service} — your neighbors are loving the results! Want us to swing by yours too?',
  },
  'closing_file': {
    a: 'Hey {name}, last check-in from me! We\'d love to have you back for {service} but no pressure. Reply YES to book, otherwise I\'ll stop reaching out.',
    b: 'Hi {name}, I\'m cleaning up my list — should I keep you on it for {service}, or would you rather I stop texting? Either way, no hard feelings!',
  },
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

  // A/B test: randomly assign variant for the entire sequence
  const variant = Math.random() < 0.5 ? 'a' : 'b'

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
        variant,
      },
    })

    if (result.taskId) {
      taskIds.push(result.taskId)
    }
  }

  // Update customer retargeting status + A/B variant
  const supabase = getSupabase()
  await supabase
    .from('customers')
    .update({
      retargeting_sequence: sequence,
      retargeting_step: 1,
      retargeting_enrolled_at: now.toISOString(),
      retargeting_completed_at: null,
      retargeting_stopped_reason: null,
      retargeting_variant: variant,
      retargeting_replied_at: null,
    })
    .eq('id', customerId)

  return { success: true, taskIds }
}
