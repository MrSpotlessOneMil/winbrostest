/**
 * Regression guard: customer dedup on lead ingest
 *
 * Incident 2026-04-17 (AJ): Real AJ submitted a Meta ad form with phone
 * 310-650-3440 — system auto-created a duplicate customer record even
 * though an existing customer with the same email already existed at
 * phone 323-801-3870. This caused a manual quote to go to the wrong
 * person.
 *
 * Fix: both webhooks must resolve customers via upsertLeadCustomer
 * (apps/house-cleaning/lib/customer-dedup.ts), which checks by email
 * first, then phone. Raw `.upsert({...}, { onConflict: "tenant_id,phone_number" })`
 * on customers is BANNED in webhook routes because it creates duplicates
 * whenever a known customer submits with a new phone.
 */

import { describe, it, expect } from "vitest"
import * as fs from "fs"
import * as path from "path"

const HC_ROOT = path.resolve(__dirname, "../../apps/house-cleaning")
const WEBSITE_WEBHOOK = path.join(
  HC_ROOT,
  "app/api/webhooks/website/[slug]/route.ts"
)
const META_WEBHOOK = path.join(HC_ROOT, "app/api/webhooks/meta/[slug]/route.ts")
const DEDUP_LIB = path.join(HC_ROOT, "lib/customer-dedup.ts")
const CUSTOMERS_PAGE = path.join(
  HC_ROOT,
  "app/(dashboard)/customers/page.tsx"
)

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8")
}

describe("Customer dedup helper exists", () => {
  it("customer-dedup.ts is present and exports upsertLeadCustomer", () => {
    expect(fs.existsSync(DEDUP_LIB)).toBe(true)
    const src = read(DEDUP_LIB)
    expect(src).toMatch(/export\s+async\s+function\s+upsertLeadCustomer/)
  })

  it("dedup helper checks email before phone", () => {
    const src = read(DEDUP_LIB)
    const emailIdx = src.indexOf('ilike("email"')
    const phoneIdx = src.indexOf('.eq("phone_number"')
    expect(emailIdx).toBeGreaterThan(-1)
    expect(phoneIdx).toBeGreaterThan(-1)
    expect(emailIdx).toBeLessThan(phoneIdx)
  })
})

describe("Lead ingest webhooks use dedup helper", () => {
  it("website webhook imports upsertLeadCustomer", () => {
    const src = read(WEBSITE_WEBHOOK)
    expect(src).toMatch(/from\s+["']@\/lib\/customer-dedup["']/)
    expect(src).toMatch(/upsertLeadCustomer\s*\(/)
  })

  it("meta webhook imports upsertLeadCustomer", () => {
    const src = read(META_WEBHOOK)
    expect(src).toMatch(/from\s+["']@\/lib\/customer-dedup["']/)
    expect(src).toMatch(/upsertLeadCustomer\s*\(/)
  })

  it('website webhook does NOT raw-upsert customers with onConflict phone', () => {
    const src = read(WEBSITE_WEBHOOK)
    const rawUpsertPattern =
      /\.from\(["']customers["']\)\s*\.upsert\([\s\S]{0,500}onConflict[\s\S]{0,80}tenant_id\s*,\s*phone_number/
    expect(src).not.toMatch(rawUpsertPattern)
  })

  it('meta webhook does NOT raw-upsert customers with onConflict phone', () => {
    const src = read(META_WEBHOOK)
    const rawUpsertPattern =
      /\.from\(["']customers["']\)\s*\.upsert\([\s\S]{0,500}onConflict[\s\S]{0,80}tenant_id\s*,\s*phone_number/
    expect(src).not.toMatch(rawUpsertPattern)
  })
})

describe("Customers dashboard surfaces duplicate-name warnings", () => {
  it("customers page computes firstNameCounts", () => {
    const src = read(CUSTOMERS_PAGE)
    expect(src).toMatch(/firstNameCounts/)
  })

  it("customers page shows DUP NAME badge", () => {
    const src = read(CUSTOMERS_PAGE)
    expect(src).toMatch(/DUP NAME/i)
  })

  it("customers page shows phone number in each row", () => {
    const src = read(CUSTOMERS_PAGE)
    expect(src).toMatch(/Phone row[\s\S]{0,600}formatPhone\(customer\.phone_number\)/)
  })

  it("Create Quote form warns when selected customer has duplicate first name", () => {
    const src = read(CUSTOMERS_PAGE)
    expect(src).toMatch(/Duplicate first name — verify before sending/i)
  })
})
