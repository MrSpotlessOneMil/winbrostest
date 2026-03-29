/**
 * Regression test: Opt-out detection — keyword layer + safe defaults.
 *
 * The keyword layer must correctly identify TCPA stop words without false positives.
 * The AI layer (detectOptOutIntent) is tested with a mock since it calls Claude.
 */

import { describe, it, expect } from 'vitest'
import { isKeywordOptOut, isStartRequest } from '@/lib/sms-opt-out'

describe('Keyword opt-out detection', () => {
  it('detects all standard TCPA stop words', () => {
    const stopWords = ['stop', 'STOP', 'Stop', 'unsubscribe', 'opt out', 'optout', 'cancel texts', 'quit']
    for (const word of stopWords) {
      expect(isKeywordOptOut(word), `should detect "${word}" as opt-out`).toBe(true)
    }
  })

  it('handles whitespace around stop words', () => {
    expect(isKeywordOptOut('  stop  ')).toBe(true)
    expect(isKeywordOptOut('\tstop\n')).toBe(true)
  })

  it('does NOT opt-out on normal conversation messages', () => {
    const normalMessages = [
      'Hi I need a cleaning',
      'Yes that sounds good',
      "No I don't want that date",
      'Can you stop by on Tuesday?', // contains "stop" but not exact match
      'Please unsubscribe me from the newsletter', // contains "unsubscribe" but not exact
      "I'd like to quit my membership plan", // contains "quit" but not exact
      'Yup',
      'bob@gmail.com',
      'No french panes',
      '3 bedrooms 2 bathrooms',
    ]
    for (const msg of normalMessages) {
      expect(isKeywordOptOut(msg), `false positive on: "${msg}"`).toBe(false)
    }
  })

  it('does NOT opt-out on empty or whitespace-only messages', () => {
    expect(isKeywordOptOut('')).toBe(false)
    expect(isKeywordOptOut('   ')).toBe(false)
  })
})

describe('START re-subscribe detection', () => {
  it('detects START keyword', () => {
    expect(isStartRequest('start')).toBe(true)
    expect(isStartRequest('START')).toBe(true)
    expect(isStartRequest('  Start  ')).toBe(true)
  })

  it('does NOT trigger on messages containing "start"', () => {
    expect(isStartRequest('When do you start?')).toBe(false)
    expect(isStartRequest('start time is 10am')).toBe(false)
  })
})
