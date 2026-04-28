/**
 * Appointment-Set Commission — Unit Tests
 *
 * Phase F (2026-04-27). Locks the pure aggregator helper so payroll
 * settlement math stays correct even if the DB shape shifts later.
 */

import { describe, it, expect } from 'vitest'
import { aggregateEarnedCreditsBySalesman } from '@/apps/window-washing/lib/appointment-commission'

describe('aggregateEarnedCreditsBySalesman', () => {
  it('sums multiple credits for the same salesman', () => {
    const result = aggregateEarnedCreditsBySalesman([
      { id: 1, salesman_id: 7, amount_earned: 50, appointment_price: 400, frozen_pct: 12.5 },
      { id: 2, salesman_id: 7, amount_earned: 25, appointment_price: 200, frozen_pct: 12.5 },
    ])
    expect(result[7]).toBeDefined()
    expect(result[7].amount).toBe(75)
    expect(result[7].revenueSet).toBe(600)
    expect(result[7].frozenPct).toBe(12.5)
    expect(result[7].creditIds).toEqual([1, 2])
  })

  it('keeps each salesman in their own bucket', () => {
    const result = aggregateEarnedCreditsBySalesman([
      { id: 1, salesman_id: 7, amount_earned: 50, appointment_price: 400, frozen_pct: 12.5 },
      { id: 2, salesman_id: 9, amount_earned: 100, appointment_price: 800, frozen_pct: 12.5 },
    ])
    expect(result[7].amount).toBe(50)
    expect(result[9].amount).toBe(100)
  })

  it('treats string-typed numeric DB values as numbers', () => {
    // Postgres numeric round-trips can return strings via the JS client.
    const result = aggregateEarnedCreditsBySalesman([
      { id: 1, salesman_id: 7, amount_earned: '37.50' as unknown as number, appointment_price: '300.00' as unknown as number, frozen_pct: '12.50' as unknown as number },
    ])
    expect(result[7].amount).toBe(37.5)
    expect(result[7].revenueSet).toBe(300)
  })

  it('floors precision at cents (no floating-point drift)', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE 754 — confirm we round.
    const result = aggregateEarnedCreditsBySalesman([
      { id: 1, salesman_id: 7, amount_earned: 0.1, appointment_price: 1, frozen_pct: 10 },
      { id: 2, salesman_id: 7, amount_earned: 0.2, appointment_price: 2, frozen_pct: 10 },
    ])
    expect(result[7].amount).toBe(0.3)
  })

  it('skips rows with falsy salesman_id', () => {
    const result = aggregateEarnedCreditsBySalesman([
      { id: 1, salesman_id: 0 as unknown as number, amount_earned: 50, appointment_price: 400, frozen_pct: 12.5 },
      { id: 2, salesman_id: 7, amount_earned: 25, appointment_price: 200, frozen_pct: 12.5 },
    ])
    expect(result[0]).toBeUndefined()
    expect(result[7].amount).toBe(25)
  })

  it('handles null amounts as zero', () => {
    const result = aggregateEarnedCreditsBySalesman([
      { id: 1, salesman_id: 7, amount_earned: null, appointment_price: null, frozen_pct: null },
      { id: 2, salesman_id: 7, amount_earned: 50, appointment_price: 400, frozen_pct: 12.5 },
    ])
    expect(result[7].amount).toBe(50)
    expect(result[7].revenueSet).toBe(400)
    expect(result[7].frozenPct).toBe(12.5)
  })

  it('returns empty object for empty input', () => {
    expect(aggregateEarnedCreditsBySalesman([])).toEqual({})
  })
})
