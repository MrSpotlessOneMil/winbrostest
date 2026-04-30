/**
 * Payroll Engine — Unit Tests
 *
 * Round 2 (2026-04-23): pay_mode is hourly XOR percentage. Never both.
 * Each operation tested with 3 input variants per the 3-tier-test-before-push rule.
 */

import { describe, it, expect } from 'vitest'
import {
  calculateTechPay,
  calculateSalesmanPay,
  calculateSalesmanPayN,
  accumulateSalesmanRevenueByOrigin,
  type SalesmanRevenueByOrigin,
  type VisitForSalesmanPayroll,
} from '@/apps/window-washing/lib/payroll'

describe('calculateTechPay — hourly mode', () => {
  it('variant 1 (happy): 40hrs * $25/hr = $1000', () => {
    expect(calculateTechPay(0, 'hourly', null, 40, 0, 25)).toBe(1000)
  })

  it('variant 2 (with OT): 40 regular + 5 OT at 1.5x @ $25/hr = $1187.50', () => {
    // Regular: 40 * 25 = 1000
    // OT: 5 * 25 * 1.5 = 187.50
    expect(calculateTechPay(0, 'hourly', null, 45, 5, 25, 1.5)).toBe(1187.5)
  })

  it('variant 3 (edge): hourly mode IGNORES pay_percentage even if set', () => {
    // Revenue-based percentage must NOT contribute in hourly mode (that was the bug).
    expect(calculateTechPay(5000, 'hourly', 35, 40, 0, 25)).toBe(1000)
  })
})

describe('calculateTechPay — percentage mode', () => {
  it('variant 1 (happy): 15% of $4000 = $600', () => {
    expect(calculateTechPay(4000, 'percentage', 15, 0, 0, null)).toBe(600)
  })

  it('variant 2 (fractional): 22% of $5750 = $1265.00', () => {
    expect(calculateTechPay(5750, 'percentage', 22, 0, 0, null)).toBe(1265)
  })

  it('variant 3 (edge): percentage mode IGNORES hourly_rate + hours', () => {
    // Hours * rate must NOT contribute in percentage mode.
    expect(calculateTechPay(1000, 'percentage', 30, 40, 5, 25)).toBe(300)
  })
})

describe('calculateTechPay — null/edge mode handling', () => {
  it('variant 1: null pay_mode defaults to hourly (safe floor)', () => {
    expect(calculateTechPay(5000, null, 35, 40, 0, 25)).toBe(1000)
  })

  it('variant 2: hourly mode with 0 rate returns 0 (never negative or NaN)', () => {
    expect(calculateTechPay(1000, 'hourly', 30, 40, 0, 0)).toBe(0)
  })

  it('variant 3: percentage mode with null pct returns 0', () => {
    expect(calculateTechPay(1000, 'percentage', null, 0, 0, null)).toBe(0)
  })
})

describe('calculateSalesmanPay', () => {
  it('variant 1 (happy): mixed plan types', () => {
    // $1000 * 10% + $2000 * 15% + $3000 * 20% = 100 + 300 + 600 = 1000
    expect(calculateSalesmanPay(1000, 2000, 3000, 10, 15, 20)).toBe(1000)
  })

  it('variant 2 (single plan): only quarterly', () => {
    expect(calculateSalesmanPay(0, 0, 10000, 0, 0, 8)).toBe(800)
  })

  it('variant 3 (fractional): rounds to cents', () => {
    // $333 at 10% = $33.30
    expect(calculateSalesmanPay(333, 0, 0, 10, 0, 0)).toBe(33.3)
  })

  it('variant 4 (edge): zero revenue returns 0', () => {
    expect(calculateSalesmanPay(0, 0, 0, 10, 15, 20)).toBe(0)
  })
})

/**
 * Phase N (Blake call 2026-04-29): salesmen are paid 20% on door-knock
 * quotes and 12.5% on appointment-converted quotes. Plan-frequency
 * (one-time / triannual / quarterly) no longer affects the rate. Tech
 * upsells now pay at a separate rate from base. The legacy
 * calculateSalesmanPay path is kept for historical-week rendering only.
 */
describe('calculateSalesmanPayN — Phase N door-knock vs appointment', () => {
  it('door-knock only @ 20%', () => {
    expect(
      calculateSalesmanPayN({
        revenueDoorknock: 1000,
        commissionDoorknockPct: 20,
        appointmentEarnedAmount: 0,
      })
    ).toBe(200)
  })

  it('mixed door-knock + appointment ledger payout', () => {
    // $2000 door-knock at 20% = $400 + $250 already-earned appointment
    // credits = $650 total.
    expect(
      calculateSalesmanPayN({
        revenueDoorknock: 2000,
        commissionDoorknockPct: 20,
        appointmentEarnedAmount: 250,
      })
    ).toBe(650)
  })

  it('appointment ledger only (door-knock zero)', () => {
    expect(
      calculateSalesmanPayN({
        revenueDoorknock: 0,
        commissionDoorknockPct: 20,
        appointmentEarnedAmount: 312.5,
      })
    ).toBe(312.5)
  })

  it('rounds to cents', () => {
    // 333 * 20% = 66.6 (no rounding needed) + 0.005 to test rounding
    expect(
      calculateSalesmanPayN({
        revenueDoorknock: 333.55,
        commissionDoorknockPct: 20,
        appointmentEarnedAmount: 0,
      })
    ).toBe(66.71)
  })

  it('non-default door-knock pct (admin override)', () => {
    expect(
      calculateSalesmanPayN({
        revenueDoorknock: 1000,
        commissionDoorknockPct: 25,
        appointmentEarnedAmount: 100,
      })
    ).toBe(350)
  })
})

describe('accumulateSalesmanRevenueByOrigin — Phase N flag-based bucketing', () => {
  function makeVisit(args: {
    salesmanId?: number | null
    creditedSalesmanId?: number | null
    isAppointmentQuote?: boolean | null
    originalQuotePrices?: number[]
    upsellPrices?: number[]
  }): VisitForSalesmanPayroll {
    return {
      jobs: {
        id: 1,
        salesman_id: args.salesmanId ?? null,
        credited_salesman_id: args.creditedSalesmanId ?? null,
        quotes: { is_appointment_quote: args.isAppointmentQuote ?? null },
      },
      visit_line_items: [
        ...(args.originalQuotePrices ?? []).map((p) => ({
          price: p,
          revenue_type: 'original_quote' as const,
        })),
        ...(args.upsellPrices ?? []).map((p) => ({
          price: p,
          revenue_type: 'technician_upsell' as const,
        })),
      ],
    }
  }

  it('door-knock quote → revenue lands in doorknock bucket', () => {
    const byOrigin: Record<number, SalesmanRevenueByOrigin> = {}
    accumulateSalesmanRevenueByOrigin(
      makeVisit({
        salesmanId: 7,
        isAppointmentQuote: false,
        originalQuotePrices: [500, 250],
      }),
      byOrigin
    )
    expect(byOrigin[7]).toEqual({ doorknock: 750, appointment: 0 })
  })

  it('appointment quote → revenue lands in appointment bucket', () => {
    const byOrigin: Record<number, SalesmanRevenueByOrigin> = {}
    accumulateSalesmanRevenueByOrigin(
      makeVisit({
        salesmanId: 9,
        isAppointmentQuote: true,
        originalQuotePrices: [400],
      }),
      byOrigin
    )
    expect(byOrigin[9]).toEqual({ doorknock: 0, appointment: 400 })
  })

  it('credited_salesman_id overrides salesman_id (admin override)', () => {
    const byOrigin: Record<number, SalesmanRevenueByOrigin> = {}
    accumulateSalesmanRevenueByOrigin(
      makeVisit({
        salesmanId: 7,
        creditedSalesmanId: 99,
        isAppointmentQuote: false,
        originalQuotePrices: [600],
      }),
      byOrigin
    )
    expect(byOrigin[99]).toEqual({ doorknock: 600, appointment: 0 })
    expect(byOrigin[7]).toBeUndefined()
  })

  it('skips upsell line items (they pay to the tech, not the salesman)', () => {
    const byOrigin: Record<number, SalesmanRevenueByOrigin> = {}
    accumulateSalesmanRevenueByOrigin(
      makeVisit({
        salesmanId: 7,
        isAppointmentQuote: false,
        originalQuotePrices: [500],
        upsellPrices: [100, 200],
      }),
      byOrigin
    )
    expect(byOrigin[7]).toEqual({ doorknock: 500, appointment: 0 })
  })

  it('null is_appointment_quote treated as door-knock (default)', () => {
    const byOrigin: Record<number, SalesmanRevenueByOrigin> = {}
    accumulateSalesmanRevenueByOrigin(
      makeVisit({
        salesmanId: 7,
        isAppointmentQuote: null,
        originalQuotePrices: [300],
      }),
      byOrigin
    )
    expect(byOrigin[7]).toEqual({ doorknock: 300, appointment: 0 })
  })
})

describe('calculateTechPay — Phase N upsell split', () => {
  it('percentage mode with upsell split: base 20% + upsell 40%', () => {
    // Total revenue $1000 = $700 base + $300 upsell.
    // Base: 700 * 20% = 140
    // Upsell: 300 * 40% = 120
    // Total: 260
    expect(
      calculateTechPay(1000, 'percentage', 20, 0, 0, null, 1.5, 300, 40)
    ).toBe(260)
  })

  it('percentage mode without upsell pct: legacy single-rate behavior', () => {
    // Backward compat — when commissionUpsellPct is null, behave like before.
    expect(calculateTechPay(1000, 'percentage', 20, 0, 0, null, 1.5, 300, null)).toBe(200)
  })

  it('hourly mode ignores upsell split entirely', () => {
    // Hourly never touches revenue; the split args are inert.
    expect(calculateTechPay(1000, 'hourly', null, 40, 0, 25, 1.5, 300, 40)).toBe(1000)
  })
})
