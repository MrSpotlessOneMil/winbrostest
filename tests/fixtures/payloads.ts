/**
 * Webhook payload factories for tests.
 * Each factory returns a realistic payload matching what the external service sends.
 */

import { CEDAR_RAPIDS_ID, CEDAR_RAPIDS_TENANT } from './cedar-rapids'

// ─── VAPI ──────────────────────────────────────────────────────────────

export function makeVapiEndOfCallReport(overrides: Record<string, any> = {}) {
  return {
    message: {
      type: 'end-of-call-report',
      call: {
        id: 'vapi-call-001',
        orgId: 'vapi-org-001',
        type: 'inboundPhoneCall',
        status: 'ended',
        phoneNumber: { number: '+13195551234' },
        customer: { number: '+13195550001' },
        startedAt: '2026-02-24T15:00:00Z',
        endedAt: '2026-02-24T15:05:00Z',
      },
      transcript: 'Customer: Hi, I need a house cleaning. Assistant: Great! When would you like it? Customer: March 1st at 10am. Assistant: Perfect, I have you booked for March 1st at 10am.',
      recordingUrl: 'https://vapi.test/recording/001.mp3',
      summary: 'Customer booked a standard house cleaning for March 1st at 10am.',
      structuredData: {
        appointment_date: '2026-03-01',
        appointment_time: '10:00 AM',
        service_type: 'standard house cleaning',
        address: '456 Oak Ave, Cedar Rapids, IA 52402',
        customer_name: 'Jane Doe',
        bedrooms: 2,
        bathrooms: 1,
        outcome: 'booked',
        ...overrides.structuredData,
      },
      ...overrides,
    },
  }
}

export function makeVapiNoBooking(overrides: Record<string, any> = {}) {
  return makeVapiEndOfCallReport({
    structuredData: {
      outcome: 'not_booked',
      customer_name: 'Bob Smith',
      reason: 'Customer wanted pricing info only',
    },
    transcript: 'Customer: How much is a cleaning? Assistant: It depends on size. Customer: I\'ll think about it. Thanks.',
    summary: 'Customer inquired about pricing but did not book.',
    ...overrides,
  })
}

// ─── OpenPhone ─────────────────────────────────────────────────────────

export function makeOpenPhoneInbound(from: string, body: string, overrides: Record<string, any> = {}) {
  return {
    type: 'message.received',
    data: {
      object: {
        id: `msg-${Date.now()}`,
        conversationId: `conv-${from}`,
        from: from,
        to: CEDAR_RAPIDS_TENANT.openphone_phone_number,
        body: body,
        direction: 'incoming',
        createdAt: new Date().toISOString(),
        userId: null,
        phoneNumberId: CEDAR_RAPIDS_TENANT.openphone_phone_id,
        ...overrides,
      },
    },
    createdAt: new Date().toISOString(),
  }
}

export function makeOpenPhoneOutbound(to: string, body: string, overrides: Record<string, any> = {}) {
  return {
    type: 'message.sent',
    data: {
      object: {
        id: `msg-${Date.now()}`,
        conversationId: `conv-${to}`,
        from: CEDAR_RAPIDS_TENANT.openphone_phone_number,
        to: to,
        body: body,
        direction: 'outgoing',
        createdAt: new Date().toISOString(),
        userId: 'user-cedar-admin',
        phoneNumberId: CEDAR_RAPIDS_TENANT.openphone_phone_id,
        ...overrides,
      },
    },
    createdAt: new Date().toISOString(),
  }
}

// ─── Stripe ────────────────────────────────────────────────────────────

export function makeStripeCheckoutCompleted(jobId: string, paymentType: 'DEPOSIT' | 'FINAL' | 'ADDON' = 'DEPOSIT') {
  return {
    id: `evt_test_${Date.now()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_${Date.now()}`,
        mode: 'payment',
        payment_status: 'paid',
        customer_email: 'jane@example.com',
        amount_total: paymentType === 'DEPOSIT' ? 12875 : 25000,
        metadata: {
          job_id: jobId,
          payment_type: paymentType,
          tenant_id: CEDAR_RAPIDS_ID,
          customer_phone: '+13195550001',
        },
      },
    },
  }
}

export function makeStripePaymentFailed(jobId: string) {
  return {
    id: `evt_test_fail_${Date.now()}`,
    type: 'payment_intent.payment_failed',
    data: {
      object: {
        id: `pi_test_${Date.now()}`,
        status: 'requires_payment_method',
        amount: 12875,
        metadata: {
          job_id: jobId,
          payment_type: 'DEPOSIT',
          tenant_id: CEDAR_RAPIDS_ID,
          customer_phone: '+13195550001',
        },
        last_payment_error: {
          message: 'Your card was declined.',
          code: 'card_declined',
        },
      },
    },
  }
}

export function makeStripeSetupIntentSucceeded(jobId: string) {
  return {
    id: `evt_test_setup_${Date.now()}`,
    type: 'setup_intent.succeeded',
    data: {
      object: {
        id: `seti_test_${Date.now()}`,
        status: 'succeeded',
        metadata: {
          job_id: jobId,
          tenant_id: CEDAR_RAPIDS_ID,
          customer_phone: '+13195550001',
        },
      },
    },
  }
}

// ─── Telegram ──────────────────────────────────────────────────────────

export function makeTelegramCallbackQuery(data: string, chatId: string = '5001') {
  return {
    update_id: Date.now(),
    callback_query: {
      id: `cq-${Date.now()}`,
      from: {
        id: parseInt(chatId),
        is_bot: false,
        first_name: 'Alice',
        username: 'alicecleaner',
      },
      message: {
        message_id: 12345,
        chat: {
          id: parseInt(chatId),
          type: 'private',
        },
        date: Math.floor(Date.now() / 1000),
        text: 'Job assignment',
      },
      data: data,
    },
  }
}

export function makeTelegramTextMessage(text: string, chatId: string = '5001') {
  return {
    update_id: Date.now(),
    message: {
      message_id: Date.now(),
      from: {
        id: parseInt(chatId),
        is_bot: false,
        first_name: 'Alice',
      },
      chat: {
        id: parseInt(chatId),
        type: 'private',
      },
      date: Math.floor(Date.now() / 1000),
      text: text,
    },
  }
}

// ─── Cron ──────────────────────────────────────────────────────────────

export function makeCronHeaders() {
  return {
    authorization: `Bearer ${process.env.CRON_SECRET}`,
  }
}
