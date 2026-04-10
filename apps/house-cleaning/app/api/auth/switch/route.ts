import { NextRequest, NextResponse } from 'next/server'
import { getSession, setSessionCookie } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionToken } = body

    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: 'Session token is required' },
        { status: 400 }
      )
    }

    // Validate the session token
    const result = await getSession(sessionToken)

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session' },
        { status: 401 }
      )
    }

    // Look up tenant info for the online indicator and account label
    // NOTE: Must NOT filter by active=true — we need to READ the active status
    let tenantStatus: { active: boolean; smsEnabled: boolean } | null = null
    let tenantSlug: string | null = null
    if (result.user.tenant_id) {
      const client = getSupabaseServiceClient()
      const { data: tenant } = await client
        .from('tenants')
        .select('slug, active, workflow_config')
        .eq('id', result.user.tenant_id)
        .single()

      if (tenant) {
        tenantSlug = tenant.slug
        const wc = tenant.workflow_config as Record<string, any> | null
        tenantStatus = {
          active: tenant.active !== false,
          smsEnabled: wc?.sms_auto_response_enabled !== false,
        }
      }
    }

    // Create response with user data
    const response = NextResponse.json({
      success: true,
      data: {
        user: {
          id: result.user.id,
          username: result.user.username,
          display_name: result.user.display_name,
          email: result.user.email,
          tenantSlug,
        },
        tenantStatus,
      },
    })

    // Set the session cookie to the provided token
    setSessionCookie(response, sessionToken)

    return response
  } catch (error) {
    console.error('Switch account error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to switch account' },
      { status: 500 }
    )
  }
}
