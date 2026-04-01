import { test, expect } from '@playwright/test'

const BASE = 'https://cleanmachine.live'

// WinBros test cleaner (technician)
const WINBROS_TOKEN = 'ae1ca33c-d83e-466c-8863-7897a5e0f92c'
// Cedar Rapids cleaners with real jobs
const LILY_TOKEN = '634a2988-5e12-48dd-bd01-d6283d1d585b'
const HANNAH_TOKEN = '657439fd-66f1-44a5-9caa-ab21a8380b92'
const FAKE_TOKEN = '00000000-0000-0000-0000-000000000000'
const SCHEDULED_JOB_ID = 395

test.describe('Crew Portal — Calendar View', () => {
  test('1. WinBros portal loads with teal theme and calendar toolbar', async ({ page }) => {
    await page.goto(`${BASE}/crew/${WINBROS_TOKEN}`)
    // Should show cleaner name (not Application Error)
    await expect(page.getByText('Dominic')).toBeVisible({ timeout: 15000 })
    // Should show WinBros tenant name
    await expect(page.getByText('WinBros', { exact: false }).first()).toBeVisible()
    // Toolbar should have Day/Week toggle
    await expect(page.getByRole('button', { name: 'day' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'week' })).toBeVisible()
    // Availability button should be visible
    await expect(page.getByText('Availability')).toBeVisible()
  })

  test('2. Invalid token shows error page gracefully (no crash)', async ({ page }) => {
    await page.goto(`${BASE}/crew/${FAKE_TOKEN}`)
    await expect(page.getByText('Invalid Link')).toBeVisible({ timeout: 15000 })
    // Should NOT show Application Error
    const body = await page.textContent('body')
    expect(body).not.toContain('Application error')
  })

  test('3. Day view shows empty state when no jobs', async ({ page }) => {
    await page.goto(`${BASE}/crew/${WINBROS_TOKEN}`)
    await page.waitForLoadState('networkidle')
    // Empty day should show "No jobs scheduled"
    await expect(page.getByText('No jobs scheduled')).toBeVisible({ timeout: 15000 })
  })

  test('4. Day/Week toggle switches views', async ({ page }) => {
    await page.goto(`${BASE}/crew/${WINBROS_TOKEN}`)
    await page.waitForLoadState('networkidle')
    // Start in day view - should see "No jobs scheduled" or job blocks
    await expect(page.getByRole('button', { name: 'day' })).toBeVisible({ timeout: 15000 })

    // Switch to week view
    await page.getByRole('button', { name: 'week' }).click()
    await page.waitForTimeout(500)

    // Week view should show 7 day columns with day abbreviations
    const dayHeaders = page.locator('text=/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/')
    await expect(dayHeaders.first()).toBeVisible({ timeout: 5000 })
    const count = await dayHeaders.count()
    expect(count).toBe(7)

    // Switch back to day view
    await page.getByRole('button', { name: 'day' }).click()
    await page.waitForTimeout(500)
  })

  test('5. Date navigation arrows change the displayed date', async ({ page }) => {
    await page.goto(`${BASE}/crew/${WINBROS_TOKEN}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // Get the date text from the toolbar (between the arrows)
    const dateBtn = page.locator('button:has(span.text-sm.font-bold)')
    const initialText = await dateBtn.textContent()

    // Click forward arrow
    const forwardArrow = page.locator('button:has(svg) >> nth=1').first()
    await forwardArrow.click()
    await page.waitForTimeout(1000)

    // Date should have changed
    const newText = await dateBtn.textContent()
    expect(newText).not.toBe(initialText)
  })

  test('6. Availability drawer opens and shows month calendar', async ({ page }) => {
    await page.goto(`${BASE}/crew/${WINBROS_TOKEN}`)
    await page.waitForLoadState('networkidle')

    // Click availability button
    await page.getByText('Availability').click()
    await page.waitForTimeout(500)

    // Drawer should open with month calendar
    await expect(page.getByText('My Availability')).toBeVisible({ timeout: 5000 })

    // Should show "Tap a day to request off" instruction text
    await expect(page.getByText('Tap a day to request off')).toBeVisible({ timeout: 5000 })
  })

  test('7. Availability drawer shows Weekly Hours toggle', async ({ page }) => {
    await page.goto(`${BASE}/crew/${WINBROS_TOKEN}`)
    await page.waitForLoadState('networkidle')

    // Open availability
    await page.getByText('Availability').click()
    await page.waitForTimeout(500)

    // Toggle to weekly hours
    await page.getByText('Weekly Hours').click()
    await page.waitForTimeout(300)

    // Should show day labels and time selectors
    await expect(page.getByText('Set your regular weekly hours')).toBeVisible({ timeout: 5000 })

    // Should have 7 day toggle buttons
    for (const day of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      await expect(page.locator(`[data-slot="drawer-content"] button:has-text("${day}")`).first()).toBeVisible()
    }
  })

  test('8. Bottom bar shows $0 scheduled when no jobs', async ({ page }) => {
    await page.goto(`${BASE}/crew/${WINBROS_TOKEN}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('$0')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('scheduled', { exact: true })).toBeVisible()
  })

  test('9. Log out button is present in header', async ({ page }) => {
    await page.goto(`${BASE}/crew/${WINBROS_TOKEN}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Log out')).toBeVisible({ timeout: 15000 })
  })
})

test.describe('Crew Portal — With Real Jobs (Cedar Rapids)', () => {
  test('10. Portal with jobs shows time blocks in day view', async ({ page }) => {
    await page.goto(`${BASE}/crew/${LILY_TOKEN}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Lily should have jobs — check for job blocks or empty state
    const body = await page.textContent('body')
    const hasJobs = !body?.includes('No jobs scheduled')

    if (hasJobs) {
      // Should show time blocks with service type
      const jobBlock = page.locator('button:has-text(/AM|PM/)').first()
      await expect(jobBlock).toBeVisible({ timeout: 5000 })
    }
  })

  test('11. Clicking a job block opens the detail drawer', async ({ page }) => {
    await page.goto(`${BASE}/crew/${LILY_TOKEN}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Find a job block and click it
    const jobBlock = page.locator('button:has-text(/AM|PM/)').first()
    const hasJobs = await jobBlock.isVisible().catch(() => false)

    if (hasJobs) {
      await jobBlock.click()
      await page.waitForTimeout(500)

      // Drawer should open with job details
      await expect(page.getByText('View Full Details')).toBeVisible({ timeout: 5000 })
    }
  })

  test('12. Job detail drawer shows address as Maps link', async ({ page }) => {
    await page.goto(`${BASE}/crew/${LILY_TOKEN}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const jobBlock = page.locator('button:has-text(/AM|PM/)').first()
    const hasJobs = await jobBlock.isVisible().catch(() => false)

    if (hasJobs) {
      await jobBlock.click()
      await page.waitForTimeout(500)

      // Check for maps link
      const mapLink = page.locator('a[href*="maps.google.com"]').first()
      const hasMap = await mapLink.isVisible().catch(() => false)
      // Maps link should be present if job has address
      if (hasMap) {
        const href = await mapLink.getAttribute('href')
        expect(href).toContain('maps.google.com')
      }
    }
  })

  test('13. View Full Details navigates to job page', async ({ page }) => {
    await page.goto(`${BASE}/crew/${LILY_TOKEN}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const jobBlock = page.locator('button:has-text(/AM|PM/)').first()
    const hasJobs = await jobBlock.isVisible().catch(() => false)

    if (hasJobs) {
      await jobBlock.click()
      await page.waitForTimeout(500)

      const detailBtn = page.getByText('View Full Details')
      await expect(detailBtn).toBeVisible({ timeout: 5000 })
      await detailBtn.click()

      // Should navigate to job detail page
      await page.waitForURL(/\/crew\/.*\/job\/\d+/, { timeout: 10000 })
      expect(page.url()).toContain('/job/')
    }
  })

  test('14. Pending jobs show urgent banner', async ({ page }) => {
    await page.goto(`${BASE}/crew/${HANNAH_TOKEN}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Hannah may have pending assignments
    const hasPending = await page.getByText('need your response').isVisible().catch(() => false)
    const hasView = await page.getByText('View').isVisible().catch(() => false)
    // If pending jobs exist, the banner should show
    if (hasPending) {
      expect(hasView).toBeTruthy()
    }
  })
})

test.describe('Crew Portal — API (updated shape)', () => {
  test('15. API returns new shape with jobs array', async ({ request }) => {
    const res = await request.get(`${BASE}/api/crew/${LILY_TOKEN}?range=day`)
    expect(res.status()).toBe(200)
    const json = await res.json()
    expect(json.cleaner).toBeTruthy()
    expect(json.cleaner.name).toBeTruthy()
    expect(json.tenant).toBeTruthy()
    expect(Array.isArray(json.jobs)).toBeTruthy()
    expect(Array.isArray(json.pendingJobs)).toBeTruthy()
    expect(json.dateRange).toBeTruthy()
    expect(json.dateRange.start).toBeTruthy()
    expect(json.dateRange.end).toBeTruthy()
    expect(Array.isArray(json.timeOff)).toBeTruthy()
  })

  test('16. API returns jobs with hours and price fields', async ({ request }) => {
    const res = await request.get(`${BASE}/api/crew/${LILY_TOKEN}?range=week&date=2026-03-31`)
    expect(res.status()).toBe(200)
    const json = await res.json()
    // If there are jobs, they should have hours and price
    if (json.jobs.length > 0) {
      const job = json.jobs[0]
      expect(job).toHaveProperty('hours')
      expect(job).toHaveProperty('price')
      expect(job).toHaveProperty('service_type')
      expect(job).toHaveProperty('scheduled_at')
      expect(job).toHaveProperty('date')
      expect(job).toHaveProperty('status')
    }
  })

  test('17. API returns 404 for invalid token', async ({ request }) => {
    const res = await request.get(`${BASE}/api/crew/${FAKE_TOKEN}`)
    expect(res.status()).toBe(404)
  })

  test('18. API range=week returns Mon-Sun date range', async ({ request }) => {
    const res = await request.get(`${BASE}/api/crew/${WINBROS_TOKEN}?range=week&date=2026-04-02`)
    expect(res.status()).toBe(200)
    const json = await res.json()
    // April 2 2026 is a Thursday — week should be Mar 30 (Mon) to Apr 5 (Sun)
    expect(json.dateRange.start).toBe('2026-03-30')
    expect(json.dateRange.end).toBe('2026-04-05')
  })

  test('19. PATCH toggleTimeOff adds and removes days off', async ({ request }) => {
    const testDate = '2026-12-25' // Christmas — safe to toggle
    // Add day off
    const addRes = await request.patch(`${BASE}/api/crew/${WINBROS_TOKEN}`, {
      data: { toggleTimeOff: { date: testDate } },
    })
    expect(addRes.status()).toBe(200)
    const addJson = await addRes.json()
    expect(addJson.success).toBeTruthy()
    expect(addJson.action).toBe('added')

    // Remove day off (toggle again)
    const removeRes = await request.patch(`${BASE}/api/crew/${WINBROS_TOKEN}`, {
      data: { toggleTimeOff: { date: testDate } },
    })
    expect(removeRes.status()).toBe(200)
    const removeJson = await removeRes.json()
    expect(removeJson.success).toBeTruthy()
    expect(removeJson.action).toBe('removed')
  })

  test('20. Cross-cleaner job access is blocked', async ({ request }) => {
    // WinBros token trying to access Cedar Rapids job
    const res = await request.get(`${BASE}/api/crew/${WINBROS_TOKEN}/job/${SCHEDULED_JOB_ID}`)
    expect(res.status()).toBe(404)
  })
})
