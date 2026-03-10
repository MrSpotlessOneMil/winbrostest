import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SESSION_COOKIE_NAME = 'winbros_session'

// Public routes that don't require authentication
const publicRoutes = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session',
  '/quote',
  '/api/quotes',
  '/tip',
  '/api/tip',
]

// Webhook and cron routes (external callbacks and server-side jobs)
const externalRoutes = [
  '/api/webhooks/',
  '/api/cron/',
  '/api/vapi/',
  '/api/automation/',
  '/api/demo/seed',
]

function isPublicRoute(pathname: string): boolean {
  return publicRoutes.some(route => pathname === route || pathname.startsWith(route + '/'))
}

function isExternalRoute(pathname: string): boolean {
  return externalRoutes.some(route => pathname.startsWith(route))
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public routes
  if (isPublicRoute(pathname)) {
    return NextResponse.next()
  }

  // Allow external webhook/cron routes (they have their own auth or derive user from data)
  if (isExternalRoute(pathname)) {
    return NextResponse.next()
  }

  // Check for session cookie
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value

  // If no session and trying to access protected page, redirect to login
  if (!sessionToken) {
    // API routes return 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Page routes redirect to login
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Session exists, allow request (actual validation happens in requireAuth)
  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
