/**
 * Unit tests for lead-source → canonical marketing channel normalization.
 * Pure function, no mocks needed.
 */
import { describe, it, expect } from 'vitest'
import { normalizeChannel, channelKey } from '@/lib/marketing/attribution'

describe('normalizeChannel', () => {
  it('maps LSA leads (source=google_lsa)', () => {
    expect(normalizeChannel({ source: 'google_lsa' }).channel).toBe('lsa')
  })

  it('maps LSA leads detected via form_data markers', () => {
    expect(normalizeChannel({ source: 'phone', formData: { lsa_lead_id: 'x', lsa_lead_type: 'PHONE_CALL' } }).channel).toBe('lsa')
  })

  it('maps organic SEO city pages from source_detail area-<city>', () => {
    const n = normalizeChannel({ source: 'website', formData: { source_detail: 'area-santa-monica' } })
    expect(n.channel).toBe('seo')
    expect(n.detail).toBe('santa-monica')
    expect(channelKey(n)).toBe('seo:santa-monica')
  })

  it('maps SEO service pages from service-<...>', () => {
    expect(normalizeChannel({ source: 'website', formData: { source: 'service-deep-cleaning/venice' } }).channel).toBe('seo')
  })

  it('maps GBP from utm_source', () => {
    expect(normalizeChannel({ source: 'website', formData: { utm_source: 'gbp' } }).channel).toBe('gbp')
  })

  it('maps paid search from utm_medium=cpc', () => {
    expect(normalizeChannel({ source: 'website', formData: { utm_medium: 'cpc', utm_source: 'google' } }).channel).toBe('paid_search')
  })

  it('maps social from utm_source and captures platform', () => {
    const n = normalizeChannel({ source: 'website', formData: { utm_source: 'ig', utm_medium: 'social' } })
    expect(n.channel).toBe('social')
    expect(n.detail).toBe('instagram')
  })

  it('maps cold email from utm_medium=email', () => {
    expect(normalizeChannel({ source: 'website', formData: { utm_medium: 'email', utm_source: 'instantly' } }).channel).toBe('email')
  })

  it('maps organic search referral to seo', () => {
    expect(normalizeChannel({ source: 'website', formData: { referrer: 'https://www.google.com/' } }).channel).toBe('seo')
  })

  it('maps a third-party referrer to referral', () => {
    expect(normalizeChannel({ source: 'website', formData: { referrer: 'https://www.yelp.com/biz/x' } }).channel).toBe('referral')
  })

  it('treats bare website/book visits as direct', () => {
    expect(normalizeChannel({ source: 'website', formData: { source_detail: 'book' } }).channel).toBe('direct')
    expect(normalizeChannel({ source: 'website' }).channel).toBe('direct')
  })

  it('keeps non-LSA phone leads as phone', () => {
    expect(normalizeChannel({ source: 'phone' }).channel).toBe('phone')
  })

  it('falls back to customer lead_source for LSA', () => {
    expect(normalizeChannel({ source: 'website', customerLeadSource: 'google_lsa' }).channel).toBe('lsa')
  })

  it('LSA beats UTM when both present (paid intent precedence)', () => {
    expect(normalizeChannel({ source: 'google_lsa', formData: { utm_medium: 'social' } }).channel).toBe('lsa')
  })
})
