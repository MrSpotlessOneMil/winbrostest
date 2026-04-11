import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/auth/google-lsa?tenant=cedar-rapids
 *
 * Redirects to Google OAuth consent screen to authorize
 * Local Services API access for a tenant.
 */
export async function GET(request: NextRequest) {
  const tenant = request.nextUrl.searchParams.get('tenant')
  if (!tenant) {
    return NextResponse.json({ error: 'Missing ?tenant= parameter' }, { status: 400 })
  }

  const clientId = process.env.GOOGLE_LSA_CR_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: 'GOOGLE_LSA_CR_CLIENT_ID not configured' }, { status: 500 })
  }

  const redirectUri = `${request.nextUrl.origin}/api/auth/google-lsa/callback`

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/adwords',
    access_type: 'offline',
    prompt: 'consent',
    state: tenant,
  })

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/auth?${params.toString()}`)
}
