import { getSupabaseClient } from './supabase'

const BUFFER_MINUTES = 15
const STEP_MINUTES = 30
const MAX_DAYS_AHEAD = 14
const TIMEZONE = 'America/Los_Angeles'

type AvailabilityRule = {
  days: number[]
  startMin: number
  endMin: number
}

type AvailabilitySchedule = {
  tz: string
  rules: AvailabilityRule[]
  is24_7: boolean
}

type Team = {
  name: string
  availability: unknown
  _availability: AvailabilitySchedule
}

type JobBlock = {
  team: string
  start: Date
  end: Date
}

export type VapiAvailabilityResponse = {
  is_available: boolean
  confirmed_datetime: string | null
  alternatives: string[]
  duration_hours: number | null
  error?: string
  missing_fields?: string[]
  debug?:
    | {
        received: Record<string, unknown>
        payload_keys: string[]
        payload_preview: string
        hint: string
      }
    | {
        bedrooms: number
        bathrooms: number
        sqft: number
        serviceType: string
      }
}

const PRICING = {
  Standard: {
    1: {
      1: { 800: { hours: 4, price: 200 } },
      1.5: { 899: { hours: 4, price: 206.25 } },
      2: { 999: { hours: 4.5, price: 212.5 } },
    },
    2: {
      1: { 999: { hours: 4.5, price: 237.5 } },
      1.5: { 1249: { hours: 5.25, price: 256.25 } },
      2: { 1250: { hours: 5.5, price: 262.5 } },
      2.5: { 1251: { hours: 5.5, price: 287.5 } },
      3: { 1499: { hours: 5.5, price: 300 } },
    },
    3: {
      1: { 999: { hours: 6, price: 325 } },
      1.5: { 1249: { hours: 6, price: 350 } },
      2: { 1500: { hours: 3.5, price: 362.5 } },
      2.5: { 1749: { hours: 3.75, price: 387.5 } },
      3: { 1999: { hours: 4, price: 400 } },
      3.5: { 2000: { hours: 4, price: 431.25 } },
      4: { 2001: { hours: 4.5, price: 437.5 } },
    },
    4: {
      1: { 1999: { hours: 4.25, price: 425 } },
      1.5: { 2000: { hours: 4.5, price: 450 } },
      2: { 2124: { hours: 4.75, price: 475 } },
      2.5: { 2249: { hours: 4.75, price: 500 } },
      3: { 2374: { hours: 5.25, price: 525 } },
      3.5: { 2500: { hours: 5.75, price: 550 } },
      4: { 2501: { hours: 6, price: 575 } },
      4.5: { 2750: { hours: 6.25, price: 631.25 } },
      5: { 2999: { hours: 6.5, price: 681.25 } },
    },
    5: {
      1: { 2999: { hours: 4.5, price: 737.5 } },
      1.5: { 3249: { hours: 4.5, price: 762.5 } },
      2: { 3250: { hours: 4.5, price: 768.75 } },
      2.5: { 3251: { hours: 4.75, price: 806.25 } },
      3: { 3499: { hours: 4.75, price: 825 } },
      3.5: { 3500: { hours: 5, price: 868.75 } },
      4: { 3501: { hours: 5.25, price: 900 } },
      4.5: { 3750: { hours: 5.25, price: 943.75 } },
      5: { 3999: { hours: 5.5, price: 981.25 } },
      5.5: { 4000: { hours: 5.75, price: 1025 } },
      6: { 4001: { hours: 5.75, price: 1075 } },
    },
    6: {
      1: { 3499: { hours: 5.25, price: 1125 } },
      1.5: { 3749: { hours: 5.25, price: 1137.5 } },
      2: { 3750: { hours: 5.25, price: 1150 } },
      2.5: { 3751: { hours: 5.25, price: 1200 } },
      3: { 3999: { hours: 5.5, price: 1250 } },
      3.5: { 4000: { hours: 5.5, price: 1300 } },
      4: { 4001: { hours: 5.75, price: 1350 } },
      4.5: { 4250: { hours: 5.75, price: 1412.5 } },
      5: { 4499: { hours: 6, price: 1462.5 } },
      5.5: { 4500: { hours: 6, price: 1512.5 } },
      6: { 4501: { hours: 6.25, price: 1562.5 } },
      6.5: { 4750: { hours: 6.25, price: 1625 } },
      7: { 4999: { hours: 6.5, price: 1675 } },
    },
    7: {
      1: { 3999: { hours: 5.5, price: 1725 } },
      1.5: { 4249: { hours: 5.5, price: 1768.75 } },
      2: { 4250: { hours: 5.5, price: 1775 } },
      2.5: { 4251: { hours: 5.5, price: 1825 } },
      3: { 4499: { hours: 5.75, price: 1875 } },
      3.5: { 4500: { hours: 5.75, price: 1925 } },
      4: { 4501: { hours: 6, price: 1975 } },
      4.5: { 4750: { hours: 6, price: 2037.5 } },
      5: { 4999: { hours: 6.25, price: 2100 } },
      5.5: { 5000: { hours: 6.25, price: 2175 } },
      6: { 5001: { hours: 6.5, price: 2250 } },
      6.5: { 5250: { hours: 6.5, price: 2325 } },
      7: { 5499: { hours: 6.5, price: 2400 } },
      7.5: { 5500: { hours: 6.5, price: 2475 } },
      8: { 5501: { hours: 6.75, price: 2550 } },
    },
    8: {
      1: { 4499: { hours: 5.75, price: 2625 } },
      1.5: { 4749: { hours: 5.75, price: 2687.5 } },
      2: { 4750: { hours: 5.75, price: 2700 } },
      2.5: { 4751: { hours: 5.75, price: 2775 } },
      3: { 4999: { hours: 6, price: 2850 } },
      3.5: { 5000: { hours: 6, price: 2925 } },
      4: { 5001: { hours: 6, price: 3000 } },
      4.5: { 5250: { hours: 6.25, price: 3075 } },
      5: { 5499: { hours: 6.25, price: 3150 } },
      5.5: { 5500: { hours: 6.25, price: 3225 } },
      6: { 5501: { hours: 6.5, price: 3300 } },
      6.5: { 5750: { hours: 6.5, price: 3375 } },
      7: { 5999: { hours: 6.5, price: 3450 } },
      7.5: { 6000: { hours: 6.5, price: 3525 } },
      8: { 6001: { hours: 6.75, price: 3600 } },
      8.5: { 6002: { hours: 6.75, price: 3675 } },
      9: { 6003: { hours: 6.75, price: 3750 } },
    },
    9: {
      1: { 4999: { hours: 6.75, price: 3825 } },
      1.5: { 5249: { hours: 6.75, price: 3893.75 } },
      2: { 5250: { hours: 6.75, price: 3900 } },
      2.5: { 5251: { hours: 7, price: 3975 } },
      3: { 5499: { hours: 7, price: 4050 } },
      3.5: { 5500: { hours: 7, price: 4125 } },
      4: { 5501: { hours: 7.25, price: 4200 } },
      4.5: { 5750: { hours: 7.25, price: 4275 } },
      5: { 5999: { hours: 7.25, price: 4350 } },
      5.5: { 6000: { hours: 7.5, price: 4425 } },
      6: { 6001: { hours: 7.5, price: 4500 } },
      6.5: { 6002: { hours: 7.5, price: 4575 } },
      7: { 6003: { hours: 7.75, price: 4650 } },
      7.5: { 6004: { hours: 7.75, price: 4725 } },
      8: { 6005: { hours: 7.75, price: 4800 } },
      8.5: { 6006: { hours: 8, price: 4875 } },
      9: { 6007: { hours: 8, price: 4950 } },
    },
  },
  'Deep Clean': {
    1: {
      1: { 800: { hours: 4.5, price: 225 } },
      1.5: { 899: { hours: 5, price: 250 } },
      2: { 999: { hours: 5.5, price: 262.5 } },
    },
    2: {
      1: { 999: { hours: 5.5, price: 287.5 } },
      1.5: { 1249: { hours: 6.25, price: 312.5 } },
      2: { 1250: { hours: 6.5, price: 325 } },
      2.5: { 1251: { hours: 7, price: 350 } },
      3: { 1499: { hours: 7, price: 362.5 } },
    },
    3: {
      1: { 999: { hours: 4, price: 387.5 } },
      1.5: { 1249: { hours: 4.25, price: 412.5 } },
      2: { 1500: { hours: 4.5, price: 425 } },
      2.5: { 1749: { hours: 4.75, price: 475 } },
      3: { 1999: { hours: 5, price: 475 } },
      3.5: { 2000: { hours: 5.25, price: 525 } },
      4: { 2001: { hours: 5.5, price: 575 } },
    },
    4: {
      1: { 1999: { hours: 6.25, price: 575 } },
      1.5: { 2000: { hours: 6.5, price: 600 } },
      2: { 2001: { hours: 6.5, price: 625 } },
      2.5: { 2249: { hours: 6.75, price: 700 } },
      3: { 2499: { hours: 7.5, price: 725 } },
      3.5: { 2500: { hours: 7.75, price: 775 } },
      4: { 2501: { hours: 8, price: 775 } },
      4.5: { 2750: { hours: 8.25, price: 837.5 } },
      5: { 2999: { hours: 8.5, price: 887.5 } },
    },
    5: {
      1: { 2999: { hours: 6, price: 937.5 } },
      1.5: { 3249: { hours: 6, price: 968.75 } },
      2: { 3250: { hours: 6, price: 975 } },
      2.5: { 3251: { hours: 6.25, price: 1025 } },
      3: { 3499: { hours: 6.25, price: 1050 } },
      3.5: { 3500: { hours: 6.5, price: 1100 } },
      4: { 3501: { hours: 6.75, price: 1150 } },
      4.5: { 3750: { hours: 6.75, price: 1212.5 } },
      5: { 3999: { hours: 7, price: 1262.5 } },
      5.5: { 4000: { hours: 7.25, price: 1312.5 } },
      6: { 4001: { hours: 7.25, price: 1362.5 } },
    },
    6: {
      1: { 3499: { hours: 6.5, price: 1412.5 } },
      1.5: { 3749: { hours: 6.75, price: 1456.25 } },
      2: { 3750: { hours: 6.75, price: 1462.5 } },
      2.5: { 3751: { hours: 6.75, price: 1512.5 } },
      3: { 3999: { hours: 7, price: 1562.5 } },
      3.5: { 4000: { hours: 7, price: 1612.5 } },
      4: { 4001: { hours: 7.25, price: 1662.5 } },
      4.5: { 4250: { hours: 7.25, price: 1737.5 } },
      5: { 4499: { hours: 7.5, price: 1812.5 } },
      5.5: { 4500: { hours: 7.5, price: 1875 } },
      6: { 4501: { hours: 7.75, price: 1950 } },
      6.5: { 4750: { hours: 7.75, price: 2025 } },
      7: { 4999: { hours: 8, price: 2100 } },
    },
    7: {
      1: { 3999: { hours: 6.75, price: 2175 } },
      1.5: { 4249: { hours: 6.75, price: 2243.75 } },
      2: { 4250: { hours: 6.75, price: 2250 } },
      2.5: { 4251: { hours: 7, price: 2325 } },
      3: { 4499: { hours: 7, price: 2400 } },
      3.5: { 4500: { hours: 7.25, price: 2475 } },
      4: { 4501: { hours: 7.25, price: 2550 } },
      4.5: { 4750: { hours: 7.5, price: 2625 } },
      5: { 4999: { hours: 7.5, price: 2700 } },
      5.5: { 5000: { hours: 7.5, price: 2775 } },
      6: { 5001: { hours: 7.75, price: 2850 } },
      6.5: { 5250: { hours: 7.75, price: 2925 } },
      7: { 5499: { hours: 7.75, price: 3000 } },
      7.5: { 5500: { hours: 8, price: 3075 } },
      8: { 5501: { hours: 8, price: 3150 } },
    },
    8: {
      1: { 4499: { hours: 7, price: 3225 } },
      1.5: { 4749: { hours: 7, price: 3293.75 } },
      2: { 4750: { hours: 7, price: 3300 } },
      2.5: { 4751: { hours: 7, price: 3375 } },
      3: { 4999: { hours: 7.25, price: 3450 } },
      3.5: { 5000: { hours: 7.25, price: 3525 } },
      4: { 5001: { hours: 7.25, price: 3600 } },
      4.5: { 5250: { hours: 7.5, price: 3675 } },
      5: { 5499: { hours: 7.5, price: 3750 } },
      5.5: { 5500: { hours: 7.5, price: 3825 } },
      6: { 5501: { hours: 7.75, price: 3900 } },
      6.5: { 5750: { hours: 7.75, price: 3975 } },
      7: { 5999: { hours: 7.75, price: 4050 } },
      7.5: { 6000: { hours: 8, price: 4125 } },
      8: { 6001: { hours: 8, price: 4200 } },
      8.5: { 6002: { hours: 8, price: 4275 } },
      9: { 6003: { hours: 8.25, price: 4350 } },
    },
    9: {
      1: { 4999: { hours: 8, price: 4425 } },
      1.5: { 5249: { hours: 8, price: 4493.75 } },
      2: { 5250: { hours: 8, price: 4500 } },
      2.5: { 5251: { hours: 8.25, price: 4575 } },
      3: { 5499: { hours: 8.25, price: 4650 } },
      3.5: { 5500: { hours: 8.25, price: 4725 } },
      4: { 5501: { hours: 8.5, price: 4800 } },
      4.5: { 5750: { hours: 8.5, price: 4875 } },
      5: { 5999: { hours: 8.5, price: 4950 } },
      5.5: { 6000: { hours: 8.75, price: 5025 } },
      6: { 6001: { hours: 8.75, price: 5100 } },
      6.5: { 6002: { hours: 8.75, price: 5175 } },
      7: { 6003: { hours: 9, price: 5250 } },
      7.5: { 6004: { hours: 9, price: 5325 } },
      8: { 6005: { hours: 9.25, price: 5400 } },
      8.5: { 6006: { hours: 9.25, price: 5475 } },
      9: { 6007: { hours: 9.25, price: 5550 } },
    },
  },
} as const

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
}

const DAY_MAP: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
}

const ISO_DAY_MAP: Record<string, number> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 0,
}

function pickFirst(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (
      obj &&
      Object.prototype.hasOwnProperty.call(obj, key) &&
      obj[key] !== null &&
      obj[key] !== undefined &&
      obj[key] !== ''
    ) {
      return obj[key]
    }
  }
  return null
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  return null
}

function toIdString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return Number.NaN
  if (typeof value === 'number') return value
  const trimmed = String(value).trim()
  if (!trimmed) return Number.NaN
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : Number.NaN
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

  return `${year}-${month}-${day}T${pad(Number(resolvedHour))}:${pad(Number(minute))}:${pad(
    Number(second)
  )}${offset}`
}

function getLocalTimeComponents(
  date: Date,
  timeZone: string
): {
  hour: number
  minute: number
  dayOfWeek: number
  totalMinutes: number
} {
  const options = { timeZone, hour12: false }
  const hourValue = Number(
    new Intl.DateTimeFormat('en-US', { ...options, hour: '2-digit' }).format(date)
  )
  const minuteValue = Number(
    new Intl.DateTimeFormat('en-US', { ...options, minute: '2-digit' }).format(date)
  )
  const weekday = new Intl.DateTimeFormat('en-US', { ...options, weekday: 'short' })
    .format(date)
    .toLowerCase()
  const dayOfWeek = DAY_MAP[weekday] ?? 0
  const hour = hourValue === 24 ? 0 : hourValue
  const minute = Number.isNaN(minuteValue) ? 0 : minuteValue
  return {
    hour,
    minute,
    dayOfWeek,
    totalMinutes: hour * 60 + minute,
  }
}

function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd
}

function createPacificDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0
): Date {
  const monthStr = String(month + 1).padStart(2, '0')
  const dayStr = String(day).padStart(2, '0')
  const hourStr = String(hour).padStart(2, '0')
  const minStr = String(minute).padStart(2, '0')
  const secStr = String(second).padStart(2, '0')

  const isPDT =
    (month > 2 && month < 10) ||
    (month === 2 && day >= 8) ||
    (month === 10 && day < 1)
  const offset = isPDT ? '-07:00' : '-08:00'

  const isoString = `${year}-${monthStr}-${dayStr}T${hourStr}:${minStr}:${secStr}${offset}`
  return new Date(isoString)
}

function parseDateFlexible(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null
  }

  const raw = String(value).trim()
  if (!raw) return null

  if (raw.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)) {
    const native = new Date(raw)
    if (Number.isFinite(native.getTime())) return native
  }

  let match = raw.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
  )
  if (match) {
    let hour = Number(match[4])
    const ampm = match[7] ? String(match[7]).toUpperCase() : null
    if (ampm === 'PM' && hour < 12) hour += 12
    if (ampm === 'AM' && hour === 12) hour = 0
    return createPacificDate(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      hour,
      Number(match[5]),
      match[6] ? Number(match[6]) : 0
    )
  }

  match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (match) {
    return createPacificDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9, 0, 0)
  }

  match = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
  )
  if (match) {
    let hour = Number(match[4])
    const ampm = match[7] ? String(match[7]).toUpperCase() : null
    if (ampm === 'PM' && hour < 12) hour += 12
    if (ampm === 'AM' && hour === 12) hour = 0
    return createPacificDate(
      Number(match[3]),
      Number(match[1]) - 1,
      Number(match[2]),
      hour,
      Number(match[5]),
      match[6] ? Number(match[6]) : 0
    )
  }

  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/)
  if (match) {
    return createPacificDate(
      Number(match[3]),
      Number(match[1]) - 1,
      Number(match[2]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6])
    )
  }

  if (raw.includes('T') && (raw.includes('Z') || raw.match(/[+-]\d{2}:\d{2}$/))) {
    const native = new Date(raw)
    if (Number.isFinite(native.getTime())) return native
  }

  const normalized = raw
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/,/g, ' ')
    .replace(/(st|nd|rd|th)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const parts = normalized.split(' ').filter(Boolean)

  let month: number | null = null
  let day: number | null = null
  let year: number | null = null
  let hour: number | null = null
  let minute = 0
  let isPM = false
  let isAM = false

  for (const part of parts) {
    const monthMatch = MONTH_MAP[part] ?? MONTH_MAP[part.slice(0, 3)]
    if (monthMatch !== undefined) {
      month = monthMatch
      continue
    }
    if (part === 'am') {
      isAM = true
      continue
    }
    if (part === 'pm') {
      isPM = true
      continue
    }
    const timeMatch = part.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/)
    if (timeMatch) {
      hour = Number(timeMatch[1])
      minute = timeMatch[2] ? Number(timeMatch[2]) : 0
      if (timeMatch[3] === 'pm') isPM = true
      if (timeMatch[3] === 'am') isAM = true
      continue
    }
    if (/^\d{4}$/.test(part)) {
      year = Number(part)
      continue
    }
    if (/^\d{1,2}$/.test(part)) {
      const num = Number(part)
      if (num >= 1 && num <= 31 && day === null) {
        day = num
      } else if (hour === null && num >= 0 && num <= 23) {
        hour = num
      }
    }
  }

  if (hour !== null) {
    if (isPM && hour < 12) hour += 12
    if (isAM && hour === 12) hour = 0
  }

  if (year === null) {
    const now = new Date()
    year = now.getFullYear()
    if (month !== null && day !== null) {
      const testDate = new Date(year, month, day)
      if (testDate < now) year += 1
    }
  }

  if (hour === null) hour = 9

  if (month !== null && day !== null && year !== null) {
    return createPacificDate(year, month, day, hour, minute, 0)
  }

  return null
}

function parseTimeToMinutes(value: unknown): number | null {
  const raw = String(value ?? '').trim().toLowerCase()
  let match = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (match) {
    const hour = Number(match[1])
    const minute = Number(match[2])
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return hour * 60 + minute
    }
  }
  match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/)
  if (match) {
    let hour = Number(match[1])
    const minute = match[2] ? Number(match[2]) : 0
    const ampm = match[3]
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null
    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0
    return hour * 60 + minute
  }
  return null
}

function parseAvailability(rawValue: unknown): AvailabilitySchedule {
  const fullAvailability: AvailabilitySchedule = {
    tz: TIMEZONE,
    rules: [],
    is24_7: true,
  }

  if (!rawValue) return fullAvailability

  if (typeof rawValue === 'string') {
    const raw = rawValue.trim()
    if (!raw) return fullAvailability
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        return parseAvailabilityObject(parsed)
      } catch (error) {
        console.warn('Invalid availability JSON string:', error)
        return fullAvailability
      }
    }
    return parseAvailabilityLegacy(raw)
  }

  if (typeof rawValue === 'object' && rawValue !== null) {
    return parseAvailabilityObject(rawValue as Record<string, unknown>)
  }

  return fullAvailability
}

function parseAvailabilityObject(rawValue: Record<string, unknown>): AvailabilitySchedule {
  const tz =
    typeof rawValue.tz === 'string' && rawValue.tz.trim() ? rawValue.tz.trim() : TIMEZONE
  const rawRules = Array.isArray(rawValue.rules) ? rawValue.rules : []
  const rules: AvailabilityRule[] = []

  for (const rule of rawRules) {
    if (!rule || typeof rule !== 'object') continue
    const record = rule as Record<string, unknown>
    const daysRaw = Array.isArray(record.days) ? record.days : []
    const days = daysRaw
      .map(day => (typeof day === 'string' ? day.trim().toUpperCase() : ''))
      .map(day => ISO_DAY_MAP[day])
      .filter((value): value is number => typeof value === 'number')

    const startMin = parseTimeToMinutes(record.start)
    const endMin = parseTimeToMinutes(record.end)
    if (!days.length || startMin === null || endMin === null) continue
    rules.push({ days, startMin, endMin })
  }

  if (!rules.length) {
    return { tz, rules: [], is24_7: true }
  }

  return { tz, rules, is24_7: false }
}

function parseAvailabilityLegacy(raw: string): AvailabilitySchedule {
  const fullAvailability: AvailabilitySchedule = {
    tz: TIMEZONE,
    rules: [],
    is24_7: true,
  }

  const lower = raw.toLowerCase()
  if (lower.includes('24/7') || lower.includes('24-7') || lower === 'always') {
    return fullAvailability
  }

  const parts = raw.split(/\s+/)
  if (parts.length < 2) return fullAvailability

  const timePart = parts[parts.length - 1]
  const daysPart = parts.slice(0, parts.length - 1).join(' ')

  const timeMatch = timePart.match(/^(.+)-(.+)$/)
  if (!timeMatch) return fullAvailability

  const startMin = parseTimeToMinutes(timeMatch[1])
  const endMin = parseTimeToMinutes(timeMatch[2])
  if (startMin === null || endMin === null) return fullAvailability

  const normalizedDays = daysPart.replace(/–/g, '-').toLowerCase()
  let days: number[] = []

  if (normalizedDays.includes(',')) {
    const chunks = normalizedDays
      .split(',')
      .map(chunk => chunk.trim())
      .filter(Boolean)
    for (const chunk of chunks) {
      const day = DAY_MAP[chunk] ?? DAY_MAP[chunk.slice(0, 3)]
      if (day !== undefined) days.push(day)
    }
  } else if (normalizedDays.includes('-')) {
    const [aRaw, bRaw] = normalizedDays.split('-').map(chunk => chunk.trim())
    const a = DAY_MAP[aRaw] ?? DAY_MAP[aRaw.slice(0, 3)]
    const b = DAY_MAP[bRaw] ?? DAY_MAP[bRaw.slice(0, 3)]
    if (a === undefined || b === undefined) return fullAvailability
    let current = a
    const seen = new Set<number>()
    while (!seen.has(current)) {
      seen.add(current)
      days.push(current)
      if (current === b) break
      current = (current + 1) % 7
    }
  } else {
    const day = DAY_MAP[normalizedDays] ?? DAY_MAP[normalizedDays.slice(0, 3)]
    if (day === undefined) return fullAvailability
    days = [day]
  }

  if (!days.length) return fullAvailability
  return {
    tz: TIMEZONE,
    rules: [{ days, startMin, endMin }],
    is24_7: false,
  }
}

function withinTeamHours(team: Team, candidateStart: Date, candidateEnd: Date): boolean {
  const schedule = team._availability
  if (schedule.is24_7) return true

  const startLocal = getLocalTimeComponents(candidateStart, schedule.tz || TIMEZONE)
  const endLocal = getLocalTimeComponents(candidateEnd, schedule.tz || TIMEZONE)

  const startMins = startLocal.totalMinutes
  const endMins = endLocal.totalMinutes

  if (endMins < startMins) {
    return false
  }

  for (const rule of schedule.rules) {
    if (!rule.days.includes(startLocal.dayOfWeek)) continue
    if (startMins >= rule.startMin && endMins <= rule.endMin) {
      return true
    }
  }

  return false
}

function lookupPricing(
  serviceType: string,
  bedrooms: number,
  bathrooms: number,
  sqft: number
): { hours: number; price: number } | null {
  const type = serviceType.toLowerCase().includes('deep') ? 'Deep Clean' : 'Standard'
  const table = PRICING[type as keyof typeof PRICING]
  if (!table) return null
  const bedTable = table[bedrooms as keyof typeof table]
  if (!bedTable) {
    const beds = Object.keys(table).map(Number).sort((a, b) => a - b)
    const closest = beds.reduce((prev, curr) =>
      Math.abs(curr - bedrooms) < Math.abs(prev - bedrooms) ? curr : prev
    )
    return lookupPricing(serviceType, closest, bathrooms, sqft)
  }
  const bathTable = bedTable[bathrooms as keyof typeof bedTable]
  if (!bathTable) {
    const baths = Object.keys(bedTable).map(Number).sort((a, b) => a - b)
    const closest = baths.reduce((prev, curr) =>
      Math.abs(curr - bathrooms) < Math.abs(prev - bathrooms) ? curr : prev
    )
    return lookupPricing(serviceType, bedrooms, closest, sqft)
  }
  const sqftTiers = Object.keys(bathTable).map(Number).sort((a, b) => a - b)
  const tier = sqftTiers.find(t => sqft <= t) || sqftTiers[sqftTiers.length - 1]
  const match = bathTable[tier as keyof typeof bathTable] as { hours: number; price: number }
  return match || null
}

function teamIsFree(team: Team, candidateStart: Date, candidateEnd: Date, jobs: JobBlock[]) {
  const theirJobs = jobs.filter(job => job.team.toLowerCase() === team.name.toLowerCase())
  for (const job of theirJobs) {
    if (intervalsOverlap(job.start, job.end, candidateStart, candidateEnd)) {
      return false
    }
  }
  return true
}

function anyTeamAvailable(candidateStart: Date, candidateEnd: Date, teams: Team[], jobs: JobBlock[]) {
  return teams.some(team => withinTeamHours(team, candidateStart, candidateEnd) && teamIsFree(team, candidateStart, candidateEnd, jobs))
}

function findAvailableSlots(
  startFrom: Date,
  count: number,
  durationHours: number,
  teams: Team[],
  jobs: JobBlock[]
): string[] {
  const slots: string[] = []
  let cursor = new Date(startFrom.getTime())
  const maxSteps = Math.floor((MAX_DAYS_AHEAD * 24 * 60) / STEP_MINUTES)
  for (let i = 0; i < maxSteps && slots.length < count; i += 1) {
    const end = addMinutes(cursor, durationHours * 60 + BUFFER_MINUTES)
    if (cursor.getTime() >= Date.now() && anyTeamAvailable(cursor, end, teams, jobs)) {
      const iso = toIsoWithTimezone(cursor)
      if (!slots.includes(iso)) {
        slots.push(iso)
      }
    }
    cursor = addMinutes(cursor, STEP_MINUTES)
  }
  return slots
}

async function fetchTeams(tenantId: string | null): Promise<Team[]> {
  const client = getSupabaseClient()
  let query = client
    .from('cleaners')
    .select('*')
    .eq('active', true)
    .is('deleted_at', null)

  if (tenantId) {
    query = query.eq('tenant_id', tenantId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching cleaners for availability:', error)
    return []
  }

  return (data || [])
    .map(row => {
      const record = row as Record<string, unknown>
      const name = firstString(record.name || record.Name) || ''
      const availability = record.availability ?? record.Availability
      if (!name) return null
      return {
        name,
        availability,
        _availability: parseAvailability(availability),
      }
    })
    .filter(Boolean) as Team[]
}

async function fetchJobs(tenantId: string | null): Promise<JobBlock[]> {
  const client = getSupabaseClient()
  let assignmentQuery = client
    .from('cleaner_assignments')
    .select('job_id, cleaner_id, status')

  if (tenantId) {
    assignmentQuery = assignmentQuery.eq('tenant_id', tenantId)
  }

  const { data: assignments, error: assignmentError } = await assignmentQuery

  if (assignmentError) {
    console.error('Error fetching cleaner assignments for availability:', assignmentError)
    return []
  }

  const activeAssignments = (assignments || []).filter(row => {
    const record = row as Record<string, unknown>
    const status = firstString(record.status)
    return status !== 'cancelled' && status !== 'declined'
  })

  const jobIds = Array.from(
    new Set(
      activeAssignments
        .map(row => (row as Record<string, unknown>).job_id)
        .filter(id => typeof id === 'string' && id.trim())
    )
  )

  if (jobIds.length === 0) return []

  let jobQuery = client
    .from('jobs')
    .select('id, date, scheduled_at, hours, status')
    .in('id', jobIds)
    .is('deleted_at', null)
    .not('status', 'eq', 'cancelled')

  if (tenantId) {
    jobQuery = jobQuery.eq('tenant_id', tenantId)
  }

  const { data: jobs, error: jobError } = await jobQuery

  if (jobError) {
    console.error('Error fetching jobs for availability:', jobError)
    return []
  }

  let cleanerQuery = client
    .from('cleaners')
    .select('id, name')
    .is('deleted_at', null)

  if (tenantId) {
    cleanerQuery = cleanerQuery.eq('tenant_id', tenantId)
  }

  const { data: cleaners, error: cleanerError } = await cleanerQuery
  if (cleanerError) {
    console.error('Error fetching cleaners for availability:', cleanerError)
    return []
  }

  const cleanerById = new Map<string, string>()
  for (const row of cleaners || []) {
    const record = row as Record<string, unknown>
    const id = toIdString(record.id)
    const name = firstString(record.name)
    if (id && name) {
      cleanerById.set(id, name)
    }
  }

  const jobById = new Map<string, Record<string, unknown>>()
  for (const row of jobs || []) {
    const record = row as Record<string, unknown>
    const id = toIdString(record.id)
    if (id) {
      jobById.set(id, record)
    }
  }

  const now = Date.now()
  const result: JobBlock[] = []

  for (const assignment of activeAssignments) {
    const record = assignment as Record<string, unknown>
    const jobId = toIdString(record.job_id)
    const cleanerId = toIdString(record.cleaner_id)
    if (!jobId || !cleanerId) continue

    const teamName = cleanerById.get(cleanerId)
    if (!teamName) continue

    const job = jobById.get(jobId)
    if (!job) continue

    const dateValue = pickFirst(job, ['date', 'Date'])
    const timeValue = pickFirst(job, ['scheduled_at', 'scheduledAt', 'time', 'start_time', 'startTime'])
    const durationValue = pickFirst(job, ['hours', 'duration_hours', 'duration'])
    const duration = toNumber(durationValue)
    if (!Number.isFinite(duration)) continue
    if (!dateValue) continue

    const startRaw = timeValue ? `${String(dateValue)} ${String(timeValue)}` : String(dateValue)
    const start = parseDateFlexible(startRaw)
    if (!start) continue
    if (start.getTime() < now) continue

    const end = addMinutes(start, duration * 60 + BUFFER_MINUTES)
    result.push({ team: teamName, start, end })
  }

  return result
}

export async function getVapiAvailabilityResponse(
  payload: Record<string, unknown>,
  tenantId?: string | null
): Promise<VapiAvailabilityResponse> {
  const allKeys = Object.keys(payload)
  const payloadPreview = JSON.stringify(payload).slice(0, 500)

  const bedrooms = toNumber(pickFirst(payload, ['bedrooms', 'Bedrooms', 'bed', 'beds', 'bedroom']))
  const bathrooms = toNumber(pickFirst(payload, ['bathrooms', 'Bathrooms', 'bath', 'baths', 'bathroom']))
  const sqft = toNumber(
    pickFirst(payload, [
      'sqft',
      'square_footage',
      'squareFootage',
      'sq_ft',
      'Square Footage',
      'squarefootage',
    ])
  )
  const serviceType =
    String(pickFirst(payload, ['service_type', 'serviceType', 'type', 'cleaning_type']) || 'Standard')

  const requestedStartRaw = pickFirst(payload, [
    'requested_datetime',
    'requestedDatetime',
    'requested_start',
    'requestedStart',
    'start',
    'start_time',
    'startTime',
    'datetime',
    'date_time',
    'dateTime',
    'date',
    'time',
    'appointment_time',
    'appointmentTime',
    'booking_time',
    'scheduledTime',
  ])

  const requestedStart = parseDateFlexible(requestedStartRaw)

  const missingFields: string[] = []
  if (!Number.isFinite(bedrooms)) missingFields.push('bedrooms')
  if (!Number.isFinite(bathrooms)) missingFields.push('bathrooms')
  if (!Number.isFinite(sqft)) missingFields.push('sqft')
  if (!requestedStart) missingFields.push('requested_datetime')

  if (missingFields.length > 0) {
    return {
      is_available: false,
      confirmed_datetime: null,
      alternatives: [],
      duration_hours: null,
      error: 'MISSING_FIELDS',
      missing_fields: missingFields,
      debug: {
        received: {
          bedrooms,
          bathrooms,
          sqft,
          requested_datetime: requestedStartRaw,
        },
        payload_keys: allKeys,
        payload_preview: payloadPreview,
        hint: 'Provide bedrooms, bathrooms, sqft, and requested_datetime in webhook body',
      },
    }
  }

  const pricingMatch = lookupPricing(serviceType, bedrooms, bathrooms, sqft)
  if (!pricingMatch) {
    return {
      is_available: false,
      confirmed_datetime: null,
      alternatives: [],
      duration_hours: null,
      error: 'NO_PRICING_MATCH',
      debug: {
        bedrooms,
        bathrooms,
        sqft,
        serviceType,
      },
    }
  }

  const durationHours = pricingMatch.hours

  // Minimum buffer: requests for "now" or very soon should be shifted 1.5 hours out
  const MIN_BUFFER_MS = 90 * 60 * 1000 // 1.5 hours in milliseconds
  const now = Date.now()
  let adjustedStart = requestedStart!
  if (adjustedStart.getTime() < now + MIN_BUFFER_MS) {
    adjustedStart = new Date(now + MIN_BUFFER_MS)
  }

  const adjustedEnd = addMinutes(adjustedStart, durationHours * 60 + BUFFER_MINUTES)

  const [teams, jobs] = await Promise.all([fetchTeams(tenantId || null), fetchJobs(tenantId || null)])

  console.log(`[VAPI choose-team] tenantId=${tenantId || 'null'}, teams=${teams.length}, jobs=${jobs.length}`)

  // If no teams/cleaners exist for this tenant, return immediately
  if (teams.length === 0) {
    return {
      is_available: false,
      confirmed_datetime: null,
      alternatives: [],
      duration_hours: durationHours,
      error: 'NO_TEAMS_CONFIGURED',
    }
  }

  // Always find 2 alternative slots regardless of availability
  const alternatives = findAvailableSlots(
    adjustedStart,
    2,
    durationHours,
    teams,
    jobs
  )

  if (anyTeamAvailable(adjustedStart, adjustedEnd, teams, jobs)) {
    return {
      is_available: true,
      confirmed_datetime: toIsoWithTimezone(adjustedStart),
      alternatives,
      duration_hours: durationHours,
    }
  }

  const unavailableResponse = {
    is_available: false,
    confirmed_datetime: null,
    alternatives,
    duration_hours: durationHours,
  }

  if (alternatives.length === 0) {
    return {
      ...unavailableResponse,
      error: 'NO_AVAILABILITY_FOUND',
    }
  }

  return unavailableResponse
}
