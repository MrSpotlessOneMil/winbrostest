/**
 * Phase G — automated message helpers.
 *
 * Pure-ish: resolveAutomatedMessage takes a fake Supabase client so we
 * can drive the cache, fallback, and is_active branches without hitting
 * a real DB. renderTemplate is fully pure.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  renderTemplate,
  resolveAutomatedMessage,
  invalidateMessageCache,
  clearMessageCacheForTests,
} from '@/apps/window-washing/lib/automated-messages'

beforeEach(() => {
  clearMessageCacheForTests()
})

interface MockRow {
  message_template: string
  is_active: boolean
}

function makeFakeClient(rows: Record<string, MockRow | null>, callCounter: { count: number }): any {
  return {
    from(table: string) {
      if (table !== 'automated_messages') {
        throw new Error(`unexpected table ${table}`)
      }
      let tenantId: string | null = null
      let trigger: string | null = null
      const builder = {
        select(_: string) { return builder },
        eq(col: string, val: string) {
          if (col === 'tenant_id') tenantId = val
          if (col === 'trigger_type') trigger = val
          return builder
        },
        async maybeSingle() {
          callCounter.count++
          const key = `${tenantId}::${trigger}`
          const row = rows[key]
          if (row === undefined) return { data: null, error: null }
          return { data: row, error: null }
        },
      }
      return builder
    },
  }
}

describe('renderTemplate', () => {
  it('substitutes {{var}} from the supplied dictionary', () => {
    expect(
      renderTemplate('Hi {{name}}, your job is at {{time}}.', { name: 'Alice', time: '3pm' })
    ).toBe('Hi Alice, your job is at 3pm.')
  })

  it('handles whitespace inside the braces', () => {
    expect(renderTemplate('{{ name }}', { name: 'Bob' })).toBe('Bob')
  })

  it('substitutes numbers as strings', () => {
    expect(renderTemplate('${{price}}', { price: 99 })).toBe('$99')
  })

  it('renders null/undefined as empty string', () => {
    expect(renderTemplate('Hi {{name}}!', { name: null })).toBe('Hi !')
    expect(renderTemplate('Hi {{name}}!', { name: undefined })).toBe('Hi !')
  })

  it('leaves unknown placeholders untouched (so a second pass can fill them)', () => {
    expect(renderTemplate('{{x}} and {{y}}', { x: '1' })).toBe('1 and {{y}}')
  })

  it('does not interpret HTML — caller controls escaping', () => {
    expect(renderTemplate('Hi {{n}}', { n: '<script>' })).toBe('Hi <script>')
  })

  it('rejects invalid identifiers (no execution, no error)', () => {
    // {{1}} or {{a-b}} aren't valid var names; leave as-is.
    expect(renderTemplate('{{1}} {{a-b}}', {})).toBe('{{1}} {{a-b}}')
  })
})

describe('resolveAutomatedMessage', () => {
  const TENANT = 't1'
  const FALLBACK = 'fallback-body'

  it('returns the DB row when one exists', async () => {
    const calls = { count: 0 }
    const client = makeFakeClient(
      { 't1::lead_thanks': { message_template: 'Hi {{name}}', is_active: true } },
      calls
    )
    const r = await resolveAutomatedMessage(client, {
      tenantId: TENANT,
      trigger: 'lead_thanks',
      fallbackBody: FALLBACK,
    })
    expect(r).toEqual({ body: 'Hi {{name}}', isActive: true, source: 'db' })
    expect(calls.count).toBe(1)
  })

  it('returns the fallback when no row exists', async () => {
    const calls = { count: 0 }
    const client = makeFakeClient({}, calls)
    const r = await resolveAutomatedMessage(client, {
      tenantId: TENANT,
      trigger: 'on_my_way',
      fallbackBody: FALLBACK,
    })
    expect(r).toEqual({ body: FALLBACK, isActive: true, source: 'fallback' })
  })

  it('preserves is_active=false from the DB so callers can skip', async () => {
    const calls = { count: 0 }
    const client = makeFakeClient(
      { 't1::receipt': { message_template: 'paused', is_active: false } },
      calls
    )
    const r = await resolveAutomatedMessage(client, {
      tenantId: TENANT,
      trigger: 'receipt',
      fallbackBody: FALLBACK,
    })
    expect(r.isActive).toBe(false)
    expect(r.body).toBe('paused')
  })

  it('caches DB hits within the 60s window (second call does not query)', async () => {
    const calls = { count: 0 }
    const client = makeFakeClient(
      { 't1::lead_thanks': { message_template: 'cached', is_active: true } },
      calls
    )
    await resolveAutomatedMessage(client, {
      tenantId: TENANT,
      trigger: 'lead_thanks',
      fallbackBody: FALLBACK,
    })
    const r2 = await resolveAutomatedMessage(client, {
      tenantId: TENANT,
      trigger: 'lead_thanks',
      fallbackBody: FALLBACK,
    })
    expect(r2.source).toBe('cache')
    expect(calls.count).toBe(1)
  })

  it('does NOT cache fallbacks (so a fresh save lands instantly)', async () => {
    const calls = { count: 0 }
    const client = makeFakeClient({}, calls)
    await resolveAutomatedMessage(client, {
      tenantId: TENANT,
      trigger: 'lead_thanks',
      fallbackBody: FALLBACK,
    })
    await resolveAutomatedMessage(client, {
      tenantId: TENANT,
      trigger: 'lead_thanks',
      fallbackBody: FALLBACK,
    })
    expect(calls.count).toBe(2)
  })

  it('invalidateMessageCache forces the next call to re-query the DB', async () => {
    const calls = { count: 0 }
    const client = makeFakeClient(
      { 't1::lead_thanks': { message_template: 'v1', is_active: true } },
      calls
    )
    const r1 = await resolveAutomatedMessage(client, {
      tenantId: TENANT,
      trigger: 'lead_thanks',
      fallbackBody: FALLBACK,
    })
    expect(r1.body).toBe('v1')
    invalidateMessageCache(TENANT, 'lead_thanks')
    const r2 = await resolveAutomatedMessage(client, {
      tenantId: TENANT,
      trigger: 'lead_thanks',
      fallbackBody: FALLBACK,
    })
    expect(r2.source).toBe('db')
    expect(calls.count).toBe(2)
  })

  it('cache is per-(tenant, trigger) — different triggers don\'t share', async () => {
    const calls = { count: 0 }
    const client = makeFakeClient(
      {
        't1::lead_thanks': { message_template: 'A', is_active: true },
        't1::receipt': { message_template: 'B', is_active: true },
      },
      calls
    )
    const a = await resolveAutomatedMessage(client, {
      tenantId: TENANT,
      trigger: 'lead_thanks',
      fallbackBody: FALLBACK,
    })
    const b = await resolveAutomatedMessage(client, {
      tenantId: TENANT,
      trigger: 'receipt',
      fallbackBody: FALLBACK,
    })
    expect(a.body).toBe('A')
    expect(b.body).toBe('B')
    expect(calls.count).toBe(2)
  })
})
