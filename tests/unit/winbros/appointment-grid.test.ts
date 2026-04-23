/**
 * Appointment grid config — Unit Tests (Round 2 Wave 2 task 4)
 *
 * Minimal logic (slot math), 3 input variants per operation.
 */

import { describe, it, expect } from 'vitest'
import {
  APPOINTMENT_GRID,
  buildTimeSlots,
  parseHHMM,
  slotForTime,
} from '@/apps/window-washing/lib/appointment-grid-config'

describe('buildTimeSlots', () => {
  it('variant 1 (default): 7am-7pm hourly → 12 slots', () => {
    const slots = buildTimeSlots()
    expect(slots.length).toBe(12)
    expect(slots[0]).toBe('07:00')
    expect(slots[slots.length - 1]).toBe('18:00')
  })

  it('variant 2: slot labels zero-pad both fields', () => {
    const slots = buildTimeSlots()
    for (const s of slots) {
      expect(s).toMatch(/^\d{2}:\d{2}$/)
    }
  })

  it('variant 3: endHour is exclusive (no 19:00 slot)', () => {
    const slots = buildTimeSlots()
    expect(slots).not.toContain(`${String(APPOINTMENT_GRID.endHour).padStart(2, '0')}:00`)
  })
})

describe('parseHHMM', () => {
  it('variant 1 (happy): "09:30" → 570 minutes', () => {
    expect(parseHHMM('09:30')).toBe(570)
  })

  it('variant 2 (edge): tolerates trailing seconds', () => {
    expect(parseHHMM('14:15:00')).toBe(14 * 60 + 15)
  })

  it('variant 3 (malformed): returns NaN', () => {
    expect(Number.isNaN(parseHHMM('not a time'))).toBe(true)
    expect(Number.isNaN(parseHHMM(null))).toBe(true)
    expect(Number.isNaN(parseHHMM(undefined))).toBe(true)
  })
})

describe('slotForTime', () => {
  it('variant 1 (happy): "09:30" buckets into "09:00" (1-hr grid)', () => {
    expect(slotForTime('09:30')).toBe('09:00')
  })

  it('variant 2 (boundary): exact slot boundary returns that slot', () => {
    expect(slotForTime('07:00')).toBe('07:00')
    expect(slotForTime('18:59')).toBe('18:00')
  })

  it('variant 3 (out of range): returns null', () => {
    expect(slotForTime('06:30')).toBeNull() // before startHour
    expect(slotForTime('19:00')).toBeNull() // at/after endHour
    expect(slotForTime('23:45')).toBeNull()
    expect(slotForTime(null)).toBeNull()
  })
})
