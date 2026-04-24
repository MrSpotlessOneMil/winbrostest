/**
 * Payroll revenue attribution — Unit Tests (Round 2 Wave 3d)
 *
 * Pins Max's rule from the PDF:
 *   - Line items where is_upsell=true  → team lead on the job
 *   - Line items where is_upsell=false → split across technicians (base pay)
 *
 * Round 2 conversion stamps quote-level upsells with added_by_cleaner_id=null.
 * This test ensures payroll still credits those to the job's team lead
 * (crew_salesman_id fallback), preventing the "commission falls on the floor"
 * bug that would have hit on the first Round 2 payroll run.
 */

import { describe, it, expect } from 'vitest'
import {
  accumulateVisitRevenue,
  type VisitForPayroll,
} from '@/apps/window-washing/lib/payroll'

function collect(visits: VisitForPayroll[]) {
  const sold: Record<number, number> = {}
  const upsell: Record<number, number> = {}
  for (const v of visits) accumulateVisitRevenue(v, sold, upsell)
  return { sold, upsell }
}

describe('original_quote lines split across technicians', () => {
  it('variant 1 (happy): single tech gets the full amount', () => {
    const { sold, upsell } = collect([
      {
        technicians: [10],
        jobs: { crew_salesman_id: 99, cleaner_id: null },
        visit_line_items: [{ price: 200, revenue_type: 'original_quote' }],
      },
    ])
    expect(sold[10]).toBe(200)
    expect(upsell[99]).toBeUndefined()
  })

  it('variant 2: two techs split evenly', () => {
    const { sold } = collect([
      {
        technicians: [10, 20],
        visit_line_items: [{ price: 300, revenue_type: 'original_quote' }],
      },
    ])
    expect(sold[10]).toBe(150)
    expect(sold[20]).toBe(150)
  })

  it('variant 3: no technicians → no sold credit (soft-fails, not crash)', () => {
    const { sold } = collect([
      {
        technicians: [],
        visit_line_items: [{ price: 300, revenue_type: 'original_quote' }],
      },
    ])
    expect(Object.keys(sold).length).toBe(0)
  })
})

describe('technician_upsell attribution (Round 2 Wave 3d fix)', () => {
  it('variant 1 (happy): explicit added_by_cleaner_id wins over any fallback', () => {
    const { upsell } = collect([
      {
        technicians: [10],
        jobs: { crew_salesman_id: 99, cleaner_id: 77 },
        visit_line_items: [
          { price: 80, revenue_type: 'technician_upsell', added_by_cleaner_id: 42 },
        ],
      },
    ])
    expect(upsell[42]).toBe(80)
    expect(upsell[99]).toBeUndefined()
    expect(upsell[77]).toBeUndefined()
  })

  it('variant 2 (quote-level upsell): null added_by falls back to crew_salesman_id', () => {
    const { upsell } = collect([
      {
        technicians: [10],
        jobs: { crew_salesman_id: 99, cleaner_id: 77 },
        visit_line_items: [
          { price: 80, revenue_type: 'technician_upsell', added_by_cleaner_id: null },
        ],
      },
    ])
    expect(upsell[99]).toBe(80)
    expect(upsell[10]).toBeUndefined()
    expect(upsell[77]).toBeUndefined()
  })

  it('variant 3 (deeper fallback): null added_by + null crew_salesman → cleaner_id', () => {
    const { upsell } = collect([
      {
        technicians: [10],
        jobs: { crew_salesman_id: null, cleaner_id: 77 },
        visit_line_items: [
          { price: 80, revenue_type: 'technician_upsell', added_by_cleaner_id: null },
        ],
      },
    ])
    expect(upsell[77]).toBe(80)
    expect(upsell[10]).toBeUndefined()
  })
})

describe('technician_upsell attribution — deepest fallback', () => {
  it('variant 1: only technicians assigned → first technician gets the credit', () => {
    const { upsell } = collect([
      {
        technicians: [10, 20],
        jobs: { crew_salesman_id: null, cleaner_id: null },
        visit_line_items: [
          { price: 80, revenue_type: 'technician_upsell', added_by_cleaner_id: null },
        ],
      },
    ])
    expect(upsell[10]).toBe(80)
    expect(upsell[20]).toBeUndefined()
  })

  it('variant 2: zero attribution available → line is dropped (not crashed)', () => {
    const { upsell } = collect([
      {
        technicians: [],
        jobs: null,
        visit_line_items: [
          { price: 80, revenue_type: 'technician_upsell', added_by_cleaner_id: null },
        ],
      },
    ])
    expect(Object.keys(upsell).length).toBe(0)
  })

  it('variant 3: multiple upsells aggregate correctly on same cleaner', () => {
    const { upsell } = collect([
      {
        technicians: [10],
        jobs: { crew_salesman_id: 99, cleaner_id: null },
        visit_line_items: [
          { price: 50, revenue_type: 'technician_upsell', added_by_cleaner_id: null },
          { price: 80, revenue_type: 'technician_upsell', added_by_cleaner_id: null },
          { price: 30, revenue_type: 'technician_upsell', added_by_cleaner_id: 42 },
        ],
      },
    ])
    expect(upsell[99]).toBe(130)
    expect(upsell[42]).toBe(30)
  })
})
