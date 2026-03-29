/**
 * Regression test: Cross-tenant data isolation.
 *
 * Bug history: `getDefaultTenant()` returns WinBros hardcoded. Using it in
 * dashboard routes causes data leaks between tenants. These tests verify
 * that tenant_id filtering works correctly and prevents cross-contamination.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetAllMocks, mockClient, resetMockClient } from '../mocks/modules'
import { WINBROS_ID, CEDAR_RAPIDS_ID, makeSeedData } from '../fixtures/cedar-rapids'

describe('Cross-tenant data isolation', () => {
  beforeEach(() => {
    resetAllMocks()
    resetMockClient(makeSeedData())
  })

  it('customer query scoped to tenant returns ONLY that tenant\'s customers', async () => {
    // Phone +13195550001 exists for BOTH tenants in seed data
    const { data: cedarCustomers } = await mockClient.from('customers')
      .select('*')
      .eq('tenant_id', CEDAR_RAPIDS_ID)
      .eq('phone_number', '+13195550001')

    const { data: winbrosCustomers } = await mockClient.from('customers')
      .select('*')
      .eq('tenant_id', WINBROS_ID)
      .eq('phone_number', '+13195550001')

    expect(cedarCustomers).toHaveLength(1)
    expect(cedarCustomers![0].last_name).toBe('Doe')
    expect(cedarCustomers![0].tenant_id).toBe(CEDAR_RAPIDS_ID)

    expect(winbrosCustomers).toHaveLength(1)
    expect(winbrosCustomers![0].last_name).toBe('Doe-WinBros')
    expect(winbrosCustomers![0].tenant_id).toBe(WINBROS_ID)
  })

  it('cleaners are scoped to their tenant', async () => {
    const { data: cedarCleaners } = await mockClient.from('cleaners')
      .select('*')
      .eq('tenant_id', CEDAR_RAPIDS_ID)

    const { data: winbrosCleaners } = await mockClient.from('cleaners')
      .select('*')
      .eq('tenant_id', WINBROS_ID)

    // Cedar has 3 cleaners, WinBros has 1
    expect(cedarCleaners).toHaveLength(3)
    expect(winbrosCleaners).toHaveLength(1)

    // No cross-contamination
    for (const c of cedarCleaners!) {
      expect(c.tenant_id).toBe(CEDAR_RAPIDS_ID)
    }
    for (const c of winbrosCleaners!) {
      expect(c.tenant_id).toBe(WINBROS_ID)
    }
  })

  it('job insert for one tenant does not appear for the other', async () => {
    // Insert a WinBros job
    await mockClient.from('jobs').insert({
      id: 'job-wb-001',
      tenant_id: WINBROS_ID,
      phone_number: '+16305550001',
      status: 'scheduled',
      date: '2026-04-01',
      service_type: 'window_cleaning',
    })

    // Query Cedar Rapids jobs — should NOT see the WinBros job
    const { data: cedarJobs } = await mockClient.from('jobs')
      .select('*')
      .eq('tenant_id', CEDAR_RAPIDS_ID)

    const { data: winbrosJobs } = await mockClient.from('jobs')
      .select('*')
      .eq('tenant_id', WINBROS_ID)

    expect(cedarJobs).toHaveLength(0)
    expect(winbrosJobs).toHaveLength(1)
    expect(winbrosJobs![0].id).toBe('job-wb-001')
  })

  it('message insert is tenant-scoped', async () => {
    // Insert messages for both tenants
    await mockClient.from('messages').insert({
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550001',
      content: 'Cedar message',
      role: 'client',
      direction: 'inbound',
    })

    await mockClient.from('messages').insert({
      tenant_id: WINBROS_ID,
      phone_number: '+13195550001', // same phone, different tenant
      content: 'WinBros message',
      role: 'client',
      direction: 'inbound',
    })

    const { data: cedarMessages } = await mockClient.from('messages')
      .select('*')
      .eq('tenant_id', CEDAR_RAPIDS_ID)

    const { data: winbrosMessages } = await mockClient.from('messages')
      .select('*')
      .eq('tenant_id', WINBROS_ID)

    expect(cedarMessages).toHaveLength(1)
    expect(cedarMessages![0].content).toBe('Cedar message')
    expect(winbrosMessages).toHaveLength(1)
    expect(winbrosMessages![0].content).toBe('WinBros message')
  })

  it('tenant lookup by phone returns correct tenant', async () => {
    // Cedar Rapids phone
    const { data: cedarTenant } = await mockClient.from('tenants')
      .select('*')
      .eq('openphone_phone_number', '+13195551234')
      .single()

    expect(cedarTenant?.slug).toBe('cedar-rapids')

    // WinBros phone
    const { data: winbrosTenant } = await mockClient.from('tenants')
      .select('*')
      .eq('openphone_phone_number', '+16305551234')
      .single()

    expect(winbrosTenant?.slug).toBe('winbros')
  })

  it('WinBros workflow config has route_optimization enabled', async () => {
    const { data: tenant } = await mockClient.from('tenants')
      .select('*')
      .eq('slug', 'winbros')
      .single()

    expect(tenant?.workflow_config?.use_route_optimization).toBe(true)
    expect(tenant?.workflow_config?.use_housecall_pro).toBe(true)
  })

  it('Cedar Rapids workflow config does NOT have route_optimization', async () => {
    const { data: tenant } = await mockClient.from('tenants')
      .select('*')
      .eq('slug', 'cedar-rapids')
      .single()

    expect(tenant?.workflow_config?.use_route_optimization).toBe(false)
    expect(tenant?.workflow_config?.use_cleaner_dispatch).toBe(true)
  })
})
