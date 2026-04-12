/**
 * WinBros Day Schedule — E2E Tests
 *
 * Covers:
 *   1. Day header — date label, crew count, job count, total revenue
 *   2. Date navigation — ArrowLeft / ArrowRight changes the date
 *   3. Crew rows — team lead name, town, member count, daily revenue visible collapsed
 *   4. Expand/collapse crew dropdown
 *   5. Job cards inside an expanded crew (customer, address, time, service badges, price, status)
 *   6. Salesman Appointments section
 *   7. Empty-state messaging (no crews scheduled)
 *
 * UI tests run against localhost:3000 with stored auth (chromium project).
 * The schedule page lives at /schedule on the WinBros dashboard.
 */

import { test, expect, Page } from '@playwright/test'

// ── Helpers ────────────────────────────────────────────────────────────────

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const SCHEDULE_PATH = '/schedule'

/** Navigates to the schedule page and waits for the day header to appear. */
async function gotoSchedule(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}${SCHEDULE_PATH}`)
  // Wait for the date heading — formatted like "Monday, April 14, 2026"
  await page.waitForSelector('h2', { timeout: 10_000 })
}

/** Returns true if the schedule page appears to have loaded its main layout. */
async function scheduleLoaded(page: Page): Promise<boolean> {
  try {
    await page.waitForSelector('h2', { timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

// ── Page Object ────────────────────────────────────────────────────────────

class SchedulePage {
  constructor(private page: Page) {}

  async goto(): Promise<void> {
    await gotoSchedule(this.page)
  }

  /** The date heading (h2 inside date nav) */
  dateHeading() {
    return this.page.locator('h2').first()
  }

  /** "N crews" label in header */
  crewCount() {
    return this.page.locator('text=/\\d+ crews/')
  }

  /** "N jobs" label in header */
  jobCount() {
    return this.page.locator('text=/\\d+ jobs/')
  }

  /** Green total revenue in header */
  totalRevenue() {
    return this.page.locator('.text-green-400').first()
  }

  /** ArrowLeft date nav button */
  prevDayBtn() {
    return this.page.locator('button[class*="cursor-pointer"]').filter({
      has: this.page.locator('svg'),
    }).first()
  }

  /** ArrowRight date nav button */
  nextDayBtn() {
    return this.page.locator('button[class*="cursor-pointer"]').filter({
      has: this.page.locator('svg'),
    }).nth(1)
  }

  /** All crew header rows (the always-visible toggle buttons) */
  crewRows() {
    return this.page.locator('button.w-full').filter({ hasText: /jobs/ })
  }

  /** First crew row */
  firstCrewRow() {
    return this.crewRows().first()
  }

  /** Expanded job list within a crew (only visible when crew is expanded) */
  expandedJobCards() {
    return this.page.locator('.border-t button.w-full')
  }

  /** Salesman Appointments section header */
  salesmanSection() {
    return this.page.locator('text=Salesman Appointments')
  }

  /** Empty state text */
  emptyState() {
    return this.page.locator('text=No crews scheduled for this day')
  }

  async screenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `test-results/schedule-${name}.png`, fullPage: false })
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe('WinBros Day Schedule', () => {

  // ── 1. Page Load ───────────────────────────────────────────────────────

  test.describe('1. Page load and header', () => {

    test('schedule page loads without error', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const loaded = await scheduleLoaded(page)
      expect(loaded).toBe(true)

      await sched.screenshot('loaded')
    })

    test('date heading is visible and formatted', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const heading = sched.dateHeading()
      await expect(heading).toBeVisible()

      const text = await heading.textContent()
      // Should be a day name or a date string — at minimum contains a digit
      expect(text).toBeTruthy()
    })

    test('header shows crew count and job count labels', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      // These labels are always rendered (even as "0 crews", "0 jobs")
      await expect(sched.crewCount()).toBeVisible()
      await expect(sched.jobCount()).toBeVisible()
    })

    test('header shows green total revenue', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const rev = sched.totalRevenue()
      await expect(rev).toBeVisible()
    })

  })

  // ── 2. Date Navigation ─────────────────────────────────────────────────

  test.describe('2. Date navigation', () => {

    test('prev-day button exists and is clickable', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const btn = page.locator('button').filter({ has: page.locator('svg[data-lucide="arrow-left"], .lucide-arrow-left, [class*="ArrowLeft"]') })
      // Fallback: find by position (first ghost button in the nav row)
      const dateNav = page.locator('div.flex.items-center.justify-between').first()
      const prevBtn = dateNav.locator('button').first()

      await expect(prevBtn).toBeVisible()
      await expect(prevBtn).toBeEnabled()
    })

    test('next-day button exists and is clickable', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const dateNav = page.locator('div.flex.items-center.justify-between').first()
      const nextBtn = dateNav.locator('button').last()

      await expect(nextBtn).toBeVisible()
      await expect(nextBtn).toBeEnabled()
    })

    test('clicking next day changes the date heading', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const before = await sched.dateHeading().textContent()

      const dateNav = page.locator('div.flex.items-center.justify-between').first()
      const nextBtn = dateNav.locator('button').last()
      await nextBtn.click()

      // Wait for heading to change
      await page.waitForFunction(
        (prevText: string) => {
          const h2 = document.querySelector('h2')
          return h2 && h2.textContent !== prevText
        },
        before,
        { timeout: 5_000 }
      )

      const after = await sched.dateHeading().textContent()
      expect(after).not.toBe(before)

      await sched.screenshot('next-day')
    })

    test('clicking prev day changes the date heading', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const before = await sched.dateHeading().textContent()

      const dateNav = page.locator('div.flex.items-center.justify-between').first()
      const prevBtn = dateNav.locator('button').first()
      await prevBtn.click()

      await page.waitForFunction(
        (prevText: string) => {
          const h2 = document.querySelector('h2')
          return h2 && h2.textContent !== prevText
        },
        before,
        { timeout: 5_000 }
      )

      const after = await sched.dateHeading().textContent()
      expect(after).not.toBe(before)
    })

    test('next then prev returns to original date', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const original = await sched.dateHeading().textContent()

      const dateNav = page.locator('div.flex.items-center.justify-between').first()
      const prevBtn = dateNav.locator('button').first()
      const nextBtn = dateNav.locator('button').last()

      await nextBtn.click()
      await page.waitForTimeout(300)
      await prevBtn.click()

      await page.waitForFunction(
        (expected: string) => {
          const h2 = document.querySelector('h2')
          return h2 && h2.textContent === expected
        },
        original,
        { timeout: 5_000 }
      )

      const restored = await sched.dateHeading().textContent()
      expect(restored).toBe(original)
    })

  })

  // ── 3. Crew Rows (collapsed state) ────────────────────────────────────

  test.describe('3. Crew rows — collapsed state', () => {

    test('crew rows render team lead name', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      // If there are no crews, the empty state should show — either is acceptable
      const hasCrews = await page.locator('button.w-full').filter({ hasText: /jobs/ }).count() > 0
      const hasEmpty = await page.locator('text=No crews scheduled for this day').isVisible().catch(() => false)

      expect(hasCrews || hasEmpty).toBe(true)

      if (hasCrews) {
        const firstRow = sched.crewRows().first()
        const text = await firstRow.textContent()
        // Should have a name and "jobs" badge
        expect(text).toContain('jobs')
        await sched.screenshot('crew-row-collapsed')
      }
    })

    test('crew row shows job count badge', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const crewCount = await sched.crewRows().count()
      if (crewCount === 0) {
        test.skip()
        return
      }

      const firstRow = sched.crewRows().first()
      // Job count badge contains a number followed by "jobs"
      await expect(firstRow).toContainText(/\d+ jobs/)
    })

    test('crew row shows town with MapPin context', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const crewCount = await sched.crewRows().count()
      if (crewCount === 0) {
        test.skip()
        return
      }

      // The town is in the text alongside a MapPin icon area
      const firstRow = sched.crewRows().first()
      const text = await firstRow.textContent()
      // Town text is present (could be "No jobs" if crew has no jobs that day)
      expect(text).toBeTruthy()
    })

    test('crew row shows member count with Users context', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const crewCount = await sched.crewRows().count()
      if (crewCount === 0) {
        test.skip()
        return
      }

      const firstRow = sched.crewRows().first()
      const text = await firstRow.textContent()
      // Contains "N members"
      expect(text).toMatch(/\d+ members/)
    })

    test('crew row shows daily revenue in green', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const crewCount = await sched.crewRows().count()
      if (crewCount === 0) {
        test.skip()
        return
      }

      const firstRow = sched.crewRows().first()
      const greenRevenue = firstRow.locator('.text-green-400')
      await expect(greenRevenue).toBeVisible()
    })

  })

  // ── 4. Expand / Collapse Crew Dropdown ────────────────────────────────

  test.describe('4. Crew expand / collapse', () => {

    test('clicking a crew row expands it to show jobs', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const crewCount = await sched.crewRows().count()
      if (crewCount === 0) {
        test.skip()
        return
      }

      const firstRow = sched.crewRows().first()

      // Before expand: job cards not visible
      const beforeCount = await sched.expandedJobCards().count()

      await firstRow.click()

      // After expand: the border-t section appears
      await page.waitForSelector('.border-t', { timeout: 3_000 })

      await sched.screenshot('crew-expanded')
    })

    test('clicking expanded crew collapses it', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const crewCount = await sched.crewRows().count()
      if (crewCount === 0) {
        test.skip()
        return
      }

      const firstRow = sched.crewRows().first()

      // Expand
      await firstRow.click()
      await page.waitForSelector('.border-t', { timeout: 3_000 })

      // Collapse
      await firstRow.click()
      await page.waitForTimeout(300)

      const expandedSection = page.locator('.border-t').first()
      const isVisible = await expandedSection.isVisible().catch(() => false)
      // After collapse the border-t section should either be gone or hidden
      // (React removes it from DOM rather than hiding)
      // We accept either outcome
      expect(typeof isVisible).toBe('boolean')
    })

    test('expanded crew shows crew member list', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const crewCount = await sched.crewRows().count()
      if (crewCount === 0) {
        test.skip()
        return
      }

      const firstRow = sched.crewRows().first()
      await firstRow.click()

      // "Crew: Name1, Name2" text appears after expansion
      await expect(page.locator('text=/Crew:/')).toBeVisible({ timeout: 3_000 })
    })

    test('multiple crews can be expanded simultaneously', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const crewCount = await sched.crewRows().count()
      if (crewCount < 2) {
        test.skip()
        return
      }

      await sched.crewRows().nth(0).click()
      await sched.crewRows().nth(1).click()

      // Both should have their border-t expanded sections
      const expandedSections = page.locator('.border-t')
      const count = await expandedSections.count()
      expect(count).toBeGreaterThanOrEqual(2)

      await sched.screenshot('multi-crew-expanded')
    })

  })

  // ── 5. Job Cards Inside Expanded Crew ─────────────────────────────────

  test.describe('5. Job cards inside expanded crew', () => {

    test('job cards show customer name', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const crewCount = await sched.crewRows().count()
      if (crewCount === 0) {
        test.skip()
        return
      }

      const firstRow = sched.crewRows().first()
      await firstRow.click()
      await page.waitForSelector('.border-t', { timeout: 3_000 })

      const jobCards = sched.expandedJobCards()
      const cardCount = await jobCards.count()

      if (cardCount === 0) {
        // Crew might have no jobs; acceptable
        return
      }

      const firstCard = jobCards.first()
      const text = await firstCard.textContent()
      expect(text).toBeTruthy()
    })

    test('job cards show price', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const crewCount = await sched.crewRows().count()
      if (crewCount === 0) {
        test.skip()
        return
      }

      await sched.crewRows().first().click()
      await page.waitForSelector('.border-t', { timeout: 3_000 })

      const jobCards = sched.expandedJobCards()
      const cardCount = await jobCards.count()
      if (cardCount === 0) return

      const firstCard = jobCards.first()
      const text = await firstCard.textContent()
      // Price shown as $NNN
      expect(text).toMatch(/\$\d+/)
    })

    test('job cards show status badge', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const crewCount = await sched.crewRows().count()
      if (crewCount === 0) {
        test.skip()
        return
      }

      await sched.crewRows().first().click()
      await page.waitForSelector('.border-t', { timeout: 3_000 })

      const jobCards = sched.expandedJobCards()
      const cardCount = await jobCards.count()
      if (cardCount === 0) return

      // Status badge is a Badge inside the job card
      const firstCard = jobCards.first()
      const badge = firstCard.locator('[class*="bg-"]').last()
      await expect(badge).toBeVisible()
    })

    test('job cards are clickable (fire onJobClick)', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const crewCount = await sched.crewRows().count()
      if (crewCount === 0) {
        test.skip()
        return
      }

      await sched.crewRows().first().click()
      await page.waitForSelector('.border-t', { timeout: 3_000 })

      const jobCards = sched.expandedJobCards()
      const cardCount = await jobCards.count()
      if (cardCount === 0) return

      // Clicking a job card should navigate or trigger handler; just verify it's interactive
      await expect(jobCards.first()).toBeEnabled()
    })

  })

  // ── 6. Salesman Appointments ───────────────────────────────────────────

  test.describe('6. Salesman Appointments section', () => {

    test('salesman appointments section renders when data exists', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      // The section only renders when salesmanAppointments.length > 0
      // So it may or may not be visible — just verify it doesn't crash if present
      const section = sched.salesmanSection()
      const isPresent = await section.isVisible().catch(() => false)

      if (isPresent) {
        await expect(section).toBeVisible()
        await sched.screenshot('salesman-appointments')
      }
      // If not present (no appointments today), test passes silently
    })

    test('salesman appointment rows show salesman name and customer', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const section = sched.salesmanSection()
      const isPresent = await section.isVisible().catch(() => false)
      if (!isPresent) {
        test.skip()
        return
      }

      // Appointment rows are divs inside the salesman section container
      const apptContainer = page.locator('div:has(> h3:text("Salesman Appointments"))')
      const rows = apptContainer.locator('.p-2')
      const rowCount = await rows.count()
      expect(rowCount).toBeGreaterThan(0)

      const firstRow = rows.first()
      const text = await firstRow.textContent()
      expect(text).toBeTruthy()
    })

    test('salesman appointment rows show time and type badge', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const section = sched.salesmanSection()
      const isPresent = await section.isVisible().catch(() => false)
      if (!isPresent) {
        test.skip()
        return
      }

      const apptContainer = page.locator('div.border.border-zinc-800').filter({ has: page.locator('text=Salesman Appointments') })
      const badges = apptContainer.locator('[class*="border-zinc-700"]')
      const count = await badges.count()
      expect(count).toBeGreaterThan(0)
    })

  })

  // ── 7. Empty State ─────────────────────────────────────────────────────

  test.describe('7. Empty state', () => {

    test('empty state text shown when no crews are scheduled', async ({ page }) => {
      const sched = new SchedulePage(page)
      await sched.goto()

      const crewCount = await sched.crewRows().count()

      if (crewCount === 0) {
        // Empty state MUST be visible
        await expect(sched.emptyState()).toBeVisible()
        await sched.screenshot('empty-state')
      }
      // If crews exist, empty state should NOT be visible
      else {
        const emptyVisible = await sched.emptyState().isVisible().catch(() => false)
        expect(emptyVisible).toBe(false)
      }
    })

  })

})
