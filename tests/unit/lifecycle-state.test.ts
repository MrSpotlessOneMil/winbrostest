/**
 * Unit tests for the customer lifecycle state machine (the "Railway").
 *
 * OUTREACH-SPEC v1.0 Section 3. Verifies ALLOWED_TRANSITIONS graph is
 * correct and rejects invalid moves. Pure logic — no DB.
 */

import { describe, it, expect } from 'vitest'
import {
  ALL_STATES,
  ALLOWED_TRANSITIONS,
  allowedOutreachForState,
  isValidTransition,
  type LifecycleState,
} from '../../packages/core/src/lifecycle-state'

describe('ALLOWED_TRANSITIONS — graph completeness', () => {
  it('has an entry for every state', () => {
    for (const state of ALL_STATES) {
      expect(ALLOWED_TRANSITIONS[state]).toBeDefined()
    }
  })

  it('only references valid target states', () => {
    for (const state of ALL_STATES) {
      for (const target of ALLOWED_TRANSITIONS[state]) {
        expect(ALL_STATES).toContain(target)
      }
    }
  })

  it('archived is terminal (no transitions out)', () => {
    expect(ALLOWED_TRANSITIONS['archived']).toEqual([])
  })
})

describe('isValidTransition', () => {
  it('allows new_lead -> engaged', () => {
    expect(isValidTransition('new_lead', 'engaged')).toBe(true)
  })

  it('allows engaged -> quoted', () => {
    expect(isValidTransition('engaged', 'quoted')).toBe(true)
  })

  it('allows engaged -> retargeting (graduation from Pipeline A)', () => {
    expect(isValidTransition('engaged', 'retargeting')).toBe(true)
  })

  it('allows quoted -> approved', () => {
    expect(isValidTransition('quoted', 'approved')).toBe(true)
  })

  it('allows quoted -> retargeting (graduation from Pipeline B)', () => {
    expect(isValidTransition('quoted', 'retargeting')).toBe(true)
  })

  it('allows paid -> recurring', () => {
    expect(isValidTransition('paid', 'recurring')).toBe(true)
  })

  it('allows paid -> retargeting', () => {
    expect(isValidTransition('paid', 'retargeting')).toBe(true)
  })

  it('allows recurring -> retargeting (membership cancelled)', () => {
    expect(isValidTransition('recurring', 'retargeting')).toBe(true)
  })

  it('allows retargeting -> engaged (inbound reply)', () => {
    expect(isValidTransition('retargeting', 'engaged')).toBe(true)
  })

  it('rejects new_lead -> scheduled (skipping states)', () => {
    expect(isValidTransition('new_lead', 'scheduled')).toBe(false)
  })

  it('rejects recurring -> engaged (members are never in follow-up)', () => {
    expect(isValidTransition('recurring', 'engaged')).toBe(false)
  })

  it('rejects archived -> anything', () => {
    for (const target of ALL_STATES) {
      if (target !== 'archived') expect(isValidTransition('archived', target)).toBe(false)
    }
  })

  it('allows same-state no-op', () => {
    expect(isValidTransition('engaged', 'engaged')).toBe(true)
  })
})

describe('allowedOutreachForState', () => {
  it('engaged -> pre_quote', () => {
    expect(allowedOutreachForState('engaged')).toBe('pre_quote')
  })

  it('quoted -> post_quote', () => {
    expect(allowedOutreachForState('quoted')).toBe('post_quote')
  })

  it('retargeting -> retargeting', () => {
    expect(allowedOutreachForState('retargeting')).toBe('retargeting')
  })

  it('recurring -> null (zero outreach)', () => {
    expect(allowedOutreachForState('recurring')).toBeNull()
  })

  it('archived -> null (zero outreach ever)', () => {
    expect(allowedOutreachForState('archived')).toBeNull()
  })

  it('scheduled -> null (operational only)', () => {
    expect(allowedOutreachForState('scheduled')).toBeNull()
  })

  it('in_service -> null', () => {
    expect(allowedOutreachForState('in_service')).toBeNull()
  })
})

describe('Railway coverage — every state has a documented outreach rule', () => {
  const EXPECTED: Record<LifecycleState, 'pre_quote' | 'post_quote' | 'retargeting' | null> = {
    new_lead: null,
    engaged: 'pre_quote',
    quoted: 'post_quote',
    approved: null,
    scheduled: null,
    in_service: null,
    awaiting_payment: null,
    paid: null,
    recurring: null,
    retargeting: 'retargeting',
    archived: null,
  }

  for (const state of ALL_STATES) {
    it(`${state} -> ${EXPECTED[state] ?? 'none'}`, () => {
      expect(allowedOutreachForState(state)).toBe(EXPECTED[state])
    })
  }
})
