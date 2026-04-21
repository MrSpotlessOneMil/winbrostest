/**
 * T5 — Cold-lead follow-up cadence.
 *
 * James Shannon / Miguel Cruz incidents (2026-04-20): initial cold outreach
 * sent, zero reply, no follow-up from the agent. Patrick had to manually
 * step in 4 hours later.
 *
 * Tests the template selection and stage thresholds. The cron's DB path is
 * exercised in t5-cold-cadence-cron.test.ts (not written — depends on
 * dedicated mock infra we don't have yet).
 */

import { describe, it, expect } from 'vitest'
import {
  coldFollowupStage1,
  coldFollowupStage2,
  coldFollowupStage3,
  templateForStage,
  COLD_FOLLOWUP_MIN_HOURS,
} from '../../packages/core/src/cold-followup-templates'

const tenant = {
  business_name_short: 'Spotless',
  business_name: 'Spotless Scrubbers LLC',
  sdr_persona: 'Sarah',
  slug: 'spotless-scrubbers',
}

describe('cold-followup templates', () => {
  it('stage 1 uses sdr persona and business name', () => {
    const out = coldFollowupStage1({ tenant, firstName: 'James' })
    expect(out).toMatch(/Sarah/)
    expect(out).toMatch(/Spotless/)
    expect(out).toMatch(/James/)
    expect(out.length).toBeLessThan(200)
  })

  it('falls back to "there" when firstName missing', () => {
    const out = coldFollowupStage1({ tenant, firstName: null })
    expect(out).toMatch(/\bthere\b/i)
  })

  it('stage 2 uses low-pressure framing', () => {
    const out = coldFollowupStage2({ tenant, firstName: 'Miguel' })
    expect(out).toMatch(/no pressure|not the right time|when you're ready/i)
  })

  it('stage 3 is final and polite', () => {
    const out = coldFollowupStage3({ tenant, firstName: 'Taylor' })
    expect(out).toMatch(/last check-in/i)
  })

  it('NEVER mentions discount/promo in any stage', () => {
    for (const stage of [1, 2, 3] as const) {
      const out = templateForStage(stage, { tenant, firstName: 'Test' })
      expect(out).not.toMatch(/\bdiscount\b/i)
      expect(out).not.toMatch(/\b\d+%\s*off\b/i)
      expect(out).not.toMatch(/\bspecial\s+(?:price|rate|deal|offer)\b/i)
    }
  })

  it('NEVER promises email follow-up', () => {
    for (const stage of [1, 2, 3] as const) {
      const out = templateForStage(stage, { tenant, firstName: 'Test' })
      expect(out).not.toMatch(/\bemail\b/i)
    }
  })

  it('stage thresholds match the plan: 4h / 24h / 72h', () => {
    expect(COLD_FOLLOWUP_MIN_HOURS[1]).toBe(4)
    expect(COLD_FOLLOWUP_MIN_HOURS[2]).toBe(24)
    expect(COLD_FOLLOWUP_MIN_HOURS[3]).toBe(72)
  })
})
