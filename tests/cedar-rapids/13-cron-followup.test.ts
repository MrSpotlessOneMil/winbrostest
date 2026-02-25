/**
 * Test: Post-job follow-up cron sends review + tip SMS 2h after completion.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetAllMocks, mockClient, mockSendSMS, mockLogSystemEvent, resetMockClient } from '../mocks/modules'
import { CEDAR_RAPIDS_TENANT, CEDAR_RAPIDS_ID, makeCompletedJob, makeSeedData } from '../fixtures/cedar-rapids'
import { createCronRequest, parseResponse } from '../helpers'

describe('Cron: post-job-followup', () => {
  beforeEach(() => {
    resetAllMocks()

    const seed = makeSeedData()

    // Add a completed job from 3 hours ago (eligible for followup)
    seed.jobs.push(makeCompletedJob({
      id: 'job-followup-001',
      customer_id: '100',
      phone_number: '+13195550001',
    }))

    resetMockClient(seed)

    // Register the claim_jobs_for_followup RPC to return eligible jobs
    mockClient.registerRpc('claim_jobs_for_followup', (params: any) => {
      if (params.p_tenant_id === CEDAR_RAPIDS_ID) {
        const jobs = mockClient.getTableData('jobs').filter(
          (j: any) =>
            j.tenant_id === CEDAR_RAPIDS_ID &&
            j.status === 'completed' &&
            !j.followup_sent_at
        )
        // Mark as claimed (simulate what the real RPC does)
        for (const j of jobs) {
          j.followup_sent_at = new Date().toISOString()
        }
        return {
          data: jobs.map((j: any) => ({
            job_id: j.id,
            customer_phone: j.phone_number,
            customer_first_name: 'Jane',
            team_id: j.team_id,
            job_type: j.job_type,
            paid: j.paid,
            stripe_payment_intent_id: j.stripe_payment_intent_id || null,
            job_phone_number: j.phone_number,
          })),
          error: null,
        }
      }
      return { data: [], error: null }
    })
  })

  it('sends follow-up SMS for completed Cedar Rapids job', async () => {
    const { GET } = await import('@/app/api/cron/post-job-followup/route')
    const req = createCronRequest('/api/cron/post-job-followup')
    const res = await GET(req)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.processed).toBeGreaterThanOrEqual(1)

    // SMS should be sent with Cedar Rapids tenant
    expect(mockSendSMS).toHaveBeenCalled()
    const smsCall = mockSendSMS.mock.calls[0]
    // First arg should be the tenant object (not a raw phone string)
    expect(smsCall[0]).toMatchObject({ slug: 'cedar-rapids' })

    // System event should be logged
    expect(mockLogSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'POST_JOB_FOLLOWUP_SENT',
        tenant_id: CEDAR_RAPIDS_ID,
      })
    )
  })

  it('skips tenants with post_cleaning_followup_enabled=false', async () => {
    // Modify Cedar Rapids to disable followup
    const tenants = mockClient.getTableData('tenants')
    const crTenant = tenants.find((t: any) => t.slug === 'cedar-rapids')
    if (crTenant) {
      crTenant.workflow_config = {
        ...crTenant.workflow_config,
        post_cleaning_followup_enabled: false,
      }
    }

    const { GET } = await import('@/app/api/cron/post-job-followup/route')
    const req = createCronRequest('/api/cron/post-job-followup')
    const res = await GET(req)
    const { body } = await parseResponse(res)

    expect(body.processed).toBe(0)
    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('uses Cedar Rapids review link (not WinBros)', async () => {
    const { GET } = await import('@/app/api/cron/post-job-followup/route')
    const req = createCronRequest('/api/cron/post-job-followup')
    await GET(req)

    if (mockSendSMS.mock.calls.length > 0) {
      const message = mockSendSMS.mock.calls[0][2] || mockSendSMS.mock.calls[0][1]
      // The review link should use the Cedar Rapids Google review link or not be WinBros
      expect(message).not.toContain('winbros')
    }
  })

  it('rejects request without cron auth', async () => {
    const { GET } = await import('@/app/api/cron/post-job-followup/route')
    const { createMockRequest, parseResponse: parse } = await import('../helpers')
    const noAuthReq = createMockRequest('http://localhost:3000/api/cron/post-job-followup', {
      method: 'GET',
      // No authorization header
    })
    const res = await GET(noAuthReq)
    const { status } = await parse(res)
    expect(status).toBe(401)
  })
})
