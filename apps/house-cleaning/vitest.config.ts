import { defineConfig } from 'vitest/config'
import path from 'path'

// App-scoped test config so `@/...` resolves to THIS app's own lib copies —
// the code that actually runs in production (per-app lib copies are authoritative).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/house-cleaning/tests/**/*.test.ts'],
    setupFiles: ['apps/house-cleaning/tests/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
