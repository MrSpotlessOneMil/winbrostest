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

/**
 * DISABLED — auto-session was overwriting the dashboard admin cookie with
 * an employee session (same cookie name), causing cleaners to get admin access
 * and admins to get locked out. Cleaners access the portal via their token
 * link directly — no session cookie needed.
 */
export async function POST(
  _request: NextRequest,
  { params: _params }: { params: Promise<{ token: string }> }
) {
  return NextResponse.json({ success: true, disabled: true })
}
