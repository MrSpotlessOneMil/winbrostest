/**
 * Unit tests for customer-memory extraction logic.
 *
 * OUTREACH-SPEC v1.0 Section 8.2. `analyzeMessages` is pure — no DB.
 */

import { describe, it, expect } from 'vitest'
import { analyzeMessages, emptyMemory } from '../../packages/core/src/customer-memory'

describe('analyzeMessages — casing pattern', () => {
  it('detects all-lowercase pattern', () => {
    const msgs = [
      { direction: 'inbound', content: 'yo sounds good' },
      { direction: 'inbound', content: 'that works for me' },
      { direction: 'inbound', content: 'cool lmk' },
    ]
    const mem = analyzeMessages(msgs)
    expect(mem.casing_pattern).toBe('lower')
  })

  it('detects formal/uppercase-heavy pattern', () => {
    // Heuristic fires when >40% uppercase ratio per message, in >30% of messages.
    // ALL CAPS / SHOUTY / caps-heavy speech triggers this.
    const msgs = [
      { direction: 'inbound', content: 'HELLO THAT SOUNDS GOOD' },
      { direction: 'inbound', content: 'OK PERFECT THANKS' },
      { direction: 'inbound', content: 'SEE YOU THEN' },
    ]
    const mem = analyzeMessages(msgs)
    expect(mem.casing_pattern).toBe('formal')
  })
})

describe('analyzeMessages — emojis', () => {
  it('collects distinct emojis from inbound', () => {
    const msgs = [
      { direction: 'inbound', content: 'yo 👋 how are you' },
      { direction: 'inbound', content: 'thx 🙏 ✨' },
    ]
    const mem = analyzeMessages(msgs)
    expect(mem.emojis_used).toContain('👋')
    expect(mem.emojis_used).toContain('🙏')
    expect(mem.emojis_used).toContain('✨')
  })

  it('ignores emojis in outbound-only', () => {
    const msgs = [
      { direction: 'outbound', content: 'hey 👋 ✨' },
      { direction: 'inbound', content: 'hi' },
    ]
    const mem = analyzeMessages(msgs)
    expect(mem.emojis_used).toEqual([])
  })
})

describe('analyzeMessages — pets', () => {
  it('extracts pet mentions', () => {
    const msgs = [
      { direction: 'inbound', content: 'my dog Milo keeps eating the baseboards' },
    ]
    const mem = analyzeMessages(msgs)
    expect(mem.pets.length).toBeGreaterThan(0)
    expect(mem.pets[0].type).toBe('dog')
    // name capture is best-effort, may or may not catch 'Milo'
  })
})

describe('analyzeMessages — objections', () => {
  it('captures price-related objections', () => {
    const msgs = [
      { direction: 'inbound', content: 'that is too expensive for me' },
    ]
    const mem = analyzeMessages(msgs)
    expect(mem.known_objections.length).toBeGreaterThan(0)
  })

  it('captures competitor mentions', () => {
    const msgs = [
      { direction: 'inbound', content: 'I already have a cleaner' },
    ]
    const mem = analyzeMessages(msgs)
    expect(mem.known_objections.length).toBeGreaterThan(0)
  })
})

describe('analyzeMessages — callback anchors', () => {
  it('pulls short quotable phrases from inbound', () => {
    const msgs = [
      { direction: 'inbound', content: 'kitchen reno finished. so much dust' },
      { direction: 'inbound', content: 'moving in next week.' },
    ]
    const mem = analyzeMessages(msgs)
    expect(mem.callback_anchors.length).toBeGreaterThan(0)
    expect(mem.callback_anchors.some(a => a.toLowerCase().includes('dust') || a.toLowerCase().includes('moving'))).toBe(true)
  })

  it('returns empty for no inbound', () => {
    const msgs = [
      { direction: 'outbound', content: 'hello' },
    ]
    const mem = analyzeMessages(msgs)
    expect(mem.callback_anchors).toEqual([])
  })
})

describe('analyzeMessages — warmth signal', () => {
  it('low for messages with objections', () => {
    const msgs = [
      { direction: 'inbound', content: 'too expensive, cant afford that' },
      { direction: 'inbound', content: 'already have a cleaner' },
    ]
    const mem = analyzeMessages(msgs)
    expect(mem.warmth_signal).toBeLessThan(0.5)
  })

  it('high for warm long-form replies', () => {
    const msgs = [
      { direction: 'inbound', content: 'thats great news and so excited to schedule' },
      { direction: 'inbound', content: 'sounds perfect see you then thanks' },
    ]
    const mem = analyzeMessages(msgs)
    expect(mem.warmth_signal).toBeGreaterThan(0.5)
  })
})

describe('emptyMemory — defaults', () => {
  it('returns a safe default shape', () => {
    const m = emptyMemory()
    expect(m.emojis_used).toEqual([])
    expect(m.casing_pattern).toBe('mixed')
    expect(m.pets).toEqual([])
    expect(m.kids).toEqual([])
    expect(m.callback_anchors).toEqual([])
    expect(m.warmth_signal).toBe(0.5)
  })
})
