/**
 * W1 — Operator-message datetime extraction.
 *
 * TJ / Paige Elizabeth incident (2026-04-20): operator corrected appointment
 * via shared OpenPhone inbox. Agent reverted to the old time on the next
 * turn because the correction never hit jobs.scheduled_at.
 *
 * The pre-filter regex must cheap-reject non-datetime messages. The full
 * extraction uses Haiku; tested via mock here.
 */

import { describe, it, expect } from 'vitest'
import { looksLikeDatetimeCorrection } from '../../packages/core/src/extract-datetime-correction'

describe('W1 — datetime pre-filter', () => {
  const shouldPass = [
    'Sorry we meant Wednesday at 11am',
    'Actually, 9am works better',
    'Can we do tomorrow at 10?',
    'Let\'s reschedule to Friday 2pm',
    'Change to Thursday',
    'see you Monday',
  ]
  for (const msg of shouldPass) {
    it(`accepts "${msg}"`, () => {
      expect(looksLikeDatetimeCorrection(msg)).toBe(true)
    })
  }

  const shouldReject = [
    'ok',
    'thanks!',
    'on my way',
    'payment link?',
    'can you send me the invoice',
    'how much?',
    '',
  ]
  for (const msg of shouldReject) {
    it(`rejects "${msg}"`, () => {
      expect(looksLikeDatetimeCorrection(msg)).toBe(false)
    })
  }
})

describe('W1 — authoritative appointment elevation in prompt', () => {
  const fs = require('fs')
  const path = require('path')
  const coreSource = fs.readFileSync(
    path.resolve(__dirname, '../../packages/core/src/auto-response.ts'),
    'utf-8'
  )

  it('prompt context labels active job datetime as authoritative', () => {
    expect(coreSource).toMatch(/AUTHORITATIVE APPOINTMENT/)
    expect(coreSource).toMatch(/overrides anything said earlier/i)
  })

  it('OpenPhone webhook triggers extraction on manual takeover', () => {
    const webhookSource = fs.readFileSync(
      path.resolve(__dirname, '../../apps/house-cleaning/app/api/webhooks/openphone/route.ts'),
      'utf-8'
    )
    expect(webhookSource).toMatch(/extractDatetimeCorrection/)
    expect(webhookSource).toMatch(/looksLikeDatetimeCorrection/)
    expect(webhookSource).toMatch(/confidence >= 0\.7/)
    expect(webhookSource).toMatch(/APPOINTMENT_EXTRACTED_FROM_OPERATOR_SMS/)
  })
})
