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
    const { data, error } = await supabase
      .from('scheduled_tasks')
      .upsert(
        {
          tenant_id: options.tenantId,
          task_type: options.taskType,
          task_key: options.taskKey,
          scheduled_for: options.scheduledFor.toISOString(),
          payload: options.payload,
          max_attempts: options.maxAttempts || 3,
          status: 'pending',
        },
        {
          onConflict: 'task_key',
          ignoreDuplicates: true, // Don't update if exists
        }
      )
      .select('id')
      .single()

    if (error) {
      // Handle unique constraint violation (task already scheduled)
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
