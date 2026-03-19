import { NextRequest, NextResponse } from 'next/server'
import {
  verifyPassword,
  verifyEmployeePassword,
  createSession,
  createEmployeeSession,
  setSessionCookie,
} from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

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

    // Try owner/manager login first
    const user = await verifyPassword(username, password)

    if (user) {
      const token = await createSession(user.id)

      // Look up tenant slug for account switcher dedup
      let tenantSlug: string | null = null
      if (user.tenant_id) {
        const client = getSupabaseServiceClient()
        const { data: tenant } = await client
          .from('tenants')
          .select('slug')
          .eq('id', user.tenant_id)
          .single()
        if (tenant) tenantSlug = tenant.slug
      }

      const response = NextResponse.json({
        success: true,
        data: {
          type: 'owner',
          user: {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            email: user.email,
            tenantSlug,
          },
          sessionToken: token,
        },
      })

      setSessionCookie(response, token)
      return response
    }

    // Fallback: try employee (cleaner) login
    const cleaner = await verifyEmployeePassword(username, password)

    if (cleaner) {
      const token = await createEmployeeSession(cleaner.id)

      const response = NextResponse.json({
        success: true,
        data: {
          type: 'employee',
          user: {
            id: -cleaner.id,
            username: cleaner.username,
            display_name: cleaner.name,
          },
          portalToken: cleaner.portal_token,
          sessionToken: token,
        },
      })

      setSessionCookie(response, token)
      return response
    }

    return NextResponse.json(
      { success: false, error: 'Invalid username or password' },
      { status: 401 }
    )
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { success: false, error: 'Login failed' },
      { status: 500 }
    )
  }
}
