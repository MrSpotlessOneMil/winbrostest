/**
 * Module-level mocks for external services.
 *
 * Usage: import this file at the top of any test that needs mocked externals.
 * Each mock returns sensible defaults; override per-test with mockReturnValue/mockResolvedValue.
 *
 * IMPORTANT: vi.mock() calls are hoisted, so they run before any imports.
 * This file should be imported AFTER setup.ts but BEFORE any app code.
 */

import { vi } from 'vitest'
import { createMockSupabaseClient, MockSupabaseClient } from './supabase-mock'
import { makeSeedData } from '../fixtures/cedar-rapids'

// ─── Shared mock client instance ───────────────────────────────────────
// Tests can access this to seed data and inspect mutations.

export let mockClient: MockSupabaseClient

export function resetMockClient(customData?: Record<string, any[]>) {
  const seed = customData ?? makeSeedData()
  mockClient = createMockSupabaseClient(seed)
  return mockClient
}

// Initialize with default seed data
resetMockClient()

// ─── @supabase/supabase-js ─────────────────────────────────────────────
// Mock the Supabase constructor so lib/tenant.ts and lib/supabase.ts
// get our mock client instead of connecting to a real database.

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => mockClient.from(table),
    rpc: (fn: string, params: any) => mockClient.rpc(fn, params),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      admin: {
        generateLink: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
    },
  }),
}))

// ─── @/lib/openphone ───────────────────────────────────────────────────

export const mockSendSMS = vi.fn().mockResolvedValue({ success: true, messageId: 'mock-sms-001' })
export const mockExtractMessage = vi.fn()
export const mockValidateOpenPhone = vi.fn().mockResolvedValue(true)
export const mockSaveOutboundMessage = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/openphone', () => ({
  sendSMS: (...args: any[]) => mockSendSMS(...args),
  extractMessageFromOpenPhonePayload: (...args: any[]) => mockExtractMessage(...args),
  validateOpenPhoneWebhook: (...args: any[]) => mockValidateOpenPhone(...args),
  normalizePhoneNumber: (phone: string) => phone, // passthrough
  saveOutboundMessage: (...args: any[]) => mockSaveOutboundMessage(...args),
  SMS_TEMPLATES: {
    vapiConfirmation: (name: string, st: string, dt: string, addr: string, _isEst?: boolean, offerEarned?: boolean, offerApplied?: boolean) => {
      let msg = `Hi ${name}! Confirming: ${st} on ${dt} at ${addr}.`
      if (offerApplied) msg += `\n\n🎉 Your FREE standard cleaning has been applied to this booking!`
      if (offerEarned) msg += `\n\n🎁 BONUS: You've earned a FREE standard cleaning on your next visit! Book again within 90 days and it's on us.`
      return msg
    },
    paymentConfirmation: (st: string, date: string) => `Payment confirmed for ${st} on ${date}.`,
    invoiceSent: (email: string) => `Invoice sent to ${email}.`,
    footer: '\n\nReply STOP to unsubscribe.',
  },
}))

// ─── @/lib/telegram ────────────────────────────────────────────────────

export const mockSendTelegramMessage = vi.fn().mockResolvedValue({ success: true, messageId: 1001 })
export const mockAnswerCallbackQuery = vi.fn().mockResolvedValue(true)
export const mockNotifyCleanerAssignment = vi.fn().mockResolvedValue({ success: true, messageId: 1002 })
export const mockSendUrgentFollowUp = vi.fn().mockResolvedValue({ success: true, messageId: 1003 })
export const mockSendDailySchedule = vi.fn().mockResolvedValue({ success: true, messageId: 1004 })
export const mockSendJobReminder = vi.fn().mockResolvedValue({ success: true, messageId: 1005 })
export const mockNotifyCleanerAwarded = vi.fn().mockResolvedValue({ success: true, messageId: 1006 })
export const mockNotifyCleanerNotSelected = vi.fn().mockResolvedValue({ success: true, messageId: 1007 })
export const mockLogTelegramMessage = vi.fn().mockResolvedValue(undefined)
export const mockEditMessageReplyMarkup = vi.fn().mockResolvedValue(true)
export const mockNotifyJobDetailsChange = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: (...args: any[]) => mockSendTelegramMessage(...args),
  answerCallbackQuery: (...args: any[]) => mockAnswerCallbackQuery(...args),
  notifyCleanerAssignment: (...args: any[]) => mockNotifyCleanerAssignment(...args),
  sendUrgentFollowUp: (...args: any[]) => mockSendUrgentFollowUp(...args),
  sendDailySchedule: (...args: any[]) => mockSendDailySchedule(...args),
  sendJobReminder: (...args: any[]) => mockSendJobReminder(...args),
  notifyCleanerAwarded: (...args: any[]) => mockNotifyCleanerAwarded(...args),
  notifyCleanerNotSelected: (...args: any[]) => mockNotifyCleanerNotSelected(...args),
  logTelegramMessage: (...args: any[]) => mockLogTelegramMessage(...args),
  editMessageReplyMarkup: (...args: any[]) => mockEditMessageReplyMarkup(...args),
  notifyJobDetailsChange: (...args: any[]) => mockNotifyJobDetailsChange(...args),
  notifyJobCancellation: vi.fn().mockResolvedValue({ success: true }),
  notifyScheduleChange: vi.fn().mockResolvedValue({ success: true }),
  requestRescheduleConfirmation: vi.fn().mockResolvedValue({ success: true }),
}))

// ─── @/lib/stripe-client ──────────────────────────────────────────────

export const mockCreateDepositLink = vi.fn().mockResolvedValue({ success: true, url: 'https://stripe.mock/deposit/123', amount: 12875 })
export const mockCreateCardOnFileLink = vi.fn().mockResolvedValue({ success: true, url: 'https://stripe.mock/setup/456' })
export const mockCreateAddOnLink = vi.fn().mockResolvedValue({ success: true, url: 'https://stripe.mock/addon/789', amount: 5000 })
export const mockValidateStripeWebhook = vi.fn()

vi.mock('@/lib/stripe-client', () => ({
  createDepositPaymentLink: (...args: any[]) => mockCreateDepositLink(...args),
  createCardOnFileLink: (...args: any[]) => mockCreateCardOnFileLink(...args),
  createAddOnPaymentLink: (...args: any[]) => mockCreateAddOnLink(...args),
  validateStripeWebhook: (...args: any[]) => mockValidateStripeWebhook(...args),
  createStripeCustomer: vi.fn().mockResolvedValue({ id: 'cus_mock_001' }),
  findOrCreateStripeCustomer: vi.fn().mockResolvedValue({ id: 'cus_mock_001' }),
  createAndSendInvoice: vi.fn().mockResolvedValue({ success: true, invoiceId: 'inv_mock_001' }),
  getInvoice: vi.fn().mockResolvedValue(null),
  calculateJobPrice: vi.fn().mockReturnValue(250),
  calculateDeposit: vi.fn().mockReturnValue(12875),
  calculateFinalPayment: vi.fn().mockReturnValue(12875),
  calculateJobEstimate: vi.fn().mockReturnValue({ basePrice: 250, totalPrice: 250, addOnPrice: 0 }),
  calculateJobEstimateAsync: vi.fn().mockResolvedValue({ basePrice: 250, totalPrice: 250, addOnPrice: 0 }),
  calculateJobPriceAsync: vi.fn().mockResolvedValue(250),
  resolveStripeChargeCents: vi.fn().mockReturnValue({ amountCents: 12875 }),
}))

// ─── @/lib/system-events ──────────────────────────────────────────────

export const mockLogSystemEvent = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/system-events', () => ({
  logSystemEvent: (...args: any[]) => mockLogSystemEvent(...args),
  getTelegramConversation: vi.fn().mockResolvedValue([]),
}))

// ─── @/lib/cron-auth ──────────────────────────────────────────────────

vi.mock('@/lib/cron-auth', () => ({
  verifyCronAuth: (request: any) => {
    const auth = request.headers?.get?.('authorization') || ''
    return auth === `Bearer ${process.env.CRON_SECRET}`
  },
  unauthorizedResponse: () => ({ error: 'Unauthorized' }),
}))

// ─── @/lib/auto-response ──────────────────────────────────────────────

export const mockGenerateAutoResponse = vi.fn().mockResolvedValue({
  response: 'Thanks for reaching out! We\'d love to help you.',
  shouldSend: true,
  reason: 'mock',
  escalation: { shouldEscalate: false, reasons: [] },
  bookingComplete: false,
})

vi.mock('@/lib/auto-response', () => ({
  generateAutoResponse: (...args: any[]) => mockGenerateAutoResponse(...args),
}))

// ─── @/lib/ai-intent (if it exists) ───────────────────────────────────

export const mockAnalyzeBookingIntent = vi.fn().mockResolvedValue({
  hasBookingIntent: false,
  confidence: 'low',
  extractedInfo: {},
  reason: 'mock default',
})

// ─── @/lib/hcp-job-sync ───────────────────────────────────────────────

vi.mock('@/lib/hcp-job-sync', () => ({
  syncNewJobToHCP: vi.fn().mockResolvedValue(undefined),
  syncCustomerToHCP: vi.fn().mockResolvedValue(undefined),
}))

// ─── @/lib/housecall-pro-api ──────────────────────────────────────────

vi.mock('@/lib/housecall-pro-api', () => ({
  createHCPJob: vi.fn().mockResolvedValue({ success: true }),
  createHCPCustomerAlways: vi.fn().mockResolvedValue({ id: 'hcp-cust-mock' }),
  createLeadInHCP: vi.fn().mockResolvedValue({ success: true }),
  convertHCPLeadToJob: vi.fn().mockResolvedValue({ success: true }),
}))

// ─── @/lib/scheduler ──────────────────────────────────────────────────

export const mockScheduleLeadFollowUp = vi.fn().mockResolvedValue({ success: true, taskIds: ['task-mock-001'] })
export const mockCancelTask = vi.fn().mockResolvedValue({ success: true })

vi.mock('@/lib/scheduler', () => ({
  scheduleTask: vi.fn().mockResolvedValue({ success: true, taskId: 'task-mock-001' }),
  cancelTask: (...args: any[]) => mockCancelTask(...args),
  getDueTasks: vi.fn().mockResolvedValue([]),
  claimTask: vi.fn().mockResolvedValue({ success: true }),
  completeTask: vi.fn().mockResolvedValue(undefined),
  failTask: vi.fn().mockResolvedValue(undefined),
  scheduleLeadFollowUp: (...args: any[]) => mockScheduleLeadFollowUp(...args),
  scheduleJobBroadcast: vi.fn().mockResolvedValue({ success: true, taskIds: [] }),
  scheduleDayBeforeReminder: vi.fn().mockResolvedValue({ success: true }),
}))

// ─── @/lib/google-maps ────────────────────────────────────────────────

vi.mock('@/lib/google-maps', () => ({
  geocodeAddress: vi.fn().mockResolvedValue({
    lat: 41.9779,
    lng: -91.6656,
    formattedAddress: '456 Oak Ave, Cedar Rapids, IA 52402',
  }),
  calculateDistanceMatrix: vi.fn().mockResolvedValue([]),
}))

// ─── @/lib/wave ───────────────────────────────────────────────────────

vi.mock('@/lib/wave', () => ({
  createWaveInvoice: vi.fn().mockResolvedValue({ success: true, invoiceId: 'wave-inv-mock' }),
  sendWaveInvoice: vi.fn().mockResolvedValue({ success: true }),
}))

// ─── nodemailer ───────────────────────────────────────────────────────

vi.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: vi.fn().mockResolvedValue({ messageId: 'email-mock-001' }),
  }),
}))

// ─── Helper to reset all mocks between tests ──────────────────────────

export function resetAllMocks() {
  resetMockClient()
  mockSendSMS.mockClear()
  mockExtractMessage.mockClear()
  mockValidateOpenPhone.mockClear()
  mockSaveOutboundMessage.mockClear()
  mockSendTelegramMessage.mockClear()
  mockAnswerCallbackQuery.mockClear()
  mockNotifyCleanerAssignment.mockClear()
  mockSendUrgentFollowUp.mockClear()
  mockSendDailySchedule.mockClear()
  mockSendJobReminder.mockClear()
  mockLogTelegramMessage.mockClear()
  mockEditMessageReplyMarkup.mockClear()
  mockCreateDepositLink.mockClear()
  mockCreateCardOnFileLink.mockClear()
  mockCreateAddOnLink.mockClear()
  mockValidateStripeWebhook.mockClear()
  mockLogSystemEvent.mockClear()
  mockGenerateAutoResponse.mockClear()
  mockScheduleLeadFollowUp.mockClear()
  mockCancelTask.mockClear()
}
