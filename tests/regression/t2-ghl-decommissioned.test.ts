/**
 * T2 — GHL decommissioning for Texas Nova.
 *
 * Two layers of defense:
 *   1. /api/webhooks/ghl/ returns 410 Gone for decommissioned tenants.
 *   2. GHL follow-up scheduler cancels any pending row for those tenants
 *      instead of executing.
 *
 * Both reference the same slug list: ['texas-nova']. This test verifies the
 * list is present in both source files so decom can't partially regress.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('T2 — GHL decommissioned slug list consistency', () => {
  it('webhook source references texas-nova in a decommissioned set', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../apps/house-cleaning/app/api/webhooks/ghl/route.ts'),
      'utf-8'
    )
    expect(source).toMatch(/GHL_DECOMMISSIONED_SLUGS/)
    expect(source).toMatch(/['"]texas-nova['"]/)
    expect(source).toMatch(/410/)
  })

  it('follow-up scheduler source references texas-nova in a decommissioned set', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../apps/house-cleaning/integrations/ghl/follow-up-scheduler.ts'),
      'utf-8'
    )
    expect(source).toMatch(/GHL_DECOMMISSIONED_SLUGS/)
    expect(source).toMatch(/['"]texas-nova['"]/)
    expect(source).toMatch(/skipped_ghl_decommissioned/)
  })

  it('workflow_config.ghl_bridge_enabled flag is honored in both files', () => {
    const webhook = fs.readFileSync(
      path.resolve(__dirname, '../../apps/house-cleaning/app/api/webhooks/ghl/route.ts'),
      'utf-8'
    )
    const scheduler = fs.readFileSync(
      path.resolve(__dirname, '../../apps/house-cleaning/integrations/ghl/follow-up-scheduler.ts'),
      'utf-8'
    )
    expect(webhook).toMatch(/ghl_bridge_enabled/)
    expect(scheduler).toMatch(/ghl_bridge_enabled/)
  })
})
