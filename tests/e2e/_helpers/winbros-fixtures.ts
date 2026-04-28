/**
 * Shared E2E helpers — every winbros-phase spec uses these so we have a
 * single fixture/cleanup contract.
 *
 * Conventions:
 * - All fixtures stamp `PHASE_*_TEST_FIXTURE` strings in human-readable
 *   columns (service_type, address, reason) so a stray row is easy to spot
 *   if cleanup races.
 * - Every helper returns the inserted row id so the spec can register it
 *   for teardown in afterAll.
 * - Tests SHOULD NOT rely on real cleaners' production data — always seed.
 *
 * Auth model:
 * - mintAdminSession() inserts a sessions row with user_id=WinBros admin
 *   and returns the cookie value. Use it as `Cookie: winbros_session=<token>`.
 * - mintCleanerSession(cleanerId) inserts a sessions row with cleaner_id
 *   and returns the token. Same cookie name.
 *
 * Required env: SUPABASE_SERVICE_ROLE_KEY (read from .env.local).
 */

import { randomUUID } from 'crypto'
import type { BrowserContext } from '@playwright/test'

// ──────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────

export const WINBROS_TENANT_ID = 'e954fbd6-b3e1-4271-88b0-341c9df56beb'
export const WINBROS_ADMIN_USER_ID = 2 // username='winbros'

/** Cleaners we use as test personas. Seeded as `(WinBros Test)` accounts. */
export const TEST_PERSONAS = {
  salesman: {
    cleanerId: 134,
    portalToken: '5f6b3902-6851-4581-a211-2333c0b79ed8',
    name: 'Salesman (WinBros Test)',
  },
  techLead: {
    cleanerId: 135,
    portalToken: '8cd7b9a1-3528-4d82-8b65-4152cc723dac',
    name: 'Tech Lead (WinBros Test)',
  },
  technician: {
    cleanerId: 140,
    portalToken: '0f26a1f5dd309560a85c6ed64defe74c',
    name: 'Technician (WinBros Test)',
  },
} as const

export const SUPABASE_URL = 'https://kcmbwstjmdrjkhxhkkjt.supabase.co'

function serviceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY env var is required. Source .env.local before running playwright.'
    )
  }
  return key
}

// ──────────────────────────────────────────────────────────────────────
// Supabase REST helpers
// ──────────────────────────────────────────────────────────────────────

/** GET / POST / PATCH / DELETE a PostgREST URL with service-role auth. */
export async function supabaseRest<T = unknown>(
  pathAndQuery: string,
  init: RequestInit = {}
): Promise<T> {
  const key = serviceKey()
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return (await res.json()) as T
}

/** Best-effort DELETE — ignores 404s and network errors. */
export async function rawDelete(pathAndQuery: string): Promise<void> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return
  await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }).catch(() => {})
}

// ──────────────────────────────────────────────────────────────────────
// Auth: minting + tearing down sessions
// ──────────────────────────────────────────────────────────────────────

function makeOpaqueToken(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
}

export async function mintAdminSession(): Promise<string> {
  const token = makeOpaqueToken()
  await supabaseRest('sessions', {
    method: 'POST',
    body: JSON.stringify({
      user_id: WINBROS_ADMIN_USER_ID,
      cleaner_id: null,
      token,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    }),
  })
  return token
}

export async function mintCleanerSession(cleanerId: number): Promise<string> {
  const token = makeOpaqueToken()
  await supabaseRest('sessions', {
    method: 'POST',
    body: JSON.stringify({
      user_id: null,
      cleaner_id: cleanerId,
      token,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    }),
  })
  return token
}

export async function deleteSession(token: string): Promise<void> {
  await rawDelete(`sessions?token=eq.${encodeURIComponent(token)}`)
}

/** Inject a winbros_session cookie into the Playwright browser context
 *  before navigating, so dashboard pages render against the seeded session. */
export async function attachCookie(
  context: BrowserContext,
  baseUrl: string,
  token: string
): Promise<void> {
  const u = new URL(baseUrl)
  await context.addCookies([
    {
      name: 'winbros_session',
      value: token,
      domain: u.hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ])
}

// ──────────────────────────────────────────────────────────────────────
// Date helpers
// ──────────────────────────────────────────────────────────────────────

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function futureIso(daysAhead: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  return d.toISOString().slice(0, 10)
}

// ──────────────────────────────────────────────────────────────────────
// Domain seeders — every helper returns the row id and tags it as a
// fixture so we can grep for stray rows after a test crash.
// ──────────────────────────────────────────────────────────────────────

export interface SeedJobArgs {
  status?:
    | 'pending'
    | 'scheduled'
    | 'in_progress'
    | 'completed'
    | 'closed'
    | 'cancelled'
  service_type?: string
  date?: string
  cleaner_id?: number | null
  crew_salesman_id?: number | null
  salesman_id?: number | null
  credited_salesman_id?: number | null
  price?: number
  phone_number?: string
  address?: string
}

export async function seedJob(
  args: SeedJobArgs = {}
): Promise<{ id: number }> {
  const rows = await supabaseRest<Array<{ id: number }>>('jobs', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: WINBROS_TENANT_ID,
      status: args.status ?? 'pending',
      service_type: args.service_type ?? 'PHASE_TEST_FIXTURE',
      date: args.date ?? todayIso(),
      address: args.address ?? 'PHASE_TEST_FIXTURE',
      phone_number: args.phone_number ?? '+15555550000',
      price: args.price ?? 250,
      ...(args.cleaner_id !== undefined ? { cleaner_id: args.cleaner_id } : {}),
      ...(args.crew_salesman_id !== undefined
        ? { crew_salesman_id: args.crew_salesman_id }
        : {}),
      ...(args.salesman_id !== undefined ? { salesman_id: args.salesman_id } : {}),
      ...(args.credited_salesman_id !== undefined
        ? { credited_salesman_id: args.credited_salesman_id }
        : {}),
    }),
  })
  return { id: rows[0].id }
}

export interface SeedVisitArgs {
  jobId: number
  status?: 'not_started' | 'in_progress' | 'completed' | 'closed'
  visitDate?: string
}

export async function seedVisit(
  args: SeedVisitArgs
): Promise<{ id: number }> {
  const rows = await supabaseRest<Array<{ id: number }>>('visits', {
    method: 'POST',
    body: JSON.stringify({
      job_id: args.jobId,
      tenant_id: WINBROS_TENANT_ID,
      visit_date: args.visitDate ?? todayIso(),
      visit_number: 1,
      status: args.status ?? 'not_started',
      ...(args.status === 'closed'
        ? { closed_at: new Date().toISOString() }
        : {}),
    }),
  })
  return { id: rows[0].id }
}

export interface SeedLineItemArgs {
  jobId: number
  visitId: number
  serviceName?: string
  price: number
  revenueType?: 'original_quote' | 'technician_upsell'
}

export async function seedLineItem(
  args: SeedLineItemArgs
): Promise<{ id: number }> {
  const rows = await supabaseRest<Array<{ id: number }>>('visit_line_items', {
    method: 'POST',
    body: JSON.stringify({
      visit_id: args.visitId,
      job_id: args.jobId,
      tenant_id: WINBROS_TENANT_ID,
      service_name: args.serviceName ?? 'PHASE_TEST_FIXTURE Service',
      price: args.price,
      revenue_type: args.revenueType ?? 'technician_upsell',
    }),
  })
  return { id: rows[0].id }
}

export interface SeedTimeOffArgs {
  cleanerId: number
  date?: string
  status?: 'pending' | 'approved' | 'denied'
  reason?: string
}

export async function seedTimeOff(
  args: SeedTimeOffArgs
): Promise<{ id: number }> {
  const rows = await supabaseRest<Array<{ id: number }>>('time_off', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: WINBROS_TENANT_ID,
      cleaner_id: args.cleanerId,
      date: args.date ?? futureIso(30),
      status: args.status ?? 'pending',
      reason: args.reason ?? 'PHASE_TEST_FIXTURE',
    }),
  })
  return { id: rows[0].id }
}

// ──────────────────────────────────────────────────────────────────────
// Cleanup registry — collect ids during a test, drain in afterAll.
// ──────────────────────────────────────────────────────────────────────

export interface CleanupRegistry {
  jobIds: number[]
  visitIds: number[]
  lineItemIds: number[]
  quoteIds: number[]
  timeOffIds: number[]
  sessionTokens: string[]
}

export function newRegistry(): CleanupRegistry {
  return {
    jobIds: [],
    visitIds: [],
    lineItemIds: [],
    quoteIds: [],
    timeOffIds: [],
    sessionTokens: [],
  }
}

export async function drainRegistry(reg: CleanupRegistry): Promise<void> {
  // Reverse FK order: quotes can reference jobs (appointment_job_id);
  // line_items + visits reference jobs; sessions are independent.
  for (const id of reg.lineItemIds) await rawDelete(`visit_line_items?id=eq.${id}`)
  for (const id of reg.visitIds) await rawDelete(`visits?id=eq.${id}`)
  for (const id of reg.quoteIds) await rawDelete(`quotes?id=eq.${id}`)
  for (const id of reg.jobIds) await rawDelete(`jobs?id=eq.${id}`)
  for (const id of reg.timeOffIds) await rawDelete(`time_off?id=eq.${id}`)
  for (const t of reg.sessionTokens) await deleteSession(t)
}
