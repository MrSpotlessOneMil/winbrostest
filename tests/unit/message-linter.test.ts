/**
 * Unit tests for the outreach message linter.
 *
 * OUTREACH-SPEC v1.0 Section 8.8. Every rule gets a positive + negative case.
 * Pure logic — no DB, no HTTP.
 */

import { describe, it, expect } from 'vitest'
import { lintMessage, GLOBAL_BANNED_PHRASES } from '../../packages/core/src/message-linter'

describe('lintMessage — banned phrases', () => {
  it('rejects every global banned phrase', () => {
    for (const phrase of GLOBAL_BANNED_PHRASES) {
      const res = lintMessage({
        text: `hey ${phrase} whatever`,
        pipeline: 'pre_quote',
        channel: 'sms',
      })
      expect(res.ok).toBe(false)
      expect(res.failures.some(f => f.rule === 'banned_phrase')).toBe(true)
    }
  })

  it('case-insensitive match', () => {
    const res = lintMessage({ text: 'DEAR customer, here is info', pipeline: 'pre_quote', channel: 'sms' })
    expect(res.ok).toBe(false)
    expect(res.failures[0].rule).toBe('banned_phrase')
  })

  it('tenant-specific never_says merges with global', () => {
    const res = lintMessage({
      text: 'hey sarah, about your cleaning — hope all is well',
      pipeline: 'pre_quote',
      channel: 'sms',
      tenantBannedPhrases: ['hope all is well'],
    })
    expect(res.ok).toBe(false)
    expect(res.failures[0].rule).toBe('banned_phrase')
  })

  it('passes a clean message', () => {
    const res = lintMessage({ text: 'hey sarah, quick nudge about the quote', pipeline: 'pre_quote', channel: 'sms' })
    expect(res.ok).toBe(true)
  })
})

describe('lintMessage — emoji count', () => {
  it('rejects > 3 emojis', () => {
    const res = lintMessage({ text: 'yo 👋 ✨ 🧹 🏡 😭', pipeline: 'pre_quote', channel: 'sms' })
    expect(res.ok).toBe(false)
    expect(res.failures.some(f => f.rule === 'too_many_emojis')).toBe(true)
  })
  it('allows 3 emojis', () => {
    const res = lintMessage({ text: 'yo 👋 ✨ 🧹 hope you are well', pipeline: 'pre_quote', channel: 'sms' })
    expect(res.failures.find(f => f.rule === 'too_many_emojis')).toBeUndefined()
  })
})

describe('lintMessage — placeholders', () => {
  it('rejects unreplaced {name}', () => {
    const res = lintMessage({ text: 'hey {name}, nudge', pipeline: 'pre_quote', channel: 'sms' })
    expect(res.ok).toBe(false)
    expect(res.failures.some(f => f.rule === 'unreplaced_placeholder')).toBe(true)
  })
  it('allows prose with curly braces in code blocks', () => {
    const res = lintMessage({ text: 'hey sarah here is the info', pipeline: 'pre_quote', channel: 'sms' })
    expect(res.failures.find(f => f.rule === 'unreplaced_placeholder')).toBeUndefined()
  })
})

describe('lintMessage — carrier keyword names', () => {
  it('rejects if firstName is STOP', () => {
    const res = lintMessage({ text: 'hey STOP, nudge', pipeline: 'pre_quote', channel: 'sms', firstName: 'STOP' })
    expect(res.failures.some(f => f.rule === 'carrier_keyword_name')).toBe(true)
  })
  it('allows a normal first name', () => {
    const res = lintMessage({ text: 'hey Sarah, nudge', pipeline: 'pre_quote', channel: 'sms', firstName: 'Sarah' })
    expect(res.failures.find(f => f.rule === 'carrier_keyword_name')).toBeUndefined()
  })
})

describe('lintMessage — retargeting callback requirement', () => {
  it('rejects retargeting message without a callback anchor', () => {
    const res = lintMessage({
      text: 'hey sarah, it has been a while',
      pipeline: 'retargeting',
      channel: 'sms',
      callbackAnchors: ['the kitchen reno', 'milo the dog'],
    })
    expect(res.ok).toBe(false)
    expect(res.failures.some(f => f.rule === 'missing_callback')).toBe(true)
  })
  it('accepts retargeting message that includes an anchor', () => {
    const res = lintMessage({
      text: 'hey sarah, how did the kitchen reno turn out? ready for a post-dust clean?',
      pipeline: 'retargeting',
      channel: 'sms',
      callbackAnchors: ['the kitchen reno', 'milo the dog'],
    })
    expect(res.failures.find(f => f.rule === 'missing_callback')).toBeUndefined()
  })
  it('skips the callback check when anchors is empty', () => {
    const res = lintMessage({
      text: 'hey sarah, quick check in',
      pipeline: 'retargeting',
      channel: 'sms',
      callbackAnchors: [],
    })
    expect(res.failures.find(f => f.rule === 'missing_callback')).toBeUndefined()
  })
  it('pre_quote messages are not required to have a callback', () => {
    const res = lintMessage({
      text: 'hey sarah, any update on the quote?',
      pipeline: 'pre_quote',
      channel: 'sms',
      callbackAnchors: ['something specific'],
    })
    expect(res.failures.find(f => f.rule === 'missing_callback')).toBeUndefined()
  })
})

describe('lintMessage — length limits', () => {
  it('rejects SMS over 160 chars', () => {
    const res = lintMessage({ text: 'x'.repeat(161), pipeline: 'pre_quote', channel: 'sms' })
    expect(res.failures.some(f => f.rule === 'length_exceeded')).toBe(true)
  })
  it('accepts SMS at 160 chars', () => {
    const res = lintMessage({ text: 'x'.repeat(160), pipeline: 'pre_quote', channel: 'sms' })
    expect(res.failures.find(f => f.rule === 'length_exceeded')).toBeUndefined()
  })
  it('MMS allows 600 chars', () => {
    const res = lintMessage({ text: 'x'.repeat(600), pipeline: 'pre_quote', channel: 'mms' })
    expect(res.failures.find(f => f.rule === 'length_exceeded')).toBeUndefined()
  })
})

describe('lintMessage — empty input', () => {
  it('rejects empty string', () => {
    const res = lintMessage({ text: '', pipeline: 'pre_quote', channel: 'sms' })
    expect(res.ok).toBe(false)
    expect(res.failures[0].rule).toBe('empty_message')
  })
  it('rejects whitespace-only', () => {
    const res = lintMessage({ text: '   ', pipeline: 'pre_quote', channel: 'sms' })
    expect(res.ok).toBe(false)
  })
})
