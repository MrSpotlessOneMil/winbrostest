/**
 * Test: Cron idempotency — running the same cron twice produces single outcome.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetAllMocks, mockClient, mockSendSMS, resetMockClient } from '../mocks/modules'
import { CEDAR_RAPIDS_ID, makeCompletedJob, makeSeedData } from '../fixtures/cedar-rapids'
import { createCronRequest, parseResponse } from '../helpers'

describe('Cron: idempotency', () => {
  let claimCount: number

  beforeEach(() => {
    resetAllMocks()
    claimCount = 0

    const seed = makeSeedData()
    seed.jobs.push(makeCompletedJob({
      id: 'job-idem-001',
      phone_number: '+13195550001',
    }))
    resetMockClient(seed)

    // RPC that simulates atomic claim — second call returns empty
    mockClient.registerRpc('claim_jobs_for_followup', (params: any) => {
      claimCount++
      if (params.p_tenant_id !== CEDAR_RAPIDS_ID) return { data: [], error: null }

      if (claimCount === 1) {
        // First call: claim the job
        const jobs = mockClient.getTableData('jobs').filter(
          (j: any) => j.tenant_id === CEDAR_RAPIDS_ID && j.status === 'completed' && !j.followup_sent_at
        )
        for (const j of jobs) j.followup_sent_at = new Date().toISOString()
        return {
          data: jobs.map((j: any) => ({
            job_id: j.id,
            customer_phone: j.phone_number,
            customer_first_name: 'Jane',
            team_id: j.team_id,
            job_type: 'cleaning',
            paid: true,
            stripe_payment_intent_id: null,
            job_phone_number: j.phone_number,
          })),
          error: null,
        }
      }
      // Second call: already claimed
      return { data: [], error: null }
    })
  })

  it('double cron run sends SMS exactly once', async () => {
    const { GET } = await import('@/app/api/cron/post-job-followup/route')

    // First run
    const req1 = createCronRequest('/api/cron/post-job-followup')
    const res1 = await GET(req1)
    const { body: body1 } = await parseResponse(res1)
    expect(body1.processed).toBeGreaterThanOrEqual(1)

    const smsCountAfterFirst = mockSendSMS.mock.calls.length

    // Second run — should find nothing to process
    const req2 = createCronRequest('/api/cron/post-job-followup')
    const res2 = await GET(req2)
    const { body: body2 } = await parseResponse(res2)
    expect(body2.processed).toBe(0)

    // SMS count should not have increased
    expect(mockSendSMS.mock.calls.length).toBe(smsCountAfterFirst)
  })
})
