/**
 * T8 — Hallucinated booking confirmation guard.
 *
 * Rosemary Johnson incident (2026-04-20): AI told customer "You're all set!
 * I've got your booking confirmed for Monday, April 20th at 9am" with no
 * actual booking in the DB. Customer hadn't even confirmed. Risks no-shows,
 * chargebacks, reputation.
 *
 * The sms-guard.ts BOOKING_CONFIRMATION_PATTERNS + hasConfirmedBooking gate
 * must block every confirmation phrase when no confirmed job exists and let
 * them through when one does.
 */

import { describe, it, expect } from 'vitest'
import { guardMessage } from '../../packages/core/src/sms-guard'

const EMPTY_HISTORY: Array<{ role: string; content: string }> = []

describe('T8 — booking confirmation guard', () => {
  const cases = [
    "You're all set!",
    "you're booked for Tuesday 9am",
    "We've got you booked for Friday at 10",
    "Confirmed for Monday at 2pm",
    "Scheduled for Wednesday 11am",
    "Your cleaning is confirmed for tomorrow",
    "Your booking is locked in for Thursday",
    "I've booked you for Saturday at 8",
    "Got you on the calendar for next Tuesday",
    "Booking confirmed",
    "See you Monday!",
  ]

  for (const phrase of cases) {
    it(`blocks "${phrase}" when hasConfirmedBooking=false`, async () => {
      const result = await guardMessage(phrase, 'test-tenant', EMPTY_HISTORY, {
        hasConfirmedBooking: false,
      })
      expect(result.blocked).toBe(true)
      expect(result.reason).toMatch(/booking-confirmation|confirmation language/i)
      expect(result.shouldEscalate).toBe(true)
    })

    it(`allows "${phrase}" when hasConfirmedBooking=true (real booking exists)`, async () => {
      const result = await guardMessage(phrase, 'test-tenant', EMPTY_HISTORY, {
        hasConfirmedBooking: true,
      })
      expect(result.blocked).toBe(false)
    })
  }

  it('does NOT block proposal-style language', async () => {
    const proposal = "I can hold Monday at 9am for you — want me to lock that in?"
    const result = await guardMessage(proposal, 'test-tenant', EMPTY_HISTORY, {
      hasConfirmedBooking: false,
    })
    expect(result.blocked).toBe(false)
  })

  it('still blocks discount language unrelated to booking confirmation', async () => {
    const discount = "I can give you 20% off if you book today"
    const result = await guardMessage(discount, 'test-tenant', EMPTY_HISTORY, {
      hasConfirmedBooking: true,
    })
    expect(result.blocked).toBe(true)
    expect(result.reason).toMatch(/discount|price reduction/i)
  })

  it('Rosemary-exact reproduction: blocks the full offending message', async () => {
    const rosemaryMessage =
      "You're all set! I've got your booking confirmed for Monday, April 20th at 9am for your one bedroom, one bathroom home."
    const result = await guardMessage(rosemaryMessage, 'test-tenant', EMPTY_HISTORY, {
      hasConfirmedBooking: false,
    })
    expect(result.blocked).toBe(true)
    expect(result.shouldEscalate).toBe(true)
  })
})
