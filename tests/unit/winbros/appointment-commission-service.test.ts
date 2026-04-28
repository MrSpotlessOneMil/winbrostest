/**
 * Appointment-Set Commission — Service helper regression tests.
 *
 * Phase F (2026-04-27). The pure aggregator already has unit tests
 * (appointment-commission.test.ts). This file locks the SUPABASE-FACING
 * helpers — upsertPendingAppointmentCredit + settleAppointmentCreditOnConversion
 * — so a future edit to either path that breaks Dominic's commission flow
 * fails CI immediately.
 *
 * The mock client is a thin promise-chain stub. We verify call shape
 * (.from / .upsert / .update / .eq / .select / .single) and the helper's
 * return contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  upsertPendingAppointmentCredit,
  settleAppointmentCreditOnConversion,
  voidAppointmentCredit,
} from '@/apps/window-washing/lib/appointment-commission'

type SupabaseStub = ReturnType<typeof makeStub>

interface ChainStub {
  select: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
  is: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
}

function makeChain(initial?: { selectReturns?: unknown; upsertReturns?: unknown; updateReturns?: unknown; maybeSingleReturns?: unknown; singleReturns?: unknown }) {
  const chain: ChainStub = {
    select: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(initial?.singleReturns ?? { data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue(initial?.maybeSingleReturns ?? { data: null, error: null }),
  }
  return chain
}

function makeStub(routes: Record<string, ChainStub>) {
  return {
    from: vi.fn((table: string) => {
      if (!routes[table]) {
        throw new Error(`Test stub: no chain configured for table "${table}"`)
      }
      return routes[table]
    }),
  } as unknown as SupabaseStub & { from: ReturnType<typeof vi.fn> }
}

describe('upsertPendingAppointmentCredit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips silently when no salesman is assigned', async () => {
    const stub = makeStub({})
    const result = await upsertPendingAppointmentCredit(stub as unknown as never, {
      tenantId: 'tenant-1',
      appointmentJobId: 100,
      salesmanId: 0,
      appointmentPrice: 400,
    })
    expect(result.success).toBe(true)
    expect(result.skipped_reason).toBe('no salesman assigned')
    expect((stub as { from: { mock: { calls: unknown[] } } }).from.mock.calls).toHaveLength(0)
  })

  it('skips silently when price is zero or missing', async () => {
    const stub = makeStub({})
    const result = await upsertPendingAppointmentCredit(stub as unknown as never, {
      tenantId: 'tenant-1',
      appointmentJobId: 100,
      salesmanId: 7,
      appointmentPrice: 0,
    })
    expect(result.success).toBe(true)
    expect(result.skipped_reason).toBe('no price set')
  })

  it('does not overwrite an earned or voided credit', async () => {
    const credits = makeChain({
      maybeSingleReturns: { data: { id: 99, status: 'earned', salesman_id: 7 }, error: null },
    })
    const stub = makeStub({ salesman_appointment_credits: credits })
    const result = await upsertPendingAppointmentCredit(stub as unknown as never, {
      tenantId: 'tenant-1',
      appointmentJobId: 100,
      salesmanId: 7,
      appointmentPrice: 400,
    })
    expect(result.success).toBe(true)
    expect(result.skipped_reason).toBe('credit already earned')
    expect(credits.upsert).not.toHaveBeenCalled()
  })

  it('upserts a fresh pending credit with 12.5% × price (rounded to cents)', async () => {
    const credits = makeChain({
      maybeSingleReturns: { data: null, error: null },
      singleReturns: { data: { id: 5, amount_pending: 50 }, error: null },
    })
    const payRates = makeChain({
      maybeSingleReturns: { data: { commission_appointment_pct: 12.5 }, error: null },
    })
    const stub = makeStub({
      salesman_appointment_credits: credits,
      pay_rates: payRates,
    })

    const result = await upsertPendingAppointmentCredit(stub as unknown as never, {
      tenantId: 'tenant-1',
      appointmentJobId: 100,
      salesmanId: 7,
      appointmentPrice: 400,
    })

    expect(result.success).toBe(true)
    expect(result.credit_id).toBe(5)
    expect(credits.upsert).toHaveBeenCalledTimes(1)
    const upsertArg = credits.upsert.mock.calls[0][0] as Record<string, unknown>
    expect(upsertArg.amount_pending).toBe(50)
    expect(upsertArg.frozen_pct).toBe(12.5)
    expect(upsertArg.appointment_price).toBe(400)
    expect(upsertArg.status).toBe('pending')
  })

  it('falls back to default 12.5 when pay_rates row is missing', async () => {
    const credits = makeChain({
      maybeSingleReturns: { data: null, error: null },
      singleReturns: { data: { id: 5, amount_pending: 25 }, error: null },
    })
    const payRates = makeChain({
      maybeSingleReturns: { data: null, error: null }, // no rate row
    })
    const stub = makeStub({
      salesman_appointment_credits: credits,
      pay_rates: payRates,
    })

    const result = await upsertPendingAppointmentCredit(stub as unknown as never, {
      tenantId: 'tenant-1',
      appointmentJobId: 100,
      salesmanId: 7,
      appointmentPrice: 200,
    })

    expect(result.success).toBe(true)
    const upsertArg = credits.upsert.mock.calls[0][0] as Record<string, unknown>
    // 200 × 12.5% = 25
    expect(upsertArg.frozen_pct).toBe(12.5)
    expect(upsertArg.amount_pending).toBe(25)
  })

  it('honors an explicit commissionPct override (e.g. weird per-salesman rate)', async () => {
    const credits = makeChain({
      maybeSingleReturns: { data: null, error: null },
      singleReturns: { data: { id: 8, amount_pending: 30 }, error: null },
    })
    const stub = makeStub({ salesman_appointment_credits: credits })

    await upsertPendingAppointmentCredit(stub as unknown as never, {
      tenantId: 'tenant-1',
      appointmentJobId: 100,
      salesmanId: 7,
      appointmentPrice: 200,
      commissionPct: 15,
    })

    const upsertArg = credits.upsert.mock.calls[0][0] as Record<string, unknown>
    // 200 × 15% = 30
    expect(upsertArg.frozen_pct).toBe(15)
    expect(upsertArg.amount_pending).toBe(30)
  })
})

describe('settleAppointmentCreditOnConversion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips quietly when no credit was logged for the appointment', async () => {
    const credits = makeChain({
      maybeSingleReturns: { data: null, error: null },
    })
    const stub = makeStub({ salesman_appointment_credits: credits })

    const result = await settleAppointmentCreditOnConversion(stub as unknown as never, {
      tenantId: 'tenant-1',
      appointmentJobId: 100,
      convertedQuoteId: 'q-1',
    })

    expect(result.success).toBe(true)
    expect(result.skipped_reason).toBe('no credit logged for this appointment')
    expect(credits.update).not.toHaveBeenCalled()
  })

  it('refuses to flip an already-earned credit', async () => {
    const credits = makeChain({
      maybeSingleReturns: {
        data: { id: 5, status: 'earned', appointment_price: 400, frozen_pct: 12.5 },
        error: null,
      },
    })
    const stub = makeStub({ salesman_appointment_credits: credits })

    const result = await settleAppointmentCreditOnConversion(stub as unknown as never, {
      tenantId: 'tenant-1',
      appointmentJobId: 100,
      convertedQuoteId: 'q-1',
    })

    expect(result.success).toBe(true)
    expect(result.skipped_reason).toBe('already earned')
    expect(credits.update).not.toHaveBeenCalled()
  })

  it('refuses to flip a voided credit', async () => {
    const credits = makeChain({
      maybeSingleReturns: {
        data: { id: 5, status: 'voided', appointment_price: 400, frozen_pct: 12.5 },
        error: null,
      },
    })
    const stub = makeStub({ salesman_appointment_credits: credits })

    const result = await settleAppointmentCreditOnConversion(stub as unknown as never, {
      tenantId: 'tenant-1',
      appointmentJobId: 100,
      convertedQuoteId: 'q-1',
    })

    expect(result.success).toBe(true)
    expect(result.skipped_reason).toContain('voided')
  })

  it('flips pending → earned with amount = price × frozen_pct', async () => {
    const credits = makeChain({
      maybeSingleReturns: {
        data: { id: 5, status: 'pending', appointment_price: 400, frozen_pct: 12.5 },
        error: null,
      },
      singleReturns: { data: { id: 5, amount_earned: 50 }, error: null },
    })
    const stub = makeStub({ salesman_appointment_credits: credits })

    const result = await settleAppointmentCreditOnConversion(stub as unknown as never, {
      tenantId: 'tenant-1',
      appointmentJobId: 100,
      convertedQuoteId: 'q-1',
    })

    expect(result.success).toBe(true)
    expect(result.amount_earned).toBe(50)
    expect(credits.update).toHaveBeenCalledTimes(1)
    const updateArg = credits.update.mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.status).toBe('earned')
    expect(updateArg.amount_earned).toBe(50)
    expect(updateArg.converted_quote_id).toBe('q-1')
    expect(updateArg.earned_at).toBeTruthy()
  })

  it('uses the (possibly updated) appointment_price at settle time, not the original', async () => {
    // Admin edited the appointment price from $400 → $500 before conversion;
    // the credit row's appointment_price was refreshed by upsert. Settle
    // must compute earned = 500 × 12.5% = 62.50.
    const credits = makeChain({
      maybeSingleReturns: {
        data: { id: 5, status: 'pending', appointment_price: 500, frozen_pct: 12.5 },
        error: null,
      },
      singleReturns: { data: { id: 5, amount_earned: 62.5 }, error: null },
    })
    const stub = makeStub({ salesman_appointment_credits: credits })

    const result = await settleAppointmentCreditOnConversion(stub as unknown as never, {
      tenantId: 'tenant-1',
      appointmentJobId: 100,
      convertedQuoteId: 'q-1',
    })

    expect(result.amount_earned).toBe(62.5)
  })
})

describe('voidAppointmentCredit', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('only voids pending credits — never earned ones', async () => {
    // The .eq('status', 'pending') guard means earned credits won't be
    // matched server-side. We assert the call shape includes that filter
    // so a future refactor doesn't accidentally drop it.
    const credits = makeChain()
    const stub = makeStub({ salesman_appointment_credits: credits })

    await voidAppointmentCredit(stub as unknown as never, {
      creditId: 5,
      reason: 'Stale > 30d',
    })

    expect(credits.update).toHaveBeenCalledTimes(1)
    const updateArg = credits.update.mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.status).toBe('voided')
    expect(updateArg.void_reason).toBe('Stale > 30d')
    expect(updateArg.voided_at).toBeTruthy()

    // Two .eq() calls: one for id, one for status='pending'
    const eqCalls = credits.eq.mock.calls
    expect(eqCalls.some(c => c[0] === 'status' && c[1] === 'pending')).toBe(true)
  })
})
