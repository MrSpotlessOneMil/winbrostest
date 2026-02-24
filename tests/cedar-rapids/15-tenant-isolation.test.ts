/**
 * Test: Tenant isolation — Cedar Rapids and WinBros data/calls never cross.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetAllMocks,
  mockClient,
  mockSendSMS,
  mockSendTelegramMessage,
  mockCreateDepositLink,
  mockLogSystemEvent,
  resetMockClient,
} from '../mocks/modules'
import {
  CEDAR_RAPIDS_ID,
  CEDAR_RAPIDS_TENANT,
  WINBROS_ID,
  WINBROS_TENANT,
  makeSeedData,
  makeBookedJob,
} from '../fixtures/cedar-rapids'
import { assertCalledWithTenant, assertNeverCalledWithTenant } from '../helpers'

describe('Tenant isolation', () => {
  beforeEach(() => {
    resetAllMocks()
    const seed = makeSeedData()

    // Add jobs for both tenants
    seed.jobs.push(makeBookedJob({ id: 'job-cr-iso', tenant_id: CEDAR_RAPIDS_ID }))
    seed.jobs.push(makeBookedJob({
      id: 'job-wb-iso',
      tenant_id: WINBROS_ID,
      customer_id: '500',
      phone_number: '+16305550001',
    }))

    resetMockClient(seed)
  })

  it('Cedar Rapids cleaners query returns only CR cleaners', () => {
    const allCleaners = mockClient.getTableData('cleaners')
    const crCleaners = allCleaners.filter((c: any) => c.tenant_id === CEDAR_RAPIDS_ID)
    const wbCleaners = allCleaners.filter((c: any) => c.tenant_id === WINBROS_ID)

    expect(crCleaners.length).toBe(3)
    expect(wbCleaners.length).toBe(1)

    // Verify no overlap
    const crIds = new Set(crCleaners.map((c: any) => c.id))
    const wbIds = new Set(wbCleaners.map((c: any) => c.id))
    for (const id of crIds) {
      expect(wbIds.has(id)).toBe(false)
    }
  })

  it('Cedar Rapids customer query with tenant_id returns only CR customers', async () => {
    const result = await mockClient.from('customers')
      .select('*')
      .eq('phone_number', '+13195550001')
      .eq('tenant_id', CEDAR_RAPIDS_ID)
      .maybeSingle()

    expect(result.data).not.toBeNull()
    expect(result.data?.tenant_id).toBe(CEDAR_RAPIDS_ID)
    expect(result.data?.first_name).toBe('Jane')
    expect(result.data?.last_name).toBe('Doe') // Not 'Doe-WinBros'
  })

  it('same phone number exists in both tenants without conflict', async () => {
    // Cedar Rapids Jane
    const crResult = await mockClient.from('customers')
      .select('*')
      .eq('phone_number', '+13195550001')
      .eq('tenant_id', CEDAR_RAPIDS_ID)
      .maybeSingle()

    // WinBros Jane
    const wbResult = await mockClient.from('customers')
      .select('*')
      .eq('phone_number', '+13195550001')
      .eq('tenant_id', WINBROS_ID)
      .maybeSingle()

    expect(crResult.data?.id).toBe('100')
    expect(wbResult.data?.id).toBe('500')
    expect(crResult.data?.last_name).toBe('Doe')
    expect(wbResult.data?.last_name).toBe('Doe-WinBros')
  })

  it('tenant config objects have distinct API keys', () => {
    expect(CEDAR_RAPIDS_TENANT.openphone_api_key).not.toBe(WINBROS_TENANT.openphone_api_key)
    expect(CEDAR_RAPIDS_TENANT.telegram_bot_token).not.toBe(WINBROS_TENANT.telegram_bot_token)
    expect(CEDAR_RAPIDS_TENANT.stripe_secret_key).not.toBe(WINBROS_TENANT.stripe_secret_key)
    expect(CEDAR_RAPIDS_TENANT.openphone_phone_number).not.toBe(WINBROS_TENANT.openphone_phone_number)
  })

  it('jobs query scoped by tenant returns only that tenant jobs', async () => {
    const crJobs = await mockClient.from('jobs')
      .select('*')
      .eq('tenant_id', CEDAR_RAPIDS_ID)

    const wbJobs = await mockClient.from('jobs')
      .select('*')
      .eq('tenant_id', WINBROS_ID)

    expect(crJobs.data.length).toBe(1)
    expect(crJobs.data[0].id).toBe('job-cr-iso')

    expect(wbJobs.data.length).toBe(1)
    expect(wbJobs.data[0].id).toBe('job-wb-iso')
  })
})
