import type { Cleaner, Job } from './supabase'
import { getClientConfig } from './client-config'

const CONNECTEAM_BASE_URL = 'https://api.connecteam.com'

export type ConnecteamShiftResult = {
  success: boolean
  shiftId?: string
  error?: string
}

function isConnecteamEnabled(): boolean {
  const config = getClientConfig()
  return (
    config.features.connecteam &&
    Boolean(process.env.CONNECTEAM_API_KEY) &&
    Boolean(process.env.CONNECTEAM_SCHEDULER_ID)
  )
}

function getTimeZone(): string {
  return process.env.CONNECTEAM_TIMEZONE || 'America/Los_Angeles'
}

function getTimezoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const values: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value
    }
  }

  const utcTime = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  )

  return utcTime - date.getTime()
}

function toEpochSeconds(dateStr: string, timeStr: string, timeZone: string): number | null {
  const [year, month, day] = dateStr.split('-').map(Number)
  const timeParts = timeStr.split(':').map(Number)
  const hour = timeParts[0] ?? 0
  const minute = timeParts[1] ?? 0
  const second = timeParts[2] ?? 0

  if (![year, month, day].every(Number.isFinite) || !Number.isFinite(hour)) {
    return null
  }

  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  const offsetMs = getTimezoneOffsetMs(utcDate, timeZone)
  return Math.floor((utcDate.getTime() - offsetMs) / 1000)
}

function resolveShiftTimes(job: Job, timeZone: string): { start: number; end: number } | null {
  if (!job.date || !job.scheduled_at) {
    return null
  }

  const start = toEpochSeconds(job.date, job.scheduled_at, timeZone)
  if (!start) {
    return null
  }

  let duration = typeof job.hours === 'number' ? job.hours : 0
  if (!duration) {
    duration = 4
  }

  const end = start + Math.round(duration * 3600)
  return { start, end }
}

export async function createConnecteamShift(
  job: Job,
  cleaner: Cleaner
): Promise<ConnecteamShiftResult> {
  if (!isConnecteamEnabled()) {
    return { success: false, error: 'Connecteam not enabled' }
  }

  const schedulerId = process.env.CONNECTEAM_SCHEDULER_ID as string
  const apiKey = process.env.CONNECTEAM_API_KEY as string
  const timeZone = getTimeZone()

  const userId = Number(cleaner.connecteam_user_id)
  if (!Number.isFinite(userId)) {
    return { success: false, error: 'Cleaner missing Connecteam user ID' }
  }

  const times = resolveShiftTimes(job, timeZone)
  if (!times) {
    return { success: false, error: 'Missing job date/time for Connecteam shift' }
  }

  const payload = [
    {
      title: 'NEW JOB: CHECK TELEGRAM',
      assignedUserIds: [userId],
      startTime: times.start,
      endTime: times.end,
      timezone: timeZone,
      isPublished: true,
      isOpenShift: false,
    },
  ]

  try {
    const response = await fetch(
      `${CONNECTEAM_BASE_URL}/scheduler/v1/schedulers/${schedulerId}/shifts`,
      {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    )

    const text = await response.text()
    if (!response.ok) {
      return { success: false, error: `Connecteam API error: ${response.status} ${text}` }
    }

    const data = text ? JSON.parse(text) : null
    const shiftId =
      data?.shifts?.[0]?.id ||
      data?.[0]?.id ||
      data?.id ||
      data?.result?.[0]?.id

    return { success: true, shiftId: shiftId ? String(shiftId) : undefined }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Connecteam error'
    return { success: false, error: message }
  }
}
