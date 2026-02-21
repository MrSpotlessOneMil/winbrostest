/**
 * Local HCP Integration Test Script
 * Run: npx tsx scripts/test-hcp-sync.ts
 *
 * Tests auth, customer creation, job creation, schedule, dispatch, and line items
 * against the real HouseCall Pro API using tenant config from Supabase.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const HCP_API_BASE = 'https://api.housecallpro.com'

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars')
  console.error('Run: source .env.local (or set them manually)')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface TestResult {
  name: string
  success: boolean
  data?: any
  error?: string
}

const results: TestResult[] = []

function log(label: string, ...args: any[]) {
  console.log(`[TEST] ${label}:`, ...args)
}

function logResult(result: TestResult) {
  results.push(result)
  const icon = result.success ? 'PASS' : 'FAIL'
  console.log(`\n[${icon}] ${result.name}`)
  if (result.error) console.log(`  Error: ${result.error}`)
  if (result.data) console.log(`  Data:`, JSON.stringify(result.data, null, 2).slice(0, 500))
}

async function hcpFetch(
  apiKey: string,
  companyId: string | null,
  endpoint: string,
  options: { method?: string; body?: any } = {}
): Promise<{ ok: boolean; status: number; data: any; authMethod: string }> {
  // Try Token + Company-Id first
  const attempts = [
    { label: 'Token+Company', headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(companyId ? { 'X-Company-Id': companyId } : {}) } },
    { label: 'Token', headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' } },
    { label: 'Bearer+Company', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(companyId ? { 'X-Company-Id': companyId } : {}) } },
    { label: 'Bearer', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' } },
  ]

  for (const attempt of attempts) {
    const url = `${HCP_API_BASE}${endpoint}`
    log('Request', `${options.method || 'GET'} ${url} [${attempt.label}]`)
    if (options.body) log('Body', JSON.stringify(options.body).slice(0, 300))

    const resp = await fetch(url, {
      method: options.method || 'GET',
      headers: attempt.headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })

    const text = await resp.text()
    log('Response', `${resp.status} ${resp.statusText} [${attempt.label}]`)
    if (text) log('Body', text.slice(0, 500))

    if (resp.ok) {
      const data = text ? JSON.parse(text) : null
      return { ok: true, status: resp.status, data, authMethod: attempt.label }
    }

    if (resp.status === 401 || resp.status === 403) {
      log('Auth', `${resp.status} with ${attempt.label}, trying next...`)
      continue
    }

    // Non-auth error — return immediately
    let data = null
    try { data = JSON.parse(text) } catch {}
    return { ok: false, status: resp.status, data: data || text, authMethod: attempt.label }
  }

  return { ok: false, status: 401, data: 'All auth methods failed', authMethod: 'none' }
}

async function main() {
  console.log('\n========================================')
  console.log('  HCP Integration Test')
  console.log('========================================\n')

  // 1. Load tenant config
  log('Setup', 'Loading WinBros tenant from Supabase...')
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, slug, housecall_pro_api_key, housecall_pro_company_id, timezone')
    .eq('slug', 'winbros')
    .single()

  if (tenantErr || !tenant) {
    logResult({ name: 'Load Tenant', success: false, error: tenantErr?.message || 'Not found' })
    return
  }

  const apiKey = tenant.housecall_pro_api_key?.trim().replace(/^(token|bearer)\s+/i, '').trim()
  const companyId = tenant.housecall_pro_company_id?.trim() || null

  logResult({
    name: 'Load Tenant',
    success: true,
    data: {
      slug: tenant.slug,
      timezone: tenant.timezone,
      hasApiKey: !!apiKey,
      apiKeyLength: apiKey?.length,
      apiKeyPrefix: apiKey?.slice(0, 8) + '...',
      companyId,
    },
  })

  if (!apiKey) {
    console.error('\nNo HCP API key found. Cannot proceed.')
    return
  }

  // 2. Test Auth — list employees
  log('Test', 'Testing auth with GET /employees...')
  const empResult = await hcpFetch(apiKey, companyId, '/employees')
  logResult({
    name: 'Auth + List Employees',
    success: empResult.ok,
    data: empResult.ok
      ? { authMethod: empResult.authMethod, count: Array.isArray(empResult.data?.employees) ? empResult.data.employees.length : 'unknown' }
      : undefined,
    error: !empResult.ok ? `${empResult.status}: ${JSON.stringify(empResult.data).slice(0, 200)}` : undefined,
  })

  if (!empResult.ok) {
    console.error('\nAuth failed. Fix the API key before proceeding.')
    printSummary()
    return
  }

  const workingAuth = empResult.authMethod
  const employees = empResult.data?.employees || []
  log('Employees', employees.map((e: any) => `${e.first_name} ${e.last_name} (${e.id})`).join(', '))

  // 3. Test Customer Create
  const testPhone = '+12225551234'
  const testCustomer = {
    first_name: 'OSIRIS Test',
    last_name: 'Customer',
    mobile_number: testPhone,
    email: 'osiris-test@example.com',
    notifications_enabled: true,
    tags: ['osiris-test'],
    lead_source: 'osiris',
    addresses: [{
      street: '123 Test Street',
      city: 'Springfield',
      state: 'IL',
      zip: '62701',
      country: 'US',
      type: 'service',
    }],
  }

  log('Test', 'Creating test customer...')
  const custResult = await hcpFetch(apiKey, companyId, '/customers', {
    method: 'POST',
    body: testCustomer,
  })
  logResult({
    name: 'Customer Create',
    success: custResult.ok,
    data: custResult.ok ? { customerId: custResult.data?.id, addresses: custResult.data?.addresses?.length } : undefined,
    error: !custResult.ok ? `${custResult.status}: ${JSON.stringify(custResult.data).slice(0, 300)}` : undefined,
  })

  if (!custResult.ok) {
    console.error('\nCustomer creation failed. Check API permissions.')
    printSummary()
    return
  }

  const customerId = custResult.data?.id
  const addressId = custResult.data?.addresses?.[0]?.id

  // 4. Test Address Create (if customer didn't come with address)
  if (!addressId && customerId) {
    log('Test', 'Creating address on customer...')
    const addrResult = await hcpFetch(apiKey, companyId, `/customers/${customerId}/addresses`, {
      method: 'POST',
      body: { street: '123 Test Street', city: 'Springfield', state: 'IL', zip: '62701', country: 'US' },
    })
    logResult({
      name: 'Address Create',
      success: addrResult.ok,
      data: addrResult.ok ? { addressId: addrResult.data?.id } : undefined,
      error: !addrResult.ok ? `${addrResult.status}: ${JSON.stringify(addrResult.data).slice(0, 200)}` : undefined,
    })
  } else {
    logResult({ name: 'Address Create', success: true, data: { addressId, note: 'Created with customer' } })
  }

  const finalAddressId = addressId || results.find(r => r.name === 'Address Create')?.data?.addressId

  // 5. Test Job Create
  const now = new Date()
  const tomorrow = new Date(now.getTime() + 86400000)
  const dateStr = tomorrow.toISOString().split('T')[0]
  const scheduledStart = `${dateStr}T10:00:00-06:00`
  const scheduledEnd = `${dateStr}T12:00:00-06:00`

  const jobBody: Record<string, any> = {
    customer_id: customerId,
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
    line_items: [{ name: 'Window Cleaning - Exterior', quantity: 1, unit_price: 27500 }],
    notes: 'OSIRIS Test Job\nService: Window Cleaning\nOSIRIS Job ID: TEST-001\nQuoted Price: $275.00',
    tags: ['osiris', 'window-cleaning', 'test'],
    lead_source: 'osiris-test',
    description: 'Window Cleaning - Exterior',
  }

  if (finalAddressId) {
    jobBody.address_id = finalAddressId
  } else {
    jobBody.address = '123 Test Street, Springfield, IL 62701'
  }

  if (employees.length > 0) {
    jobBody.assigned_employee_ids = [employees[0].id]
    log('Assignment', `Assigning to: ${employees[0].first_name} ${employees[0].last_name}`)
  }

  log('Test', 'Creating test job...')
  const jobResult = await hcpFetch(apiKey, companyId, '/jobs', {
    method: 'POST',
    body: jobBody,
  })

  const jobId = jobResult.data?.id || jobResult.data?.job?.id
  logResult({
    name: 'Job Create',
    success: jobResult.ok && !!jobId,
    data: jobResult.ok ? { jobId, status: jobResult.data?.work_status } : undefined,
    error: !jobResult.ok ? `${jobResult.status}: ${JSON.stringify(jobResult.data).slice(0, 300)}` : undefined,
  })

  if (!jobId) {
    console.error('\nJob creation failed. Check payload format.')
    printSummary()
    return
  }

  // 6. Test Schedule endpoint
  log('Test', 'Testing PUT /jobs/{id}/schedule...')
  const schedBody: Record<string, any> = {
    start_time: scheduledStart,
    end_time: scheduledEnd,
    arrival_window_in_minutes: 60,
    notify: false,
    notify_pro: false,
  }
  if (employees.length > 0) {
    schedBody.dispatched_employees = [{ employee_id: employees[0].id }]
  }

  const schedResult = await hcpFetch(apiKey, companyId, `/jobs/${jobId}/schedule`, {
    method: 'PUT',
    body: schedBody,
  })
  logResult({
    name: 'Schedule (PUT)',
    success: schedResult.ok,
    error: !schedResult.ok ? `${schedResult.status}: ${JSON.stringify(schedResult.data).slice(0, 200)}` : undefined,
  })

  // 7. Test Dispatch endpoint
  if (employees.length > 0) {
    log('Test', 'Testing PUT /jobs/{id}/dispatch...')
    const dispResult = await hcpFetch(apiKey, companyId, `/jobs/${jobId}/dispatch`, {
      method: 'PUT',
      body: { dispatched_employees: [{ employee_id: employees[0].id }] },
    })
    logResult({
      name: 'Dispatch (PUT)',
      success: dispResult.ok,
      error: !dispResult.ok ? `${dispResult.status}: ${JSON.stringify(dispResult.data).slice(0, 200)}` : undefined,
    })
  }

  // 8. Test Line Items endpoint
  log('Test', 'Testing PUT /jobs/{id}/line_items/bulk_update...')
  const liResult = await hcpFetch(apiKey, companyId, `/jobs/${jobId}/line_items/bulk_update`, {
    method: 'PUT',
    body: {
      line_items: [{ name: 'Window Cleaning - Exterior', quantity: 1, unit_price: 27500 }],
      append_line_items: false,
    },
  })
  logResult({
    name: 'Line Items (PUT)',
    success: liResult.ok,
    error: !liResult.ok ? `${liResult.status}: ${JSON.stringify(liResult.data).slice(0, 200)}` : undefined,
  })

  // 9. Verify job via GET
  log('Test', 'Verifying job via GET...')
  const getResult = await hcpFetch(apiKey, companyId, `/jobs/${jobId}`)
  if (getResult.ok) {
    const job = getResult.data
    logResult({
      name: 'Job Verification (GET)',
      success: true,
      data: {
        id: job.id,
        work_status: job.work_status,
        scheduled_start: job.schedule?.scheduled_start || job.scheduled_start,
        scheduled_end: job.schedule?.scheduled_end || job.scheduled_end,
        total_amount: job.total_amount,
        assigned_employees: job.assigned_employees?.map((e: any) => e.first_name),
        line_items_count: job.line_items?.length,
        notes: job.notes?.slice(0, 100),
        tags: job.tags,
        lead_source: job.lead_source,
      },
    })
  } else {
    logResult({ name: 'Job Verification (GET)', success: false, error: `${getResult.status}` })
  }

  printSummary()

  // Print cleanup instructions
  console.log('\n--- CLEANUP ---')
  console.log(`To delete test job: DELETE /jobs/${jobId}`)
  console.log(`To delete test customer: DELETE /customers/${customerId}`)
  console.log('Or delete them manually in the HCP dashboard.')
}

function printSummary() {
  console.log('\n========================================')
  console.log('  SUMMARY')
  console.log('========================================')
  for (const r of results) {
    console.log(`  ${r.success ? 'PASS' : 'FAIL'}  ${r.name}`)
  }
  const passed = results.filter(r => r.success).length
  const total = results.length
  console.log(`\n  ${passed}/${total} tests passed`)
  console.log('========================================\n')
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
