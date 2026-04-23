import { describe, it, expect } from 'vitest'
import { pickVariant } from '../../packages/core/src/ab-testing'

describe('pickVariant — deterministic 50/50 split', () => {
  it('even customerId -> a', () => {
    expect(pickVariant(100)).toBe('a')
    expect(pickVariant(0)).toBe('a')
    expect(pickVariant(2)).toBe('a')
  })

  it('odd customerId -> b', () => {
    expect(pickVariant(1)).toBe('b')
    expect(pickVariant(99)).toBe('b')
    expect(pickVariant(13811)).toBe('b')
  })

  it('same customer always gets same variant (deterministic)', () => {
    const customerId = 42
    expect(pickVariant(customerId)).toBe(pickVariant(customerId))
    expect(pickVariant(customerId)).toBe(pickVariant(customerId))
  })

  it('roughly 50/50 across a large range', () => {
    let a = 0, b = 0
    for (let i = 1; i <= 1000; i++) {
      if (pickVariant(i) === 'a') a++
      else b++
    }
    // Deterministic split of sequential integers: exactly 500/500
    expect(a).toBe(500)
    expect(b).toBe(500)
  })
})
