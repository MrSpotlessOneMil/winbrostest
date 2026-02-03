import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'

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

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          email: user.email,
        },
        sessionToken, // Return token for multi-account storage
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
