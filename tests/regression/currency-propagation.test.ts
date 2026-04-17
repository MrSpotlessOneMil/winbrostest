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
