/**
 * Unit tests for the global unsubscribe handler (Build 2).
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 * Source spec: clean_machine_rebuild/07_RETARGETING.md §5 + §10
 *
 * Pure pattern detection. Side-effect handler tests live in tier-2 integration.
 */

import { describe, it, expect } from 'vitest'
import {
  isStopMessage,
  isReoptInMessage,
} from '../../../apps/house-cleaning/lib/services/followups/unsubscribe'

describe('isStopMessage', () => {
  it.each([
    'STOP', 'stop', 'Stop',
    'UNSUBSCRIBE', 'unsubscribe',
    'QUIT', 'quit',
    'CANCEL', 'cancel',
    'END', 'end',
    'OPT OUT', 'opt out', 'opt-out', 'optout',
    'REMOVE ME', 'remove me',
    'STOP MESSAGING', 'stop messaging',
  ])('matches %s', (msg) => {
    expect(isStopMessage(msg)).toBe(true)
  })

  it.each([
    "don't stop calling me",
    'i need to cancel my appointment',
    'please end the cleaning early',
    'just stop by whenever',
    'stop in for coffee',
    'i quit my job',
    'remove me from the list of pending',
    "stop messaging me about discounts please can you call instead",
  ])('does NOT match %s (avoids false positives)', (msg) => {
    expect(isStopMessage(msg)).toBe(false)
  })

  it('handles leading/trailing whitespace', () => {
    expect(isStopMessage('   STOP   ')).toBe(true)
    expect(isStopMessage('\nstop\n')).toBe(true)
  })

  it('does NOT match a multi-word message even if it starts with stop', () => {
    expect(isStopMessage('stop please')).toBe(false)
  })
})

describe('isReoptInMessage', () => {
  it.each(['BACK', 'back', 'START', 'start', 'SUBSCRIBE', 'subscribe', 'OPT IN', 'opt in', 'opt-in'])(
    'matches %s',
    (msg) => {
      expect(isReoptInMessage(msg)).toBe(true)
    },
  )

  it('does NOT match conversational use', () => {
    expect(isReoptInMessage('back tomorrow')).toBe(false)
    expect(isReoptInMessage('start the cleaning at noon')).toBe(false)
  })
})
