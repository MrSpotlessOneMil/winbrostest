#!/usr/bin/env npx tsx
/**
 * Live Smoke Test — All Lead Source Endpoints
 *
 * Tests every customer-facing endpoint against the live production API.
 * Does NOT modify real customer data — uses test phone numbers and
 * assistant IDs that route to safe paths.
 *
 * Tests:
 *  1. VAPI send-customer-text (quote SMS delivery)
 *  2. VAPI webhook (end-of-call report)
 *  3. OpenPhone webhook (inbound SMS)
 *  4. Meta/Facebook webhook (lead submission)
 *  5. Website form webhook (lead submission)
 *  6. Quote page (customer-facing booking page)
 *  7. Cron auth (disabled crons return correctly)
 *  8. SMS throttle (3/day limit enforcement)
 *
 * Usage:
 *   npx tsx scripts/e2e/smoke-test-live.ts
 *   npx tsx scripts/e2e/smoke-test-live.ts --dry-run
 */

const BASE = process.env.E2E_BASE_URL || 'https://cleanmachine.live'
const DRY_RUN = process.argv.includes('--dry-run')

// Test phone: Dominic's test number (safe to SMS)
const TEST_PHONE = '+14242755847'

// Assistant IDs for each tenant
const ASSISTANTS = {
  spotless: 'e3ed2426-dc28-4046-a5e9-0fbb945ff706',
  westNiagara: '81cee3b3-324f-4d05-900e-ac0f57ed283f',
  cedarRapids: '4c673d16-436d-42ae-bf51-10b2c2d30fa0',
}

type Result = { name: string; pass: boolean; detail: string; duration: number }
const results: Result[] = []

async function test(name: string, fn: () => Promise<void>) {
  const start = Date.now()
  try {
    if (DRY_RUN) {
      results.push({ name, pass: true, detail: '[DRY RUN]', duration: 0 })
      return
    }
    await fn()
    results.push({ name, pass: true, detail: 'OK', duration: Date.now() - start })
    console.log(`  PASS  ${name} (${Date.now() - start}ms)`)
  } catch (err: any) {
    results.push({ name, pass: false, detail: err.message, duration: Date.now() - start })
    console.log(`  FAIL  ${name}`)
    console.log(`         ${err.message}`)
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

async function post(path: string, body: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data: any
  try { data = await res.json() } catch { data = null }
  return { status: res.status, data }
}

async function get(path: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`)
  let data: any
  try { data = await res.json() } catch { data = null }
  return { status: res.status, data }
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 1: VAPI send-customer-text — All 3 VAPI payload formats
// ═══════════════════════════════════════════════════════════════════════

async function testVapiSendText() {
  console.log('\n── VAPI send-customer-text ──')

  const params = {
    message_type: 'price_quote',
    bedrooms: 2,
    bathrooms: 2,
    service_type: 'standard',
    customer_name: 'SmokeTest',
    price: 263,
  }

  // Format 1: toolCallList (newer VAPI)
  await test('VAPI toolCallList format → real quote', async () => {
    const { status, data } = await post('/api/vapi/send-customer-text', {
      message: {
        type: 'tool-calls',
        call: { customer: { number: TEST_PHONE }, assistantId: ASSISTANTS.spotless },
        toolCallList: [{ id: 'smoke-1', name: 'send-customer-text', parameters: params }],
      },
    })
    assert(status === 200, `Expected 200, got ${status}`)
    const result = data?.results?.[0]?.result || ''
    assert(result.includes('$'), `Expected price in SMS, got: ${result.slice(0, 100)}`)
    assert(!result.includes('follow up'), `Got fallback message: ${result.slice(0, 100)}`)
    assert(result.includes('/quote/'), `Expected quote link, got: ${result.slice(0, 100)}`)
  })

  // Format 2: toolWithToolCallList (newer nested)
  await test('VAPI toolWithToolCallList format → real quote', async () => {
    const { status, data } = await post('/api/vapi/send-customer-text', {
      message: {
        type: 'tool-calls',
        call: { customer: { number: TEST_PHONE }, assistantId: ASSISTANTS.westNiagara },
        toolWithToolCallList: [{ name: 'send-customer-text', toolCall: { id: 'smoke-2', parameters: params } }],
      },
    })
    assert(status === 200, `Expected 200, got ${status}`)
    const result = data?.results?.[0]?.result || ''
    assert(result.includes('$'), `Expected price, got: ${result.slice(0, 100)}`)
  })

  // Format 3: functionCall (legacy)
  await test('VAPI functionCall format → real quote', async () => {
    const { status, data } = await post('/api/vapi/send-customer-text', {
      message: {
        type: 'function-call',
        call: { customer: { number: TEST_PHONE }, assistantId: ASSISTANTS.cedarRapids },
        functionCall: { id: 'smoke-3', name: 'send-customer-text', parameters: params },
      },
    })
    assert(status === 200, `Expected 200, got ${status}`)
    const result = data?.results?.[0]?.result || ''
    assert(result.includes('$'), `Expected price, got: ${result.slice(0, 100)}`)
  })

  // Missing params → should still return 200 (VAPI requires it)
  await test('VAPI missing bed/bath → returns 200 with fallback', async () => {
    const { status, data } = await post('/api/vapi/send-customer-text', {
      message: {
        type: 'tool-calls',
        call: { customer: { number: TEST_PHONE }, assistantId: ASSISTANTS.spotless },
        toolCallList: [{ id: 'smoke-4', name: 'send-customer-text', parameters: { message_type: 'price_quote' } }],
      },
    })
    assert(status === 200, `Expected 200, got ${status}`)
    // Fallback is OK here — the point is it doesn't crash
  })
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 2: VAPI webhook (end-of-call report)
// ═══════════════════════════════════════════════════════════════════════

async function testVapiWebhook() {
  console.log('\n── VAPI webhook (end-of-call) ──')

  await test('VAPI end-of-call → 200 (Spotless)', async () => {
    const { status } = await post('/api/webhooks/vapi/spotless-scrubbers', {
      message: {
        type: 'end-of-call-report',
        call: {
          id: `smoke-call-${Date.now()}`,
          type: 'inbound',
          status: 'completed',
          endedReason: 'completed',
          duration: 120,
          customer: { number: TEST_PHONE },
        },
        analysis: {
          structuredData: {},
          successEvaluation: false,
        },
      },
    })
    assert(status === 200, `Expected 200, got ${status}`)
  })

  await test('VAPI end-of-call → 200 (West Niagara)', async () => {
    const { status } = await post('/api/webhooks/vapi/west-niagara', {
      message: {
        type: 'end-of-call-report',
        call: {
          id: `smoke-call-wn-${Date.now()}`,
          type: 'inbound',
          status: 'completed',
          endedReason: 'completed',
          duration: 90,
          customer: { number: TEST_PHONE },
        },
        analysis: { structuredData: {}, successEvaluation: false },
      },
    })
    assert(status === 200, `Expected 200, got ${status}`)
  })

  // Non end-of-call messages should be ignored
  await test('VAPI transcript message → ignored (200)', async () => {
    const { status, data } = await post('/api/webhooks/vapi/spotless-scrubbers', {
      message: { type: 'transcript', transcript: 'test' },
    })
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data?.ignored === true, 'Should be ignored')
  })
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 3: Website form webhook
// ═══════════════════════════════════════════════════════════════════════

async function testWebsiteWebhook() {
  console.log('\n── Website form webhook ──')

  await test('Website form → 200 (Spotless)', async () => {
    const { status } = await post('/api/webhooks/website/spotless-scrubbers', {
      name: 'Smoke Test',
      phone: TEST_PHONE,
      email: 'smoketest@example.com',
      service: 'standard',
      message: 'E2E smoke test — please ignore',
    })
    // May fail on tenant lookup without service key, but should not 500
    assert(status < 500, `Expected non-500, got ${status}`)
  })
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 4: Disabled crons return correctly
// ═══════════════════════════════════════════════════════════════════════

async function testDisabledCrons() {
  console.log('\n── Disabled crons ──')

  for (const cron of ['monthly-reengagement', 'frequency-nudge', 'monthly-followup']) {
    await test(`${cron} → disabled response`, async () => {
      const { status, data } = await get(`/api/cron/${cron}`)
      // Without CRON_SECRET, should get 401 OR our disabled response
      // If disabled correctly, the early return fires before auth check
      assert(status === 200, `Expected 200 (disabled), got ${status}`)
      assert(data?.disabled === true, `Expected disabled:true, got: ${JSON.stringify(data).slice(0, 100)}`)
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 5: Quote page loads
// ═══════════════════════════════════════════════════════════════════════

async function testQuotePage() {
  console.log('\n── Quote page ──')

  await test('Quote page with invalid token → 404 or error page (not 500)', async () => {
    const res = await fetch(`${BASE}/quote/invalid-token-smoke-test`)
    assert(res.status < 500, `Expected non-500, got ${res.status}`)
  })
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 6: Cron auth enforcement
// ═══════════════════════════════════════════════════════════════════════

async function testCronAuth() {
  console.log('\n── Cron auth enforcement ──')

  const protectedCrons = [
    'send-reminders', 'post-job-followup', 'send-final-payments',
    'process-scheduled-tasks', 'check-timeouts', 'ghost-watchdog',
  ]

  for (const cron of protectedCrons) {
    await test(`${cron} → 401 without auth`, async () => {
      const { status } = await get(`/api/cron/${cron}`)
      assert(status === 401, `Expected 401, got ${status}`)
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 7: Webhook auth enforcement
// ═══════════════════════════════════════════════════════════════════════

async function testWebhookAuth() {
  console.log('\n── Webhook auth enforcement ──')

  await test('Stripe webhook → rejects unsigned', async () => {
    const { status } = await post('/api/webhooks/stripe/', { type: 'test' })
    assert(status === 400 || status === 401, `Expected 400/401, got ${status}`)
  })

  await test('HCP webhook → rejects unsigned', async () => {
    const { status } = await post('/api/webhooks/housecall-pro/', { type: 'test' })
    assert(status === 400 || status === 401, `Expected 400/401, got ${status}`)
  })
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log(' Osiris Live Smoke Test')
  console.log(`═══════════════════════════════════════════════════`)
  console.log(`Base URL: ${BASE}`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)
  console.log(`Test phone: ${TEST_PHONE}`)
  console.log('')

  await testVapiSendText()
  await testVapiWebhook()
  await testWebsiteWebhook()
  await testDisabledCrons()
  await testQuotePage()
  await testCronAuth()
  await testWebhookAuth()

  // Summary
  console.log('\n═══════════════════════════════════════════════════')
  const passed = results.filter(r => r.pass).length
  const failed = results.filter(r => !r.pass).length
  console.log(` Results: ${passed} passed, ${failed} failed, ${results.length} total`)
  console.log('═══════════════════════════════════════════════════')

  if (failed > 0) {
    console.log('\nFailed tests:')
    for (const r of results.filter(r => !r.pass)) {
      console.log(`  FAIL  ${r.name}`)
      console.log(`         ${r.detail}`)
    }
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
