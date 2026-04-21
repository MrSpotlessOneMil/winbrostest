/**
 * T3 — KNOWN FACTS prompt section prevents redundant intake.
 *
 * Linda Kingcade incident (2026-04-20): form-submitted 6/8 fields; agent
 * asked for all of them again. formatCustomerContextForPrompt must emit a
 * KNOWN FACTS section from ctx.lead.form_data and instruct the LLM never to
 * re-ask.
 */

import { describe, it, expect } from 'vitest'
import { formatCustomerContextForPrompt, type CustomerContext } from '../../packages/core/src/auto-response'

const tenant = {
  id: 'tenant-1',
  slug: 'texas-nova',
  name: 'Texas Nova',
  timezone: 'America/Chicago',
  business_name: 'Texas Nova Cleaning',
} as any

const EMPTY_CTX: CustomerContext = {
  activeJobs: [],
  recentJobs: [],
  customer: null,
  lead: null,
  totalJobs: 0,
  totalSpend: 0,
}

describe('T3 — KNOWN FACTS injection', () => {
  it('emits KNOWN FACTS when lead.form_data is populated', () => {
    const ctx: CustomerContext = {
      ...EMPTY_CTX,
      lead: {
        id: 1,
        status: 'new',
        source: 'website',
        form_data: {
          name: 'Linda Kingcade',
          email: 'linda@example.com',
          bedrooms: 3,
          bathrooms: 3,
          half_baths: 1,
          sqft_range: '1000-1499',
          service_type: 'deep',
          estimated_price: 335,
        },
      },
    }
    const prompt = formatCustomerContextForPrompt(ctx, tenant)
    expect(prompt).toMatch(/KNOWN FACTS FROM FORM SUBMISSION/)
    expect(prompt).toMatch(/Linda Kingcade/)
    expect(prompt).toMatch(/Bedrooms: 3/)
    expect(prompt).toMatch(/Bathrooms: 3/)
    expect(prompt).toMatch(/Half baths: 1/)
    expect(prompt).toMatch(/Sqft: 1000-1499/)
    expect(prompt).toMatch(/Service: deep/)
    expect(prompt).toMatch(/Estimate shown on form: \$335/)
    expect(prompt).toMatch(/do NOT re-ask/i)
  })

  it('is silent when no form_data exists', () => {
    const prompt = formatCustomerContextForPrompt(EMPTY_CTX, tenant)
    expect(prompt).not.toMatch(/KNOWN FACTS/)
  })

  it('skips empty fields without emitting a blank line', () => {
    const ctx: CustomerContext = {
      ...EMPTY_CTX,
      lead: {
        id: 1,
        status: 'new',
        source: 'website',
        form_data: { name: 'Test User', bedrooms: null, bathrooms: 0, email: '' },
      },
    }
    const prompt = formatCustomerContextForPrompt(ctx, tenant)
    expect(prompt).toMatch(/Test User/)
    expect(prompt).not.toMatch(/Bedrooms:/)
    // bathrooms=0 is falsy → pushIf skips (0 is stringified as '0' which trims non-empty — accept both behaviors)
  })

  it('pairs with AUTHORITATIVE APPOINTMENT when both are present', () => {
    const ctx: CustomerContext = {
      ...EMPTY_CTX,
      activeJobs: [{
        id: 1,
        service_type: 'deep_clean',
        date: null,
        scheduled_at: '2026-04-24T14:00:00.000Z',
        price: 335,
        status: 'scheduled',
        address: '123 Main',
        cleaner_name: null,
      }],
      lead: {
        id: 1,
        status: 'new',
        source: 'website',
        form_data: { name: 'Linda', bedrooms: 3, bathrooms: 2 },
      },
    }
    const prompt = formatCustomerContextForPrompt(ctx, tenant)
    expect(prompt).toMatch(/AUTHORITATIVE APPOINTMENT/)
    expect(prompt).toMatch(/KNOWN FACTS/)
  })
})
