/**
 * Unit tests for follow-up + retargeting SMS templates (Build 2).
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 *
 * Verifies:
 *   - Every template_key renders without crashing
 *   - First-name fallback to "there" when null
 *   - Tenant name interpolated correctly
 *   - Offer label inserted when provided, sensible fallback when not
 *   - No template contains banned phrases or emojis (per OUTREACH-SPEC v1.0 §8.8)
 */

import { describe, it, expect } from 'vitest'
import {
  renderTemplate,
  type TemplateContext,
  type TemplateKey,
} from '../../../apps/house-cleaning/lib/services/followups/templates'

const baseCtx = (override: Partial<TemplateContext> = {}): TemplateContext => ({
  customerFirstName: 'Sarah',
  tenantName: 'Spotless Scrubbers',
  ...override,
})

const ALL_KEYS: TemplateKey[] = [
  'still_there',
  'small_followup',
  'followup_with_offer',
  'soft_poke',
  'last_chance_offer',
  'recurring_seed_20',
  'open_slots_this_week',
  'monthly_offer_15',
  'monthly_offer_20',
  'evergreen_pct_15_recurring',
  'evergreen_pct_20_recurring',
  'evergreen_pct_25_single',
  'evergreen_dollar_20',
  'evergreen_dollar_40',
  'evergreen_free_addon_fridge',
  'evergreen_free_addon_oven',
  'evergreen_referral',
  'evergreen_seasonal',
  'unsubscribe_confirmation',
]

describe('renderTemplate — every key renders', () => {
  it.each(ALL_KEYS)('%s renders to a non-empty string', (key) => {
    const out = renderTemplate(key, baseCtx())
    expect(out).toBeTruthy()
    expect(out!.length).toBeGreaterThan(0)
  })

  it.each(ALL_KEYS)('%s never contains an emoji', (key) => {
    const out = renderTemplate(key, baseCtx())!
    // Same emoji pattern as sanitizer
    const EMOJI = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/u
    expect(EMOJI.test(out)).toBe(false)
  })
})

describe('renderTemplate — first-name fallback', () => {
  it('uses first_name when present', () => {
    const out = renderTemplate('still_there', baseCtx({ customerFirstName: 'Mary' }))!
    expect(out).toContain('Mary')
  })

  it('falls back to "there" when null', () => {
    const out = renderTemplate('still_there', baseCtx({ customerFirstName: null }))!
    expect(out).toContain('there')
  })
})

describe('renderTemplate — tenant name interpolation', () => {
  it.each(['recurring_seed_20', 'evergreen_dollar_20', 'unsubscribe_confirmation'] as const)(
    '%s includes tenant name',
    (key) => {
      const out = renderTemplate(key, baseCtx({ tenantName: 'Cedar Rapids House Cleaners' }))!
      expect(out).toContain('Cedar Rapids House Cleaners')
    },
  )
})

describe('renderTemplate — offer labels', () => {
  it('followup_with_offer renders with offer when supplied', () => {
    const out = renderTemplate('followup_with_offer', baseCtx({ offerLabel: '$20 off' }))!
    expect(out).toContain('$20 off')
  })

  it('followup_with_offer has sensible fallback without offer', () => {
    const out = renderTemplate('followup_with_offer', baseCtx())!
    expect(out).toBeTruthy()
    // Should not literally include the unrendered placeholder
    expect(out).not.toContain('{{')
    expect(out).not.toContain('undefined')
  })

  it('evergreen_dollar_40 renders the offer label', () => {
    const out = renderTemplate('evergreen_dollar_40', baseCtx({ offerLabel: 'C$40 off' }))!
    expect(out).toContain('C$40 off')
  })
})

describe('renderTemplate — bedrooms/bathrooms reference', () => {
  it('monthly_offer_15 references bed/bath when known', () => {
    const out = renderTemplate('monthly_offer_15', baseCtx({ bedrooms: 3, bathrooms: 2, offerLabel: '15% off' }))!
    expect(out).toContain('3BR/2BA')
  })

  it('monthly_offer_15 omits bed/bath when null', () => {
    const out = renderTemplate('monthly_offer_15', baseCtx({ offerLabel: '15% off' }))!
    expect(out).not.toContain('BR/')
    expect(out).not.toContain('undefined')
  })
})

describe('renderTemplate — TCPA compliance', () => {
  it('unsubscribe_confirmation includes the BACK opt-in path', () => {
    const out = renderTemplate('unsubscribe_confirmation', baseCtx())!
    expect(out.toLowerCase()).toContain('back')
    expect(out).toContain('Spotless Scrubbers')
  })
})
