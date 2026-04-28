/**
 * Unit tests for Build 1 (HC messaging rebuild).
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 *
 * Covers:
 *   1. stripCurrencyForQuoteSend — defense-in-depth currency redaction
 *   2. computeRapportGate — pure logic for rapport-first + takeover-resume
 *
 * Pure logic only. No DB, no HTTP, no AI calls.
 */

import { describe, it, expect } from 'vitest'
import {
  stripCurrencyForQuoteSend,
  computeRapportGate,
  type CustomerContext,
} from '../../../packages/core/src/auto-response'

// ─────────────────────────────────────────────────────────────────────────────
// stripCurrencyForQuoteSend
// ─────────────────────────────────────────────────────────────────────────────

describe('stripCurrencyForQuoteSend', () => {
  it('strips bare $NNN tokens', () => {
    const r = stripCurrencyForQuoteSend('Your deep clean is $325, want me to send the link?')
    expect(r.didStrip).toBe(true)
    expect(r.stripped).not.toMatch(/\$\d/)
    expect(r.stripped).toContain('your price')
  })

  it('strips $X.XX decimals', () => {
    const r = stripCurrencyForQuoteSend('Total comes to $499.99')
    expect(r.didStrip).toBe(true)
    expect(r.stripped).not.toMatch(/\$\d/)
  })

  it('strips $1,234.56 with comma thousands', () => {
    const r = stripCurrencyForQuoteSend('That run is $1,234.56 once we add the addons')
    expect(r.didStrip).toBe(true)
    expect(r.stripped).not.toMatch(/\$/)
  })

  it('strips USD / CAD word forms', () => {
    const usd = stripCurrencyForQuoteSend('It comes out to 450 USD all in')
    expect(usd.didStrip).toBe(true)
    expect(usd.stripped).not.toMatch(/USD/i)

    const cad = stripCurrencyForQuoteSend('Roughly 600 CAD this week')
    expect(cad.didStrip).toBe(true)
    expect(cad.stripped).not.toMatch(/CAD/i)
  })

  it('strips "150 dollars" word form', () => {
    const r = stripCurrencyForQuoteSend('runs about 150 dollars')
    expect(r.didStrip).toBe(true)
    expect(r.stripped).not.toMatch(/\d+\s*dollars/i)
  })

  it('strips CA$ and US$ prefixed forms', () => {
    const ca = stripCurrencyForQuoteSend('Looking at CA$480 for a deep clean')
    expect(ca.didStrip).toBe(true)
    expect(ca.stripped).not.toMatch(/CA\$/)

    const us = stripCurrencyForQuoteSend('runs US$300')
    expect(us.didStrip).toBe(true)
    expect(us.stripped).not.toMatch(/US\$/)
  })

  it('handles multiple price tokens in one message', () => {
    const r = stripCurrencyForQuoteSend('Standard is $200, deep is $325, move-out $480')
    expect(r.didStrip).toBe(true)
    expect(r.stripped.match(/\$\d/g) ?? []).toHaveLength(0)
  })

  it('leaves clean text alone (no false strip)', () => {
    const r = stripCurrencyForQuoteSend('Hey, real quick before I send your quote, anything we should know?')
    expect(r.didStrip).toBe(false)
    expect(r.stripped).toContain('real quick')
  })

  it('does not strip plain numbers without currency context', () => {
    const r = stripCurrencyForQuoteSend('We have 3 cleaners on staff and 2 trucks')
    expect(r.didStrip).toBe(false)
    expect(r.stripped).toContain('3 cleaners')
  })

  it('collapses whitespace after redaction', () => {
    const r = stripCurrencyForQuoteSend('Total $325   today')
    expect(r.stripped).not.toMatch(/\s{2,}/)
  })

  it('collapses repeated "your price" placeholders', () => {
    const r = stripCurrencyForQuoteSend('We charge $200 to $300 for that range')
    expect(r.didStrip).toBe(true)
    // Should not have two adjacent "your price your price" sequences
    expect(r.stripped).not.toMatch(/your price\s+your price\s+your price/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// computeRapportGate
// ─────────────────────────────────────────────────────────────────────────────

const baseCtx = (overrides: Partial<CustomerContext['customer']> = {}): CustomerContext => ({
  activeJobs: [],
  recentJobs: [],
  customer: {
    id: 1,
    first_name: 'Sarah',
    last_name: 'Johnson',
    email: null,
    address: null,
    notes: null,
    housecall_pro_customer_id: null,
    pre_quote_rapport_sent_at: null,
    human_takeover_until: null,
    ...overrides,
  },
  lead: null,
  totalJobs: 0,
  totalSpend: 0,
})

describe('computeRapportGate — rapport-first', () => {
  it('fires rapport when all booking facts ready and rapport never sent', () => {
    const r = computeRapportGate({
      knownCustomerInfo: { bedrooms: 3, bathrooms: 2, address: '123 Main' },
      customerContext: baseCtx(),
    })
    expect(r.shouldDeliverRapportFirst).toBe(true)
  })

  it('does NOT fire rapport when address is missing', () => {
    const r = computeRapportGate({
      knownCustomerInfo: { bedrooms: 3, bathrooms: 2 },
      customerContext: baseCtx(),
    })
    expect(r.shouldDeliverRapportFirst).toBe(false)
  })

  it('does NOT fire rapport when bed/bath is missing', () => {
    const r = computeRapportGate({
      knownCustomerInfo: { address: '123 Main' },
      customerContext: baseCtx(),
    })
    expect(r.shouldDeliverRapportFirst).toBe(false)
  })

  it('does NOT fire rapport when already sent (idempotent)', () => {
    const r = computeRapportGate({
      knownCustomerInfo: { bedrooms: 3, bathrooms: 2, address: '123 Main' },
      customerContext: baseCtx({ pre_quote_rapport_sent_at: '2026-04-28T12:00:00Z' }),
    })
    expect(r.shouldDeliverRapportFirst).toBe(false)
  })

  it('suppresses rapport for retargeting replies', () => {
    const r = computeRapportGate({
      knownCustomerInfo: { bedrooms: 3, bathrooms: 2, address: '123 Main' },
      customerContext: baseCtx(),
      isRetargetingReply: true,
    })
    expect(r.shouldDeliverRapportFirst).toBe(false)
  })

  it('suppresses rapport for customers with active jobs', () => {
    const ctx = baseCtx()
    ctx.activeJobs = [{
      id: 1, service_type: 'standard', date: '2026-04-30',
      scheduled_at: null, price: 200, status: 'scheduled',
      address: '123 Main', cleaner_name: 'Mary',
    }]
    const r = computeRapportGate({
      knownCustomerInfo: { bedrooms: 3, bathrooms: 2, address: '123 Main' },
      customerContext: ctx,
    })
    expect(r.shouldDeliverRapportFirst).toBe(false)
  })

  it('suppresses rapport for returning customers (totalJobs > 0)', () => {
    const ctx = baseCtx()
    ctx.totalJobs = 4
    const r = computeRapportGate({
      knownCustomerInfo: { bedrooms: 3, bathrooms: 2, address: '123 Main' },
      customerContext: ctx,
    })
    expect(r.shouldDeliverRapportFirst).toBe(false)
  })

  it('handles null customerContext gracefully', () => {
    const r = computeRapportGate({
      knownCustomerInfo: { bedrooms: 3, bathrooms: 2, address: '123 Main' },
      customerContext: null,
    })
    // No context means no rapport flag, but no crash either
    expect(r.shouldDeliverRapportFirst).toBe(true)
  })
})

describe('computeRapportGate — takeover-resume', () => {
  const fixedNow = new Date('2026-04-28T12:00:00Z').getTime()

  it('flags resume when takeover expired 1h ago', () => {
    const oneHourAgo = new Date(fixedNow - 60 * 60 * 1000).toISOString()
    const r = computeRapportGate({
      customerContext: baseCtx({ human_takeover_until: oneHourAgo }),
      nowMs: fixedNow,
    })
    expect(r.humanTakeoverRecentlyEnded).toBe(true)
  })

  it('flags resume when takeover expires in 2 minutes (about to lift)', () => {
    const inTwoMin = new Date(fixedNow + 2 * 60 * 1000).toISOString()
    const r = computeRapportGate({
      customerContext: baseCtx({ human_takeover_until: inTwoMin }),
      nowMs: fixedNow,
    })
    expect(r.humanTakeoverRecentlyEnded).toBe(true)
  })

  it('does NOT flag resume when takeover ended 25h ago (too old)', () => {
    const longAgo = new Date(fixedNow - 25 * 60 * 60 * 1000).toISOString()
    const r = computeRapportGate({
      customerContext: baseCtx({ human_takeover_until: longAgo }),
      nowMs: fixedNow,
    })
    expect(r.humanTakeoverRecentlyEnded).toBe(false)
  })

  it('does NOT flag resume when takeover is far in future (still active)', () => {
    const tomorrow = new Date(fixedNow + 24 * 60 * 60 * 1000).toISOString()
    const r = computeRapportGate({
      customerContext: baseCtx({ human_takeover_until: tomorrow }),
      nowMs: fixedNow,
    })
    expect(r.humanTakeoverRecentlyEnded).toBe(false)
  })

  it('does NOT flag resume when human_takeover_until is null', () => {
    const r = computeRapportGate({
      customerContext: baseCtx({ human_takeover_until: null }),
      nowMs: fixedNow,
    })
    expect(r.humanTakeoverRecentlyEnded).toBe(false)
  })

  it('handles invalid date string without crashing', () => {
    const r = computeRapportGate({
      customerContext: baseCtx({ human_takeover_until: 'not-a-date' }),
      nowMs: fixedNow,
    })
    expect(r.humanTakeoverRecentlyEnded).toBe(false)
  })
})

describe('computeRapportGate — combined behavior', () => {
  it('rapport AND takeover can both fire on the same call', () => {
    const fixedNow = new Date('2026-04-28T12:00:00Z').getTime()
    const oneHourAgo = new Date(fixedNow - 60 * 60 * 1000).toISOString()
    const r = computeRapportGate({
      knownCustomerInfo: { bedrooms: 3, bathrooms: 2, address: '123 Main' },
      customerContext: baseCtx({ human_takeover_until: oneHourAgo }),
      nowMs: fixedNow,
    })
    expect(r.shouldDeliverRapportFirst).toBe(true)
    expect(r.humanTakeoverRecentlyEnded).toBe(true)
  })

  it('returning customer with takeover ending: takeover flagged, rapport suppressed', () => {
    const fixedNow = new Date('2026-04-28T12:00:00Z').getTime()
    const oneHourAgo = new Date(fixedNow - 60 * 60 * 1000).toISOString()
    const ctx = baseCtx({ human_takeover_until: oneHourAgo })
    ctx.totalJobs = 5
    const r = computeRapportGate({
      knownCustomerInfo: { bedrooms: 3, bathrooms: 2, address: '123 Main' },
      customerContext: ctx,
      nowMs: fixedNow,
    })
    expect(r.shouldDeliverRapportFirst).toBe(false)
    expect(r.humanTakeoverRecentlyEnded).toBe(true)
  })
})
