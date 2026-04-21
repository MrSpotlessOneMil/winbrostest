/**
 * Regression test: VAPI catch-all webhook must NEVER default to a hardcoded tenant slug.
 *
 * Incident: 2026-04-20 audit found `apps/house-cleaning/app/api/webhooks/vapi/route.ts`
 * hardcoded `handleVapiWebhook(payload, 'winbros')` as the default. Any HC VAPI event
 * with a missing/unknown assistant ID was being written under the WinBros tenant →
 * cross-tenant data pollution + wrong-tenant outbound SMS.
 *
 * Fix: the catch-all resolves tenantSlug from `payload.message.call.metadata.tenantSlug`
 * and returns 400 when absent. Production traffic should route via /api/webhooks/vapi/[slug].
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const HC_VAPI_ROUTE = path.resolve(
  __dirname,
  '../../apps/house-cleaning/app/api/webhooks/vapi/route.ts',
)

describe('VAPI catch-all webhook — cross-tenant bleed prevention', () => {
  const source = fs.readFileSync(HC_VAPI_ROUTE, 'utf-8')

  it('does NOT call handleVapiWebhook with a hardcoded tenant slug', () => {
    // Block any string literal in the second argument position: handleVapiWebhook(..., 'anything')
    const hardcodedSlug = source.match(/handleVapiWebhook\([^,]+,\s*['"]([a-z-]+)['"]\s*\)/)
    expect(
      hardcodedSlug,
      `handleVapiWebhook called with hardcoded slug: ${hardcodedSlug?.[1]}. ` +
        `Resolve tenantSlug from payload metadata instead.`,
    ).toBeNull()
  })

  it('specifically does NOT contain the winbros default (old bug)', () => {
    // Belt-and-suspenders: the exact old string must never reappear.
    expect(source).not.toMatch(/handleVapiWebhook\([^)]*,\s*['"]winbros['"]/)
  })

  it('resolves tenantSlug from payload metadata', () => {
    // The route must read the slug from the VAPI payload before dispatching.
    expect(source).toMatch(/metadata\??\.\s*tenantSlug/)
  })

  it('returns HTTP 400 when tenantSlug is missing', () => {
    // The route should refuse unroutable requests with a 400 response somewhere in POST.
    expect(source).toMatch(/status:\s*400/)
    expect(source.toLowerCase()).toMatch(/tenantslug|tenant\s?slug/i)
  })
})
