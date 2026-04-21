/**
 * W3 — Human-operator takeover respected by canSendOutreach.
 *
 * TJ / Paige Elizabeth incident (2026-04-20): operator sent correction;
 * short auto-unpause (15min) is the existing behavior for active-conversation
 * scenarios. The W3 hardening adds a 24h+ human_takeover_until column for
 * operators who explicitly own the thread, plus canSendOutreach respects it
 * across every cron path.
 */

import { describe, it, expect } from 'vitest'
import { MockSupabaseClient } from '../mocks/supabase-mock'
import { canSendOutreach } from '../../packages/core/src/can-send-outreach'

const tenant = { id: 't1', slug: 'spotless-scrubbers', timezone: 'America/Chicago' }

describe('W3 — canSendOutreach takeover gate', () => {
  it('blocks when human_takeover_until is in the future', async () => {
    const client = new MockSupabaseClient({ jobs: [] })
    const fakeNow = new Date('2026-04-21T18:00:00.000Z') // 13:00 CT, inside biz hours
    const inOneHour = new Date(fakeNow.getTime() + 60 * 60 * 1000).toISOString()
    const result = await canSendOutreach({
      client: client as any,
      tenant,
      customer: { id: 1, phone_number: '+13105551234', human_takeover_until: inOneHour },
      now: fakeNow,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('human_takeover_active')
  })

  it('allows when human_takeover_until is in the past (expired)', async () => {
    const client = new MockSupabaseClient({ jobs: [] })
    const fakeNow = new Date('2026-04-21T18:00:00.000Z')
    const hourAgo = new Date(fakeNow.getTime() - 60 * 60 * 1000).toISOString()
    const result = await canSendOutreach({
      client: client as any,
      tenant,
      customer: { id: 1, phone_number: '+13105551234', human_takeover_until: hourAgo },
      now: fakeNow,
    })
    expect(result.ok).toBe(true)
  })

  it('allows when human_takeover_until is null', async () => {
    const client = new MockSupabaseClient({ jobs: [] })
    const result = await canSendOutreach({
      client: client as any,
      tenant,
      customer: { id: 1, phone_number: '+13105551234', human_takeover_until: null },
      now: new Date('2026-04-21T18:00:00.000Z'),
    })
    expect(result.ok).toBe(true)
  })
})

describe('W3 — canSendOutreach compound gates', () => {
  it('sms_opt_out beats everything else', async () => {
    const client = new MockSupabaseClient({})
    const result = await canSendOutreach({
      client: client as any,
      tenant,
      customer: { id: 1, phone_number: '+13105551234', sms_opt_out: true },
    })
    expect(result).toEqual({ ok: false, reason: 'opt_out' })
  })

  it('auto_response_disabled (permanent) blocks', async () => {
    const client = new MockSupabaseClient({})
    const result = await canSendOutreach({
      client: client as any,
      tenant,
      customer: { id: 1, phone_number: '+13105551234', auto_response_disabled: true },
    })
    expect(result).toEqual({ ok: false, reason: 'auto_response_disabled' })
  })

  it('confirmed booking blocks (W2 combined with W3)', async () => {
    const client = new MockSupabaseClient({
      jobs: [{ id: 99, tenant_id: 't1', customer_id: 1, status: 'scheduled' }],
    })
    const result = await canSendOutreach({
      client: client as any,
      tenant,
      customer: { id: 1, phone_number: '+13105551234' },
      now: new Date('2026-04-21T18:00:00.000Z'),
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('confirmed_booking_exists')
  })

  it('winbros is globally excluded from retargeting', async () => {
    const client = new MockSupabaseClient({})
    const result = await canSendOutreach({
      client: client as any,
      tenant: { id: 'wb', slug: 'winbros', timezone: 'America/Chicago' },
      customer: { id: 1, phone_number: '+13095551234' },
    })
    expect(result).toEqual({ ok: false, reason: 'tenant_excluded' })
  })

  it('outside quiet hours returns queueUntil', async () => {
    const client = new MockSupabaseClient({ jobs: [] })
    const result = await canSendOutreach({
      client: client as any,
      tenant,
      customer: { id: 1, phone_number: '+13465551234' },
      now: new Date('2026-04-21T06:38:00.000Z'), // 01:38 CT
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('outside_quiet_hours')
    expect(result.queueUntil).toBeInstanceOf(Date)
  })
})
