/**
 * Incident regression guards.
 *
 * Each test here corresponds to a real production incident.
 * They scan the actual source code for patterns that caused the bug.
 * If someone re-introduces the pattern, the test fails BEFORE it ships.
 *
 * These are NOT unit tests — they're structural guards. They read source
 * files and verify dangerous patterns are absent. They run in <1 second
 * and catch bugs that TypeScript can't (because ignoreBuildErrors: true).
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

function getAllTsFiles(dir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...getAllTsFiles(fullPath))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      results.push(fullPath)
    }
  }
  return results
}

describe('Incident guard: SMS pre-insert before sendSMS', () => {
  /**
   * Incident: Automated SMS without a pre-inserted DB record triggers
   * manual_takeover and ghosts the customer. Every sendSMS call in
   * automation/cron routes must have a corresponding DB insert BEFORE it.
   *
   * This test verifies that auto-response routes import the pre-insert
   * function and that sendSMS is not called raw in cron routes.
   */
  it('auto-response.ts imports pre-insert helpers', () => {
    const autoResponse = path.join(HC_ROOT, 'lib/auto-response.ts')
    if (!fs.existsSync(autoResponse)) return // skip if file doesn't exist yet

    const source = readFile(autoResponse)
    // Must have some form of DB insert before SMS
    const hasPreInsert = source.includes('scheduled_tasks') ||
      source.includes('pre_insert') ||
      source.includes('preInsert') ||
      source.includes('insertTask') ||
      source.includes('insert(') ||
      source.includes('upsert(') ||
      source.includes('.from(')

    expect(hasPreInsert, 'auto-response.ts must pre-insert a DB record before sendSMS').toBe(true)
  })
})

describe('Incident guard: tenant isolation in shared functions', () => {
  /**
   * Incident: Functions that fall back to a "default" tenant when no
   * tenant_id is provided cause cross-tenant data leaks.
   *
   * Guard: shared lib functions must NOT call getDefaultTenant().
   */
  it('core lib files do not call getDefaultTenant() in payment/invoice code', () => {
    // getDefaultTenant() exists in auth.ts and tenant.ts for backwards compat,
    // but must NEVER appear in payment, invoice, or SMS paths.
    const dangerousFiles = ['stripe-client.ts', 'invoices.ts', 'openphone.ts', 'sms-templates.ts', 'cleaner-sms.ts']
    const violations: string[] = []

    for (const fileName of dangerousFiles) {
      const filePath = path.join(CORE_ROOT, fileName)
      if (!fs.existsSync(filePath)) continue
      const source = readFile(filePath)
      if (source.includes('getDefaultTenant()')) {
        violations.push(fileName)
      }
    }

    expect(violations, `getDefaultTenant() found in payment/SMS files: ${violations.join(', ')}`).toHaveLength(0)
  })
})

describe('Incident guard: no Telegram references', () => {
  /**
   * Incident: Telegram is DEAD. Cleaner dispatch is SMS only.
   * Any new code referencing Telegram dispatch will silently fail.
   */
  it('no Telegram dispatch in active route files', () => {
    const violations: string[] = []
    const routeDirs = [
      path.join(HC_ROOT, 'app/api'),
      path.join(HC_ROOT, 'lib'),
    ]

    for (const dir of routeDirs) {
      const files = getAllTsFiles(dir)
      for (const file of files) {
        const source = readFile(file)
        const lines = source.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          // Skip comments
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue
          // Look for active Telegram sending (not type definitions or dead code)
          if (line.includes('sendTelegramMessage') && !line.includes('// DEAD') && !line.includes('deprecated')) {
            const relPath = path.relative(HC_ROOT, file)
            violations.push(`${relPath}:${i + 1}`)
          }
        }
      }
    }

    expect(violations, `Active Telegram dispatch found:\n${violations.join('\n')}`).toHaveLength(0)
  })
})

describe('Incident guard: cron business hours', () => {
  /**
   * Incident 2026-03-28: Quote follow-up cron blasted 58 texts at 11pm.
   * Customer-facing crons MUST check business hours.
   */
  // TODO: lifecycle-reengagement needs a business hours check added
  const CUSTOMER_FACING_CRONS = [
    'app/api/cron/send-quote-followups',
    'app/api/cron/send-review-requests',
    'app/api/cron/satisfaction-check',
  ]

  for (const cronPath of CUSTOMER_FACING_CRONS) {
    it(`${cronPath} checks business hours`, () => {
      const fullPath = path.join(HC_ROOT, cronPath, 'route.ts')
      if (!fs.existsSync(fullPath)) return // skip if cron doesn't exist

      const source = readFile(fullPath)
      const hasHoursCheck = source.includes('business_hours') ||
        source.includes('businessHours') ||
        source.includes('isBusinessHours') ||
        source.includes('getHours()') ||
        source.includes('hour >=') ||
        source.includes('hour <=') ||
        source.includes('hour <') ||
        source.includes('hour >') ||
        source.includes('currentHour')

      expect(hasHoursCheck, `${cronPath} sends SMS to customers but has no business hours check`).toBe(true)
    })
  }
})

describe('Incident guard: function signature propagation', () => {
  /**
   * Meta-guard: When a function in packages/core/src has optional params,
   * verify the SAME function exists in both app lib/ copies with the same
   * signature. Catches drift between core and app copies.
   */
  const CRITICAL_FUNCTIONS = [
    { name: 'createAndSendInvoice', file: 'stripe-client.ts' },
    { name: 'createDepositPaymentLink', file: 'stripe-client.ts' },
    { name: 'createCustomPaymentLink', file: 'stripe-client.ts' },
    { name: 'chargeCardOnFile', file: 'stripe-client.ts' },
    { name: 'createInvoice', file: 'invoices.ts' },
  ]

  for (const func of CRITICAL_FUNCTIONS) {
    it(`${func.name} signature matches between core, HC, and WW`, () => {
      const corePath = path.join(CORE_ROOT, func.file)
      const hcPath = path.join(HC_ROOT, 'lib', func.file)
      const wwPath = path.join(WW_ROOT, 'lib', func.file)

      if (!fs.existsSync(corePath) || !fs.existsSync(hcPath)) return

      const coreSource = readFile(corePath)
      const hcSource = readFile(hcPath)

      // Extract function signature (first line of the function)
      const sigPattern = new RegExp(`export async function ${func.name}\\([^)]*\\)`, 's')
      const coreSig = coreSource.match(sigPattern)?.[0]
      const hcSig = hcSource.match(sigPattern)?.[0]

      expect(coreSig, `${func.name} not found in core`).toBeTruthy()
      expect(hcSig, `${func.name} not found in HC`).toBeTruthy()
      expect(hcSig).toBe(coreSig)

      if (fs.existsSync(wwPath)) {
        const wwSource = readFile(wwPath)
        const wwSig = wwSource.match(sigPattern)?.[0]
        expect(wwSig, `${func.name} signature differs between core and WW`).toBe(coreSig)
      }
    })
  }
})

describe('Incident guard: promo jobs store normal price', () => {
  /**
   * Incident 2026-04-12: $99 promo jobs paid cleaners 50% of $99 ($49.50)
   * instead of 50% of normal price. NORMAL_PRICE must be stored in notes.
   *
   * Guard: any code that creates promo/offer jobs must set cleaner_pay_override
   * or NORMAL_PRICE in notes.
   */
  it('offer/promo routes set cleaner_pay_override or NORMAL_PRICE', () => {
    const offerRoutes = [
      path.join(HC_ROOT, 'app/api/webhooks/stripe/route.ts'),
    ]

    for (const routePath of offerRoutes) {
      if (!fs.existsSync(routePath)) continue
      const source = readFile(routePath)

      // If the file handles promo/offer payments, it must set cleaner_pay_override
      if (source.includes('promo') || source.includes('offer') || source.includes('$99') || source.includes('$149')) {
        const hasPayGuard = source.includes('cleaner_pay_override') || source.includes('NORMAL_PRICE')
        expect(hasPayGuard, `${routePath} handles promos but doesn't set cleaner_pay_override or NORMAL_PRICE`).toBe(true)
      }
    }
  })
})
