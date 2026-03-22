import { test, expect } from '@playwright/test'

/**
 * Crawl every dashboard page and flag any phone numbers displayed
 * without a name, source badge, or other human-readable identifier.
 *
 * A "raw number" = a phone number pattern that appears as standalone text
 * with no adjacent name/label within the same row/card/list-item.
 */

const PHONE_REGEX = /(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g

const PAGES_TO_CHECK = [
  { path: '/overview', name: 'Overview' },
  { path: '/customers', name: 'Customers' },
  { path: '/leads', name: 'Leads' },
  { path: '/inbox', name: 'Inbox' },
  { path: '/memberships', name: 'Memberships' },
  { path: '/calendar', name: 'Calendar' },
  { path: '/teams', name: 'Teams' },
  { path: '/pipeline', name: 'Pipeline' },
  { path: '/insights', name: 'Insights' },
]

test.describe('No unidentified phone numbers anywhere', () => {
  for (const pg of PAGES_TO_CHECK) {
    test(`${pg.name} page — no raw unidentified numbers`, async ({ page }) => {
      await page.goto(pg.path)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(2000) // let async data load

      const results = await page.evaluate((phonePattern) => {
        const regex = new RegExp(phonePattern, 'g')
        const issues: Array<{
          number: string
          context: string
          element: string
          hasName: boolean
          location: string
        }> = []

        // Find all text nodes that contain phone numbers
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null
        )

        const seen = new Set<string>()

        while (walker.nextNode()) {
          const node = walker.currentNode
          const text = node.textContent || ''
          const matches = text.match(regex)
          if (!matches) continue

          for (const match of matches) {
            // Normalize to digits only
            const digits = match.replace(/\D/g, '')
            if (digits.length < 10) continue // skip short numbers
            if (seen.has(digits)) continue
            seen.add(digits)

            // Walk up to find the nearest container (row, card, list-item)
            let container = node.parentElement
            for (let i = 0; i < 8 && container; i++) {
              const tag = container.tagName.toLowerCase()
              const role = container.getAttribute('role')
              const cls = container.className || ''
              if (
                tag === 'tr' || tag === 'li' || tag === 'article' ||
                role === 'row' || role === 'listitem' ||
                cls.includes('card') || cls.includes('item') ||
                cls.includes('thread') || cls.includes('customer') ||
                cls.includes('lead') || cls.includes('conversation')
              ) break
              container = container.parentElement
            }

            const containerText = (container?.textContent || '').trim()

            // Check if there's a name-like string near the number
            // Names: 2+ consecutive capitalized words, or common name patterns
            const namePattern = /[A-Z][a-z]+\s+[A-Z][a-z]+|Unknown|No name|Anonymous/
            const hasName = namePattern.test(containerText)

            // Check for source/label badges
            const hasBadge = container?.querySelector(
              '[class*="badge"], [class*="Badge"], [class*="source"], [class*="icon"], svg'
            ) !== null

            // Check for any label like "Phone:", "Customer:", "From:", etc.
            const hasLabel = /(?:phone|customer|from|to|name|contact|caller|lead)[\s:]/i.test(containerText)

            // If no name AND no badge AND no label — it's a raw unidentified number
            if (!hasName && !hasBadge && !hasLabel) {
              issues.push({
                number: match,
                context: containerText.slice(0, 200),
                element: container?.tagName || 'unknown',
                hasName: false,
                location: container?.className?.slice(0, 100) || '',
              })
            }
          }
        }

        return issues
      }, PHONE_REGEX.source)

      if (results.length > 0) {
        const report = results.map(r =>
          `  NUMBER: ${r.number}\n  CONTEXT: "${r.context.slice(0, 150)}"\n  ELEMENT: <${r.element} class="${r.location}">`
        ).join('\n\n')

        console.log(`\n=== UNIDENTIFIED NUMBERS ON ${pg.name.toUpperCase()} ===\n${report}\n`)
      }

      // FAIL if any unidentified numbers found
      expect(
        results,
        `Found ${results.length} unidentified phone number(s) on ${pg.name} page:\n` +
        results.map(r => `  ${r.number} — context: "${r.context.slice(0, 80)}"`).join('\n')
      ).toHaveLength(0)
    })
  }
})
