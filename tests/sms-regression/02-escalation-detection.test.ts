/**
 * Regression test: Escalation detection — AI tags + customer message keyword fallback.
 *
 * Bug history: A keyword-based fallback on the AI RESPONSE caused false positives
 * ("No french panes" matched "french pane"). That was removed. The current fallback
 * checks the CUSTOMER'S inbound message for unambiguous escalation phrases (refund,
 * cancel, lawyer, etc.) — these don't appear in normal booking conversations.
 */

import { describe, it, expect } from 'vitest'
import { detectEscalation, detectBookingComplete, stripEscalationTags, detectScheduleReady } from '@/lib/winbros-sms-prompt'

describe('Escalation detection (AI tags + customer keyword fallback)', () => {
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

  // === CUSTOMER MESSAGE KEYWORD FALLBACK ===
  it('escalates when customer says "refund" even if AI missed the tag', () => {
    const aiResponse = "I'm sorry to hear that, can I ask what happened?"
    const result = detectEscalation(aiResponse, undefined, "I want a refund")
    expect(result.shouldEscalate).toBe(true)
    expect(result.reasons).toContain('customer_escalation_keyword')
  })

  it('escalates when customer says "cancel"', () => {
    const aiResponse = "I understand! Let me help you with that."
    const result = detectEscalation(aiResponse, undefined, "I need to cancel")
    expect(result.shouldEscalate).toBe(true)
    expect(result.reasons).toContain('customer_escalation_keyword')
  })

  it('escalates when customer mentions "lawyer"', () => {
    const aiResponse = "I'm sorry you had that experience."
    const result = detectEscalation(aiResponse, undefined, "I'm going to talk to my lawyer")
    expect(result.shouldEscalate).toBe(true)
  })

  it('escalates when customer mentions "bbb"', () => {
    const aiResponse = "I'm sorry about that."
    const result = detectEscalation(aiResponse, undefined, "I'm reporting you to the bbb")
    expect(result.shouldEscalate).toBe(true)
  })

  it('escalates when customer says "scam"', () => {
    const aiResponse = "I understand your concern."
    const result = detectEscalation(aiResponse, undefined, "this is a scam")
    expect(result.shouldEscalate).toBe(true)
  })

  it('does NOT use keyword fallback when AI already tagged', () => {
    const aiResponse = "Our team will reach out shortly! [ESCALATE:service_issue]"
    const result = detectEscalation(aiResponse, undefined, "I want a refund")
    expect(result.shouldEscalate).toBe(true)
    expect(result.reasons).toContain('service_issue')
    expect(result.reasons).not.toContain('customer_escalation_keyword')
  })

  it('does NOT escalate on normal customer messages', () => {
    const normalMessages = [
      "Hi, I need a cleaning",
      "3 bed 2 bath",
      "How much does it cost?",
      "Can you come on Monday?",
      "Sounds good, book it",
    ]
    for (const msg of normalMessages) {
      const result = detectEscalation("Sure! Let me help.", undefined, msg)
      expect(result.shouldEscalate, `false escalation on customer msg: "${msg}"`).toBe(false)
    }
  })

  it('still does NOT escalate on "No french panes" in AI response', () => {
    const response = "Got it — no french panes on your windows. That makes the job straightforward!"
    const result = detectEscalation(response, undefined, "no we dont have french panes")
    expect(result.shouldEscalate).toBe(false)
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
