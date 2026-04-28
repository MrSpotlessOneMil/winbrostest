/**
 * Phase G — Automated message templates (Blake's IMG_0996 flow).
 *
 * Single read-path that any cron / webhook / handler can call to get the
 * tenant-specific message body for a given trigger. Falls back to a
 * sensible default if no row exists yet (so a cron doesn't break when a
 * tenant hasn't seeded their templates).
 *
 * Cache: 60-second in-memory window per (tenant, trigger). Most senders
 * fire in tight bursts (a cron sweeping 50 leads), so re-reading the
 * row 50× is wasteful. Setting a row in Control Center invalidates the
 * cache entry on PATCH (see invalidateMessageCache below).
 *
 * Variable substitution: pure helper renderTemplate handles {{var}} with
 * caller-supplied values. HTML-escaping is the caller's responsibility —
 * SMS bodies don't need it; rendered HTML on customer pages does.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type AutomatedMessageTrigger =
  | 'lead_thanks'
  | 'appointment_confirm'
  | 'on_my_way'
  | 'day_before_reminder'
  | 'receipt'
  | 'review_request'
  | 'thank_you_tip'

interface CacheEntry {
  body: string
  isActive: boolean
  fetchedAt: number
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, CacheEntry>()

function cacheKey(tenantId: string, trigger: string): string {
  return `${tenantId}::${trigger}`
}

/** Wipe a single (tenant, trigger) entry. Called on PATCH so admin
 *  edits land within milliseconds, not 60s later. */
export function invalidateMessageCache(tenantId: string, trigger: string): void {
  cache.delete(cacheKey(tenantId, trigger))
}

/** Wipe ALL cache entries — testing only. */
export function clearMessageCacheForTests(): void {
  cache.clear()
}

/**
 * Resolve the template body for a trigger. Returns:
 *   { body, isActive, source: 'cache' | 'db' | 'fallback' }
 *
 * If a row exists with is_active=false, the row is honored (returned
 * with isActive=false) so the caller can decide whether to skip the
 * send. Inactive ≠ deleted; admin may have temporarily disabled a flow.
 */
export async function resolveAutomatedMessage(
  client: SupabaseClient,
  args: {
    tenantId: string
    trigger: AutomatedMessageTrigger
    /** Body used when no row exists. Keeps every cron sane during rollout. */
    fallbackBody: string
  }
): Promise<{ body: string; isActive: boolean; source: 'cache' | 'db' | 'fallback' }> {
  const key = cacheKey(args.tenantId, args.trigger)
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { body: cached.body, isActive: cached.isActive, source: 'cache' }
  }

  const { data, error } = await client
    .from('automated_messages')
    .select('message_template, is_active')
    .eq('tenant_id', args.tenantId)
    .eq('trigger_type', args.trigger)
    .maybeSingle()

  if (error || !data) {
    // Don't cache the fallback — admin may save the row at any moment
    // and we don't want to wait 60s before picking it up.
    return { body: args.fallbackBody, isActive: true, source: 'fallback' }
  }

  const entry: CacheEntry = {
    body: (data.message_template as string) || args.fallbackBody,
    isActive: data.is_active !== false,
    fetchedAt: now,
  }
  cache.set(key, entry)
  return { body: entry.body, isActive: entry.isActive, source: 'db' }
}

/**
 * Pure {{var}} substitution. Skips any {{name}} that's not in `vars`
 * so you can call it with partial data and it leaves untouched
 * placeholders for a later pass.
 *
 * Caller decides on escaping — SMS bodies use raw output, HTML rendering
 * should pre-escape values before passing them in.
 */
export function renderTemplate(
  body: string,
  vars: Record<string, string | number | null | undefined>
): string {
  return body.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return match
    const v = vars[name]
    if (v === null || v === undefined) return ''
    return String(v)
  })
}
