/**
 * T1 — Web-form submit surfaces structured errors.
 *
 * Linda Kingcade incident (2026-04-20): form returned generic "Something
 * went wrong" with no signal about the actual DB error. The fix: structured
 * logSystemEvent with PostgrestError details, response includes an error
 * code + reference ID, and a health probe route checks preconditions.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const WEBSITE_ROUTE = path.resolve(__dirname, '../../apps/house-cleaning/app/api/webhooks/website/[slug]/route.ts')
const HEALTH_ROUTE = path.resolve(__dirname, '../../apps/house-cleaning/app/api/health/form-submit/route.ts')

describe('T1 — website webhook structured errors', () => {
  const source = fs.readFileSync(WEBSITE_ROUTE, 'utf-8')

  it('logs WEBSITE_FORM_LEAD_INSERT_FAIL with PostgrestError fields', () => {
    expect(source).toMatch(/WEBSITE_FORM_LEAD_INSERT_FAIL/)
    expect(source).toMatch(/leadError\.code/)
    expect(source).toMatch(/leadError\.message/)
    expect(source).toMatch(/leadError\.details/)
    expect(source).toMatch(/leadError\.hint/)
  })

  it('returns error code + reference ID to client (not generic "Failed")', () => {
    expect(source).toMatch(/lead_insert_failed/)
    expect(source).toMatch(/ref:/)
  })

  it('logs parse errors to system_events', () => {
    expect(source).toMatch(/WEBSITE_FORM_PARSE_FAIL/)
  })
})

describe('T1 — /api/health/form-submit probe', () => {
  const source = fs.readFileSync(HEALTH_ROUTE, 'utf-8')

  it('checks tenant resolution', () => {
    expect(source).toMatch(/tenant_resolution/)
  })
  it('checks OpenPhone config', () => {
    expect(source).toMatch(/openphone_config/)
  })
  it('checks pricing_tiers seed', () => {
    expect(source).toMatch(/pricing_tiers_seeded/)
  })
  it('checks pricing_addons seed', () => {
    expect(source).toMatch(/pricing_addons_seeded/)
  })
  it('probes a real leads INSERT with cleanup', () => {
    expect(source).toMatch(/leads_insert/)
    expect(source).toMatch(/delete\(\)\.eq\("id", probeLead\.id\)/)
  })
  it('probes a real customers INSERT with cleanup', () => {
    expect(source).toMatch(/customers_insert/)
    expect(source).toMatch(/delete\(\)\.eq\("id", probeCustomer\.id\)/)
  })
  it('requires CRON_SECRET auth', () => {
    expect(source).toMatch(/verifyCronAuth/)
  })
  it('checks TENANT_TIER_ADDITIONS registration (T7 prep)', () => {
    expect(source).toMatch(/tenant_tier_additions_registered/)
  })
})
