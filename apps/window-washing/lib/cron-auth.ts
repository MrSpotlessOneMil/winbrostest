/**
 * Cron Job Authentication Utility
 *
 * Verifies that cron requests are legitimate, supporting:
 * - Vercel Cron (uses CRON_SECRET header)
 * - Manual triggers (uses Authorization: Bearer <CRON_SECRET>)
 * - Legacy QStash (uses upstash-signature header)
 */

import { NextRequest } from 'next/server'

/**
 * Verify that a cron request is authorized
 * Returns true if authorized, false otherwise
 */
export function verifyCronAuth(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET

  // In development without CRON_SECRET, allow all requests
  if (!cronSecret && process.env.NODE_ENV !== 'production') {
    console.warn('[cron-auth] No CRON_SECRET configured, allowing request in development')
    return true
  }

  // Require CRON_SECRET in production — x-vercel-cron header is spoofable and must not be trusted
  if (!cronSecret) {
    console.error('[cron-auth] CRON_SECRET not configured in production — rejecting')
    return false
  }

  // Check Authorization header (Vercel Cron and manual triggers)
  const authHeader = request.headers.get('authorization')
  if (authHeader === `Bearer ${cronSecret}`) {
    return true
  }

  return false
}

/**
 * Get error response for unauthorized cron requests
 */
export function unauthorizedResponse() {
  return { error: 'Unauthorized' }
}
