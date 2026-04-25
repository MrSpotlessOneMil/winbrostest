/**
 * Portal Token Exchange — magic-link auto-signin for SMS deeplinks.
 *
 * GET /api/auth/portal-exchange?token=<portal_token>&next=<relative path>
 *
 * Looks up cleaners.portal_token, mints a fresh winbros_session, and 302s to
 * the requested next path on the dashboard. Replaces the legacy /crew/<token>
 * SMS landing flow so techs/salesmen/team-leads land on the dashboard.
 *
 * Security:
 *  - `next` must be a same-origin RELATIVE path (starts with `/`, no protocol).
 *    Rejects open-redirect attempts.
 *  - Cleaner must be active and not soft-deleted.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createEmployeeSession, setSessionCookie } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

const DEFAULT_NEXT = '/schedule'

function isSafeNextPath(next: string): boolean {
  if (!next) return false
  if (!next.startsWith('/')) return false
  if (next.startsWith('//')) return false
  if (/^\/?[a-z][a-z0-9+.-]*:/i.test(next)) return false
  return true
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const token = url.searchParams.get('token')
  const rawNext = url.searchParams.get('next') || DEFAULT_NEXT
  const next = isSafeNextPath(rawNext) ? rawNext : DEFAULT_NEXT

  if (!token || typeof token !== 'string' || token.length < 16) {
    return NextResponse.redirect(new URL('/login?error=invalid_link', request.url))
  }

  const client = getSupabaseServiceClient()

  const { data: cleaner, error } = await client
    .from('cleaners')
    .select('id, active, deleted_at')
    .eq('portal_token', token)
    .single()

  if (error || !cleaner || !cleaner.active || cleaner.deleted_at) {
    return NextResponse.redirect(new URL('/login?error=invalid_link', request.url))
  }

  let sessionToken: string
  try {
    sessionToken = await createEmployeeSession(cleaner.id)
  } catch (e) {
    console.error('[portal-exchange] createEmployeeSession failed:', e)
    return NextResponse.redirect(new URL('/login?error=session_failed', request.url))
  }

  const response = NextResponse.redirect(new URL(next, request.url))
  setSessionCookie(response, sessionToken)
  return response
}
