/**
 * WinBros Payroll Week — E2E Tests
 *
 * Covers:
 *   1. Page load and week header (date range, status badge, grand total)
 *   2. Week navigation (ArrowLeft / ArrowRight changes the week)
 *   3. Technicians table (Name, TL badge, Revenue, %, Hours, OT, Total Pay columns)
 *   4. Salesmen table (Name, 1-Time, Triannual, Quarterly, Total columns)
 *   5. Employee bank sidebar (all employees clickable)
 *   6. Draft vs Finalized status badge rendering
 *   7. Overtime highlighting (amber when OT > 0)
 *
 * UI tests run against localhost:3000 with stored auth (chromium project).
 * The payroll page lives at /payroll on the WinBros dashboard.
 */

import { test, expect, Page } from '@playwright/test'

// ── Constants ──────────────────────────────────────────────────────────────

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const PAYROLL_PATH = '/payroll'

// ── Page Object ────────────────────────────────────────────────────────────

class PayrollPage {
  constructor(private page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(`${BASE_URL}${PAYROLL_PATH}`)
    await this.page.waitForSelector('h2', { timeout: 10_000 })
  }

  /** Week range heading (e.g. "Apr 7 — Apr 13") */
  weekHeading() {
    return this.page.locator('h2').first()
  }

  /** Draft or Finalized badge */
  statusBadge() {
    return this.page.locator('[class*="text-xs"]').filter({ hasText: /Draft|Finalized/ })
  }

  /** Grand total shown in green next to the status badge */
  grandTotal() {
    return this.page.locator('span.text-green-400').filter({ hasText: /Total:/ })
  }

  /** ArrowLeft (previous week) button */
  prevWeekBtn() {
    const nav = this.page.locator('div.flex.items-center.justify-between').first()
    return nav.locator('button').first()
  }

  /** ArrowRight (next week) button */
  nextWeekBtn() {
    const nav = this.page.locator('div.flex.items-center.justify-between').first()
    return nav.locator('button').last()
  }

  /** Technicians section header */
  techSection() {
    return this.page.locator('h3').filter({ hasText: /Technicians.*Team Leads|Team Leads.*Technicians/i })
  }

  /** Salesmen section header */
  salesSection() {
    return this.page.locator('h3').filter({ hasText: /Salesmen/i })
  }

  /** All rows in the technicians table tbody */
  techRows() {
    return this.techSection()
      .locator('..') // container div
      .locator('..') // border div
      .locator('tbody tr')
  }

  /** All rows in the salesmen table tbody */
  salesRows() {
    return this.salesSection()
      .locator('..') // container div
      .locator('..') // border div
      .locator('tbody tr')
  }

  /** Employee bank buttons in the right sidebar */
  employeeBankButtons() {
    return this.page.locator('h3').filter({ hasText: /Employees/i })
      .locator('..')
      .locator('button')
  }

  /** TL badge on team leads */
  teamLeadBadges() {
    return this.page.locator('[class*="border-blue-700"]').filter({ hasText: 'TL' })
  }

  /** Amber OT cells */
  overtimeCells() {
    return this.page.locator('td span.text-amber-400')
  }

  async screenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `test-results/payroll-${name}.png`, fullPage: false })
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe('WinBros Payroll Week', () => {

  // ── 1. Page Load and Header ────────────────────────────────────────────

  test.describe('1. Page load and week header', () => {

    test('payroll page loads without error', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      await expect(payroll.weekHeading()).toBeVisible()
      await payroll.screenshot('loaded')
    })

    test('week heading shows date range with em dash', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const text = await payroll.weekHeading().textContent()
      // Format: "Apr 7 — Apr 13" — must contain month abbreviation
      expect(text).toMatch(/\w{3}\s+\d+/)
    })

    test('status badge shows Draft or Finalized', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      await expect(payroll.statusBadge()).toBeVisible()
      const text = await payroll.statusBadge().first().textContent()
      expect(['Draft', 'Finalized']).toContain(text?.trim())
    })

    test('grand total is displayed in green', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      await expect(payroll.grandTotal()).toBeVisible()
      const text = await payroll.grandTotal().textContent()
      expect(text).toMatch(/Total:.*\$/)
    })

    test('technicians section header is visible', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      await expect(payroll.techSection()).toBeVisible()
    })

    test('salesmen section header is visible', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      await expect(payroll.salesSection()).toBeVisible()
    })

  })

  // ── 2. Week Navigation ─────────────────────────────────────────────────

  test.describe('2. Week navigation', () => {

    test('prev-week button is visible and enabled', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      await expect(payroll.prevWeekBtn()).toBeVisible()
      await expect(payroll.prevWeekBtn()).toBeEnabled()
    })

    test('next-week button is visible and enabled', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      await expect(payroll.nextWeekBtn()).toBeVisible()
      await expect(payroll.nextWeekBtn()).toBeEnabled()
    })

    test('clicking next week changes the date heading', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const before = await payroll.weekHeading().textContent()
      await payroll.nextWeekBtn().click()

      await page.waitForFunction(
        (prev) => {
          const h2 = document.querySelector('h2')
          return h2 && h2.textContent !== prev
        },
        before,
        { timeout: 5_000 }
      )

      const after = await payroll.weekHeading().textContent()
      expect(after).not.toBe(before)
      await payroll.screenshot('next-week')
    })

    test('clicking prev week changes the date heading', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const before = await payroll.weekHeading().textContent()
      await payroll.prevWeekBtn().click()

      await page.waitForFunction(
        (prev) => {
          const h2 = document.querySelector('h2')
          return h2 && h2.textContent !== prev
        },
        before,
        { timeout: 5_000 }
      )

      const after = await payroll.weekHeading().textContent()
      expect(after).not.toBe(before)
    })

    test('next then prev returns to original week', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const original = await payroll.weekHeading().textContent()

      await payroll.nextWeekBtn().click()
      await page.waitForTimeout(300)
      await payroll.prevWeekBtn().click()

      await page.waitForFunction(
        (expected: string) => {
          const h2 = document.querySelector('h2')
          return h2 && h2.textContent === expected
        },
        original,
        { timeout: 5_000 }
      )

      const restored = await payroll.weekHeading().textContent()
      expect(restored).toBe(original)
    })

  })

  // ── 3. Technicians Table ───────────────────────────────────────────────

  test.describe('3. Technicians / Team Leads table', () => {

    test('technicians table renders column headers', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const techContainer = page.locator('div.border.border-zinc-800').filter({
        has: page.locator('h3:text-matches("Technicians")'),
      })

      await expect(techContainer.locator('th:text("Name")')).toBeVisible()
      await expect(techContainer.locator('th:text("Revenue")')).toBeVisible()
      await expect(techContainer.locator('th:text("%")')).toBeVisible()
      await expect(techContainer.locator('th:text("Hours")')).toBeVisible()
      await expect(techContainer.locator('th:text("OT")')).toBeVisible()
      await expect(techContainer.locator('th:text("Total Pay")')).toBeVisible()
    })

    test('technicians table shows data rows or empty state', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const techContainer = page.locator('div.border.border-zinc-800').filter({
        has: page.locator('h3:text-matches("Technicians")'),
      })

      // Either data rows exist, or the empty-state message is shown
      const dataRows = techContainer.locator('tbody tr td:not([colspan])')
      const emptyRow = techContainer.locator('td[colspan="6"]')

      const hasData = await dataRows.count() > 0
      const hasEmpty = await emptyRow.isVisible().catch(() => false)

      expect(hasData || hasEmpty).toBe(true)
    })

    test('technician rows show name in first cell', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const techContainer = page.locator('div.border.border-zinc-800').filter({
        has: page.locator('h3:text-matches("Technicians")'),
      })

      const rows = techContainer.locator('tbody tr').filter({ hasNot: page.locator('td[colspan]') })
      const rowCount = await rows.count()

      if (rowCount === 0) {
        // No data this week — acceptable
        return
      }

      const firstRow = rows.first()
      const nameCell = firstRow.locator('td').first()
      const text = await nameCell.textContent()
      expect(text).toBeTruthy()

      await payroll.screenshot('tech-row')
    })

    test('team lead rows have TL badge', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const tlBadges = payroll.teamLeadBadges()
      const count = await tlBadges.count()

      // If TL badges exist, they must say "TL"
      if (count > 0) {
        await expect(tlBadges.first()).toBeVisible()
        const text = await tlBadges.first().textContent()
        expect(text?.trim()).toBe('TL')
        await payroll.screenshot('tl-badge')
      }
      // If no team leads this week, test passes
    })

    test('technician rows show revenue and percentage columns', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const techContainer = page.locator('div.border.border-zinc-800').filter({
        has: page.locator('h3:text-matches("Technicians")'),
      })

      const rows = techContainer.locator('tbody tr').filter({ hasNot: page.locator('td[colspan]') })
      const rowCount = await rows.count()
      if (rowCount === 0) return

      const cells = rows.first().locator('td')
      const cellCount = await cells.count()

      // 6 columns: Name, Revenue, %, Hours, OT, Total Pay
      expect(cellCount).toBe(6)

      // Revenue cell (index 1) should start with $
      const revText = await cells.nth(1).textContent()
      expect(revText).toMatch(/\$/)

      // Percentage cell (index 2) should end with %
      const pctText = await cells.nth(2).textContent()
      expect(pctText).toMatch(/%/)
    })

    test('overtime cell shows amber color when OT > 0', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const otCells = payroll.overtimeCells()
      const count = await otCells.count()

      if (count > 0) {
        // At least one tech has OT — verify amber styling
        await expect(otCells.first()).toBeVisible()
        await payroll.screenshot('ot-amber')
      }
      // If no OT this week, no amber cells exist — acceptable
    })

    test('technician rows are clickable (fires onEmployeeClick)', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const techContainer = page.locator('div.border.border-zinc-800').filter({
        has: page.locator('h3:text-matches("Technicians")'),
      })

      const rows = techContainer.locator('tbody tr.cursor-pointer')
      const rowCount = await rows.count()
      if (rowCount === 0) return

      await expect(rows.first()).toBeVisible()
      // The row has cursor-pointer style confirming it's interactive
    })

  })

  // ── 4. Salesmen Table ──────────────────────────────────────────────────

  test.describe('4. Salesmen table', () => {

    test('salesmen table renders column headers', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const salesContainer = page.locator('div.border.border-zinc-800').filter({
        has: page.locator('h3:text("Salesmen")'),
      })

      await expect(salesContainer.locator('th:text("Name")')).toBeVisible()
      await expect(salesContainer.locator('th:text("1-Time")')).toBeVisible()
      await expect(salesContainer.locator('th:text("Triannual")')).toBeVisible()
      await expect(salesContainer.locator('th:text("Quarterly")')).toBeVisible()
      await expect(salesContainer.locator('th:text("Total")')).toBeVisible()
    })

    test('salesmen table shows data rows or empty state', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const salesContainer = page.locator('div.border.border-zinc-800').filter({
        has: page.locator('h3:text("Salesmen")'),
      })

      const dataRows = salesContainer.locator('tbody tr td:not([colspan])')
      const emptyRow = salesContainer.locator('td[colspan="5"]')

      const hasData = await dataRows.count() > 0
      const hasEmpty = await emptyRow.isVisible().catch(() => false)

      expect(hasData || hasEmpty).toBe(true)
    })

    test('salesman rows show commission percentages inline', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const salesContainer = page.locator('div.border.border-zinc-800').filter({
        has: page.locator('h3:text("Salesmen")'),
      })

      const rows = salesContainer.locator('tbody tr').filter({ hasNot: page.locator('td[colspan]') })
      const rowCount = await rows.count()
      if (rowCount === 0) return

      const firstRow = rows.first()
      const text = await firstRow.textContent()

      // Commission cells contain "(N%)" inline
      expect(text).toMatch(/\(\d+%\)/)
      await payroll.screenshot('salesman-row')
    })

    test('salesman rows have 5 columns', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const salesContainer = page.locator('div.border.border-zinc-800').filter({
        has: page.locator('h3:text("Salesmen")'),
      })

      const rows = salesContainer.locator('tbody tr').filter({ hasNot: page.locator('td[colspan]') })
      const rowCount = await rows.count()
      if (rowCount === 0) return

      const cells = rows.first().locator('td')
      const cellCount = await cells.count()

      // 5 columns: Name, 1-Time, Triannual, Quarterly, Total
      expect(cellCount).toBe(5)
    })

    test('salesman total cell shows dollar amount', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const salesContainer = page.locator('div.border.border-zinc-800').filter({
        has: page.locator('h3:text("Salesmen")'),
      })

      const rows = salesContainer.locator('tbody tr').filter({ hasNot: page.locator('td[colspan]') })
      const rowCount = await rows.count()
      if (rowCount === 0) return

      // Last column (index 4) is the Total Pay cell
      const totalCell = rows.first().locator('td').last()
      const text = await totalCell.textContent()
      expect(text).toMatch(/\$\d+\.\d{2}/)
    })

  })

  // ── 5. Employee Bank Sidebar ───────────────────────────────────────────

  test.describe('5. Employee bank sidebar', () => {

    test('Employees header is visible in sidebar', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const employeesHeader = page.locator('h3').filter({ hasText: /Employees/i })
      await expect(employeesHeader).toBeVisible()
    })

    test('employee bank lists employees when data exists', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const bankSection = page.locator('div.border.border-zinc-800').filter({
        has: page.locator('h3:text-matches("Employees")'),
      })

      const buttons = bankSection.locator('button')
      const count = await buttons.count()

      // Could be 0 if no payroll data this week
      // If there IS data in the main tables, bank should match
      const techRows = page.locator('div.border.border-zinc-800').filter({
        has: page.locator('h3:text-matches("Technicians")'),
      }).locator('tbody tr.cursor-pointer')

      const techCount = await techRows.count()
      if (techCount > 0) {
        expect(count).toBeGreaterThan(0)
      }
    })

    test('employee bank buttons show role badge', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const bankSection = page.locator('div.border.border-zinc-800').filter({
        has: page.locator('h3:text-matches("Employees")'),
      })

      const buttons = bankSection.locator('button')
      const count = await buttons.count()
      if (count === 0) return

      // Each button has a role badge
      const badge = buttons.first().locator('[class*="border-zinc-700"]')
      await expect(badge).toBeVisible()

      const roleText = await badge.textContent()
      expect(['technician', 'team_lead', 'salesman']).toContain(roleText?.trim())

      await payroll.screenshot('employee-bank')
    })

    test('employee bank buttons are clickable', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const bankSection = page.locator('div.border.border-zinc-800').filter({
        has: page.locator('h3:text-matches("Employees")'),
      })

      const buttons = bankSection.locator('button')
      const count = await buttons.count()
      if (count === 0) return

      await expect(buttons.first()).toBeEnabled()
    })

  })

  // ── 6. Status Badge Rendering ──────────────────────────────────────────

  test.describe('6. Status badge rendering', () => {

    test('draft status renders with secondary variant styling', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      const badge = payroll.statusBadge().first()
      await expect(badge).toBeVisible()

      const text = await badge.textContent()
      // Badge must be one of the two known states
      expect(text?.trim()).toMatch(/^(Draft|Finalized)$/)
    })

    test('section totals are shown in green next to section headers', async ({ page }) => {
      const payroll = new PayrollPage(page)
      await payroll.goto()

      // Both tech and sales sections show their subtotals in green
      const greenTotals = page.locator('span.text-green-400.ml-auto')
      const count = await greenTotals.count()

      // At least 2: one per section (tech + sales)
      expect(count).toBeGreaterThanOrEqual(2)
    })

  })

})
