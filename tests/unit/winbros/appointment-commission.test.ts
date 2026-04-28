/**
 * Appointment-Set Commission — Unit Tests
 *
 * Phase F (2026-04-27). Locks the pure aggregator helper so payroll
 * settlement math stays correct even if the DB shape shifts later.
 */

import { describe, it, expect } from 'vitest'
import {
  aggregateEarnedCreditsBySalesman,
  upsertPendingAppointmentCredit,
  settleAppointmentCreditOnConversion,
  voidAppointmentCredit,
} from '@/apps/window-washing/lib/appointment-commission'

// Minimal fake Supabase client. Each test pre-stages the `data` returned
// by .maybeSingle() and .single(); upsert/update record the row passed in
// so the test can assert it.
function makeFakeClient(opts: {
  existingCredit?: Record<string, unknown> | null
  payRate?: Record<string, unknown> | null
}) {
  const calls: Array<Record<string, unknown>> = []
  let lastUpsertRow: Record<string, unknown> | null = null
  let lastUpdateRow: Record<string, unknown> | null = null
  let lastUpdateFilters: Record<string, string> = {}
  return {
    calls,
    get lastUpsertRow() { return lastUpsertRow },
    get lastUpdateRow() { return lastUpdateRow },
    get lastUpdateFilters() { return lastUpdateFilters },
    from(table: string): any {
      const builder: any = {
        _table: table,
        _filters: {} as Record<string, string>,
        select(_: string) { return builder },
        eq(col: string, val: string) {
          builder._filters[col] = String(val)
          return builder
        },
        async maybeSingle() {
          calls.push({ op: 'select', table })
          if (table === 'salesman_appointment_credits') {
            return { data: opts.existingCredit ?? null, error: null }
          }
          if (table === 'pay_rates') {
            return { data: opts.payRate ?? null, error: null }
          }
          return { data: null, error: null }
        },
        upsert(row: Record<string, unknown>) {
          lastUpsertRow = row
          return {
            select() { return this },
            async single() {
              return { data: { id: 999, amount_pending: row.amount_pending }, error: null }
            },
          }
        },
        update(row: Record<string, unknown>) {
          lastUpdateRow = row
          const updateBuilder: any = {
            _filters: {} as Record<string, string>,
            eq(col: string, val: string) {
              updateBuilder._filters[col] = String(val)
              lastUpdateFilters = { ...updateBuilder._filters }
              return updateBuilder
            },
            select() { return updateBuilder },
            async single() {
              return { data: { id: 999, amount_earned: 0 }, error: null }
            },
            then(resolve: (v: unknown) => void) {
              // Allow `await client.from().update()...eq(...)` to resolve to ok.
              resolve({ data: null, error: null })
            },
          }
          return updateBuilder
        },
      }
      return builder
    },
  }
}

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

describe('upsertPendingAppointmentCredit', () => {
  it('skips silently when salesmanId is 0', async () => {
    const client = makeFakeClient({})
    const r = await upsertPendingAppointmentCredit(client as any, {
      tenantId: 't1',
      appointmentJobId: 1,
      salesmanId: 0,
      appointmentPrice: 400,
    })
    expect(r.success).toBe(true)
    expect(r.skipped_reason).toContain('no salesman')
  })

  it('skips silently when price is 0 or negative', async () => {
    const client = makeFakeClient({})
    const r = await upsertPendingAppointmentCredit(client as any, {
      tenantId: 't1',
      appointmentJobId: 1,
      salesmanId: 7,
      appointmentPrice: 0,
    })
    expect(r.success).toBe(true)
    expect(r.skipped_reason).toContain('no price')
  })

  it('does NOT upsert when an earned credit already exists', async () => {
    const client = makeFakeClient({ existingCredit: { id: 5, status: 'earned' } })
    const r = await upsertPendingAppointmentCredit(client as any, {
      tenantId: 't1',
      appointmentJobId: 1,
      salesmanId: 7,
      appointmentPrice: 400,
    })
    expect(r.success).toBe(true)
    expect(r.credit_id).toBe(5)
    expect(client.lastUpsertRow).toBeNull()
  })

  it('does NOT upsert when a voided credit already exists', async () => {
    const client = makeFakeClient({ existingCredit: { id: 5, status: 'voided' } })
    const r = await upsertPendingAppointmentCredit(client as any, {
      tenantId: 't1',
      appointmentJobId: 1,
      salesmanId: 7,
      appointmentPrice: 400,
    })
    expect(r.success).toBe(true)
    expect(client.lastUpsertRow).toBeNull()
  })

  it('uses provided commissionPct over pay_rates lookup', async () => {
    const client = makeFakeClient({})
    await upsertPendingAppointmentCredit(client as any, {
      tenantId: 't1',
      appointmentJobId: 1,
      salesmanId: 7,
      appointmentPrice: 400,
      commissionPct: 15, // override
    })
    expect(client.lastUpsertRow?.frozen_pct).toBe(15)
    expect(client.lastUpsertRow?.amount_pending).toBe(60) // 400 × 0.15
  })

  it('falls back to 12.5% when no pay_rates row + no override', async () => {
    const client = makeFakeClient({}) // payRate not staged → null
    await upsertPendingAppointmentCredit(client as any, {
      tenantId: 't1',
      appointmentJobId: 1,
      salesmanId: 7,
      appointmentPrice: 480,
    })
    expect(client.lastUpsertRow?.frozen_pct).toBe(12.5)
    expect(client.lastUpsertRow?.amount_pending).toBe(60) // 480 × 0.125
  })

  it('uses pay_rates row when present', async () => {
    const client = makeFakeClient({
      payRate: { commission_appointment_pct: '10.00' },
    })
    await upsertPendingAppointmentCredit(client as any, {
      tenantId: 't1',
      appointmentJobId: 1,
      salesmanId: 7,
      appointmentPrice: 500,
    })
    expect(client.lastUpsertRow?.frozen_pct).toBe(10)
    expect(client.lastUpsertRow?.amount_pending).toBe(50) // 500 × 0.10
  })

  it('rounds to cents (no float drift)', async () => {
    const client = makeFakeClient({})
    await upsertPendingAppointmentCredit(client as any, {
      tenantId: 't1',
      appointmentJobId: 1,
      salesmanId: 7,
      appointmentPrice: 333.33,
      commissionPct: 12.5,
    })
    // 333.33 × 0.125 = 41.66625 → 41.67
    expect(client.lastUpsertRow?.amount_pending).toBe(41.67)
  })
})

describe('settleAppointmentCreditOnConversion', () => {
  it('returns no-op when no credit exists', async () => {
    const client = makeFakeClient({ existingCredit: null })
    const r = await settleAppointmentCreditOnConversion(client as any, {
      tenantId: 't1',
      appointmentJobId: 1,
      convertedQuoteId: 'q1',
    })
    expect(r.success).toBe(true)
    expect(r.skipped_reason).toContain('no credit')
  })

  it('skips when credit is already earned (idempotent)', async () => {
    const client = makeFakeClient({
      existingCredit: { id: 5, status: 'earned', appointment_price: 400, frozen_pct: 12.5 },
    })
    const r = await settleAppointmentCreditOnConversion(client as any, {
      tenantId: 't1',
      appointmentJobId: 1,
      convertedQuoteId: 'q1',
    })
    expect(r.success).toBe(true)
    expect(r.skipped_reason).toContain('already earned')
    expect(client.lastUpdateRow).toBeNull()
  })

  it('refuses to flip a voided credit', async () => {
    const client = makeFakeClient({
      existingCredit: { id: 5, status: 'voided', appointment_price: 400, frozen_pct: 12.5 },
    })
    const r = await settleAppointmentCreditOnConversion(client as any, {
      tenantId: 't1',
      appointmentJobId: 1,
      convertedQuoteId: 'q1',
    })
    expect(r.success).toBe(true)
    expect(r.skipped_reason).toContain('voided')
    expect(client.lastUpdateRow).toBeNull()
  })
})

describe('voidAppointmentCredit', () => {
  it('only updates rows with status=pending (filter on status)', async () => {
    const client = makeFakeClient({})
    await voidAppointmentCredit(client as any, {
      creditId: 42,
      reason: 'TEST_VOID_REASON',
    })
    // The helper sets status='voided' + voided_at + void_reason on a row
    // matching id=42 AND status='pending'.
    expect(client.lastUpdateRow?.status).toBe('voided')
    expect(client.lastUpdateRow?.void_reason).toBe('TEST_VOID_REASON')
    expect(client.lastUpdateFilters?.id).toBe('42')
    expect(client.lastUpdateFilters?.status).toBe('pending')
  })
})
