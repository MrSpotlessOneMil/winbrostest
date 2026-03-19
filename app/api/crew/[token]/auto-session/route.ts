/**
 * Auto-Session for Crew Portal
 *
 * POST /api/crew/[token]/auto-session
 *
 * When an employee clicks an SMS link to their portal, this silently creates
 * an employee session cookie so they stay logged in on future visits to
 * theosirisai.com without needing to re-enter credentials.
 *
 * If they already have a valid session, this is a no-op.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { createEmployeeSession, setSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  // If they already have a session cookie, skip
  const existingToken = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (existingToken) {
    return NextResponse.json({ success: true, existing: true })
  }

  // Look up cleaner by portal token
  const client = getSupabaseServiceClient()
  const { data: cleaner } = await client
    .from('cleaners')
    .select('id')
    .eq('portal_token', token)
    .eq('active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (!cleaner) {
    return NextResponse.json({ success: false }, { status: 404 })
  }

  // Create employee session
  const sessionToken = await createEmployeeSession(cleaner.id)

  const response = NextResponse.json({ success: true })
  setSessionCookie(response, sessionToken)

  return response
}
