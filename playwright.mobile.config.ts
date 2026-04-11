import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /mobile.*\.spec\.ts/,
  fullyParallel: true,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 375, height: 667 },
    screenshot: 'on',
  },
  projects: [
    {
      name: 'mobile',
      use: { viewport: { width: 375, height: 667 } },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
