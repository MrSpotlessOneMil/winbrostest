import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

const SESSION_COOKIE_NAME = 'winbros_session'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Get session token from cookie for multi-account support
    const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value

    // Look up tenant info for the online indicator and account label
    // NOTE: Must NOT filter by active=true — we need to READ the active status
    let tenantStatus: { active: boolean; smsEnabled: boolean } | null = null
    let tenantSlug: string | null = null
    if (user.tenant_id) {
      const client = getSupabaseServiceClient()
      const { data: tenant } = await client
        .from('tenants')
        .select('slug, active, workflow_config')
        .eq('id', user.tenant_id)
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

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          email: user.email,
          tenantSlug,
        },
        sessionToken, // Return token for multi-account storage
        tenantStatus,
      },
    })
  } catch (error) {
    console.error('Session check error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to check session' },
      { status: 500 }
    )
  }
}
