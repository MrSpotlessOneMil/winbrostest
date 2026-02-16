import { NextRequest, NextResponse } from 'next/server'
import { getSession, setSessionCookie } from '@/lib/auth'
import { getTenantById } from '@/lib/tenant'

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

    // Look up tenant status for the online indicator
    let tenantStatus: { active: boolean; smsEnabled: boolean } | null = null
    if (result.user.tenant_id) {
      const tenant = await getTenantById(result.user.tenant_id)
      if (tenant) {
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
