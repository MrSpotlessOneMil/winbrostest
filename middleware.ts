import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SESSION_COOKIE_NAME = 'winbros_session'

// Domain-based routing for marketing sites
const DOMAIN_MAP: Record<string, string> = {
  'spotlessscrubbers.org': '/spotless',
  'www.spotlessscrubbers.org': '/spotless',
  'theosirisai.com': '/osiris-marketing',
  'www.theosirisai.com': '/osiris-marketing',
}

// Public routes that don't require authentication
const publicRoutes = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session',
  '/api/auth/crew-login',
  '/quote',
  '/api/quotes',
  '/tip',
  '/api/tip',
  '/crew',
  '/api/crew',
  '/spotless',
  '/spotless-v2',
  '/spotless-v3',
  '/spotless-v4',
  '/osiris-marketing',
]

// Webhook and cron routes (external callbacks and server-side jobs)
const externalRoutes = [
  '/api/webhooks/',
  '/api/cron/',
  '/api/vapi/',
  '/api/automation/',
  '/api/marketing/',
  '/api/admin/patch-vapi-transfer',
]

function isPublicRoute(pathname: string): boolean {
  if (pathname === '/') return true // Root page (role select / crew login) is public
  return publicRoutes.some(route => pathname === route || pathname.startsWith(route + '/'))
}

function isExternalRoute(pathname: string): boolean {
  return externalRoutes.some(route => pathname.startsWith(route))
}

export function middleware(request: NextRequest) {
  const { hostname, pathname, searchParams } = request.nextUrl

  // --- Domain-based routing for marketing sites ---
  let routePrefix: string | undefined = DOMAIN_MAP[hostname]

  // Dev override: ?site=spotless or ?site=osiris on localhost
  if (!routePrefix && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    const site = searchParams.get('site')
    if (site === 'spotless') routePrefix = '/spotless'
    if (site === 'osiris') routePrefix = '/osiris-marketing'
  }

  // If marketing domain, rewrite to the route group (skip auth entirely)
  if (routePrefix) {
    if (pathname.startsWith('/api/') || pathname.startsWith('/_next/')) {
      return NextResponse.next()
    }
    if (pathname === '/sitemap.xml' || pathname === '/robots.txt') {
      const url = request.nextUrl.clone()
      url.pathname = `${routePrefix}${pathname}`
      return NextResponse.rewrite(url)
    }
    const url = request.nextUrl.clone()
    url.pathname = `${routePrefix}${pathname}`
    return NextResponse.rewrite(url)
  }

  // --- Standard auth flow for dashboard ---

  // Allow public routes
  if (isPublicRoute(pathname)) {
    return NextResponse.next()
  }

  // Allow external webhook/cron routes (they have their own auth or derive user from data)
  if (isExternalRoute(pathname)) {
    return NextResponse.next()
  }

  // Check for session cookie or Authorization Bearer header (mobile app support)
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value
    || (request.headers.get('Authorization')?.startsWith('Bearer ')
      ? request.headers.get('Authorization')!.slice(7)
      : null)

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
