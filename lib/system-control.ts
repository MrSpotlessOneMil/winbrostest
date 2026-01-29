import { getSupabaseClient } from './supabase'
import { toE164 } from './phone-utils'
import { logSystemEvent } from './system-events'

const SYSTEM_CONTROL_ID = 'global'

function isMissingSystemControlsError(error: { code?: string | null; message?: string | null }) {
  if (!error) return false
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  if (!error.message) return false
  return error.message.includes('system_controls') || error.message.includes('schema cache')
}

async function getSystemControlStateFromEvents(): Promise<SystemControlState | null> {
  try {
    const client = getSupabaseClient()
    const { data, error } = await client
      .from('system_events')
      .select('event_type, created_at, metadata')
      .in('event_type', ['SYSTEM_DISABLED', 'SYSTEM_ENABLED'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) {
      console.error('Error fetching system control state from events:', error)
      return null
    }

    if (!data || data.length === 0) {
      return {
        id: SYSTEM_CONTROL_ID,
        is_disabled: false,
        updated_at: null,
      }
    }

    const latest = data[0] as {
      event_type?: string | null
      created_at?: string | null
      metadata?: Record<string, unknown> | null
    }

    const metadata = (latest.metadata || {}) as Record<string, unknown>
    const reason = typeof metadata.reason === 'string' ? metadata.reason : null
    const disabledBy = typeof metadata.disabled_by === 'string' ? metadata.disabled_by : null
    const disabledByUsername =
      typeof metadata.disabled_by_username === 'string' ? metadata.disabled_by_username : null

    return {
      id: SYSTEM_CONTROL_ID,
      is_disabled: latest.event_type === 'SYSTEM_DISABLED',
      disabled_reason: reason,
      disabled_by: disabledBy,
      disabled_by_username: disabledByUsername,
      updated_at: latest.created_at ?? null,
    }
  } catch (error) {
    console.error('Error fetching system control state from events:', error)
    return null
  }
}

export type SystemControlState = {
  id: string
  is_disabled: boolean
  disabled_reason?: string | null
  disabled_by?: string | null
  disabled_by_username?: string | null
  updated_at?: string | null
}

export async function getSystemControlState(): Promise<SystemControlState | null> {
  try {
    const client = getSupabaseClient()
    const { data, error } = await client
      .from('system_controls')
      .select('*')
      .eq('id', SYSTEM_CONTROL_ID)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return {
          id: SYSTEM_CONTROL_ID,
          is_disabled: false,
          updated_at: null,
        }
      }
      if (isMissingSystemControlsError(error)) {
        return await getSystemControlStateFromEvents()
      }
      console.error('Error fetching system control state:', error)
      return null
    }

    return data as SystemControlState
  } catch (error) {
    console.error('Error fetching system control state:', error)
    if (isMissingSystemControlsError(error as { code?: string | null; message?: string | null })) {
      return await getSystemControlStateFromEvents()
    }
    return null
  }
}

export async function isSystemDisabled(): Promise<boolean> {
  const state = await getSystemControlState()
  return Boolean(state?.is_disabled)
}

export async function setSystemDisabled(
  disabled: boolean,
  options: {
    disabledBy?: string
    disabledByUsername?: string
    reason?: string
  } = {}
): Promise<SystemControlState | null> {
  try {
    const client = getSupabaseClient()
    const now = new Date().toISOString()
    const payload = {
      id: SYSTEM_CONTROL_ID,
      is_disabled: disabled,
      disabled_reason: options.reason || null,
      disabled_by: options.disabledBy || null,
      disabled_by_username: options.disabledByUsername || null,
      updated_at: now,
    }

    const { data, error } = await client
      .from('system_controls')
      .upsert(payload, { onConflict: 'id' })
      .select()
      .single()

    if (error) {
      if (isMissingSystemControlsError(error)) {
        await logSystemEvent({
          source: 'system',
          event_type: disabled ? 'SYSTEM_DISABLED' : 'SYSTEM_ENABLED',
          message: disabled
            ? `System disabled${options.reason ? `: ${options.reason}` : ''}.`
            : 'System re-enabled.',
          metadata: {
            disabled_by: options.disabledBy || null,
            disabled_by_username: options.disabledByUsername || null,
            reason: options.reason || null,
          },
        })

        return {
          id: SYSTEM_CONTROL_ID,
          is_disabled: disabled,
          disabled_reason: options.reason || null,
          disabled_by: options.disabledBy || null,
          disabled_by_username: options.disabledByUsername || null,
          updated_at: now,
        }
      }
      console.error('Error updating system control state:', error)
      return null
    }

    await logSystemEvent({
      source: 'system',
      event_type: disabled ? 'SYSTEM_DISABLED' : 'SYSTEM_ENABLED',
      message: disabled
        ? `System disabled${options.reason ? `: ${options.reason}` : ''}.`
        : 'System re-enabled.',
      metadata: {
        disabled_by: options.disabledBy || null,
        disabled_by_username: options.disabledByUsername || null,
        reason: options.reason || null,
      },
    })

    return data as SystemControlState
  } catch (error) {
    console.error('Error updating system control state:', error)
    return null
  }
}

export type ResetCustomerResult = {
  success: boolean
  normalizedPhones: string[]
  remaining: Record<string, number>
  errors: string[]
}

export async function resetCustomersByPhone(phoneNumbers: string[]): Promise<ResetCustomerResult> {
  const normalizedPhones = Array.from(
    new Set(phoneNumbers.map(phone => toE164(phone)).filter(Boolean))
  )

  if (normalizedPhones.length === 0) {
    return {
      success: false,
      normalizedPhones: [],
      remaining: {},
      errors: ['No valid phone numbers provided.'],
    }
  }

  const client = getSupabaseClient()
  const errors: string[] = []

  const isMissingTableError = (error: { code?: string | null; message?: string | null }) => {
    if (!error) return false
    return error.code === '42P01' || Boolean(error.message?.includes('does not exist'))
  }

  const deleteWithWarning = async (table: string, column: string) => {
    const { error } = await client
      .from(table)
      .delete()
      .in(column, normalizedPhones)
    if (error && !isMissingTableError(error)) {
      errors.push(`${table}: ${error.message}`)
      console.error(`Error deleting from ${table}:`, error)
    }
  }

  await deleteWithWarning('customers', 'phone_number')
  await deleteWithWarning('calls', 'phone_number')
  await deleteWithWarning('jobs', 'phone_number')
  await deleteWithWarning('system_events', 'phone_number')
  await deleteWithWarning('leads', 'phone_number')
  await deleteWithWarning('followup_queue', 'phone_number')

  const countRemaining = async (table: string, column: string): Promise<number> => {
    const { count, error } = await client
      .from(table)
      .select('*', { count: 'exact', head: true })
      .in(column, normalizedPhones)
    if (error && !isMissingTableError(error)) {
      errors.push(`${table} count: ${error.message}`)
      console.error(`Error counting ${table}:`, error)
      return -1
    }
    if (error && isMissingTableError(error)) {
      return 0
    }
    return count || 0
  }

  const remaining: Record<string, number> = {
    customers: await countRemaining('customers', 'phone_number'),
    calls: await countRemaining('calls', 'phone_number'),
    jobs: await countRemaining('jobs', 'phone_number'),
    system_events: await countRemaining('system_events', 'phone_number'),
    leads: await countRemaining('leads', 'phone_number'),
    followup_queue: await countRemaining('followup_queue', 'phone_number'),
  }

  const success = Object.values(remaining).every(count => count === 0)

  return {
    success,
    normalizedPhones,
    remaining,
    errors,
  }
}
