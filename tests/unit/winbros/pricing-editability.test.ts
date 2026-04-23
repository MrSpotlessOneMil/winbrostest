/**
 * Pricing editability audit — Unit Tests (Round 2 Wave 4 task 8)
 *
 * Max's non-negotiable: prices are ALWAYS editable (no fixed pricing except
 * pane-count). This file pins audit results. If a hardcoded price constant
 * reappears in the WW app, a CI grep would be a better guardrail than a test
 * — but having the expectation in code keeps the audit result discoverable.
 *
 * The test asserts the intent of the refactor, not the runtime: we verify
 * the "job detail drawer" price book now fetches from an API, not from a
 * frozen constant, by confirming the fallback list is empty (so the drawer
 * has nothing to show when the API is unreachable — forcing admins to
 * curate the catalog themselves).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DRAWER_PATH = join(
  process.cwd(),
  'apps/window-washing/components/winbros/job-detail-drawer.tsx'
)

describe('Wave 4 — pricing editability', () => {
  const source = readFileSync(DRAWER_PATH, 'utf-8')

  it('variant 1: PRICE_BOOK constant is no longer a hardcoded array', () => {
    // The old constant had the shape `const PRICE_BOOK = [{ name: ..., price: 200 }, ...]`.
    // A negative-match guard keeps it from sneaking back in.
    expect(source).not.toMatch(/const\s+PRICE_BOOK\s*=\s*\[\s*\{[^}]*name:[^}]*price:\s*\d/)
  })

  it('variant 2: drawer hydrates the price book from tech-upsell-catalog', () => {
    expect(source).toContain('/api/actions/tech-upsell-catalog')
    expect(source).toContain('setPriceBook(')
  })

  it('variant 3: fallback list ships empty so a missing API forces admin curation', () => {
    expect(source).toMatch(/PRICE_BOOK_FALLBACK[^=]*=\s*\[\s*\]/)
  })
})
