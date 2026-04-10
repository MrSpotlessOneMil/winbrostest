import { NextRequest, NextResponse } from 'next/server'
import { deleteSession, clearSessionCookie } from '@/lib/auth'

const SESSION_COOKIE_NAME = 'winbros_session'

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value

    if (token) {
      await deleteSession(token)
    }

    const response = NextResponse.json({
      success: true,
      message: 'Logged out successfully',
    })

    clearSessionCookie(response)

    return response
  } catch (error) {
    console.error('Logout error:', error)
    return NextResponse.json(
      { success: false, error: 'Logout failed' },
      { status: 500 }
    )
  }
}
