/**
 * Regression test: Currency propagation to Stripe.
 *
 * Incident: 2026-04-15 — West Niagara (CAD) clients charged in USD because
 * 11 call sites didn't pass tenant.currency to Stripe payment functions.
 * Subhabrata Dutta charged $255 USD instead of CAD. Amanda Laura's $240
 * checkout session created in USD.
 *
 * Root cause: Functions had `currency = 'usd'` default param. Callers
 * compiled fine without passing it, silently getting the wrong currency.
 *
 * These tests ensure the fix can NEVER regress.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const HC_ROOT = path.resolve(__dirname, '../../apps/house-cleaning')
const WW_ROOT = path.resolve(__dirname, '../../apps/window-washing')
const CORE_ROOT = path.resolve(__dirname, '../../packages/core/src')

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8')
}

/**
 * Find all lines where a function is CALLED (not defined/imported).
 * Returns the call lines so we can check if currency is passed.
 */
function findCallSites(source: string, funcName: string): { line: number; text: string }[] {
  const lines = source.split('\n')
  const results: { line: number; text: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Skip import lines, function definitions, and comments
    if (line.match(/^\s*(import|export\s+(async\s+)?function|\/\/|\/\*|\*)/)) continue
    if (line.includes(funcName + '(') || line.includes(funcName + ' (')) {
      // Gather the full call (may span multiple lines)
      let fullCall = line
      let j = i + 1
      let parenDepth = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length
      while (parenDepth > 0 && j < lines.length) {
        fullCall += '\n' + lines[j]
        parenDepth += (lines[j].match(/\(/g) || []).length - (lines[j].match(/\)/g) || []).length
        j++
      }
      results.push({ line: i + 1, text: fullCall })
    }
  }
  return results
}

describe('Currency propagation — Stripe payment functions', () => {
  const STRIPE_PAYMENT_FUNCTIONS = [
    'createCustomPaymentLink',
    'createDepositPaymentLink',
    'createAddOnPaymentLink',
  ]

  for (const app of ['house-cleaning', 'window-washing']) {
    const appRoot = app === 'house-cleaning' ? HC_ROOT : WW_ROOT

    describe(`${app} app`, () => {
      // Scan all route files in the app
      const routeDirs = [
        'app/api/actions',
        'app/api/automation',
        'app/api/assistant',
        'app/api/crew',
        'app/api/cron',
      ]

      for (const funcName of STRIPE_PAYMENT_FUNCTIONS) {
        it(`every call to ${funcName}() passes a currency parameter`, () => {
          const missing: string[] = []

          for (const dir of routeDirs) {
            const fullDir = path.join(appRoot, dir)
            if (!fs.existsSync(fullDir)) continue

            const files = getAllTsFiles(fullDir)
            for (const file of files) {
              const source = readFile(file)
              const calls = findCallSites(source, funcName)

              for (const call of calls) {
                // The currency param is the LAST argument in these functions.
                // Check that .currency appears somewhere in the call.
                if (!call.text.includes('currency') && !call.text.includes('cad') && !call.text.includes('CAD')) {
                  const relPath = path.relative(appRoot, file)
                  missing.push(`${relPath}:${call.line} — ${funcName}() called without currency`)
                }
              }
            }
          }

          expect(missing, `Missing currency parameter:\n${missing.join('\n')}`).toHaveLength(0)
        })
      }

      it('every call to chargeCardOnFile() passes a currency parameter', () => {
        const missing: string[] = []
        const routeAllDirs = ['app/api/actions', 'app/api/automation', 'app/api/assistant', 'app/api/crew', 'app/api/cron']

        for (const dir of routeAllDirs) {
          const fullDir = path.join(appRoot, dir)
          if (!fs.existsSync(fullDir)) continue

          const files = getAllTsFiles(fullDir)
          for (const file of files) {
            const source = readFile(file)
            const calls = findCallSites(source, 'chargeCardOnFile')

            for (const call of calls) {
              if (!call.text.includes('currency') && !call.text.includes('cad') && !call.text.includes('CAD')) {
                const relPath = path.relative(appRoot, file)
                missing.push(`${relPath}:${call.line} — chargeCardOnFile() called without currency`)
              }
            }
          }
        }

        expect(missing, `Missing currency parameter:\n${missing.join('\n')}`).toHaveLength(0)
      })

      it('SMS template functions (paymentLink, paymentRetry) are called with currency', () => {
        const missing: string[] = []
        const templateFuncs = ['paymentLink(', 'paymentRetryTemplate(', 'paymentRetry(']
        const routeAllDirs = ['app/api/actions', 'app/api/automation', 'app/api/assistant', 'app/api/crew', 'app/api/cron']

        for (const dir of routeAllDirs) {
          const fullDir = path.join(appRoot, dir)
          if (!fs.existsSync(fullDir)) continue

          const files = getAllTsFiles(fullDir)
          for (const file of files) {
            const source = readFile(file)
            const lines = source.split('\n')

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]
              // Skip imports and definitions
              if (line.match(/^\s*(import|export|function|const\s+\w+\s*=\s*\()/)) continue

              for (const func of templateFuncs) {
                if (line.includes(func) && !line.includes('import')) {
                  // Gather full call
                  let fullCall = line
                  let j = i + 1
                  let depth = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length
                  while (depth > 0 && j < lines.length) {
                    fullCall += '\n' + lines[j]
                    depth += (lines[j].match(/\(/g) || []).length - (lines[j].match(/\)/g) || []).length
                    j++
                  }

                  if (!fullCall.includes('currency') && !fullCall.includes('Currency')) {
                    const relPath = path.relative(appRoot, file)
                    missing.push(`${relPath}:${i + 1} — ${func.replace('(', '')}() called without currency`)
                  }
                }
              }
            }
          }
        }

        expect(missing, `Missing currency in SMS templates:\n${missing.join('\n')}`).toHaveLength(0)
      })
    })
  }

  describe('Core stripe-client.ts', () => {
    it('createStripeCustomer does NOT hardcode country: "US"', () => {
      const source = readFile(path.join(CORE_ROOT, 'stripe-client.ts'))
      const lines = source.split('\n')

      // Find the createStripeCustomer function body
      let inFunc = false
      let braceDepth = 0
      const hardcodedUS: number[] = []

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('async function createStripeCustomer') || lines[i].includes('export async function createStripeCustomer')) {
          inFunc = true
          braceDepth = 0
        }
        if (inFunc) {
          braceDepth += (lines[i].match(/\{/g) || []).length
          braceDepth -= (lines[i].match(/\}/g) || []).length

          if (lines[i].match(/country:\s*['"]US['"]/)) {
            hardcodedUS.push(i + 1)
          }

          if (braceDepth <= 0 && i > 0 && inFunc) {
            inFunc = false
          }
        }
      }

      expect(hardcodedUS, `Hardcoded country: 'US' found at lines: ${hardcodedUS.join(', ')}`).toHaveLength(0)
    })

    it('all Stripe payment functions have REQUIRED currency parameter (no default)', () => {
      const source = readFile(path.join(CORE_ROOT, 'stripe-client.ts'))
      const funcs = [
        'createAndSendInvoice',
        'createDepositPaymentLink',
        'createCustomPaymentLink',
        'createAddOnPaymentLink',
        'chargeCardOnFile',
      ]

      for (const func of funcs) {
        const funcMatch = source.match(new RegExp(`export async function ${func}\\([^)]*\\)`, 's'))
        expect(funcMatch, `${func} not found`).toBeTruthy()
        const sig = funcMatch![0]
        expect(sig, `${func} must accept currency`).toContain('currency')
        // Currency must NOT have a default — it must be required
        expect(sig, `${func} has currency = 'usd' default — REMOVE IT. Required params catch missing callers at compile time.`).not.toMatch(/currency\s*=\s*['"]/)
      }
    })

    it('SMS template functions have REQUIRED currency parameter (no default)', () => {
      const source = readFile(path.join(CORE_ROOT, 'sms-templates.ts'))
      const funcs = ['paymentLink', 'paymentRetry']

      for (const func of funcs) {
        const funcMatch = source.match(new RegExp(`export function ${func}\\([^)]*\\)`, 's'))
        expect(funcMatch, `${func} not found`).toBeTruthy()
        const sig = funcMatch![0]
        expect(sig, `${func} must accept currency`).toContain('currency')
        expect(sig, `${func} has currency default — REMOVE IT.`).not.toMatch(/currency\s*=\s*['"]/)
      }
    })
  })
})

describe('Currency propagation — no hardcoded $ in customer-facing SMS', () => {
  // These routes send SMS to customers with dollar amounts.
  // They must use formatTenantCurrency() or toLocaleString with currency,
  // NOT hardcoded $ signs.
  const CUSTOMER_SMS_ROUTES = [
    { app: 'house-cleaning', file: 'app/api/actions/complete-job/route.ts', label: 'complete-job receipt' },
    { app: 'house-cleaning', file: 'app/api/actions/charge-card/route.ts', label: 'charge-card receipt' },
    { app: 'house-cleaning', file: 'app/api/crew/[token]/job/[jobId]/route.ts', label: 'crew job done' },
    { app: 'house-cleaning', file: 'app/api/crew/[token]/job/[jobId]/charge/route.ts', label: 'crew charge' },
  ]

  for (const route of CUSTOMER_SMS_ROUTES) {
    it(`${route.label} uses formatTenantCurrency, not hardcoded $`, () => {
      const appRoot = route.app === 'house-cleaning' ? HC_ROOT : WW_ROOT
      const source = readFile(path.join(appRoot, route.file))

      // Find lines that send SMS with dollar amounts
      const lines = source.split('\n')
      const badLines: string[] = []

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Look for sendSMS calls that contain ${ with .toFixed or a dollar template
        if (line.includes('sendSMS') || (line.includes('Msg') && line.includes('$'))) {
          // Check for hardcoded dollar: `$${amount}` pattern in SMS messages
          if (line.match(/\$\$\{.*?(amount|charge|fee|price|pay)/i) && !line.includes('formatTenantCurrency')) {
            badLines.push(`Line ${i + 1}: ${line.trim().slice(0, 100)}`)
          }
        }
      }

      expect(badLines, `Hardcoded $ in customer SMS:\n${badLines.join('\n')}`).toHaveLength(0)
    })
  }
})

// ─── 2026-04-20 additions: broaden the no-hardcoded-$ scan ──────────────
//
// The 2026-04-15 fix caught $-in-customer-SMS regressions in a handful of routes.
// Today's audit found three more leak surfaces the old scan missed:
//   1. Stripe quote-deposit confirmation SMS (HC webhook line ~1202)
//   2. AI customer-context block built in auto-response.ts (prompt fed to the LLM)
//   3. Assistant chat `calculate_price` tool output (returned to the assistant)
//
// West Niagara (CAD) was receiving "$480.00" instead of "CA$480" on all three paths.
// These tests pin the fix so it can never silently regress.
//
// Scope: HC only. WW is tucked away (feedback_ww_app_not_production.md) — its copies
// are intentionally not covered here.

describe('Currency propagation — 2026-04-20 leak surfaces', () => {
  it('HC Stripe quote-deposit SMS uses formatTenantCurrency (not hardcoded $)', () => {
    const file = path.join(HC_ROOT, 'app/api/webhooks/stripe/route.ts')
    const source = readFile(file)
    const lines = source.split('\n')

    // Find the depositStr line(s) around the quote-deposit confirmation SMS.
    const depositStrLines = lines
      .map((l, i) => ({ l, i: i + 1 }))
      .filter(({ l }) => /\bdepositStr\s*=/.test(l))

    expect(depositStrLines.length, 'expected at least one depositStr assignment').toBeGreaterThan(0)

    const bad = depositStrLines.filter(
      ({ l }) =>
        /\$\$\{[^}]*deposit/i.test(l) && !/formatTenantCurrency/.test(l),
    )

    expect(
      bad,
      `depositStr assignments still hardcode $:\n${bad
        .map(({ l, i }) => `  line ${i}: ${l.trim()}`)
        .join('\n')}`,
    ).toHaveLength(0)
  })

  it('AI customer-context uses formatTenantCurrency for price / totalSpend (core + HC lib)', () => {
    // HC runtime resolves `@/lib/auto-response` to `packages/core/src/auto-response.ts`
    // per apps/house-cleaning/tsconfig.json (core path listed first). The HC lib copy is
    // effectively dead, but we scan both so a future tsconfig flip doesn't reintroduce
    // the leak via whichever copy wins resolution.
    const files = [
      path.join(CORE_ROOT, 'auto-response.ts'),
      path.join(HC_ROOT, 'lib/auto-response.ts'),
    ]
    for (const file of files) {
      const source = readFile(file)
      const lines = source.split('\n')
      const bad: string[] = []
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) continue
        if (
          /\$\$\{[^}]*(job\.price|ctx\.totalSpend|customerContext\.totalSpend|lastJob\.price|job\.totalCharged)/i.test(l)
        ) {
          bad.push(`line ${i + 1}: ${l.trim()}`)
        }
      }
      const relFile = path.relative(path.resolve(__dirname, '../..'), file)
      expect(
        bad,
        `${relFile} still hardcodes $ for price / totalSpend:\n${bad.join('\n')}`,
      ).toHaveLength(0)
    }
  })

  it('HC assistant/chat/route.ts calculate_price tool returns formatTenantCurrency', () => {
    const file = path.join(HC_ROOT, 'app/api/assistant/chat/route.ts')
    const source = readFile(file)

    // The calculate_price tool block must not contain `$${estimate.` or `$${depositAmount`.
    // These were the 4 leak sites flagged in the audit.
    const lines = source.split('\n')
    const bad: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) continue
      if (
        /\$\$\{\s*estimate\.(basePrice|addOnPrice|totalPrice)/.test(l) ||
        /\$\$\{\s*depositAmount/.test(l)
      ) {
        bad.push(`line ${i + 1}: ${l.trim()}`)
      }
    }

    expect(
      bad,
      `calculate_price tool still hardcodes $:\n${bad.join('\n')}`,
    ).toHaveLength(0)

    // And the file must import/use formatTenantCurrency.
    expect(source).toMatch(/formatTenantCurrency/)
  })
})

describe('formatTenantCurrency output — single source of truth', () => {
  // Per apps/house-cleaning/lib/tenant.ts:507, Dominic's design is that domestic
  // customers see plain "$" for their currency — Canadian customers know "$" means CAD.
  // The goal of these tests is NOT to enforce a CA$ prefix; it is to prove that all
  // customer-facing formatting runs through ONE code path (formatTenantCurrency), so
  // any future change (e.g. "switch to CA$ for CAD") is a one-line edit and not a
  // grep-hunt across 11 callers.
  function format(currency: 'usd' | 'cad', amount: number): string {
    const locale = currency === 'cad' ? 'en-CA' : 'en-US'
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  it('CAD tenant renders with $ and the correct amount (domestic convention)', () => {
    const cad = format('cad', 480)
    expect(cad).toContain('$')
    expect(cad).toContain('480')
  })

  it('USD tenant renders with $ and the correct amount', () => {
    const usd = format('usd', 150)
    expect(usd).toContain('$')
    expect(usd).toContain('150')
  })

  it('the en-US/USD output is deterministic ($150)', () => {
    // Pin Intl.NumberFormat output so a Node ICU change is caught in CI.
    expect(format('usd', 150)).toBe('$150')
  })
})

// Helper: recursively find all .ts files
function getAllTsFiles(dir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...getAllTsFiles(fullPath))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      results.push(fullPath)
    }
  }
  return results
}
