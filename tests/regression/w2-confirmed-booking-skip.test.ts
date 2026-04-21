/**
 * W2 — Confirmed-booking skip in follow-up crons.
 *
 * Paige Elizabeth incident (2026-04-20): AI sent cold nurture ("Did you get
 * a chance to look at your quote?") to a customer who was already booked.
 * The helper customerHasConfirmedBooking / customersWithConfirmedBookings
 * must correctly identify booked customers and the main crons must call it.
 */

import { describe, it, expect } from 'vitest'
import { MockSupabaseClient } from '../mocks/supabase-mock'
import {
  customerHasConfirmedBooking,
  customersWithConfirmedBookings,
} from '../../packages/core/src/has-confirmed-booking'

describe('W2 — customerHasConfirmedBooking', () => {
  it('returns true when a scheduled job exists', async () => {
    const client = new MockSupabaseClient({
      jobs: [
        { id: 1, tenant_id: 't1', customer_id: 42, status: 'scheduled' },
      ],
    })
    expect(await customerHasConfirmedBooking(client as any, 't1', 42)).toBe(true)
  })

  it('returns true when an in_progress job exists', async () => {
    const client = new MockSupabaseClient({
      jobs: [
        { id: 1, tenant_id: 't1', customer_id: 42, status: 'in_progress' },
      ],
    })
    expect(await customerHasConfirmedBooking(client as any, 't1', 42)).toBe(true)
  })

  it('returns false when only a quoted job exists', async () => {
    const client = new MockSupabaseClient({
      jobs: [
        { id: 1, tenant_id: 't1', customer_id: 42, status: 'quoted' },
      ],
    })
    expect(await customerHasConfirmedBooking(client as any, 't1', 42)).toBe(false)
  })

  it('returns false when no rows match', async () => {
    const client = new MockSupabaseClient({ jobs: [] })
    expect(await customerHasConfirmedBooking(client as any, 't1', 42)).toBe(false)
  })

  it('Paige scenario: quoted + scheduled for same customer → returns true', async () => {
    const client = new MockSupabaseClient({
      jobs: [
        { id: 1, tenant_id: 't1', customer_id: 42, status: 'quoted' },
        { id: 2, tenant_id: 't1', customer_id: 42, status: 'scheduled' },
      ],
    })
    expect(await customerHasConfirmedBooking(client as any, 't1', 42)).toBe(true)
  })

  it('tenant isolation: other tenant\'s bookings do NOT leak', async () => {
    const client = new MockSupabaseClient({
      jobs: [
        { id: 1, tenant_id: 'other-tenant', customer_id: 42, status: 'scheduled' },
      ],
    })
    expect(await customerHasConfirmedBooking(client as any, 't1', 42)).toBe(false)
  })
})

describe('W2 — customersWithConfirmedBookings (batch)', () => {
  it('returns only the subset with confirmed bookings', async () => {
    const client = new MockSupabaseClient({
      jobs: [
        { id: 1, tenant_id: 't1', customer_id: 10, status: 'scheduled' },
        { id: 2, tenant_id: 't1', customer_id: 20, status: 'quoted' },
        { id: 3, tenant_id: 't1', customer_id: 30, status: 'in_progress' },
      ],
    })
    const booked = await customersWithConfirmedBookings(client as any, 't1', [10, 20, 30, 40])
    expect(booked.has('10')).toBe(true)
    expect(booked.has('20')).toBe(false) // quoted only
    expect(booked.has('30')).toBe(true)
    expect(booked.has('40')).toBe(false) // no job
  })

  it('empty input returns empty set', async () => {
    const client = new MockSupabaseClient({})
    const s = await customersWithConfirmedBookings(client as any, 't1', [])
    expect(s.size).toBe(0)
  })
})

describe('W2 — helper is wired into the critical crons', () => {
  const fs = require('fs')
  const path = require('path')
  for (const cronPath of [
    '../../apps/house-cleaning/app/api/cron/follow-up-quoted/route.ts',
    '../../apps/house-cleaning/app/api/cron/lifecycle-auto-enroll/route.ts',
    '../../apps/house-cleaning/app/api/cron/seasonal-reminders/route.ts',
  ]) {
    it(`${cronPath.split('/').slice(-2).join('/')} imports has-confirmed-booking`, () => {
      const source = fs.readFileSync(path.resolve(__dirname, cronPath), 'utf-8')
      expect(source).toMatch(/has-confirmed-booking/)
    })
  }
})
