/**
 * WinBros — Quote popup on /jobs Calendar
 *
 * Locks Dominic's hard requirement: clicking "+ New Quote" on the Calendar
 * MUST open a Sheet popup overlaying /jobs. NO router.push, NO navigation
 * away, NO bounce back to /crew/<token>.
 *
 * Two layers:
 *  1. HTTP — proves /api/crew/<token>/quote-draft still mints a draft we
 *     can address by id (the data half of the popup flow).
 *  2. Browser — clicks the in-page button, asserts URL stays /jobs while
 *     the QuoteBuilder dialog is visible, asserts URL still /jobs after
 *     close, and asserts there is NEVER a redirect through /crew/.
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const SALESMAN_TOKEN =
  process.env.WINBROS_SALESMAN_TOKEN || '5f6b3902-6851-4581-a211-2333c0b79ed8'

test.describe('WinBros quote popup — HTTP', () => {
  test('quote-draft endpoint returns an addressable id', async ({ request }) => {
    const res = await request.post(
      `${BASE_URL}/api/crew/${SALESMAN_TOKEN}/quote-draft`
    )
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.quoteId).toBeTruthy()

    // Hydrate to confirm we can render that id inside the Sheet.
    const qRes = await request.get(`${BASE_URL}/api/actions/quotes/${body.quoteId}`)
    expect(qRes.ok()).toBe(true)
    const q = await qRes.json()
    expect(q.quote.id).toBe(body.quoteId)
  })
})

test.describe('WinBros quote popup — browser', () => {
  test.skip(
    !process.env.WINBROS_SALESMAN_USER || !process.env.WINBROS_SALESMAN_PASS,
    'Set WINBROS_SALESMAN_USER + WINBROS_SALESMAN_PASS to run the browser flow'
  )

  async function loginAsSalesman(page: Page) {
    const username = process.env.WINBROS_SALESMAN_USER!
    const password = process.env.WINBROS_SALESMAN_PASS!
    await page.goto(`${BASE_URL}/login`)
    await page.locator('#username').fill(username)
    await page.locator('#password').fill(password)
    await page.locator('button[type="submit"]').click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  }

  test('click + New Quote keeps URL at /jobs and opens the dialog', async ({
    page,
  }) => {
    // Track every navigation so we can assert the URL never bounces to /crew/.
    const visitedUrls: string[] = []
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) visitedUrls.push(frame.url())
    })

    await loginAsSalesman(page)

    await page.goto(`${BASE_URL}/jobs`)
    await expect(page).toHaveURL(/\/jobs/, { timeout: 10_000 })

    const newQuoteBtn = page.getByRole('button', { name: /new quote/i })
    await expect(newQuoteBtn).toBeVisible({ timeout: 10_000 })

    await newQuoteBtn.click()

    // Sheet renders the QuoteBuilder. Wait for either the embedded builder
    // or its loading skeleton to appear.
    const sheet = page.getByTestId('quote-builder-sheet')
    await expect(sheet).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByTestId('quote-builder').or(page.getByTestId('quote-builder-loading'))
    ).toBeVisible({ timeout: 15_000 })

    // URL still /jobs — the whole point of this test.
    await expect(page).toHaveURL(/\/jobs(\?|$|#)/, { timeout: 5_000 })

    // Close the sheet and confirm we're still on /jobs.
    const closeBtn = page.getByTestId('quote-builder-close').first()
    await closeBtn.click()

    await expect(sheet).toBeHidden({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/jobs(\?|$|#)/)

    // Never bounced through the legacy /crew/<token> portal during the flow.
    const bouncedToCrew = visitedUrls.some((u) => /\/crew\//.test(u))
    expect(bouncedToCrew, `Saw /crew/ in: ${visitedUrls.join(', ')}`).toBe(false)

    // Never landed on the standalone /quotes/<id> page either.
    const navigatedToQuotePage = visitedUrls.some((u) =>
      /\/quotes\/[^/?]+(\?|$|#)/.test(u)
    )
    expect(
      navigatedToQuotePage,
      `Saw /quotes/<id> in: ${visitedUrls.join(', ')}`
    ).toBe(false)
  })
})
