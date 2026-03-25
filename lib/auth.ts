import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSupabaseServiceClient } from './supabase'
import { getUserApiKeys, type UserApiKeys } from './user-api-keys'
import { getTenantById, getTenantBySlug, type Tenant } from './tenant'

export const SESSION_COOKIE_NAME = 'winbros_session'
const SESSION_DURATION_DAYS = 365

export interface AuthUser {
  id: number
  username: string
  display_name: string | null
  email: string | null
  tenant_id: string | null
  is_active: boolean
}

export interface AuthCleaner {
  id: number
  username: string
  name: string
  phone: string | null
  portal_token: string | null
  tenant_id: string
}

export interface Session {
  id: string
  user_id: number | null
  cleaner_id: number | null
  token: string
  expires_at: string
  created_at: string
}

function generateToken(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Normalize a phone input: strip everything except digits and a leading +.
 * Accepts messy input like "(309) 241-1958", "1-309-241-1958", "+1 309 241 1958", etc.
 */
function normalizePhone(raw: string): string {
  // Strip everything that isn't a digit
  const digits = raw.replace(/\D/g, '')
  // Prepend +1 if 10 digits (US), or + if 11+ digits (already has country code)
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

/**
 * Detect identifier type from login input.
 * Email: contains @
 * Phone: after stripping non-digits, has 7+ digits
 * Otherwise: username
 */
function detectIdentifierType(identifier: string): 'email' | 'phone' | 'username' {
  const trimmed = identifier.trim()
  if (trimmed.includes('@')) return 'email'
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length >= 7) return 'phone'
  return 'username'
}

export async function verifyPassword(
  identifier: string,
  password: string
): Promise<AuthUser | null> {
  const client = getSupabaseServiceClient()
  const trimmed = identifier.trim()
  const type = detectIdentifierType(trimmed)

  let query = client
    .from('users')
    .select('id, username, display_name, email, tenant_id, is_active, password_hash')
    .eq('is_active', true)

  if (type === 'email') {
    query = query.ilike('email', trimmed)
  } else if (type === 'phone') {
    query = query.eq('phone', normalizePhone(trimmed))
  } else {
    query = query.eq('username', trimmed)
  }

  const { data: user, error } = await query.single()

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

export async function createEmployeeSession(cleanerId: number): Promise<string> {
  const client = getSupabaseServiceClient()
  const token = generateToken()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS)

  const { error } = await client.from('sessions').insert({
    user_id: null,
    cleaner_id: cleanerId,
    token,
    expires_at: expiresAt.toISOString(),
  })

  if (error) {
    console.error('Error creating employee session:', error)
    throw new Error('Failed to create employee session')
  }

  return token
}

/**
 * Verify a cleaner's username + PIN.
 * Returns the cleaner record if valid, null otherwise.
 */
export async function verifyEmployeePassword(
  username: string,
  password: string
): Promise<AuthCleaner | null> {
  const client = getSupabaseServiceClient()

  const { data: cleaner, error } = await client
    .from('cleaners')
    .select('id, username, name, phone, portal_token, tenant_id, pin, active')
    .ilike('username', username)
    .eq('active', true)
    .is('deleted_at', null)
    .single()

  if (error || !cleaner) return null
  if (!cleaner.pin || cleaner.pin !== password) return null

  return {
    id: cleaner.id,
    username: cleaner.username,
    name: cleaner.name,
    phone: cleaner.phone,
    portal_token: cleaner.portal_token,
    tenant_id: cleaner.tenant_id,
  }
}

export async function getSession(
  token: string
): Promise<{ session: Session; user: AuthUser; cleaner?: AuthCleaner } | null> {
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

  // Employee session (cleaner_id set, user_id null)
  if (session.cleaner_id && !session.user_id) {
    const { data: cleaner, error: cleanerError } = await client
      .from('cleaners')
      .select('id, username, name, phone, portal_token, tenant_id, active')
      .eq('id', session.cleaner_id)
      .eq('active', true)
      .is('deleted_at', null)
      .single()

    if (cleanerError || !cleaner) return null

    // Return a synthetic AuthUser so existing middleware doesn't break,
    // plus the cleaner object for employee-specific logic
    return {
      session,
      user: {
        id: -cleaner.id, // negative to distinguish from real users
        username: cleaner.username || cleaner.name,
        display_name: cleaner.name,
        email: null,
        tenant_id: cleaner.tenant_id,
        is_active: true,
      },
      cleaner: {
        id: cleaner.id,
        username: cleaner.username || cleaner.name,
        name: cleaner.name,
        phone: cleaner.phone,
        portal_token: cleaner.portal_token,
        tenant_id: cleaner.tenant_id,
      },
    }
  }

  // Owner/manager session (user_id set)
  if (!session.user_id) return null

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

/**
 * Check if the current session is an employee (cleaner) session.
 * Returns the AuthCleaner if so, null otherwise.
 */
export async function getAuthCleaner(request: NextRequest): Promise<AuthCleaner | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null

  const result = await getSession(token)
  return result?.cleaner || null
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
  if (!user) return null

  // Primary lookup: by tenant_id
  if (user.tenant_id) {
    const tenant = await getTenantById(user.tenant_id)
    if (tenant) return tenant
    console.warn(`[Auth] getAuthTenant: tenant_id=${user.tenant_id} not found for user ${user.username}, trying slug fallback`)
  }

  // Fallback: match username to tenant slug (auto-created users use slug as username)
  if (user.username && user.username !== 'admin') {
    const tenant = await getTenantBySlug(user.username, false)
    if (tenant) {
      // Self-heal: update the user's tenant_id to the correct value
      console.warn(`[Auth] getAuthTenant: self-healing tenant_id for user ${user.username} → ${tenant.id}`)
      const client = getSupabaseServiceClient()
      await client.from('users').update({ tenant_id: tenant.id }).eq('id', user.id)
      return tenant
    }
  }

  // Admin user intentionally has no tenant — not an error
  if (user.username !== 'admin') {
    console.error(`[Auth] getAuthTenant: no tenant found for user ${user.username} (tenant_id=${user.tenant_id})`)
  }
  return null
}

/**
 * Require auth and resolve the user's tenant in one call.
 * Returns { user, tenant } or a 401/403 NextResponse.
 * Use this in dashboard action routes to enforce tenant ownership.
 */
export async function requireAuthWithTenant(
  request: NextRequest
): Promise<{ user: AuthUser; tenant: Tenant } | NextResponse> {
  const user = await getAuthUser(request)

  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const tenant = await getAuthTenant(request)

  if (!tenant) {
    return NextResponse.json(
      { success: false, error: 'Forbidden' },
      { status: 403 }
    )
  }

  return { user, tenant }
}

/**
 * Check if the request is from an admin user.
 * Verifies the session cookie against the database (expiry-checked).
 * Use this as a single source of truth for all admin-only API routes.
 */
export async function requireAdmin(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) return false

  const client = getSupabaseServiceClient()
  const { data: session } = await client
    .from('sessions')
    .select('user_id, users!inner(username)')
    .eq('token', token)
    .not('user_id', 'is', null)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (!session) return false
  const user = session.users as unknown as { username: string }
  return user.username === 'admin'
}
