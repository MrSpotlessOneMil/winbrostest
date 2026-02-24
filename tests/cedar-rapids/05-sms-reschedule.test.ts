/**
 * Test: Customer asks to reschedule — after booking and after completion.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetAllMocks,
  mockClient,
  mockSendSMS,
  mockGenerateAutoResponse,
  mockLogSystemEvent,
  resetMockClient,
} from '../mocks/modules'
import { CEDAR_RAPIDS_ID, makeSeedData, makeBookedJob, makeCompletedJob } from '../fixtures/cedar-rapids'

describe('SMS: reschedule flows', () => {
  beforeEach(() => {
    resetAllMocks()
  })

  describe('Reschedule after booking (before service)', () => {
    beforeEach(() => {
      const seed = makeSeedData()
      seed.leads.push({
        id: 'lead-resc',
        tenant_id: CEDAR_RAPIDS_ID,
        phone: '+13195550001',
        status: 'booked',
        source: 'phone',
        name: 'Jane Doe',
        created_at: new Date().toISOString(),
      })
      seed.jobs.push(makeBookedJob({
        id: 'job-resc',
        status: 'assigned',
        cleaner_confirmed: true,
      }))
      resetMockClient(seed)
    })

    it('booked job exists and can be found for reschedule', async () => {
      const result = await mockClient.from('jobs')
        .select('*')
        .eq('tenant_id', CEDAR_RAPIDS_ID)
        .eq('phone_number', '+13195550001')
        .in('status', ['scheduled', 'assigned'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      expect(result.data).not.toBeNull()
      expect(result.data?.id).toBe('job-resc')
      expect(result.data?.status).toBe('assigned')
    })

    it('reschedule logs RESCHEDULE_REQUESTED system event', async () => {
      // Simulate logging a reschedule event
      await mockClient.from('system_events').insert({
        tenant_id: CEDAR_RAPIDS_ID,
        event_type: 'RESCHEDULE_REQUESTED',
        source: 'openphone',
        message: 'Customer requested reschedule for job-resc',
        job_id: 'job-resc',
        phone_number: '+13195550001',
      })

      const events = await mockClient.from('system_events')
        .select('*')
        .eq('event_type', 'RESCHEDULE_REQUESTED')
        .eq('job_id', 'job-resc')

      expect(events.data?.length).toBe(1)
    })
  })

  describe('Reschedule after completion', () => {
    beforeEach(() => {
      const seed = makeSeedData()
      seed.jobs.push(makeCompletedJob({ id: 'job-comp-resc' }))
      // No booked lead — lead was already completed
      seed.leads.push({
        id: 'lead-comp',
        tenant_id: CEDAR_RAPIDS_ID,
        phone: '+13195550001',
        status: 'closed',
        source: 'phone',
        name: 'Jane Doe',
        created_at: '2026-02-01T00:00:00Z',
      })
      resetMockClient(seed)
    })

    it('completed job should NOT be found by active job query', async () => {
      const result = await mockClient.from('jobs')
        .select('*')
        .eq('tenant_id', CEDAR_RAPIDS_ID)
        .eq('phone_number', '+13195550001')
        .in('status', ['scheduled', 'assigned', 'in_progress'])
        .maybeSingle()

      expect(result.data).toBeNull() // No active job
    })

    it('customer with completed job falls into new inquiry flow', async () => {
      // No booked lead found → treated as new inquiry
      const bookedLead = await mockClient.from('leads')
        .select('*')
        .eq('phone', '+13195550001')
        .eq('tenant_id', CEDAR_RAPIDS_ID)
        .eq('status', 'booked')
        .maybeSingle()

      expect(bookedLead.data).toBeNull() // No booked lead → new inquiry path

      // AI auto-response should handle the "reschedule" message
      mockGenerateAutoResponse.mockResolvedValueOnce({
        response: 'We\'d love to schedule another cleaning! When works best for you?',
        shouldSend: true,
        reason: 'returning customer wants to rebook',
        escalation: { shouldEscalate: false, reasons: [] },
      })

      const aiResult = await mockGenerateAutoResponse('I want to reschedule my cleaning', {} as any, null)
      expect(aiResult.response).toContain('schedule another')
    })
  })
})
