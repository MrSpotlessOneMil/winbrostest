/**
 * Unit tests for message-generator.
 *
 * OUTREACH-SPEC v1.0 Section 8. Verifies retry-on-lint-fail, template
 * fallback, and model routing. LLM is stubbed.
 */

import { describe, it, expect, vi } from 'vitest'
import { generateOutreachMessage, type LLMCallFn } from '../../packages/core/src/message-generator'
import { emptyMemory } from '../../packages/core/src/customer-memory'

function stubClient() {
  // Unused when preloadedMemory is passed
  return {} as any
}

describe('generateOutreachMessage — happy path', () => {
  it('returns AI text when lint passes', async () => {
    const llm: LLMCallFn = vi.fn().mockResolvedValue('hey sarah, quick nudge about the quote')
    const res = await generateOutreachMessage({
      client: stubClient(),
      tenantId: 't1',
      tenantName: 'Spotless',
      voiceProfile: { owner_name: 'Dominic', owner_vibe: 'casual' },
      customerId: 10,
      customerFirstName: 'Sarah',
      pipeline: 'pre_quote',
      stage: 1,
      variant: 'a',
      channel: 'sms',
      llmCall: llm,
      preloadedMemory: emptyMemory(),
    })
    expect(res.text).toContain('sarah')
    expect(res.fallback).toBe(false)
    expect(res.lintResult.ok).toBe(true)
  })
})

describe('generateOutreachMessage — retry on lint fail', () => {
  it('retries up to 3 times if LLM returns banned phrase', async () => {
    let calls = 0
    const llm: LLMCallFn = vi.fn(async () => {
      calls++
      if (calls < 3) return 'dear valued customer, limited time offer!'
      return 'hey sarah, quick nudge'
    })
    const res = await generateOutreachMessage({
      client: stubClient(),
      tenantId: 't1',
      tenantName: 'Spotless',
      voiceProfile: {},
      customerId: 10,
      customerFirstName: 'Sarah',
      pipeline: 'pre_quote',
      stage: 1,
      variant: 'a',
      channel: 'sms',
      llmCall: llm,
      preloadedMemory: emptyMemory(),
    })
    expect(llm).toHaveBeenCalledTimes(3)
    expect(res.fallback).toBe(false)
    expect(res.text).toContain('sarah')
  })

  it('falls back to template if lint fails 3x', async () => {
    const llm: LLMCallFn = vi.fn().mockResolvedValue('dear valued customer, book now!')
    const res = await generateOutreachMessage({
      client: stubClient(),
      tenantId: 't1',
      tenantName: 'Spotless',
      voiceProfile: {},
      customerId: 10,
      customerFirstName: 'Sarah',
      pipeline: 'pre_quote',
      stage: 1,
      variant: 'a',
      channel: 'sms',
      llmCall: llm,
      preloadedMemory: emptyMemory(),
    })
    expect(llm).toHaveBeenCalledTimes(3)
    expect(res.fallback).toBe(true)
    // Fallback text should not contain banned phrases
    expect(res.text.toLowerCase()).not.toContain('dear')
    expect(res.text.toLowerCase()).not.toContain('valued customer')
  })

  it('falls back if LLM throws', async () => {
    const llm: LLMCallFn = vi.fn().mockRejectedValue(new Error('network fail'))
    const res = await generateOutreachMessage({
      client: stubClient(),
      tenantId: 't1',
      tenantName: 'Spotless',
      voiceProfile: {},
      customerId: 10,
      customerFirstName: 'Sarah',
      pipeline: 'pre_quote',
      stage: 1,
      variant: 'a',
      channel: 'sms',
      llmCall: llm,
      preloadedMemory: emptyMemory(),
    })
    expect(res.fallback).toBe(true)
    expect(res.text).toBeTruthy()
  })
})

describe('generateOutreachMessage — model routing', () => {
  it('uses Sonnet for post_quote stage 1', async () => {
    let usedModel = ''
    const llm: LLMCallFn = vi.fn(async (args) => {
      usedModel = args.model
      return 'hey sarah did you see the quote'
    })
    await generateOutreachMessage({
      client: stubClient(),
      tenantId: 't1',
      tenantName: 'Spotless',
      voiceProfile: {},
      customerId: 10,
      customerFirstName: 'Sarah',
      pipeline: 'post_quote',
      stage: 1,
      variant: 'a',
      channel: 'sms',
      llmCall: llm,
      preloadedMemory: emptyMemory(),
    })
    expect(usedModel).toContain('sonnet')
  })

  it('uses Haiku for everything else', async () => {
    let usedModel = ''
    const llm: LLMCallFn = vi.fn(async (args) => {
      usedModel = args.model
      return 'hey sarah nudge'
    })
    await generateOutreachMessage({
      client: stubClient(),
      tenantId: 't1',
      tenantName: 'Spotless',
      voiceProfile: {},
      customerId: 10,
      customerFirstName: 'Sarah',
      pipeline: 'pre_quote',
      stage: 1,
      variant: 'a',
      channel: 'sms',
      llmCall: llm,
      preloadedMemory: emptyMemory(),
    })
    expect(usedModel).toContain('haiku')
  })
})

describe('generateOutreachMessage — post_quote stage 3 offer', () => {
  it('passes offer into prompt when offerPct provided', async () => {
    let seenUser = ''
    const llm: LLMCallFn = vi.fn(async (args) => {
      seenUser = args.user
      return 'hey sarah 10 percent off this week'
    })
    await generateOutreachMessage({
      client: stubClient(),
      tenantId: 't1',
      tenantName: 'Spotless',
      voiceProfile: {},
      customerId: 10,
      customerFirstName: 'Sarah',
      pipeline: 'post_quote',
      stage: 3,
      variant: 'a',
      channel: 'sms',
      offerPct: 10,
      llmCall: llm,
      preloadedMemory: emptyMemory(),
    })
    expect(seenUser).toContain('10%')
  })
})
