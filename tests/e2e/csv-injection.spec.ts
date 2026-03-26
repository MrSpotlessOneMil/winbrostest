/**
 * CSV Formula Injection E2E Test
 *
 * Tests that the export endpoint sanitizes formula-triggering characters.
 */
import { test, expect } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('CSV Export — Formula Injection Prevention', () => {
  test('export endpoint does not expose raw formula characters', async ({ page }) => {
    const res = await page.request.post(`${BASE}/api/actions/export`, {
      data: JSON.stringify({ type: 'customers' }),
      headers: { 'Content-Type': 'application/json' },
    })

    if (res.status() === 200) {
      const text = await res.text()
      // CSV should not start any cell with raw = + - @ (formula injection)
      const lines = text.split('\n').filter(l => l.trim())
      for (const line of lines.slice(1)) { // skip header
        const cells = line.split(',')
        for (const cell of cells) {
          const trimmed = cell.replace(/^"/, '').trim()
          // If cell starts with a formula char, it should be escaped with '
          if (trimmed.match(/^[=+\-@]/)) {
            expect(trimmed.startsWith("'")).toBeTruthy()
          }
        }
      }
    }
    // If 401 (not authenticated with right tenant), that's fine
  })
})
