import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getCleanerBlockedDates } from '@/lib/supabase'
import { resolveTenantFromCall } from '@/lib/vapi-utils'

// ── Constants ──────────────────────────────────────────────────
const TIMEZONE = 'America/Los_Angeles'
const ESTIMATE_DURATION_MINUTES = 30
const SLOT_START_MINUTES = 8 * 60  // 8:00 AM
const LAST_SLOT_MINUTES = 15 * 60  // 3:00 PM
const SLOT_STEP_MINUTES = 30
const MAX_LOOKAHEAD_DAYS = 7
const WINBROS_TENANT_ID = 'e954fbd6-b3e1-4271-88b0-341c9df56beb'

// ── Helpers ────────────────────────────────────────────────────

function formatTimeFromMinutes(totalMinutes: number): string {
  const hours24 = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  const period = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 === 0 ? 12 : hours24 > 12 ? hours24 - 12 : hours24
  return `${hours12}:${String(mins).padStart(2, '0')} ${period}`
}

function formatDateHuman(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${day}`
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
  if (match24) {
    return Number(match24[1]) * 60 + Number(match24[2])
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

// ── Main handler ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const LOG = '[VAPI winbros-get-times]'

  // Resolve tenant from call metadata, fallback to WinBros
  let tenantId: string | null = null
  try {
    tenantId = await resolveTenantFromCall(request)
  } catch {
    // ignore — will use fallback
  }
  const resolvedTenantId = tenantId || WINBROS_TENANT_ID

  console.log(`${LOG} Fetching available times for tenant ${resolvedTenantId}`)

  const client = getSupabaseServiceClient()

  // 1. Load active salesmen for this tenant
  const { data: salesmenRows, error: salesmenError } = await client
    .from('cleaners')
    .select('id, name, max_jobs_per_day')
    .eq('tenant_id', resolvedTenantId)
    .eq('employee_type', 'salesman')
    .eq('active', true)
    .is('deleted_at', null)

  if (salesmenError) {
    console.error(`${LOG} Error loading salesmen:`, salesmenError.message)
    return NextResponse.json({
      available: false,
      message: 'Unable to check availability right now. Please try again.',
      slots: [],
    })
  }

  const salesmen = (salesmenRows || []).map(s => ({
    id: s.id,
    name: s.name || 'Salesman',
    maxJobsPerDay: Number(s.max_jobs_per_day) || 8,
  }))

  if (salesmen.length === 0) {
    console.error(`${LOG} No salesmen found for tenant ${resolvedTenantId}`)
    return NextResponse.json({
      available: false,
      message: 'No team members available at this time.',
      slots: [],
    })
  }

  console.log(`${LOG} Found ${salesmen.length} salesmen: ${salesmen.map(s => s.name).join(', ')}`)

  // 2. Get candidate dates (next 7 working days, skip Sundays)
  const allDates = getNextCandidateDates(MAX_LOOKAHEAD_DAYS)

  // 3. Load existing estimate jobs for the date range
  const { data: jobRows, error: jobError } = await client
    .from('jobs')
    .select('id, date, scheduled_at, team_id, status')
    .eq('tenant_id', resolvedTenantId)
    .eq('job_type', 'estimate')
    .in('date', allDates)
    .neq('status', 'cancelled')

  if (jobError) {
    console.error(`${LOG} Error loading jobs:`, jobError.message)
    return NextResponse.json({
      available: false,
      message: 'Unable to check availability right now. Please try again.',
      slots: [],
    })
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

  // Load blocked dates for all salesmen
  const blockedDatesMap = new Map<number, Set<string>>()
  for (const s of salesmen) {
    const blocked = await getCleanerBlockedDates(s.id, allDates[0], allDates[allDates.length - 1])
    if (blocked.length > 0) {
      blockedDatesMap.set(s.id, new Set(blocked.map(b => b.date)))
    }
  }

  // 4. Build schedule map: salesmanId → date → set of occupied time slots
  const assignmentByJobId = new Map<number, number>()
  for (const a of assignments) {
    assignmentByJobId.set(a.job_id, a.cleaner_id)
  }

  const scheduleMap = new Map<number, Map<string, Set<number>>>()
  for (const s of salesmen) {
    scheduleMap.set(s.id, new Map())
  }

  // Count jobs per salesman per date
  const jobCountMap = new Map<number, Map<string, number>>()
  for (const s of salesmen) {
    jobCountMap.set(s.id, new Map())
  }

  for (const job of jobs) {
    const cleanerId = assignmentByJobId.get(job.id) ?? null
    if (cleanerId === null) continue
    if (!scheduleMap.has(cleanerId)) continue

    const dateMap = scheduleMap.get(cleanerId)!
    if (!dateMap.has(job.date)) dateMap.set(job.date, new Set())

    const timeMinutes = parseScheduledAt(job.scheduled_at)
    if (timeMinutes !== null) {
      dateMap.get(job.date)!.add(timeMinutes)
    }

    // Count
    const countMap = jobCountMap.get(cleanerId)!
    countMap.set(job.date, (countMap.get(job.date) || 0) + 1)
  }

  // 5. Find available slots
  const pacific = getPacificNow()
  const todayStr = `${pacific.year}-${String(pacific.month).padStart(2, '0')}-${String(pacific.day).padStart(2, '0')}`
  const nowMinutes = pacific.hour * 60 + pacific.minute

  type AvailableSlot = { date: string; dateHuman: string; time: string; timeMinutes: number }
  const availableSlots: AvailableSlot[] = []
  const seenSlots = new Set<string>() // dedup by "date|timeMinutes"

  // Phase 1: Prioritize 8am slots (first 3 days)
  const priorityDates = allDates.slice(0, 3)
  for (const date of priorityDates) {
    if (date === todayStr && nowMinutes >= SLOT_START_MINUTES + ESTIMATE_DURATION_MINUTES) continue

    for (const salesman of salesmen) {
      if (blockedDatesMap.get(salesman.id)?.has(date)) continue
      const daySlots = scheduleMap.get(salesman.id)?.get(date) || new Set()
      const dayCount = jobCountMap.get(salesman.id)?.get(date) || 0
      if (dayCount >= salesman.maxJobsPerDay) continue

      if (!daySlots.has(SLOT_START_MINUTES)) {
        const key = `${date}|${SLOT_START_MINUTES}`
        if (!seenSlots.has(key)) {
          seenSlots.add(key)
          availableSlots.push({
            date,
            dateHuman: formatDateHuman(date),
            time: formatTimeFromMinutes(SLOT_START_MINUTES),
            timeMinutes: SLOT_START_MINUTES,
          })
        }
        break // one 8am slot per date is enough
      }
    }
  }

  // Phase 2: Fill remaining slots across all dates
  for (const date of allDates) {
    for (let slotMin = SLOT_START_MINUTES; slotMin <= LAST_SLOT_MINUTES; slotMin += SLOT_STEP_MINUTES) {
      if (date === todayStr && slotMin <= nowMinutes + 90) continue

      const key = `${date}|${slotMin}`
      if (seenSlots.has(key)) continue

      // Check if ANY salesman is available at this slot
      let slotAvailable = false
      for (const salesman of salesmen) {
        if (blockedDatesMap.get(salesman.id)?.has(date)) continue
        const daySlots = scheduleMap.get(salesman.id)?.get(date) || new Set()
        const dayCount = jobCountMap.get(salesman.id)?.get(date) || 0
        if (dayCount >= salesman.maxJobsPerDay) continue
        if (!daySlots.has(slotMin)) {
          slotAvailable = true
          break
        }
      }

      if (slotAvailable) {
        seenSlots.add(key)
        availableSlots.push({
          date,
          dateHuman: formatDateHuman(date),
          time: formatTimeFromMinutes(slotMin),
          timeMinutes: slotMin,
        })
      }
    }

    // Cap at ~20 slots total to keep the response manageable for the AI
    if (availableSlots.length >= 20) break
  }

  // Sort: earliest date first, then earliest time
  availableSlots.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date)
    if (dateCompare !== 0) return dateCompare
    return a.timeMinutes - b.timeMinutes
  })

  // Return top slots (keep it concise for the AI)
  const topSlots = availableSlots.slice(0, 15)

  console.log(`${LOG} Returning ${topSlots.length} available slots`)

  if (topSlots.length === 0) {
    return NextResponse.json({
      available: false,
      message: 'No available time slots found in the next 7 days.',
      slots: [],
    })
  }

  // Format for VAPI: group by date for readability
  const slotsByDate: Record<string, string[]> = {}
  for (const slot of topSlots) {
    if (!slotsByDate[slot.dateHuman]) slotsByDate[slot.dateHuman] = []
    slotsByDate[slot.dateHuman].push(slot.time)
  }

  return NextResponse.json({
    available: true,
    message: `We have ${topSlots.length} available time slots in the next week.`,
    slots: topSlots.map(s => ({ date: s.dateHuman, time: s.time })),
    slots_by_date: slotsByDate,
  })
}
