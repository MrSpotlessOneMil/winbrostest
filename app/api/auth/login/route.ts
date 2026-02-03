import { NextRequest, NextResponse } from 'next/server'
import {
  verifyPassword,
  createSession,
  setSessionCookie,
} from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, password } = body

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Username and password are required' },
        { status: 400 }
      )
    }

    const user = await verifyPassword(username, password)

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Invalid username or password' },
        { status: 401 }
      )
    }

    const token = await createSession(user.id)

    const response = NextResponse.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          email: user.email,
        },
        sessionToken: token, // Return token for multi-account support
      },
    })

    setSessionCookie(response, token)

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { success: false, error: 'Login failed' },
      { status: 500 }
    )
  }
}
