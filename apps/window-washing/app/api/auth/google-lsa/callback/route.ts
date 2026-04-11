import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getTenantBySlug } from '@/lib/tenant'

/**
 * GET /api/auth/google-lsa/callback
 *
 * Google redirects here after OAuth consent. Exchanges the auth code
 * for access + refresh tokens and stores them on the tenant row.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const tenantSlug = request.nextUrl.searchParams.get('state')
  const error = request.nextUrl.searchParams.get('error')

  if (error) {
    return NextResponse.json({ error: `OAuth denied: ${error}` }, { status: 400 })
  }

  if (!code || !tenantSlug) {
    return NextResponse.json({ error: 'Missing code or state' }, { status: 400 })
  }

  const clientId = process.env.GOOGLE_LSA_CR_CLIENT_ID
  const clientSecret = process.env.GOOGLE_LSA_CR_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Google LSA credentials not configured' }, { status: 500 })
  }

  const tenant = await getTenantBySlug(tenantSlug, false)
  if (!tenant) {
    return NextResponse.json({ error: `Tenant not found: ${tenantSlug}` }, { status: 404 })
  }

  // Exchange authorization code for tokens
  const redirectUri = `${request.nextUrl.origin}/api/auth/google-lsa/callback`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text()
      console.error('[Google LSA OAuth] Token exchange failed:', errBody)
      return NextResponse.json({ error: 'Token exchange failed', details: errBody }, { status: 500 })
    }

    const tokens = await tokenRes.json()
    const { access_token, refresh_token } = tokens

    if (!refresh_token) {
      return NextResponse.json({
        error: 'No refresh_token returned — revoke app access at myaccount.google.com/permissions and try again',
      }, { status: 400 })
    }

    // Save credentials to tenant row
    const supabase = getSupabaseServiceClient()
    const { error: updateError } = await supabase
      .from('tenants')
      .update({
        google_lsa_client_id: clientId,
        google_lsa_client_secret: clientSecret,
        google_lsa_refresh_token: refresh_token,
        workflow_config: {
          ...tenant.workflow_config,
          use_google_lsa: true,
        },
      })
      .eq('id', tenant.id)

    if (updateError) {
      console.error('[Google LSA OAuth] DB update failed:', updateError.message)
      return NextResponse.json({ error: 'Failed to save tokens' }, { status: 500 })
    }

    console.log(`[Google LSA OAuth] Tokens saved for ${tenantSlug}`)

    return NextResponse.json({
      success: true,
      tenant: tenantSlug,
      message: 'Google LSA connected! Refresh token saved.',
      note: 'Still need to set google_lsa_account_id (the LSA account CID) on the tenant row.',
    })

  } catch (err) {
    clearTimeout(timeout)
    console.error('[Google LSA OAuth] Error:', err)
    return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 })
  }
}
