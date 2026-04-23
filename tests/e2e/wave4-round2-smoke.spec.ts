/**
 * Wave 4 (Round 2) — Pricing editability audit smoke
 *
 * The job-detail drawer's in-drawer Price Book used to be a hardcoded
 * constant. Wave 4 swapped it for a live fetch from
 * /api/actions/tech-upsell-catalog. These tests pin:
 *   - The endpoint the drawer depends on still returns usable rows
 *     (name + price, price is a number or numeric string).
 *   - Admin PATCH of tech_upsell_catalog.price round-trips so the
 *     drawer will pick up the new price on next open.
 *   - Admin PATCH of quote_line_items.price via the builder API also
 *     round-trips so line-item prices are actually editable end-to-end.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002'

test.describe('Wave 4 pricing editability', () => {
  test('tech-upsell-catalog GET feeds the drawer with editable rows', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/actions/tech-upsell-catalog`)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.length).toBeGreaterThanOrEqual(1)
    for (const it of body.items) {
      expect(typeof it.name).toBe('string')
      expect(['number', 'string']).toContain(typeof it.price)
      expect(Number(it.price)).toBeGreaterThanOrEqual(0)
    }
  })

  test('admin can PATCH tech_upsell_catalog price', async ({ request }) => {
    const created = await request.post(`${BASE_URL}/api/actions/tech-upsell-catalog`, {
      data: { name: 'E2E_WAVE4_row', price: 100 },
    })
    if (!created.ok()) {
      throw new Error(`create failed: ${created.status()} ${await created.text()}`)
    }
    const { item } = await created.json()

    const patched = await request.fetch(
      `${BASE_URL}/api/actions/tech-upsell-catalog?id=${item.id}`,
      { method: 'PATCH', data: { price: 237.5 } }
    )
    expect(patched.ok()).toBe(true)
    const patchedBody = await patched.json()
    expect(Number(patchedBody.item.price)).toBe(237.5)

    // Cleanup (soft delete so we don't pollute future GET)
    await request.fetch(`${BASE_URL}/api/actions/tech-upsell-catalog?id=${item.id}`, {
      method: 'DELETE',
    })
  })

  test('admin can PATCH quote line item prices via builder API', async ({ request }) => {
    const create = await request.post(`${BASE_URL}/api/actions/quotes`, {
      data: {
        customer_name: 'E2E_WAVE4_customer',
        line_items: [
          { service_name: 'E2E_WAVE4_line', price: 100, optionality: 'required' },
        ],
      },
    })
    if (!create.ok()) {
      throw new Error(`quote create failed: ${create.status()} ${await create.text()}`)
    }
    const { quote } = await create.json()

    const patch = await request.fetch(`${BASE_URL}/api/actions/quotes/${quote.id}`, {
      method: 'PATCH',
      data: {
        line_items: [
          { service_name: 'E2E_WAVE4_line', price: 425.75, optionality: 'required' },
        ],
      },
    })
    expect(patch.ok()).toBe(true)
    const body = await patch.json()
    expect(body.line_items.length).toBe(1)
    expect(Number(body.line_items[0].price)).toBe(425.75)
  })

  test('admin can edit quote total_price + original_price directly', async ({ request }) => {
    const create = await request.post(`${BASE_URL}/api/actions/quotes`, {
      data: {
        customer_name: 'E2E_WAVE4_price_anchor',
        line_items: [{ service_name: 'x', price: 1, optionality: 'required' }],
      },
    })
    if (!create.ok()) {
      throw new Error(`quote create failed: ${create.status()} ${await create.text()}`)
    }
    const { quote } = await create.json()

    const patch = await request.fetch(`${BASE_URL}/api/actions/quotes/${quote.id}`, {
      method: 'PATCH',
      data: { total_price: 425.75, original_price: 500 },
    })
    expect(patch.ok()).toBe(true)
    const body = await patch.json()
    expect(Number(body.quote.total_price)).toBe(425.75)
    expect(Number(body.quote.original_price)).toBe(500)
  })
})
