/**
 * Template gate engine (cross-cutting, 2026-04-20).
 *
 * Each outbound template declares the conversation_state it requires. The
 * gate is the last layer of defense against bugs where a cron fires a
 * template against the wrong lifecycle state.
 */

import { describe, it, expect } from 'vitest'
import { canFire, type ConversationStateRow } from '../../packages/core/src/template-gate'

const NOW = new Date('2026-04-21T18:00:00.000Z')

function baseState(overrides: Partial<ConversationStateRow> = {}): ConversationStateRow {
  return {
    booking_status: 'none',
    active_job_id: null,
    appointment_at: null,
    human_takeover_until: null,
    escalated: false,
    last_agent_message_at: null,
    last_customer_message_at: null,
    cold_followup_stage: 0,
    timezone: 'America/Chicago',
    ...overrides,
  }
}

describe('canFire — global pre-conditions', () => {
  it('blocks every template when escalated=true', () => {
    expect(canFire('booking_confirmation', baseState({ escalated: true }), NOW).ok).toBe(false)
    expect(canFire('cold_followup_1', baseState({ escalated: true }), NOW).ok).toBe(false)
    expect(canFire('quote_followup', baseState({ escalated: true }), NOW).ok).toBe(false)
  })

  it('blocks every template while human_takeover_until is in the future', () => {
    const hour = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString()
    expect(canFire('cold_followup_1', baseState({ human_takeover_until: hour }), NOW).ok).toBe(false)
    expect(canFire('quote_followup', baseState({ human_takeover_until: hour }), NOW).ok).toBe(false)
  })
})

describe('canFire — booking_confirmation (T8 gate)', () => {
  it('requires booking_status=confirmed + active_job_id + future appointment', () => {
    expect(canFire('booking_confirmation', baseState({ booking_status: 'quoted' }), NOW).ok).toBe(false)
    expect(canFire('booking_confirmation', baseState({ booking_status: 'confirmed', active_job_id: 1 }), NOW).ok).toBe(false) // no appointment
    expect(canFire('booking_confirmation', baseState({
      booking_status: 'confirmed',
      active_job_id: 1,
      appointment_at: new Date(NOW.getTime() + 24*3600*1000).toISOString(),
    }), NOW).ok).toBe(true)
  })

  it('rejects past appointment', () => {
    expect(canFire('booking_confirmation', baseState({
      booking_status: 'confirmed',
      active_job_id: 1,
      appointment_at: new Date(NOW.getTime() - 24*3600*1000).toISOString(),
    }), NOW).ok).toBe(false)
  })
})

describe('canFire — cold_followup stages', () => {
  it('stage_1 requires stage=0 + no reply + 4h+ since last agent msg', () => {
    const recent = baseState({
      cold_followup_stage: 0,
      last_agent_message_at: new Date(NOW.getTime() - 2*3600*1000).toISOString(),
    })
    expect(canFire('cold_followup_1', recent, NOW).ok).toBe(false)

    const aged = baseState({
      cold_followup_stage: 0,
      last_agent_message_at: new Date(NOW.getTime() - 5*3600*1000).toISOString(),
    })
    expect(canFire('cold_followup_1', aged, NOW).ok).toBe(true)
  })

  it('stage_2 requires stage=1 + 24h gap', () => {
    expect(canFire('cold_followup_2', baseState({
      cold_followup_stage: 1,
      last_agent_message_at: new Date(NOW.getTime() - 25*3600*1000).toISOString(),
    }), NOW).ok).toBe(true)
    expect(canFire('cold_followup_2', baseState({
      cold_followup_stage: 0, // wrong stage
      last_agent_message_at: new Date(NOW.getTime() - 25*3600*1000).toISOString(),
    }), NOW).ok).toBe(false)
  })

  it('any customer reply cancels the cadence', () => {
    expect(canFire('cold_followup_1', baseState({
      cold_followup_stage: 0,
      last_agent_message_at: new Date(NOW.getTime() - 5*3600*1000).toISOString(),
      last_customer_message_at: new Date(NOW.getTime() - 1*3600*1000).toISOString(),
    }), NOW).ok).toBe(false)
  })

  it('cadence blocks once booked', () => {
    expect(canFire('cold_followup_1', baseState({
      booking_status: 'confirmed',
      cold_followup_stage: 0,
      last_agent_message_at: new Date(NOW.getTime() - 5*3600*1000).toISOString(),
    }), NOW).ok).toBe(false)
  })
})

describe('canFire — quote_followup (W2 gate)', () => {
  it('requires booking_status=quoted', () => {
    expect(canFire('quote_followup', baseState({
      booking_status: 'confirmed',
      last_customer_message_at: new Date(NOW.getTime() - 30*3600*1000).toISOString(),
    }), NOW).ok).toBe(false)
  })

  it('requires 24h+ since last customer reply', () => {
    expect(canFire('quote_followup', baseState({
      booking_status: 'quoted',
      last_customer_message_at: new Date(NOW.getTime() - 10*3600*1000).toISOString(),
    }), NOW).ok).toBe(false)
    expect(canFire('quote_followup', baseState({
      booking_status: 'quoted',
      last_customer_message_at: new Date(NOW.getTime() - 25*3600*1000).toISOString(),
    }), NOW).ok).toBe(true)
  })
})

describe('canFire — retargeting/seasonal never hit booked', () => {
  it('retargeting_nudge blocked when confirmed', () => {
    expect(canFire('retargeting_nudge', baseState({ booking_status: 'confirmed' }), NOW).ok).toBe(false)
  })
  it('seasonal_reminder blocked when completed', () => {
    expect(canFire('seasonal_reminder', baseState({ booking_status: 'completed' }), NOW).ok).toBe(false)
  })
})
