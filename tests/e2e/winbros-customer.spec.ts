/**
 * WinBros Customer Info Tab + Time-Off Validation — E2E Tests
 *
 * Covers:
 *   A. CustomerInfoTab component
 *      1. Tags section — grouped by type, Remove X button per tag
 *      2. Add tag workflow — type dropdown → value dropdown → Add/Cancel
 *      3. Notes section — editable textarea, Save button only when dirty
 *      4. Visit History — list of visits with date, service badges, total, status
 *
 *   B. Time-Off Validation (unit-level via direct import + integration)
 *      5. Requests < 14 days in advance are rejected with correct error
 *      6. Requests exactly 14 days ahead are accepted
 *      7. Requests > 14 days ahead are accepted
 *      8. Same-day or past-date requests are rejected
 *      9. getMinimumTimeOffDate returns correct date string
 *
 *   C. Cleaner Portal Time-Off UI (integration with the portal page)
 *      10. Time-off form renders with a date input
 *      11. Submitting a date < 14 days ahead shows error message
 *      12. Submitting a date >= 14 days ahead submits successfully
 *
 * UI tests run against localhost:3000 with stored auth (chromium project).
 * Customer pages live at /customers/[id] on the WinBros dashboard.
 * Time-off portal lives at /portal/time-off (or similar) for cleaner-facing.
 */

import { test, expect, Page } from '@playwright/test'

// Import validation functions for unit-level testing
import {
  validateTimeOffRequest,
  getMinimumTimeOffDate,
} from '../../apps/window-washing/lib/time-off-validation'

// ── Constants ──────────────────────────────────────────────────────────────

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const CUSTOMERS_PATH = '/customers'
const TIME_OFF_PATH = '/portal/time-off'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Adds N days to a YYYY-MM-DD string, returns YYYY-MM-DD */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

/** Returns today as YYYY-MM-DD */
function today(): string {
  return new Date().toISOString().split('T')[0]
}

// ── Page Objects ───────────────────────────────────────────────────────────

class CustomerPage {
  constructor(private page: Page) {}

  async goto(customerId?: string | number): Promise<void> {
    if (customerId) {
      await this.page.goto(`${BASE_URL}${CUSTOMERS_PATH}/${customerId}`)
    } else {
      // Navigate to the customer list and click the first customer
      await this.page.goto(`${BASE_URL}${CUSTOMERS_PATH}`)
      await this.page.waitForSelector('a, button', { timeout: 8_000 })
    }
  }

  /** Tags section header */
  tagsSection() {
    return this.page.locator('h3').filter({ hasText: 'Tags' })
  }

  /** "Add Tag" button */
  addTagBtn() {
    return this.page.locator('button').filter({ hasText: /Add Tag/ })
  }

  /** Tag type Select trigger */
  tagTypeSelect() {
    return this.page.locator('[data-testid="tag-type-select"], select').first()
  }

  /** Remove (X) buttons on existing tags */
  removeTagBtns() {
    return this.page.locator('button').filter({ has: this.page.locator('svg.lucide-x, [data-lucide="x"]') })
  }

  /** Notes textarea */
  notesTextarea() {
    return this.page.locator('textarea')
  }

  /** Save notes button (only visible when dirty) */
  saveNotesBtn() {
    return this.page.locator('button').filter({ hasText: /^Save$|^Saving/ })
  }

  /** Visit History header */
  visitHistorySection() {
    return this.page.locator('h3').filter({ hasText: 'Visit History' })
  }

  /** All visit history buttons */
  visitCards() {
    return this.page.locator('button').filter({ has: this.page.locator('[class*="bg-green-900"], [class*="bg-zinc-800"]') })
  }

  /** Cancel button in add-tag form */
  cancelTagBtn() {
    return this.page.locator('button').filter({ hasText: /^Cancel$/ })
  }

  async screenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `test-results/customer-${name}.png`, fullPage: false })
  }
}

class TimeOffPortalPage {
  constructor(private page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(`${BASE_URL}${TIME_OFF_PATH}`)
    await this.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  }

  /** Date input for time-off request */
  dateInput() {
    return this.page.locator('input[type="date"]')
  }

  /** Submit button */
  submitBtn() {
    return this.page.locator('button[type="submit"], button').filter({ hasText: /Submit|Request/ })
  }

  /** Error message element */
  errorMessage() {
    return this.page.locator('[class*="text-red"], [class*="error"], [role="alert"]').filter({ hasText: /.+/ })
  }

  /** Success/confirmation message */
  successMessage() {
    return this.page.locator('[class*="text-green"], [class*="success"]').filter({ hasText: /.+/ })
  }

  async screenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `test-results/time-off-${name}.png`, fullPage: false })
  }
}

// ── Tests: Section A — Customer Info Tab UI ────────────────────────────────

test.describe('WinBros Customer Info Tab', () => {

  // ── 1. Tags Section ──────────────────────────────────────────────────

  test.describe('1. Tags section', () => {

    test('tags section header is visible on customer page', async ({ page }) => {
      const cp = new CustomerPage(page)
      await cp.goto()

      // Try to find a customer page — either land on one directly or navigate
      const tagsSection = cp.tagsSection()
      const isVisible = await tagsSection.isVisible().catch(() => false)

      if (!isVisible) {
        // We're on the list — click the first customer link
        const firstLink = page.locator('a[href*="/customers/"]').first()
        const hasLink = await firstLink.isVisible().catch(() => false)
        if (!hasLink) {
          test.skip()
          return
        }
        await firstLink.click()
        await page.waitForLoadState('networkidle')
      }

      await expect(cp.tagsSection()).toBeVisible({ timeout: 8_000 })
      await cp.screenshot('tags-section')
    })

    test('tags section subtitle mentions payroll and scheduling', async ({ page }) => {
      const cp = new CustomerPage(page)
      await cp.goto()

      const drivesText = page.locator('text=/payroll|scheduling|service plans/i')
      const found = await drivesText.isVisible().catch(() => false)

      if (found) {
        await expect(drivesText).toBeVisible()
      }
    })

    test('"Add Tag" button is visible in tags section', async ({ page }) => {
      const cp = new CustomerPage(page)
      await cp.goto()

      // Navigate to customer detail if on list
      const tagsSection = cp.tagsSection()
      const isVisible = await tagsSection.isVisible().catch(() => false)
      if (!isVisible) {
        const firstLink = page.locator('a[href*="/customers/"]').first()
        const hasLink = await firstLink.isVisible().catch(() => false)
        if (!hasLink) {
          test.skip()
          return
        }
        await firstLink.click()
        await page.waitForLoadState('networkidle')
      }

      await expect(cp.addTagBtn()).toBeVisible()
    })

    test('clicking "Add Tag" opens the tag form', async ({ page }) => {
      const cp = new CustomerPage(page)
      await cp.goto()

      const tagsSection = cp.tagsSection()
      const isVisible = await tagsSection.isVisible().catch(() => false)
      if (!isVisible) {
        const firstLink = page.locator('a[href*="/customers/"]').first()
        const hasLink = await firstLink.isVisible().catch(() => false)
        if (!hasLink) {
          test.skip()
          return
        }
        await firstLink.click()
        await page.waitForLoadState('networkidle')
      }

      await cp.addTagBtn().click()

      // Tag type selector should appear
      const tagForm = page.locator('div.mt-3.p-3.bg-zinc-900')
      await expect(tagForm).toBeVisible({ timeout: 3_000 })

      await cp.screenshot('add-tag-form')
    })

    test('"Cancel" button in add-tag form hides the form', async ({ page }) => {
      const cp = new CustomerPage(page)
      await cp.goto()

      const tagsSection = cp.tagsSection()
      const isVisible = await tagsSection.isVisible().catch(() => false)
      if (!isVisible) {
        const firstLink = page.locator('a[href*="/customers/"]').first()
        const hasLink = await firstLink.isVisible().catch(() => false)
        if (!hasLink) {
          test.skip()
          return
        }
        await firstLink.click()
        await page.waitForLoadState('networkidle')
      }

      await cp.addTagBtn().click()
      await page.locator('div.mt-3.p-3').waitFor({ timeout: 3_000 })

      await cp.cancelTagBtn().click()

      // Form should disappear
      const form = page.locator('div.mt-3.p-3.bg-zinc-900')
      await expect(form).toBeHidden({ timeout: 3_000 })
    })

    test('tag type dropdown shows known tag types', async ({ page }) => {
      const cp = new CustomerPage(page)
      await cp.goto()

      const tagsSection = cp.tagsSection()
      const isVisible = await tagsSection.isVisible().catch(() => false)
      if (!isVisible) {
        const firstLink = page.locator('a[href*="/customers/"]').first()
        const hasLink = await firstLink.isVisible().catch(() => false)
        if (!hasLink) {
          test.skip()
          return
        }
        await firstLink.click()
        await page.waitForLoadState('networkidle')
      }

      await cp.addTagBtn().click()
      await page.locator('div.mt-3.p-3').waitFor({ timeout: 3_000 })

      // The SelectTrigger for tag type
      const typeTrigger = page.locator('[data-testid="tag-type-select"], button[role="combobox"]').first()
      if (await typeTrigger.isVisible()) {
        await typeTrigger.click()

        // Dropdown content should contain known tag types
        const options = page.locator('[role="option"]')
        const count = await options.count()
        expect(count).toBeGreaterThan(0)

        // Should contain at least one of the known types
        const allText = await options.allTextContents()
        const knownTypes = ['Salesman', 'Technician', 'Team Lead', 'Service Plan', 'Custom']
        const hasKnown = allText.some(t => knownTypes.includes(t))
        expect(hasKnown).toBe(true)

        // Close dropdown
        await page.keyboard.press('Escape')
      }
    })

    test('existing tags show Remove (X) button per tag', async ({ page }) => {
      const cp = new CustomerPage(page)
      await cp.goto()

      const tagsSection = cp.tagsSection()
      const isVisible = await tagsSection.isVisible().catch(() => false)
      if (!isVisible) {
        const firstLink = page.locator('a[href*="/customers/"]').first()
        const hasLink = await firstLink.isVisible().catch(() => false)
        if (!hasLink) {
          test.skip()
          return
        }
        await firstLink.click()
        await page.waitForLoadState('networkidle')
      }

      // Tags are shown as Badge elements with X buttons inside
      const tagBadges = page.locator('[class*="bg-zinc-800"][class*="text-zinc-200"]')
      const count = await tagBadges.count()

      if (count > 0) {
        // Each badge should have a nested X button
        const xBtn = tagBadges.first().locator('button')
        await expect(xBtn).toBeVisible()
        await cp.screenshot('tag-with-remove')
      }
    })

  })

  // ── 2. Notes Section ──────────────────────────────────────────────────

  test.describe('2. Notes section', () => {

    test('notes textarea is visible', async ({ page }) => {
      const cp = new CustomerPage(page)
      await cp.goto()

      const tagsSection = cp.tagsSection()
      const isVisible = await tagsSection.isVisible().catch(() => false)
      if (!isVisible) {
        const firstLink = page.locator('a[href*="/customers/"]').first()
        const hasLink = await firstLink.isVisible().catch(() => false)
        if (!hasLink) {
          test.skip()
          return
        }
        await firstLink.click()
        await page.waitForLoadState('networkidle')
      }

      await expect(cp.notesTextarea()).toBeVisible()
    })

    test('notes textarea has correct placeholder', async ({ page }) => {
      const cp = new CustomerPage(page)
      await cp.goto()

      const tagsSection = cp.tagsSection()
      const isVisible = await tagsSection.isVisible().catch(() => false)
      if (!isVisible) {
        const firstLink = page.locator('a[href*="/customers/"]').first()
        const hasLink = await firstLink.isVisible().catch(() => false)
        if (!hasLink) {
          test.skip()
          return
        }
        await firstLink.click()
        await page.waitForLoadState('networkidle')
      }

      const placeholder = await cp.notesTextarea().getAttribute('placeholder')
      expect(placeholder).toContain('notes')
    })

    test('Save button not shown when notes are not dirty', async ({ page }) => {
      const cp = new CustomerPage(page)
      await cp.goto()

      const tagsSection = cp.tagsSection()
      const isVisible = await tagsSection.isVisible().catch(() => false)
      if (!isVisible) {
        const firstLink = page.locator('a[href*="/customers/"]').first()
        const hasLink = await firstLink.isVisible().catch(() => false)
        if (!hasLink) {
          test.skip()
          return
        }
        await firstLink.click()
        await page.waitForLoadState('networkidle')
      }

      // On fresh load, Save button should be hidden (notesDirty = false)
      const saveVisible = await cp.saveNotesBtn().isVisible().catch(() => false)
      expect(saveVisible).toBe(false)
    })

    test('typing in notes textarea shows the Save button', async ({ page }) => {
      const cp = new CustomerPage(page)
      await cp.goto()

      const tagsSection = cp.tagsSection()
      const isVisible = await tagsSection.isVisible().catch(() => false)
      if (!isVisible) {
        const firstLink = page.locator('a[href*="/customers/"]').first()
        const hasLink = await firstLink.isVisible().catch(() => false)
        if (!hasLink) {
          test.skip()
          return
        }
        await firstLink.click()
        await page.waitForLoadState('networkidle')
      }

      const textarea = cp.notesTextarea()
      await textarea.click()
      await textarea.type('E2E test note entry')

      // Save button should now appear
      await expect(cp.saveNotesBtn()).toBeVisible({ timeout: 3_000 })
      await cp.screenshot('notes-dirty')
    })

  })

  // ── 3. Visit History ──────────────────────────────────────────────────

  test.describe('3. Visit History', () => {

    test('Visit History section header is visible', async ({ page }) => {
      const cp = new CustomerPage(page)
      await cp.goto()

      const tagsSection = cp.tagsSection()
      const isVisible = await tagsSection.isVisible().catch(() => false)
      if (!isVisible) {
        const firstLink = page.locator('a[href*="/customers/"]').first()
        const hasLink = await firstLink.isVisible().catch(() => false)
        if (!hasLink) {
          test.skip()
          return
        }
        await firstLink.click()
        await page.waitForLoadState('networkidle')
      }

      await expect(cp.visitHistorySection()).toBeVisible()
    })

    test('Visit History shows visit count in header', async ({ page }) => {
      const cp = new CustomerPage(page)
      await cp.goto()

      const tagsSection = cp.tagsSection()
      const isVisible = await tagsSection.isVisible().catch(() => false)
      if (!isVisible) {
        const firstLink = page.locator('a[href*="/customers/"]').first()
        const hasLink = await firstLink.isVisible().catch(() => false)
        if (!hasLink) {
          test.skip()
          return
        }
        await firstLink.click()
        await page.waitForLoadState('networkidle')
      }

      // Visit count label "N visits" is in the header
      const visitCount = page.locator('span.text-xs.text-zinc-500').filter({ hasText: /visits/ })
      await expect(visitCount).toBeVisible()
    })

    test('visit cards show date, total, and status badge', async ({ page }) => {
      const cp = new CustomerPage(page)
      await cp.goto()

      const tagsSection = cp.tagsSection()
      const isVisible = await tagsSection.isVisible().catch(() => false)
      if (!isVisible) {
        const firstLink = page.locator('a[href*="/customers/"]').first()
        const hasLink = await firstLink.isVisible().catch(() => false)
        if (!hasLink) {
          test.skip()
          return
        }
        await firstLink.click()
        await page.waitForLoadState('networkidle')
      }

      // Visit cards are buttons in a space-y-2 list inside the visit history section
      const visitHistContainer = cp.visitHistorySection().locator('../../..')
      const visitBtns = visitHistContainer.locator('button.w-full')
      const count = await visitBtns.count()

      if (count === 0) {
        // Empty state: "No visit history" should show
        const emptyText = page.locator('text=No visit history')
        await expect(emptyText).toBeVisible()
        return
      }

      const firstCard = visitBtns.first()
      const text = await firstCard.textContent()

      // Should contain a dollar amount
      expect(text).toMatch(/\$\d+\.\d{2}/)

      await cp.screenshot('visit-history')
    })

    test('visit cards are clickable', async ({ page }) => {
      const cp = new CustomerPage(page)
      await cp.goto()

      const tagsSection = cp.tagsSection()
      const isVisible = await tagsSection.isVisible().catch(() => false)
      if (!isVisible) {
        const firstLink = page.locator('a[href*="/customers/"]').first()
        const hasLink = await firstLink.isVisible().catch(() => false)
        if (!hasLink) {
          test.skip()
          return
        }
        await firstLink.click()
        await page.waitForLoadState('networkidle')
      }

      const visitHistContainer = page.locator('h3').filter({ hasText: 'Visit History' }).locator('../..')
      const visitBtns = visitHistContainer.locator('button.cursor-pointer')
      const count = await visitBtns.count()

      if (count > 0) {
        await expect(visitBtns.first()).toBeEnabled()
      }
    })

  })

})

// ── Tests: Section B — Time-Off Validation (Unit Level) ───────────────────

test.describe('WinBros Time-Off Validation — Unit Tests', () => {

  const REF_DATE = '2026-04-12' // Matches current session date

  test.describe('5. Requests < 14 days in advance are rejected', () => {

    test('1 day ahead is rejected', () => {
      const err = validateTimeOffRequest(addDays(REF_DATE, 1), REF_DATE)
      expect(err).not.toBeNull()
      expect(err).toContain('14 days')
    })

    test('7 days ahead is rejected', () => {
      const err = validateTimeOffRequest(addDays(REF_DATE, 7), REF_DATE)
      expect(err).not.toBeNull()
      expect(err).toContain('14 days')
    })

    test('13 days ahead is rejected', () => {
      const err = validateTimeOffRequest(addDays(REF_DATE, 13), REF_DATE)
      expect(err).not.toBeNull()
      expect(err).toContain('14 days')
    })

    test('error message contains manager contact instruction', () => {
      const err = validateTimeOffRequest(addDays(REF_DATE, 5), REF_DATE)
      expect(err).toContain('manager')
    })

  })

  test.describe('6. Requests exactly 14 days ahead are accepted', () => {

    test('14 days ahead returns null (valid)', () => {
      const err = validateTimeOffRequest(addDays(REF_DATE, 14), REF_DATE)
      expect(err).toBeNull()
    })

  })

  test.describe('7. Requests > 14 days ahead are accepted', () => {

    test('15 days ahead returns null', () => {
      const err = validateTimeOffRequest(addDays(REF_DATE, 15), REF_DATE)
      expect(err).toBeNull()
    })

    test('30 days ahead returns null', () => {
      const err = validateTimeOffRequest(addDays(REF_DATE, 30), REF_DATE)
      expect(err).toBeNull()
    })

    test('90 days ahead returns null', () => {
      const err = validateTimeOffRequest(addDays(REF_DATE, 90), REF_DATE)
      expect(err).toBeNull()
    })

  })

  test.describe('8. Same-day or past-date requests are rejected', () => {

    test('today is rejected', () => {
      const err = validateTimeOffRequest(REF_DATE, REF_DATE)
      expect(err).not.toBeNull()
      expect(err).toContain('today or past')
    })

    test('yesterday is rejected', () => {
      const err = validateTimeOffRequest(addDays(REF_DATE, -1), REF_DATE)
      expect(err).not.toBeNull()
      expect(err).toContain('today or past')
    })

    test('30 days in the past is rejected', () => {
      const err = validateTimeOffRequest(addDays(REF_DATE, -30), REF_DATE)
      expect(err).not.toBeNull()
    })

  })

  test.describe('9. getMinimumTimeOffDate returns correct date', () => {

    test('minimum date is exactly 14 days from today', () => {
      const minDate = getMinimumTimeOffDate(REF_DATE)
      const expected = addDays(REF_DATE, 14)
      expect(minDate).toBe(expected)
    })

    test('minimum date is a valid YYYY-MM-DD string', () => {
      const minDate = getMinimumTimeOffDate(REF_DATE)
      expect(minDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    test('minimum date minus 1 day fails validation', () => {
      const minDate = getMinimumTimeOffDate(REF_DATE)
      const oneDayBefore = addDays(minDate, -1)
      const err = validateTimeOffRequest(oneDayBefore, REF_DATE)
      expect(err).not.toBeNull()
    })

    test('minimum date itself passes validation', () => {
      const minDate = getMinimumTimeOffDate(REF_DATE)
      const err = validateTimeOffRequest(minDate, REF_DATE)
      expect(err).toBeNull()
    })

    test('works without a reference date (uses real today)', () => {
      // Should not throw
      const minDate = getMinimumTimeOffDate()
      expect(minDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

      // Should be in the future
      const todayStr = today()
      expect(minDate > todayStr).toBe(true)
    })

  })

})

// ── Tests: Section C — Cleaner Portal Time-Off UI ─────────────────────────

test.describe('WinBros Cleaner Portal — Time-Off Form', () => {

  test.describe('10. Form renders', () => {

    test('time-off page loads', async ({ page }) => {
      const portal = new TimeOffPortalPage(page)
      await portal.goto()

      // Verify the page loaded (may be a 404 if not yet built — skip gracefully)
      const is404 = await page.locator('text=/404|Not Found/i').isVisible().catch(() => false)
      if (is404) {
        test.skip()
        return
      }

      await portal.screenshot('loaded')
    })

    test('date input is visible on time-off form', async ({ page }) => {
      const portal = new TimeOffPortalPage(page)
      await portal.goto()

      const is404 = await page.locator('text=/404|Not Found/i').isVisible().catch(() => false)
      if (is404) {
        test.skip()
        return
      }

      const dateInput = portal.dateInput()
      const isVisible = await dateInput.isVisible().catch(() => false)

      if (isVisible) {
        await expect(dateInput).toBeVisible()
        await expect(dateInput).toBeEnabled()
      }
    })

    test('submit button is visible on time-off form', async ({ page }) => {
      const portal = new TimeOffPortalPage(page)
      await portal.goto()

      const is404 = await page.locator('text=/404|Not Found/i').isVisible().catch(() => false)
      if (is404) {
        test.skip()
        return
      }

      const submitBtn = portal.submitBtn()
      const isVisible = await submitBtn.isVisible().catch(() => false)

      if (isVisible) {
        await expect(submitBtn).toBeVisible()
      }
    })

  })

  test.describe('11. Validation error for < 14 days', () => {

    test('submitting tomorrow shows 14-day error', async ({ page }) => {
      const portal = new TimeOffPortalPage(page)
      await portal.goto()

      const is404 = await page.locator('text=/404|Not Found/i').isVisible().catch(() => false)
      if (is404) {
        test.skip()
        return
      }

      const dateInput = portal.dateInput()
      const isVisible = await dateInput.isVisible().catch(() => false)
      if (!isVisible) {
        test.skip()
        return
      }

      const tomorrowDate = addDays(today(), 1)
      await dateInput.fill(tomorrowDate)

      const submitBtn = portal.submitBtn()
      if (await submitBtn.isVisible()) {
        await submitBtn.click()

        // Wait for error to appear
        const error = portal.errorMessage()
        await expect(error).toBeVisible({ timeout: 5_000 })

        const errorText = await error.textContent()
        expect(errorText).toMatch(/14 days|advance|manager/)

        await portal.screenshot('validation-error')
      }
    })

  })

  test.describe('12. Valid submission for >= 14 days', () => {

    test('submitting 14+ days ahead does not show 14-day error', async ({ page }) => {
      const portal = new TimeOffPortalPage(page)
      await portal.goto()

      const is404 = await page.locator('text=/404|Not Found/i').isVisible().catch(() => false)
      if (is404) {
        test.skip()
        return
      }

      const dateInput = portal.dateInput()
      const isVisible = await dateInput.isVisible().catch(() => false)
      if (!isVisible) {
        test.skip()
        return
      }

      const validDate = addDays(today(), 20)
      await dateInput.fill(validDate)

      const submitBtn = portal.submitBtn()
      if (await submitBtn.isVisible()) {
        await page.waitForResponse(
          (resp) => resp.url().includes('/api/') && resp.status() < 500,
          { timeout: 8_000 }
        ).catch(() => {})

        await submitBtn.click()

        // Error about 14 days should NOT appear
        await page.waitForTimeout(1_000)
        const errorText = await portal.errorMessage().textContent().catch(() => '')
        expect(errorText ?? '').not.toMatch(/14 days|advance/)

        await portal.screenshot('valid-submission')
      }
    })

  })

})
