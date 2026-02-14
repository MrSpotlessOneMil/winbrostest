import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSupabaseServiceClient } from './supabase'
import { getUserApiKeys, type UserApiKeys } from './user-api-keys'
import { getTenantById, type Tenant } from './tenant'

const SESSION_COOKIE_NAME = 'winbros_session'
const SESSION_DURATION_DAYS = 30

export interface AuthUser {
  id: number
  username: string
  display_name: string | null
  email: string | null
  tenant_id: string | null
  is_active: boolean
}

export interface Session {
  id: string
  user_id: number
  token: string
  expires_at: string
  created_at: string
}

function generateToken(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifyPassword(
  username: string,
  password: string
): Promise<AuthUser | null> {
  const client = getSupabaseServiceClient()

  const { data: user, error } = await client
    .from('users')
    .select('id, username, display_name, email, tenant_id, is_active, password_hash')
    .eq('username', username)
    .eq('is_active', true)
    .single()

  if (error || !user) {
    return null
  }

  // Use the verify_password function we created in the schema
  const { data: isValid, error: verifyError } = await client.rpc('verify_password', {
    password_input: password,
    password_hash: user.password_hash,
  })

  if (verifyError || !isValid) {
    return null
  }

  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    email: user.email,
    tenant_id: user.tenant_id,
    is_active: user.is_active,
  }
}

export async function createSession(userId: number): Promise<string> {
  const client = getSupabaseServiceClient()
  const token = generateToken()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS)

  const { error } = await client.from('sessions').insert({
    user_id: userId,
    token,
    expires_at: expiresAt.toISOString(),
  })

  if (error) {
    console.error('Error creating session:', error)
    throw new Error('Failed to create session')
  }

  return token
}

export async function getSession(
  token: string
): Promise<{ session: Session; user: AuthUser } | null> {
  const client = getSupabaseServiceClient()

  const { data: session, error } = await client
    .from('sessions')
    .select('*')
    .eq('token', token)
    .single()

  if (error || !session) {
    return null
  }

  // Check if session is expired
  if (new Date(session.expires_at) < new Date()) {
    // Clean up expired session
    await client.from('sessions').delete().eq('id', session.id)
    return null
  }

  // Get user
  const { data: user, error: userError } = await client
    .from('users')
    .select('id, username, display_name, email, tenant_id, is_active')
    .eq('id', session.user_id)
    .eq('is_active', true)
    .single()

  if (userError || !user) {
    return null
  }

  return {
    session,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      email: user.email,
      tenant_id: user.tenant_id,
      is_active: user.is_active,
    },
  }
}

export async function deleteSession(token: string): Promise<void> {
  const client = getSupabaseServiceClient()

  await client.from('sessions').delete().eq('token', token)
}

export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value

  if (!token) {
    return null
  }

  const result = await getSession(token)
  return result?.user || null
}

export async function requireAuth(
  request: NextRequest
): Promise<{ user: AuthUser } | NextResponse> {
  const user = await getAuthUser(request)

  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    )
  }

  return { user }
}

export function setSessionCookie(response: NextResponse, token: string): void {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS)

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(0),
  })
}

export async function getSessionFromCookies(): Promise<{ user: AuthUser } | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value

  if (!token) {
    return null
  }

  const result = await getSession(token)
  if (!result) {
    return null
  }

  return { user: result.user }
}

/**
 * Require auth and also fetch user's API keys
 * Use this when you need to access user-specific integrations
 */
export async function requireAuthWithApiKeys(
  request: NextRequest
): Promise<{ user: AuthUser; apiKeys: UserApiKeys } | NextResponse> {
  const user = await getAuthUser(request)

  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const apiKeys = await getUserApiKeys(user.id)

  return { user, apiKeys }
}

/**
 * Get the tenant for the authenticated user.
 * Use this instead of getDefaultTenant() in dashboard API routes
 * to ensure each user only sees their own tenant's data.
 */
export async function getAuthTenant(request: NextRequest): Promise<Tenant | null> {
  const user = await getAuthUser(request)
  if (!user?.tenant_id) return null
  return getTenantById(user.tenant_id)
}
