import { defineConfig, devices } from '@playwright/test'
import path from 'path'

const STORAGE_STATE = path.join(__dirname, '.playwright-auth.json')

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'security',
      testMatch: /.*security\.spec\.ts|.*cron-security\.spec\.ts|.*admin-security\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Landing-page smoke for Meta ads. Runs unauthenticated against a
      // configurable base URL (SPOTLESS_BASE_URL env var), so the same spec
      // can hit production, a Vercel preview, or localhost.
      name: 'spotless-smoke',
      testMatch: /spotless-landing-smoke\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.SPOTLESS_BASE_URL || 'https://spotlessscrubbers.org',
      },
    },
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE,
      },
      dependencies: ['setup'],
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120_000,
      },
})
