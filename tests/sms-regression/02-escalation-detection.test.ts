/**
 * Regression test: Escalation detection — AI tags only, no keyword fallback.
 *
 * Bug history: Keyword-based fallback caused false positives. "No french panes"
 * matched "french pane" and triggered an escalation. Fix: only use AI [ESCALATE:...] tags.
 * This test prevents keyword-based detection from being reintroduced.
 */

import { describe, it, expect } from 'vitest'
import { detectEscalation, detectBookingComplete, stripEscalationTags, detectScheduleReady } from '@/lib/winbros-sms-prompt'

describe('Escalation detection (AI tags only)', () => {
  it('detects [ESCALATE:french_panes] tag in AI response', () => {
    const response = 'I see you have french pane windows. Let me connect you with our team for a custom quote. [ESCALATE:french_panes]'
    const result = detectEscalation(response)
    expect(result.shouldEscalate).toBe(true)
    expect(result.reasons).toContain('french_panes')
  })

  it('detects multiple escalation tags', () => {
    const response = 'This is a large property with special windows. [ESCALATE:large_home] [ESCALATE:french_panes]'
    const result = detectEscalation(response)
    expect(result.shouldEscalate).toBe(true)
    expect(result.reasons).toContain('large_home')
    expect(result.reasons).toContain('french_panes')
    expect(result.reasons).toHaveLength(2)
  })

  it('detects [OUT_OF_AREA] tag', () => {
    const response = "I'm sorry, that address is outside our service area. [OUT_OF_AREA]"
    const result = detectEscalation(response)
    expect(result.shouldEscalate).toBe(true)
    expect(result.reasons).toContain('out_of_area')
  })

  // === THE CRITICAL REGRESSION TEST ===
  it('does NOT escalate on "No french panes" (keyword false positive)', () => {
    const response = "Got it — no french panes on your windows. That makes the job straightforward! Let's get you scheduled."
    const result = detectEscalation(response)
    expect(result.shouldEscalate).toBe(false)
    expect(result.reasons).toHaveLength(0)
  })

  it('does NOT escalate on normal conversation without tags', () => {
    const normalResponses = [
      "Great! I'd love to help you with window cleaning. How many windows do you have?",
      "Your estimate for a standard cleaning is $250. Would you like to book?",
      "We can schedule you for next Tuesday at 10am. Does that work?",
      "No problem! We also offer gutter cleaning and pressure washing.",
      "The price for a 3-bedroom home is typically $375.",
    ]
    for (const response of normalResponses) {
      const result = detectEscalation(response)
      expect(result.shouldEscalate, `false escalation on: "${response.slice(0, 50)}..."`).toBe(false)
    }
  })

  it('does NOT escalate when keywords appear naturally in conversation', () => {
    const falsePositiveRisks = [
      "We do handle storm windows — no extra charge for those.",
      "French doors are no problem, we clean those regularly.",
      "Large homes are our specialty! Let me get you a quote.",
      "We don't do pressure washing on painted surfaces, but we can do your windows.",
    ]
    for (const response of falsePositiveRisks) {
      const result = detectEscalation(response)
      expect(result.shouldEscalate, `false escalation on: "${response.slice(0, 50)}..."`).toBe(false)
    }
  })
})

describe('Booking completion gate', () => {
  it('detects [BOOKING_COMPLETE] tag', () => {
    const response = "Perfect! I've got everything I need. Your estimate appointment is confirmed! [BOOKING_COMPLETE]"
    expect(detectBookingComplete(response)).toBe(true)
  })

  it('does NOT trigger without the tag', () => {
    const response = "Almost done! Just need your email address to send the confirmation."
    expect(detectBookingComplete(response)).toBe(false)
  })

  it('does NOT trigger on partial tag text', () => {
    const response = "Your booking is now complete! We'll send a confirmation shortly."
    expect(detectBookingComplete(response)).toBe(false)
  })
})

describe('Schedule ready detection', () => {
  it('detects [SCHEDULE_READY] tag', () => {
    const response = "Great, I have all your info. Let me check available times. [SCHEDULE_READY]"
    expect(detectScheduleReady(response)).toBe(true)
  })

  it('does NOT trigger without tag', () => {
    const response = "When would you like to schedule your cleaning?"
    expect(detectScheduleReady(response)).toBe(false)
  })
})

describe('Tag stripping', () => {
  it('strips all system tags before sending to customer', () => {
    const response = "Your appointment is confirmed! [BOOKING_COMPLETE] [ESCALATE:french_panes] [SCHEDULE_READY] [OUT_OF_AREA]"
    const cleaned = stripEscalationTags(response)
    expect(cleaned).toBe("Your appointment is confirmed!")
    expect(cleaned).not.toContain('[')
    expect(cleaned).not.toContain(']')
  })

  it('preserves normal text without tags', () => {
    const response = "Hi there! We'd love to help with your windows."
    expect(stripEscalationTags(response)).toBe(response)
  })
})
