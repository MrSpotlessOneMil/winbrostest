import { describe, it, expect } from 'vitest'
import { buildFirstTouchSMS, isSpecializedServiceType } from '../../packages/core/src/website-lead-sms'

const base = {
  firstName: 'Suanna',
  sdrName: 'Dominic',
  businessName: 'Spotless',
  serviceType: '',
  friendlyService: 'a cleaning',
  bedrooms: null as number | null,
  bathrooms: null as number | null,
  address: '',
  estimatedPrice: null as number | null,
  promo: null as null | { price: number; firstSms: string },
}

describe('buildFirstTouchSMS — voice rules', () => {
  it('starts with "Hey {first}, it\'s {sdr} from {biz}."', () => {
    const msg = buildFirstTouchSMS(base)
    expect(msg.startsWith("Hey Suanna, it's Dominic from Spotless.")).toBe(true)
  })

  it('never contains banned Mailchimp phrasing', () => {
    const variants = [
      buildFirstTouchSMS(base),
      buildFirstTouchSMS({ ...base, bedrooms: 2, bathrooms: 1 }),
      buildFirstTouchSMS({ ...base, bedrooms: 2, bathrooms: 1, address: '123 Main St' }),
      buildFirstTouchSMS({ ...base, bedrooms: 2, bathrooms: 1, estimatedPrice: 250 }),
      buildFirstTouchSMS({ ...base, estimatedPrice: 200 }),
      buildFirstTouchSMS({ ...base, serviceType: 'airbnb', friendlyService: 'airbnb' }),
      buildFirstTouchSMS({ ...base, promo: { price: 149, firstSms: 'Hey. Limited time offer!' } }),
    ]
    for (const v of variants) {
      expect(v).not.toMatch(/right away/i)
      expect(v).not.toMatch(/valued customer/i)
      expect(v).not.toMatch(/exclusive offer/i)
      expect(v).not.toMatch(/limited time/i)
      expect(v).not.toMatch(/!{2,}/) // never double-bang
    }
  })

  it('fits in a single SMS segment (<=160 chars) for all non-address variants', () => {
    const variants = [
      buildFirstTouchSMS(base),
      buildFirstTouchSMS({ ...base, bedrooms: 2, bathrooms: 1 }),
      buildFirstTouchSMS({ ...base, bedrooms: 2, bathrooms: 1, estimatedPrice: 250 }),
      buildFirstTouchSMS({ ...base, estimatedPrice: 200 }),
      buildFirstTouchSMS({ ...base, serviceType: 'airbnb', friendlyService: 'airbnb' }),
    ]
    for (const v of variants) {
      expect(v.length, `message too long: ${v}`).toBeLessThanOrEqual(160)
    }
  })

  it('includes the customer first name in every variant', () => {
    const variants = [
      buildFirstTouchSMS(base),
      buildFirstTouchSMS({ ...base, bedrooms: 2, bathrooms: 1 }),
      buildFirstTouchSMS({ ...base, bedrooms: 2, bathrooms: 1, address: '123 Main' }),
      buildFirstTouchSMS({ ...base, promo: { price: 99, firstSms: 'Hey. Deal text.' } }),
      buildFirstTouchSMS({ ...base, serviceType: 'commercial', friendlyService: 'commercial' }),
    ]
    for (const v of variants) expect(v).toContain('Suanna')
  })

  it('surfaces bed/bath + address when the form has them', () => {
    const msg = buildFirstTouchSMS({
      ...base,
      bedrooms: 3,
      bathrooms: 2,
      address: '742 Evergreen Terrace',
    })
    expect(msg).toContain('3 bed')
    expect(msg).toContain('2 bath')
    expect(msg).toContain('742 Evergreen Terrace')
  })

  it('surfaces the promo price when promoConfig is supplied', () => {
    const msg = buildFirstTouchSMS({
      ...base,
      bedrooms: 2,
      bathrooms: 1,
      promo: { price: 149, firstSms: 'Ignored. Body text.' },
    })
    expect(msg).toContain('$149')
    expect(msg).toContain('2 bed / 1 bath')
  })

  it('asks for address + bed/bath when the form sent neither', () => {
    const msg = buildFirstTouchSMS(base)
    expect(msg).toMatch(/address.*bed\/bath|bed\/bath.*address/i)
  })

  it('does not ask for bed/bath on specialized services', () => {
    const msg = buildFirstTouchSMS({
      ...base,
      serviceType: 'commercial',
      friendlyService: 'commercial',
    })
    expect(msg).not.toMatch(/how many bed\/bath/i)
    expect(msg).toContain('commercial')
  })
})

describe('isSpecializedServiceType', () => {
  it('flags specialized services', () => {
    expect(isSpecializedServiceType('commercial')).toBe(true)
    expect(isSpecializedServiceType('post_construction')).toBe(true)
    expect(isSpecializedServiceType('airbnb')).toBe(true)
    expect(isSpecializedServiceType('airbnb-cleaning')).toBe(true)
  })

  it('does not flag standard residential', () => {
    expect(isSpecializedServiceType('')).toBe(false)
    expect(isSpecializedServiceType('standard')).toBe(false)
    expect(isSpecializedServiceType('deep-clean')).toBe(false)
  })
})
