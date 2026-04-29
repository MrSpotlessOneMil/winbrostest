/**
 * customers-scope unit — pin role-scoping rules so a refactor can't
 * accidentally expand a tech's customer reach to other techs' customers
 * or leak salesman-only quotes into a TL view.
 */

import { describe, it, expect } from 'vitest'
import { scopeCustomerIdsForCleaner } from '@/apps/window-washing/lib/customers-scope'

interface FakeData {
  jobs?: { customer_id: number; cleaner_id?: number; salesman_id?: number; credited_salesman_id?: number }[]
  quotes?: { customer_id: number; salesman_id?: number }[]
  service_plans?: { customer_id: number; salesman_id?: number }[]
  crew_days?: { cleaner_id: number; team_lead_id: number; date: string }[]
}

/**
 * Minimal Supabase stub. Records the table + filters and returns the
 * matching rows from a pre-staged dataset.
 */
function makeFakeClient(data: FakeData): any {
  return {
    from(table: string) {
      let rows: any[] =
        (data as any)[table] ? [...(data as any)[table]] : []
      const builder: any = {
        _filters: [] as Array<{ kind: string; col: string; val: any }>,
        select(_: string) { return builder },
        order(_col: string, _opts?: any) { return builder },
        limit(_n: number) { return builder },
        in(col: string, vals: any[]) {
          rows = rows.filter((r) => vals.includes(r[col]))
          return builder
        },
        eq(col: string, val: any) {
          rows = rows.filter((r) => r[col] === val)
          return builder
        },
        gte(col: string, val: any) {
          rows = rows.filter((r) => r[col] >= val)
          return builder
        },
        or(filterStr: string) {
          // Parse "salesman_id.eq.7,credited_salesman_id.eq.7"
          const clauses = filterStr.split(',').map((c) => {
            const [col, op, val] = c.split('.')
            return { col, op, val: isNaN(Number(val)) ? val : Number(val) }
          })
          rows = rows.filter((r) =>
            clauses.some((c) => c.op === 'eq' && r[c.col] === c.val),
          )
          return builder
        },
        then(resolve: (v: { data: any[] }) => void) {
          resolve({ data: rows })
        },
      }
      return builder
    },
  }
}

describe('scopeCustomerIdsForCleaner', () => {
  it('returns null for admin (no cleaner)', async () => {
    const result = await scopeCustomerIdsForCleaner(makeFakeClient({}) as any, null)
    expect(result).toBeNull()
  })

  it('tech sees only customers from jobs where cleaner_id = me', async () => {
    const client = makeFakeClient({
      jobs: [
        { customer_id: 1, cleaner_id: 7 },
        { customer_id: 2, cleaner_id: 7 },
        { customer_id: 3, cleaner_id: 99 }, // someone else's customer
      ],
    })
    const result = await scopeCustomerIdsForCleaner(client as any, {
      id: 7,
      employee_type: 'technician',
      is_team_lead: false,
    })
    expect(result).not.toBeNull()
    expect(Array.from(result!).sort()).toEqual([1, 2])
  })

  it('tech with no jobs returns empty set (NOT null — admin-fallback would leak)', async () => {
    const client = makeFakeClient({ jobs: [] })
    const result = await scopeCustomerIdsForCleaner(client as any, {
      id: 7,
      employee_type: 'technician',
      is_team_lead: false,
    })
    expect(result).not.toBeNull()
    expect(result!.size).toBe(0)
  })

  it('salesman sees jobs.salesman_id + credited_salesman_id + quotes + service_plans', async () => {
    const client = makeFakeClient({
      jobs: [
        { customer_id: 10, salesman_id: 5, credited_salesman_id: 0 },
        { customer_id: 11, credited_salesman_id: 5 }, // override credited path
        { customer_id: 12, cleaner_id: 5 }, // not a salesman path — should NOT count
      ],
      quotes: [
        { customer_id: 13, salesman_id: 5 },
        { customer_id: 14, salesman_id: 99 },
      ],
      service_plans: [
        { customer_id: 15, salesman_id: 5 },
      ],
    })
    const result = await scopeCustomerIdsForCleaner(client as any, {
      id: 5,
      employee_type: 'salesman',
      is_team_lead: false,
    })
    expect(Array.from(result!).sort((a, b) => a - b)).toEqual([10, 11, 13, 15])
  })

  it('TL sees their own jobs + jobs of cleaners on their recent crew_days', async () => {
    const client = makeFakeClient({
      jobs: [
        { customer_id: 20, cleaner_id: 100 }, // TL themselves
        { customer_id: 21, cleaner_id: 101 }, // crew member
        { customer_id: 22, cleaner_id: 102 }, // crew member
        { customer_id: 23, cleaner_id: 999 }, // unrelated
      ],
      crew_days: [
        { cleaner_id: 101, team_lead_id: 100, date: '2026-04-15' },
        { cleaner_id: 102, team_lead_id: 100, date: '2026-04-20' },
        { cleaner_id: 103, team_lead_id: 200, date: '2026-04-22' }, // someone else's crew
      ],
    })
    const result = await scopeCustomerIdsForCleaner(client as any, {
      id: 100,
      employee_type: 'team_lead',
      is_team_lead: true,
    })
    expect(Array.from(result!).sort((a, b) => a - b)).toEqual([20, 21, 22])
  })

  it('TL crew lookup ignores crew_days older than 90 days', async () => {
    const oldDate = (() => {
      const d = new Date()
      d.setDate(d.getDate() - 200)
      return d.toISOString().slice(0, 10)
    })()
    const client = makeFakeClient({
      jobs: [
        { customer_id: 30, cleaner_id: 100 },
        { customer_id: 31, cleaner_id: 101 },
      ],
      crew_days: [
        { cleaner_id: 101, team_lead_id: 100, date: oldDate }, // too old
      ],
    })
    const result = await scopeCustomerIdsForCleaner(client as any, {
      id: 100,
      employee_type: 'team_lead',
      is_team_lead: true,
    })
    // Only TL's own customer (30) — 31 belonged to a stale crew member
    expect(Array.from(result!)).toEqual([30])
  })

  it('non-tech, non-salesman, non-TL still returns the user_own scope (defense in depth)', async () => {
    const client = makeFakeClient({
      jobs: [{ customer_id: 40, cleaner_id: 50 }],
    })
    const result = await scopeCustomerIdsForCleaner(client as any, {
      id: 50,
      employee_type: null, // unknown role — fall back to "your own jobs only"
      is_team_lead: false,
    })
    expect(Array.from(result!)).toEqual([40])
  })
})
