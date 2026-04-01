/**
 * Minimal Playwright config for crash-detection tests.
 * No auth setup required — tests run against public pages only.
 * Usage:
 *   npx playwright test --config=playwright.crash.config.ts
 *   PLAYWRIGHT_BASE_URL=https://cleanmachine.live npx playwright test --config=playwright.crash.config.ts
 */
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /crash-detection\.spec\.ts|crew-portal-calendar\.spec\.ts|crew-full-flow\.spec\.ts|full-system\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-crash', open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on',
    screenshot: 'on',
    video: 'on',
  },
  projects: [
    {
      name: 'crash-detection',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
