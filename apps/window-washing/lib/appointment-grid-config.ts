/**
 * Appointment grid configuration — WinBros Round 2 task 4.
 * Tweakable without a DB change. Flag to Max after first week of use.
 */

export const APPOINTMENT_GRID = {
  /** First visible slot (24-hour clock, inclusive) */
  startHour: 7,
  /** Last visible slot (24-hour clock, exclusive) */
  endHour: 19,
  /** Size of each column in minutes */
  slotMinutes: 60,
} as const

/**
 * Door-knock availability thresholds for the salesman portal strip.
 * A day with <= GREEN_MAX appointments renders green, <= YELLOW_MAX yellow,
 * else red. Tune with Max after the first week of use.
 */
export const AVAILABILITY_GREEN_MAX = 2
export const AVAILABILITY_YELLOW_MAX = 4

export function availabilityLevel(count: number): 'green' | 'yellow' | 'red' {
  if (count <= AVAILABILITY_GREEN_MAX) return 'green'
  if (count <= AVAILABILITY_YELLOW_MAX) return 'yellow'
  return 'red'
}

export function buildTimeSlots(): string[] {
  const slots: string[] = []
  const { startHour, endHour, slotMinutes } = APPOINTMENT_GRID
  const step = slotMinutes
  for (let minute = startHour * 60; minute < endHour * 60; minute += step) {
    const h = Math.floor(minute / 60)
    const m = minute % 60
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
  return slots
}

/** "14:30" → minutes since midnight. Returns NaN on malformed input. */
export function parseHHMM(hhmm: string | null | undefined): number {
  if (!hhmm || typeof hhmm !== 'string') return NaN
  const match = hhmm.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return NaN
  const h = Number(match[1])
  const m = Number(match[2])
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN
  return h * 60 + m
}

/**
 * Returns the time-slot label that a given "HH:MM" scheduled_at value belongs
 * to. Returns null if the value is outside the visible grid range.
 */
export function slotForTime(hhmm: string | null | undefined): string | null {
  const mins = parseHHMM(hhmm)
  if (Number.isNaN(mins)) return null
  const { startHour, endHour, slotMinutes } = APPOINTMENT_GRID
  if (mins < startHour * 60 || mins >= endHour * 60) return null
  const bucket = Math.floor((mins - startHour * 60) / slotMinutes) * slotMinutes + startHour * 60
  const h = Math.floor(bucket / 60)
  const m = bucket % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
