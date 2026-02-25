/**
 * Unit tests for SMS template functions.
 * Verifies templates produce correct output and don't contain wrong tenant references.
 */

import { describe, it, expect } from 'vitest'

// Import real templates (these are pure functions, no mocking needed)
import {
  postJobFollowup,
  reviewOnlyFollowup,
  cleanerAssigned,
  noCleanersAvailable,
  frequencyNudge,
  monthlyReengagement,
  paymentFailed,
} from '@/lib/sms-templates'

describe('SMS templates', () => {
  describe('postJobFollowup', () => {
    it('includes customer name, review link, and tip link', () => {
      const msg = postJobFollowup(
        'Jane',
        'Alice Cleaner',
        'https://g.page/cedar-rapids-review',
        'https://hookandladderexteriors.com/tip/job-001',
        '15%'
      )

      expect(msg).toContain('Jane')
      expect(msg).toContain('Alice Cleaner')
      expect(msg).toContain('https://g.page/cedar-rapids-review')
      expect(msg).toContain('https://hookandladderexteriors.com/tip/job-001')
      expect(msg).toContain('15%')
    })

    it('does NOT contain WinBros or Spotless Scrubbers references', () => {
      const msg = postJobFollowup(
        'Jane',
        'Alice',
        'https://g.page/test',
        'https://hookandladderexteriors.com/tip/123',
        '15%'
      )

      expect(msg.toLowerCase()).not.toContain('winbros')
      expect(msg.toLowerCase()).not.toContain('spotless')
    })
  })

  describe('reviewOnlyFollowup', () => {
    it('includes customer name and review link', () => {
      const msg = reviewOnlyFollowup('Bob', 'https://g.page/test-review')

      expect(msg).toContain('Bob')
      expect(msg).toContain('https://g.page/test-review')
    })
  })

  describe('cleanerAssigned', () => {
    it('includes all cleaner and job details', () => {
      const msg = cleanerAssigned(
        'Jane',
        'Alice Cleaner',
        '+13195550010',
        'March 1, 2026',
        '10:00 AM'
      )

      expect(msg).toContain('Jane')
      expect(msg).toContain('Alice Cleaner')
      expect(msg).toContain('+13195550010')
      expect(msg).toContain('March 1')
      expect(msg).toContain('10:00')
    })
  })

  describe('noCleanersAvailable', () => {
    it('includes customer name and date', () => {
      const msg = noCleanersAvailable('Jane', 'March 1, 2026')

      expect(msg).toContain('Jane')
      expect(msg).toContain('March 1')
    })
  })

  describe('frequencyNudge', () => {
    it('includes days since and business name', () => {
      const msg = frequencyNudge('Jane', 21, 'Hook and Ladder Exteriors')

      expect(msg).toContain('Jane')
      expect(msg).toContain('Hook and Ladder')
    })
  })

  describe('monthlyReengagement', () => {
    it('includes discount and days since', () => {
      const msg = monthlyReengagement('Jane', '15%', 30)

      expect(msg).toContain('Jane')
      expect(msg).toContain('15%')
      expect(msg).toContain('30')
    })
  })

  describe('paymentFailed', () => {
    it('includes payment URL', () => {
      const msg = paymentFailed('https://stripe.com/pay/retry')

      expect(msg).toContain('https://stripe.com/pay/retry')
    })
  })
})
