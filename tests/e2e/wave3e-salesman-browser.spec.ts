/**
 * Wave 3e — salesman portal browser e2e
 *
 * Visits the salesman crew portal via the token link and confirms the
 * availability strip, commission chip, and the Wave 3e quote builder UX
 * (three-state pill, live equation, offer count, quote-level first-visit
 * checkbox) all render.
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002'
const SALESMAN_TOKEN = '5f6b3902-6851-4581-a211-2333c0b79ed8'

async function openBuilderFromSalesmanPortal(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/crew/${SALESMAN_TOKEN}`)
  // Availability strip renders once the portal fetches data.
  await expect(page.getByTestId('availability-strip')).toBeVisible({
    timeout: 15000,
  })
  await expect(page.getByTestId('commission-chip')).toBeVisible()
  // Tap + New Quote (sits in bottom bar).
  await page.getByRole('button', { name: /New Quote/i }).click()
  await expect(page.getByRole('heading', { name: 'Quote Builder' })).toBeVisible({
    timeout: 15000,
  })
}

test.describe('Wave 3e — salesman portal surfaces', () => {
  test('availability strip + commission chip render for the salesman', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/crew/${SALESMAN_TOKEN}`)
    await expect(page.getByTestId('availability-strip')).toBeVisible({
      timeout: 15000,
    })
    await expect(page.getByTestId('commission-chip')).toBeVisible()
    // Strip should contain at least 14 day buttons.
    const dayButtons = page.locator('[data-testid="availability-strip"] button')
    await expect(dayButtons.nth(13)).toBeVisible()
  })
})

test.describe('Wave 3e — builder UX', () => {
  test('three-state pill cycles through required → recommended → optional', async ({
    page,
  }) => {
    await openBuilderFromSalesmanPortal(page)
    // Add two blank lines so we have something to cycle.
    await page.getByRole('button', { name: /Add line/ }).click()
    await page.getByRole('button', { name: /Add line/ }).click()

    const firstRow = page.getByTestId('line-item-row').first()
    const pill = firstRow.getByRole('button', { name: /Line state:/ })
    await expect(pill).toContainText('Required')
    await pill.click()
    await expect(pill).toContainText('Recommended')
    await pill.click()
    await expect(pill).toContainText('Optional')
    await pill.click()
    await expect(pill).toContainText('Required')
  })

  test('live equation reflects required + recommended, excludes optional', async ({
    page,
  }) => {
    await openBuilderFromSalesmanPortal(page)

    // Build: 100 required + 175 recommended + 40 optional.
    // Set optionality BEFORE prices so the pill doesn't get re-rendered
    // detached by React state updates while we're clicking.
    await page.getByRole('button', { name: /Add line/ }).click()
    await page.getByRole('button', { name: /Add line/ }).click()
    await page.getByRole('button', { name: /Add line/ }).click()

    const rows = page.getByTestId('line-item-row')

    // Row 1 → recommended (one cycle).
    await rows.nth(1).getByRole('button', { name: /Line state:/ }).click()
    // Row 2 → optional (two cycles).
    await rows.nth(2).getByRole('button', { name: /Line state:/ }).click()
    await rows.nth(2).getByRole('button', { name: /Line state:/ }).click()

    // Names
    await rows.nth(0).getByPlaceholder(/Service name/).fill('Exterior')
    await rows.nth(1).getByPlaceholder(/Service name/).fill('Deck')
    await rows.nth(2).getByPlaceholder(/Service name/).fill('Extra')
    // Prices (second number input per row is the dollar amount; first is qty)
    await rows.nth(0).locator('input[type="number"]').nth(1).fill('100')
    await rows.nth(1).locator('input[type="number"]').nth(1).fill('175')
    await rows.nth(2).locator('input[type="number"]').nth(1).fill('40')

    await expect(page.getByTestId('total-equation')).toContainText(
      '$100.00 + $175.00 = $275.00'
    )
  })

  test('plan "Offer to customer" toggle + count chip updates live', async ({
    page,
  }) => {
    await openBuilderFromSalesmanPortal(page)
    await page.getByRole('button', { name: /Add plan/ }).click()
    await page.getByRole('button', { name: /Add plan/ }).click()

    const cards = page.getByTestId('plan-card')
    await expect(cards).toHaveCount(2)
    await expect(page.getByTestId('offered-plans-count')).toHaveText(
      /0 of 2 offered/
    )

    // Each card has its own "Offer to customer" checkbox at the header.
    await cards.nth(0).getByLabel(/Offer to customer/).check()
    await expect(page.getByTestId('offered-plans-count')).toHaveText(
      /1 of 2 offered/
    )
    await cards.nth(1).getByLabel(/Offer to customer/).check()
    await expect(page.getByTestId('offered-plans-count')).toHaveText(
      /2 of 2 offered/
    )
  })

  test('quote-level first-visit checkbox cascades to every plan', async ({
    page,
  }) => {
    await openBuilderFromSalesmanPortal(page)
    await page.getByRole('button', { name: /Add plan/ }).click()
    await page.getByRole('button', { name: /Add plan/ }).click()

    // Toggle the quote-level "First cleaning keeps original price" checkbox.
    await page
      .getByLabel(/First cleaning keeps original price/i)
      .check()

    // Reveal the per-plan overrides and confirm all plans were updated.
    await page.getByRole('button', { name: /Customize per plan/ }).click()
    const cards = page.getByTestId('plan-card')
    const first = cards.nth(0).getByLabel(/First visit keeps original price/)
    const second = cards.nth(1).getByLabel(/First visit keeps original price/)
    await expect(first).toBeChecked()
    await expect(second).toBeChecked()
  })
})
