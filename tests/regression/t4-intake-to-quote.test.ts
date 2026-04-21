/**
 * T4 — Intake-complete → quote transition.
 *
 * Natasha Jones incident (2026-04-20): agent asked bed, bath, then stopped.
 * The intake state machine must return complete=true once every required
 * field is collected, and must return a deterministic next question when a
 * gap exists (no LLM freelancing).
 */

import { describe, it, expect } from 'vitest'
import { buildIntakeSnapshot, decideIntake } from '../../packages/core/src/intake-state-machine'

describe('decideIntake — standard service', () => {
  it('empty snapshot asks for service_type first', () => {
    const d = decideIntake({})
    expect(d.complete).toBe(false)
    expect(d.focus).toBe('service_type')
    expect(d.nextQuestion).toMatch(/standard.*deep.*move/i)
  })

  it('with only service_type, asks for bedrooms', () => {
    const d = decideIntake({ service_type: 'standard' })
    expect(d.focus).toBe('bedrooms')
  })

  it('with bed+bath but no address, asks for address', () => {
    const d = decideIntake({ service_type: 'deep', bedrooms: 3, bathrooms: 2 })
    expect(d.focus).toBe('address')
  })

  it('with everything, returns complete=true (Natasha-fix)', () => {
    const d = decideIntake({
      service_type: 'standard',
      bedrooms: 1,
      bathrooms: 1,
      address: '123 Main St',
      preferred_date: 'tomorrow',
    })
    expect(d.complete).toBe(true)
    expect(d.focus).toBeNull()
    expect(d.nextQuestion).toBeNull()
  })

  it('treats empty strings as missing', () => {
    const d = decideIntake({
      service_type: '',
      bedrooms: 3,
      bathrooms: 2,
      address: '  ',
      preferred_date: 'Friday',
    })
    expect(d.complete).toBe(false)
    // Priority: service_type first, then address
    expect(['service_type', 'address']).toContain(d.focus)
  })
})

describe('decideIntake — specialized services', () => {
  it('commercial does NOT require bed/bath', () => {
    const d = decideIntake({
      service_type: 'commercial',
      address: '200 Office Plaza',
      space_description: '4500 sqft open floor',
      preferred_date: 'next Wednesday',
    })
    expect(d.complete).toBe(true)
  })

  it('airbnb requires space_description', () => {
    const d = decideIntake({
      service_type: 'airbnb',
      address: '99 Beach Rd',
      preferred_date: 'Friday',
    })
    expect(d.complete).toBe(false)
    expect(d.focus).toBe('space_description')
  })

  it('post-construction handled as specialized', () => {
    const d = decideIntake({
      service_type: 'post_construction',
      address: '5 Lot St',
      space_description: 'freshly remodeled 3-bed, drywall dust everywhere',
      preferred_date: 'Monday',
    })
    expect(d.complete).toBe(true)
  })
})

describe('buildIntakeSnapshot', () => {
  it('merges form, customer, and knownInfo with correct precedence', () => {
    const snap = buildIntakeSnapshot(
      { bedrooms: 3, service_type: 'deep' },
      { address: '1 Stored St', bedrooms: 2, bathrooms: 1 },
      { firstName: 'Linda', address: '2 KnownInfo Ave' },
    )
    expect(snap.service_type).toBe('deep')
    // form_data wins
    expect(snap.bedrooms).toBe(3)
    // customer record used when form missing
    expect(snap.bathrooms).toBe(1)
    // form > customer > knownInfo when conflicting
    expect(snap.address).toBe('1 Stored St')
  })

  it('handles all-null inputs', () => {
    const snap = buildIntakeSnapshot(null, null, null)
    expect(snap.service_type).toBeNull()
    expect(snap.bedrooms).toBeNull()
  })
})
