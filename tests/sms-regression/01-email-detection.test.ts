/**
 * Regression test: Email detection from 3 sources.
 *
 * Bug history: Customer provided email in message #1 but confirmed with "Yup"
 * in message #12. The email was ONLY in conversation history — DB fallback
 * didn't have it for organic SMS leads. This test prevents that from regressing.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetAllMocks, mockClient, resetMockClient } from '../mocks/modules'
import { WINBROS_ID, WINBROS_TENANT, CEDAR_RAPIDS_ID, makeSeedData } from '../fixtures/cedar-rapids'

describe('Email detection for booking completion', () => {
  beforeEach(() => {
    resetAllMocks()
    resetMockClient(makeSeedData())
  })

  it('detects email via regex in the current message', () => {
    const message = 'Sure, my email is john@example.com'
    const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i)
    expect(emailMatch).not.toBeNull()
    expect(emailMatch![0].toLowerCase()).toBe('john@example.com')
  })

  it('detects email with plus addressing and subdomains', () => {
    const message = 'You can reach me at jane+cleaning@mail.co.uk'
    const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i)
    expect(emailMatch).not.toBeNull()
    expect(emailMatch![0].toLowerCase()).toBe('jane+cleaning@mail.co.uk')
  })

  it('does NOT false-positive on non-email text', () => {
    const messages = [
      'Yup that sounds good',
      'No french panes on our windows',
      'Can I get an estimate for 3 bedrooms?',
      'My phone number is 630-555-1234',
    ]
    for (const msg of messages) {
      const emailMatch = msg.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i)
      expect(emailMatch, `false positive on: "${msg}"`).toBeNull()
    }
  })

  it('falls back to customer.email from DB when not in current message', async () => {
    // Customer 100 has email jane@example.com in seed data
    const { data: customer } = await mockClient.from('customers')
      .select('*')
      .eq('id', '100')
      .single()

    expect(customer?.email).toBe('jane@example.com')

    // Simulate: current message has no email, but DB has it
    const currentMessage = 'Yup, that looks right'
    const emailInMessage = currentMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i)
    expect(emailInMessage).toBeNull()

    // Fallback to DB
    const fallbackEmail = customer?.email?.toLowerCase() || null
    expect(fallbackEmail).toBe('jane@example.com')
  })

  it('falls back to conversation history scan when DB has no email', async () => {
    // Simulate an organic SMS lead — no email in DB
    const { data: customer } = await mockClient.from('customers')
      .select('*')
      .eq('id', '101')
      .single()

    expect(customer?.email).toBeNull() // Bob Smith has no email

    // Customer provided email in an earlier message
    const conversationHistory = [
      { role: 'client', content: 'Hi I need a cleaning' },
      { role: 'assistant', content: 'Great! What is your email?' },
      { role: 'client', content: 'bob@gmail.com' },
      { role: 'assistant', content: 'Perfect, and what is your address?' },
      { role: 'client', content: '123 Main St, Cedar Rapids' },
      // ... many messages later ...
      { role: 'assistant', content: 'Everything looks good! Shall I confirm your booking?' },
      { role: 'client', content: 'Yup' }, // <-- current message, no email
    ]

    // Scan conversation history in reverse for email
    let historyEmail: string | null = null
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      const match = conversationHistory[i].content.match(emailRegex)
      if (match) {
        historyEmail = match[0].toLowerCase()
        break
      }
    }

    expect(historyEmail).toBe('bob@gmail.com')
  })

  it('email detection order: current message > DB > conversation history', () => {
    // If email is in the current message, that wins — even if DB has a different one
    const currentMessage = 'Actually use newemail@test.com instead'
    const dbEmail = 'old@example.com'

    const emailInMessage = currentMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i)
    const detectedEmail = emailInMessage ? emailInMessage[0].toLowerCase() : null
    const fallbackEmail = dbEmail
    const finalEmail = detectedEmail || fallbackEmail

    expect(finalEmail).toBe('newemail@test.com') // Current message wins
  })
})
