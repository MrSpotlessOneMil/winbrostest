import { NextRequest, NextResponse } from 'next/server'
import { getSession, setSessionCookie } from '@/lib/auth'

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
