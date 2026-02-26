/**
 * WinBros-specific availability checker for VAPI.
 *
 * Same response format as choose-team but:
 * - No bedrooms, bathrooms, sqft, or service type
 * - Only takes requested_datetime
 * - Fixed 30-min estimate duration
 * - Prioritizes 8am slots in alternatives
 * - Only looks at WinBros salesmen and estimate jobs
 */

import { getSupabaseServiceClient } from './supabase'
import { getCleanerBlockedDates } from './supabase'
import type { VapiAvailabilityResponse } from './vapi-choose-team'

// ── Constants ──────────────────────────────────────────────────
const TIMEZONE = 'America/Los_Angeles'
const ESTIMATE_DURATION_HOURS = 0.5 // 30 minutes
const BUFFER_MINUTES = 15
const STEP_MINUTES = 30
const SLOT_START_MINUTES = 8 * 60 // 8:00 AM
const LAST_SLOT_MINUTES = 15 * 60 // 3:00 PM
const MAX_DAYS_AHEAD = 7
const WINBROS_TENANT_ID = 'e954fbd6-b3e1-4271-88b0-341c9df56beb'

// ── Types ──────────────────────────────────────────────────────

type Salesman = {
  id: number
  name: string
  maxJobsPerDay: number
}

type ScheduledSlot = {
  salesmanId: number
  date: string
  timeMinutes: number
}

// ── Helpers ────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
}

function pickFirst(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key) &&
        obj[key] !== null && obj[key] !== undefined && obj[key] !== '') {
      return obj[key]
    }
  }
  return null
}

function addMinutes(date: Date, mins: number): Date {
  return new Date(date.getTime() + mins * 60 * 1000)
}

function getPacificOffset(date: Date): string {
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }))
  const pstDate = new Date(date.toLocaleString('en-US', { timeZone: TIMEZONE }))
  const diffMinutes = (utcDate.getTime() - pstDate.getTime()) / 60000
  const hours = Math.floor(Math.abs(diffMinutes) / 60)
  const mins = Math.abs(diffMinutes) % 60
  const sign = diffMinutes <= 0 ? '+' : '-'
  return `${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

function toIsoWithTimezone(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const options = { timeZone: TIMEZONE, hour12: false }
  const year = new Intl.DateTimeFormat('en-US', { ...options, year: 'numeric' }).format(date)
  const month = new Intl.DateTimeFormat('en-US', { ...options, month: '2-digit' }).format(date)
  const day = new Intl.DateTimeFormat('en-US', { ...options, day: '2-digit' }).format(date)
  const hour = new Intl.DateTimeFormat('en-US', { ...options, hour: '2-digit' }).format(date)
  const minute = new Intl.DateTimeFormat('en-US', { ...options, minute: '2-digit' }).format(date)
  const second = new Intl.DateTimeFormat('en-US', { ...options, second: '2-digit' }).format(date)
  const resolvedHour = hour === '24' ? '00' : hour
  const offset = getPacificOffset(date)
  return `${year}-${month}-${day}T${pad(Number(resolvedHour))}:${pad(Number(minute))}:${pad(Number(second))}${offset}`
}

function createPacificDate(year: number, month: number, day: number, hour: number, minute: number, second = 0): Date {
  const monthStr = String(month + 1).padStart(2, '0')
  const dayStr = String(day).padStart(2, '0')
  const hourStr = String(hour).padStart(2, '0')
  const minStr = String(minute).padStart(2, '0')
  const secStr = String(second).padStart(2, '0')
  const isPDT = (month > 2 && month < 10) || (month === 2 && day >= 8) || (month === 10 && day < 1)
  const offset = isPDT ? '-07:00' : '-08:00'
  return new Date(`${year}-${monthStr}-${dayStr}T${hourStr}:${minStr}:${secStr}${offset}`)
}

function parseDateFlexible(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null

  const raw = String(value).trim()
  if (!raw) return null

  // ISO with timezone offset
  if (raw.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)) {
    const native = new Date(raw)
    if (Number.isFinite(native.getTime())) return native
  }

  // "2026-02-25 10:00:00" or "2026-02-25 10:00 AM"
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i)
  if (match) {
    let hour = Number(match[4])
    const ampm = match[7] ? String(match[7]).toUpperCase() : null
    if (ampm === 'PM' && hour < 12) hour += 12
    if (ampm === 'AM' && hour === 12) hour = 0
    return createPacificDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, Number(match[5]), match[6] ? Number(match[6]) : 0)
  }

  // "2026-02-25"
  match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (match) {
    return createPacificDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9, 0, 0)
  }

  // "02/25/2026 10:00 AM"
  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i)
  if (match) {
    let hour = Number(match[4])
    const ampm = match[7] ? String(match[7]).toUpperCase() : null
    if (ampm === 'PM' && hour < 12) hour += 12
    if (ampm === 'AM' && hour === 12) hour = 0
    return createPacificDate(Number(match[3]), Number(match[1]) - 1, Number(match[2]), hour, Number(match[5]), match[6] ? Number(match[6]) : 0)
  }

  // ISO with Z or offset
  if (raw.includes('T') && (raw.includes('Z') || raw.match(/[+-]\d{2}:\d{2}$/))) {
    const native = new Date(raw)
    if (Number.isFinite(native.getTime())) return native
  }

  // Natural language: "February 26 2026 8am", "feb 26 8:00 am", etc.
  const normalized = raw.toLowerCase().replace(/\./g, '').replace(/,/g, ' ')
    .replace(/(st|nd|rd|th)/g, '').replace(/\s+/g, ' ').trim()
  const parts = normalized.split(' ').filter(Boolean)

  let nMonth: number | null = null
  let nDay: number | null = null
  let nYear: number | null = null
  let nHour: number | null = null
  let nMinute = 0
  let isPM = false
  let isAM = false

  for (const part of parts) {
    const monthMatch = MONTH_MAP[part] ?? MONTH_MAP[part.slice(0, 3)]
    if (monthMatch !== undefined) { nMonth = monthMatch; continue }
    if (part === 'am') { isAM = true; continue }
    if (part === 'pm') { isPM = true; continue }
    const timeMatch = part.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/)
    if (timeMatch) {
      nHour = Number(timeMatch[1])
      nMinute = timeMatch[2] ? Number(timeMatch[2]) : 0
      if (timeMatch[3] === 'pm') isPM = true
      if (timeMatch[3] === 'am') isAM = true
      continue
    }
    if (/^\d{4}$/.test(part)) { nYear = Number(part); continue }
    if (/^\d{1,2}$/.test(part)) {
      const num = Number(part)
      if (num >= 1 && num <= 31 && nDay === null) nDay = num
      else if (nHour === null && num >= 0 && num <= 23) nHour = num
    }
  }

  if (nHour !== null) {
    if (isPM && nHour < 12) nHour += 12
    if (isAM && nHour === 12) nHour = 0
  }
  if (nYear === null) {
    const now = new Date()
    nYear = now.getFullYear()
    if (nMonth !== null && nDay !== null) {
      const testDate = new Date(nYear, nMonth, nDay)
      if (testDate < now) nYear += 1
    }
  }
  if (nHour === null) nHour = 9
  if (nMonth !== null && nDay !== null && nYear !== null) {
    return createPacificDate(nYear, nMonth, nDay, nHour, nMinute, 0)
  }

  return null
}

function getPacificNow() {
  const now = new Date()
  const opts = { timeZone: TIMEZONE } as const
  const year = Number(new Intl.DateTimeFormat('en-US', { ...opts, year: 'numeric' }).format(now))
  const month = Number(new Intl.DateTimeFormat('en-US', { ...opts, month: 'numeric' }).format(now))
  const day = Number(new Intl.DateTimeFormat('en-US', { ...opts, day: 'numeric' }).format(now))
  const hour = Number(new Intl.DateTimeFormat('en-US', { ...opts, hour: 'numeric', hour12: false }).format(now))
  const minute = Number(new Intl.DateTimeFormat('en-US', { ...opts, minute: 'numeric' }).format(now))
  return { year, month, day, hour: hour === 24 ? 0 : hour, minute }
}

function parseScheduledAt(value: string | null | undefined): number | null {
  if (!value) return null
  const raw = value.trim().toLowerCase()
  const match = raw.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i)
  if (match) {
    let hour = Number(match[1])
    const minute = Number(match[2])
    const ampm = match[3].toLowerCase()
    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0
    return hour * 60 + minute
  }
  const match24 = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (match24) return Number(match24[1]) * 60 + Number(match24[2])
  return null
}

function formatTimeFromMinutes(totalMinutes: number): string {
  const hours24 = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  const period = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 === 0 ? 12 : hours24 > 12 ? hours24 - 12 : hours24
  return `${hours12}:${String(mins).padStart(2, '0')} ${period}`
}

function getNextCandidateDates(count: number): string[] {
  const pacific = getPacificNow()
  const todayMinutes = pacific.hour * 60 + pacific.minute
  const skipToday = todayMinutes >= LAST_SLOT_MINUTES

  const dates: string[] = []
  const cursor = new Date(pacific.year, pacific.month - 1, pacific.day)
  if (skipToday) cursor.setDate(cursor.getDate() + 1)

  while (dates.length < count) {
    if (cursor.getDay() !== 0) { // Skip Sundays
      const yyyy = cursor.getFullYear()
      const mm = String(cursor.getMonth() + 1).padStart(2, '0')
      const dd = String(cursor.getDate()).padStart(2, '0')
      dates.push(`${yyyy}-${mm}-${dd}`)
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

// ── Core Logic ─────────────────────────────────────────────────

/**
 * Check if a specific time slot is available for any WinBros salesman.
 */
function isSlotAvailable(
  requestedTimeMinutes: number,
  requestedDate: string,
  salesmen: Salesman[],
  scheduleMap: Map<number, Map<string, Set<number>>>,
  jobCountMap: Map<number, Map<string, number>>,
  blockedDatesMap: Map<number, Set<string>>
): boolean {
  // Must be within working hours (8am - 3pm)
  if (requestedTimeMinutes < SLOT_START_MINUTES || requestedTimeMinutes > LAST_SLOT_MINUTES) {
    return false
  }

  for (const salesman of salesmen) {
    if (blockedDatesMap.get(salesman.id)?.has(requestedDate)) continue
    const dayCount = jobCountMap.get(salesman.id)?.get(requestedDate) || 0
    if (dayCount >= salesman.maxJobsPerDay) continue
    const daySlots = scheduleMap.get(salesman.id)?.get(requestedDate) || new Set()
    if (!daySlots.has(requestedTimeMinutes)) {
      return true // At least one salesman is free
    }
  }
  return false
}

/**
 * Find alternative available slots, prioritizing 8am slots.
 * Returns ISO datetime strings with Pacific timezone.
 */
function findAlternatives(
  count: number,
  salesmen: Salesman[],
  scheduleMap: Map<number, Map<string, Set<number>>>,
  jobCountMap: Map<number, Map<string, number>>,
  blockedDatesMap: Map<number, Set<string>>,
  allDates: string[]
): string[] {
  const pacific = getPacificNow()
  const todayStr = `${pacific.year}-${String(pacific.month).padStart(2, '0')}-${String(pacific.day).padStart(2, '0')}`
  const nowMinutes = pacific.hour * 60 + pacific.minute

  const alternatives: string[] = []

  // Phase 1: Prioritize 8am slots across the next few days
  for (const date of allDates) {
    if (alternatives.length >= count) break
    if (date === todayStr && nowMinutes >= SLOT_START_MINUTES + 90) continue // Need 90 min buffer

    if (isSlotAvailable(SLOT_START_MINUTES, date, salesmen, scheduleMap, jobCountMap, blockedDatesMap)) {
      const [year, month, day] = date.split('-').map(Number)
      const slotDate = createPacificDate(year, month - 1, day, 8, 0)
      alternatives.push(toIsoWithTimezone(slotDate))
    }
  }

  // Phase 2: Fill remaining with other available slots (walking forward)
  if (alternatives.length < count) {
    for (const date of allDates) {
      if (alternatives.length >= count) break

      for (let slotMin = SLOT_START_MINUTES; slotMin <= LAST_SLOT_MINUTES; slotMin += STEP_MINUTES) {
        if (alternatives.length >= count) break
        if (date === todayStr && slotMin <= nowMinutes + 90) continue

        // Skip 8am — already handled in Phase 1
        if (slotMin === SLOT_START_MINUTES) continue

        if (isSlotAvailable(slotMin, date, salesmen, scheduleMap, jobCountMap, blockedDatesMap)) {
          const [year, month, day] = date.split('-').map(Number)
          const hours = Math.floor(slotMin / 60)
          const mins = slotMin % 60
          const slotDate = createPacificDate(year, month - 1, day, hours, mins)
          const iso = toIsoWithTimezone(slotDate)
          if (!alternatives.includes(iso)) {
            alternatives.push(iso)
          }
        }
      }
    }
  }

  return alternatives
}

// ── Main Export ────────────────────────────────────────────────

export async function getWinBrosAvailabilityResponse(
  payload: Record<string, unknown>,
  tenantId?: string | null
): Promise<VapiAvailabilityResponse> {
  const LOG = '[VAPI choose-team-winbros]'
  const resolvedTenantId = tenantId || WINBROS_TENANT_ID

  // 1. Extract requested datetime (the ONLY input)
  const requestedStartRaw = pickFirst(payload, [
    'requested_datetime', 'requestedDatetime', 'requested_start', 'requestedStart',
    'start', 'start_time', 'startTime', 'datetime', 'date_time', 'dateTime',
    'date', 'time', 'appointment_time', 'appointmentTime', 'booking_time', 'scheduledTime',
  ])

  const requestedStart = parseDateFlexible(requestedStartRaw)

  if (!requestedStart) {
    console.warn(`${LOG} No valid requested_datetime. Raw: ${JSON.stringify(requestedStartRaw)}`)
    return {
      is_available: false,
      confirmed_datetime: null,
      alternatives: [],
      duration_hours: ESTIMATE_DURATION_HOURS,
      error: 'MISSING_FIELDS',
      missing_fields: ['requested_datetime'],
      debug: {
        received: { requested_datetime: requestedStartRaw },
        payload_keys: Object.keys(payload),
        payload_preview: JSON.stringify(payload).slice(0, 500),
        hint: 'Provide requested_datetime in ISO format (e.g. 2026-02-26T08:00:00-08:00)',
      },
    }
  }

  // Minimum buffer: shift requests too close to "now" out 1.5 hours
  const MIN_BUFFER_MS = 90 * 60 * 1000
  const now = Date.now()
  let adjustedStart = requestedStart
  if (adjustedStart.getTime() < now + MIN_BUFFER_MS) {
    adjustedStart = new Date(now + MIN_BUFFER_MS)
  }

  console.log(`${LOG} Checking availability at ${adjustedStart.toISOString()} for tenant ${resolvedTenantId}`)

  // 2. Load active salesmen
  const client = getSupabaseServiceClient()
  const { data: salesmenRows, error: salesmenError } = await client
    .from('cleaners')
    .select('id, name, max_jobs_per_day')
    .eq('tenant_id', resolvedTenantId)
    .eq('employee_type', 'salesman')
    .eq('active', true)
    .is('deleted_at', null)

  if (salesmenError) {
    console.error(`${LOG} Error loading salesmen:`, salesmenError.message)
    return {
      is_available: false,
      confirmed_datetime: null,
      alternatives: [],
      duration_hours: ESTIMATE_DURATION_HOURS,
      error: 'DB_ERROR',
    }
  }

  const salesmen: Salesman[] = (salesmenRows || []).map(s => ({
    id: s.id,
    name: s.name || 'Salesman',
    maxJobsPerDay: Number(s.max_jobs_per_day) || 8,
  }))

  if (salesmen.length === 0) {
    console.error(`${LOG} No salesmen found for tenant ${resolvedTenantId}`)
    return {
      is_available: false,
      confirmed_datetime: null,
      alternatives: [],
      duration_hours: ESTIMATE_DURATION_HOURS,
      error: 'NO_TEAMS_CONFIGURED',
    }
  }

  console.log(`${LOG} Found ${salesmen.length} salesmen: ${salesmen.map(s => s.name).join(', ')}`)

  // 3. Get candidate dates
  const allDates = getNextCandidateDates(MAX_DAYS_AHEAD)

  // 4. Load existing estimate jobs
  const { data: jobRows, error: jobError } = await client
    .from('jobs')
    .select('id, date, scheduled_at, team_id, status')
    .eq('tenant_id', resolvedTenantId)
    .eq('job_type', 'estimate')
    .in('date', allDates)
    .neq('status', 'cancelled')

  if (jobError) {
    console.error(`${LOG} Error loading jobs:`, jobError.message)
    return {
      is_available: false,
      confirmed_datetime: null,
      alternatives: [],
      duration_hours: ESTIMATE_DURATION_HOURS,
      error: 'DB_ERROR',
    }
  }

  const jobs = jobRows || []
  const jobIds = jobs.map(j => j.id)

  // Load cleaner assignments
  let assignments: Array<{ job_id: number; cleaner_id: number }> = []
  if (jobIds.length > 0) {
    const { data: assignmentRows } = await client
      .from('cleaner_assignments')
      .select('job_id, cleaner_id, status')
      .in('job_id', jobIds)
      .not('status', 'in', '("cancelled","declined")')

    assignments = (assignmentRows || []) as Array<{ job_id: number; cleaner_id: number }>
  }

  // Load blocked dates
  const blockedDatesMap = new Map<number, Set<string>>()
  for (const s of salesmen) {
    const blocked = await getCleanerBlockedDates(s.id, allDates[0], allDates[allDates.length - 1])
    if (blocked.length > 0) {
      blockedDatesMap.set(s.id, new Set(blocked.map(b => b.date)))
    }
  }

  // 5. Build schedule map: salesmanId → date → set of occupied time slots
  const assignmentByJobId = new Map<number, number>()
  for (const a of assignments) assignmentByJobId.set(a.job_id, a.cleaner_id)

  const scheduleMap = new Map<number, Map<string, Set<number>>>()
  const jobCountMap = new Map<number, Map<string, number>>()
  for (const s of salesmen) {
    scheduleMap.set(s.id, new Map())
    jobCountMap.set(s.id, new Map())
  }

  for (const job of jobs) {
    const cleanerId = assignmentByJobId.get(job.id) ?? null
    if (cleanerId === null || !scheduleMap.has(cleanerId)) continue

    const dateMap = scheduleMap.get(cleanerId)!
    if (!dateMap.has(job.date)) dateMap.set(job.date, new Set())

    const timeMinutes = parseScheduledAt(job.scheduled_at)
    if (timeMinutes !== null) dateMap.get(job.date)!.add(timeMinutes)

    const countMap = jobCountMap.get(cleanerId)!
    countMap.set(job.date, (countMap.get(job.date) || 0) + 1)
  }

  // 6. Check requested time
  // Extract date and time from the adjusted start
  const pacificOpts = { timeZone: TIMEZONE, hour12: false } as const
  const reqYear = new Intl.DateTimeFormat('en-US', { ...pacificOpts, year: 'numeric' }).format(adjustedStart)
  const reqMonth = new Intl.DateTimeFormat('en-US', { ...pacificOpts, month: '2-digit' }).format(adjustedStart)
  const reqDay = new Intl.DateTimeFormat('en-US', { ...pacificOpts, day: '2-digit' }).format(adjustedStart)
  const reqHourRaw = Number(new Intl.DateTimeFormat('en-US', { ...pacificOpts, hour: '2-digit' }).format(adjustedStart))
  const reqMinute = Number(new Intl.DateTimeFormat('en-US', { ...pacificOpts, minute: '2-digit' }).format(adjustedStart))
  const reqHour = reqHourRaw === 24 ? 0 : reqHourRaw

  const requestedDate = `${reqYear}-${reqMonth}-${reqDay}`
  const requestedTimeMinutes = reqHour * 60 + (Number.isNaN(reqMinute) ? 0 : reqMinute)

  // Snap to nearest 30-min slot
  const snappedMinutes = Math.round(requestedTimeMinutes / STEP_MINUTES) * STEP_MINUTES

  console.log(`${LOG} Requested: ${requestedDate} at ${formatTimeFromMinutes(snappedMinutes)} (${snappedMinutes} min)`)

  // Find alternatives (always, regardless of availability)
  const alternatives = findAlternatives(
    2, salesmen, scheduleMap, jobCountMap, blockedDatesMap, allDates
  )

  // Check if requested slot is available
  const available = isSlotAvailable(snappedMinutes, requestedDate, salesmen, scheduleMap, jobCountMap, blockedDatesMap)

  if (available) {
    const confirmedIso = toIsoWithTimezone(adjustedStart)
    console.log(`${LOG} AVAILABLE at ${confirmedIso}`)
    return {
      is_available: true,
      confirmed_datetime: confirmedIso,
      alternatives,
      duration_hours: ESTIMATE_DURATION_HOURS,
    }
  }

  // Not available
  console.log(`${LOG} Requested time unavailable. Alternatives: ${alternatives.join(', ')}`)

  if (alternatives.length === 0) {
    return {
      is_available: false,
      confirmed_datetime: null,
      alternatives: [],
      duration_hours: ESTIMATE_DURATION_HOURS,
      error: 'NO_AVAILABILITY_FOUND',
    }
  }

  return {
    is_available: false,
    confirmed_datetime: null,
    alternatives,
    duration_hours: ESTIMATE_DURATION_HOURS,
  }
}
