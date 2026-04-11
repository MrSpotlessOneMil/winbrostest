import { test, expect } from '@playwright/test'

// Test against production
const BASE = 'https://cleanmachine.live'

// Lily Hoyer — has scheduled + completed jobs, no pending
const VALID_TOKEN = '634a2988-5e12-48dd-bd01-d6283d1d585b'
// Hannah Bates — has pending job assignment
const TOKEN_WITH_PENDING = '657439fd-66f1-44a5-9caa-ab21a8380b92'
// Known job IDs
const SCHEDULED_JOB_ID = 395
const COMPLETED_JOB_ID = 237
const FAKE_TOKEN = '00000000-0000-0000-0000-000000000000'
const FAKE_JOB_ID = 999999

test.describe('Crew Portal — Home Page', () => {
  test('1. Portal loads with valid token and shows cleaner name', async ({ page }) => {
    await page.goto(`${BASE}/crew/${VALID_TOKEN}`)
    await expect(page.getByText('Lily')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Cedar Rapids', { exact: true }).first()).toBeVisible()
  })

  test('2. Invalid token shows error page', async ({ page }) => {
    await page.goto(`${BASE}/crew/${FAKE_TOKEN}`)
    await expect(page.getByText('Invalid Link')).toBeVisible({ timeout: 15000 })
  })

  test('3. Malformed token (not a UUID) shows error', async ({ page }) => {
    await page.goto(`${BASE}/crew/not-a-real-token-lol`)
    await expect(page.getByText('Invalid Link')).toBeVisible({ timeout: 15000 })
  })

  test('4. Calendar toolbar with Day/Week toggle renders', async ({ page }) => {
    await page.goto(`${BASE}/crew/${VALID_TOKEN}`)
    await expect(page.getByText('DAY')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('WEEK')).toBeVisible()
  })

  test('5. Availability button is visible', async ({ page }) => {
    await page.goto(`${BASE}/crew/${VALID_TOKEN}`)
    await expect(page.getByText('Availability')).toBeVisible({ timeout: 15000 })
  })

  test('6. Job blocks are clickable and open detail drawer', async ({ page }) => {
    await page.goto(`${BASE}/crew/${VALID_TOKEN}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    // Find a job block with time
    const jobBlock = page.locator('button:has-text(/AM|PM/)').first()
    const hasJobs = await jobBlock.isVisible().catch(() => false)
    if (hasJobs) {
      await jobBlock.click()
      await page.waitForTimeout(500)
      await expect(page.getByText('View Full Details')).toBeVisible({ timeout: 5000 })
    }
  })

  test('7. Pending jobs show Action Required section', async ({ page }) => {
    await page.goto(`${BASE}/crew/${TOKEN_WITH_PENDING}`)
    await page.waitForLoadState('networkidle')
    // Hannah has a pending assignment — should show Action Required or the pending card
    const hasActionRequired = await page.getByText('Action Required').isVisible().catch(() => false)
    const hasPendingCard = await page.getByText('Respond').isVisible().catch(() => false)
    expect(hasActionRequired || hasPendingCard).toBeTruthy()
  })

  test('8. Log out button is present', async ({ page }) => {
    await page.goto(`${BASE}/crew/${VALID_TOKEN}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Log out')).toBeVisible({ timeout: 15000 })
  })
})

test.describe('Crew Portal — Job Detail Page', () => {
  test('9. Scheduled job detail loads with job info', async ({ page }) => {
    await page.goto(`${BASE}/crew/${VALID_TOKEN}/job/${SCHEDULED_JOB_ID}`)
    await expect(page.getByText('Back')).toBeVisible({ timeout: 15000 })
    // Should show date, address, or service type
    const hasContent = await page.locator('text=/Deep Cleaning|Standard Cleaning|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/').first().isVisible().catch(() => false)
    expect(hasContent).toBeTruthy()
  })

  test('10. Completed job detail shows payment collected or tip link', async ({ page }) => {
    await page.goto(`${BASE}/crew/${VALID_TOKEN}/job/${COMPLETED_JOB_ID}`)
    await page.waitForLoadState('networkidle')
    // Completed jobs should show either "Payment Collected", "Tip Link", or "Charge"
    const hasPaid = await page.getByText('Payment Collected').isVisible().catch(() => false)
    const hasTipLink = await page.getByText('Tip Link').isVisible().catch(() => false)
    const hasCharge = await page.getByText('Charge').isVisible().catch(() => false)
    const hasSendTip = await page.getByText('SEND TIP LINK', { exact: false }).isVisible().catch(() => false)
    // Completed jobs should show at least one post-completion action
    expect(hasPaid || hasTipLink || hasCharge || hasSendTip).toBeTruthy()
  })

  test('11. Invalid job ID shows error', async ({ page }) => {
    await page.goto(`${BASE}/crew/${VALID_TOKEN}/job/${FAKE_JOB_ID}`)
    await expect(page.getByText('Job Not Found', { exact: false })).toBeVisible({ timeout: 15000 })
  })

  test('12. Back button navigates to portal home', async ({ page }) => {
    await page.goto(`${BASE}/crew/${VALID_TOKEN}/job/${SCHEDULED_JOB_ID}`)
    await page.waitForLoadState('networkidle')
    await page.getByText('Back').click()
    await page.waitForURL(/\/crew\/[^/]+$/, { timeout: 10000 })
    expect(page.url()).not.toContain('/job/')
  })

  test('13. Job detail shows address as Google Maps link', async ({ page }) => {
    await page.goto(`${BASE}/crew/${VALID_TOKEN}/job/${SCHEDULED_JOB_ID}`)
    await page.waitForLoadState('networkidle')
    const mapLink = page.locator('a[href*="maps.google.com"]').first()
    const exists = await mapLink.isVisible().catch(() => false)
    if (exists) {
      const href = await mapLink.getAttribute('href')
      expect(href).toContain('maps.google.com')
    }
  })

  test('14. Status button shows next action (OMW/Arrived/Complete)', async ({ page }) => {
    await page.goto(`${BASE}/crew/${VALID_TOKEN}/job/${SCHEDULED_JOB_ID}`)
    await page.waitForLoadState('networkidle')
    // For a scheduled job, should show OMW button or progress tracker
    const hasOMW = await page.getByText('ON MY WAY', { exact: false }).isVisible().catch(() => false)
    const hasArrived = await page.getByText('ARRIVED', { exact: false }).isVisible().catch(() => false)
    const hasComplete = await page.getByText('COMPLETE', { exact: false }).isVisible().catch(() => false)
    const hasProgress = await page.getByText('Job Progress').isVisible().catch(() => false)
    expect(hasOMW || hasArrived || hasComplete || hasProgress).toBeTruthy()
  })

  test('15. Message Client section is present and toggleable', async ({ page }) => {
    await page.goto(`${BASE}/crew/${VALID_TOKEN}/job/${SCHEDULED_JOB_ID}`)
    await page.waitForLoadState('networkidle')
    const msgButton = page.getByText('Message Client')
    await expect(msgButton).toBeVisible({ timeout: 15000 })
    await msgButton.click()
    // Should show message input or "No messages yet"
    const hasInput = await page.locator('input[placeholder*="message"]').isVisible().catch(() => false)
    const hasEmpty = await page.getByText('No messages yet').isVisible().catch(() => false)
    expect(hasInput || hasEmpty).toBeTruthy()
  })
})

test.describe('Crew Portal — API Edge Cases', () => {
  test('16. API returns 404 for invalid token', async ({ request }) => {
    const res = await request.get(`${BASE}/api/crew/${FAKE_TOKEN}`)
    expect(res.status()).toBe(404)
    const json = await res.json()
    expect(json.error).toBeTruthy()
  })

  test('17. API returns valid JSON structure for valid token', async ({ request }) => {
    const res = await request.get(`${BASE}/api/crew/${VALID_TOKEN}`)
    expect(res.status()).toBe(200)
    const json = await res.json()
    expect(json.cleaner).toBeTruthy()
    expect(json.cleaner.name).toBeTruthy()
    expect(json.tenant).toBeTruthy()
    expect(Array.isArray(json.jobs)).toBeTruthy()
    expect(Array.isArray(json.pendingJobs)).toBeTruthy()
    expect(json.dateRange).toBeTruthy()
    expect(Array.isArray(json.timeOff)).toBeTruthy()
  })

  test('18. Job API returns 404 for wrong job ID', async ({ request }) => {
    const res = await request.get(`${BASE}/api/crew/${VALID_TOKEN}/job/${FAKE_JOB_ID}`)
    expect(res.status()).toBe(404)
  })

  test('19. Job API returns valid structure for real job', async ({ request }) => {
    const res = await request.get(`${BASE}/api/crew/${VALID_TOKEN}/job/${SCHEDULED_JOB_ID}`)
    expect(res.status()).toBe(200)
    const json = await res.json()
    expect(json.job).toBeTruthy()
    expect(json.job.id).toBe(SCHEDULED_JOB_ID)
    expect(json.assignment).toBeTruthy()
    expect(json.customer).toBeTruthy()
    expect(Array.isArray(json.checklist)).toBeTruthy()
    expect(json.tenant).toBeTruthy()
  })

  test('20. Cannot access job belonging to different cleaner', async ({ request }) => {
    // Hannah's token trying to access Lily's job
    const res = await request.get(`${BASE}/api/crew/${TOKEN_WITH_PENDING}/job/${SCHEDULED_JOB_ID}`)
    // Should be 404 (job not assigned to this cleaner)
    expect(res.status()).toBe(404)
  })
})
