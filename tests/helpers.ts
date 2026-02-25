/**
 * Test helpers — request factories and assertion utilities.
 */

import { NextRequest } from 'next/server'

/**
 * Create a mock NextRequest for testing API route handlers.
 */
export function createMockRequest(
  url: string,
  options: {
    method?: string
    body?: any
    headers?: Record<string, string>
  } = {}
): NextRequest {
  const { method = 'POST', body, headers = {} } = options
  const init: RequestInit = {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  }
  if (body) {
    init.body = JSON.stringify(body)
  }
  return new NextRequest(new URL(url, 'http://localhost:3000'), init)
}

/**
 * Create a GET request with cron auth header.
 */
export function createCronRequest(path: string): NextRequest {
  return createMockRequest(`http://localhost:3000${path}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
  })
}

/**
 * Create a POST request with cron auth header.
 */
export function createCronPostRequest(path: string, body?: any): NextRequest {
  return createMockRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    body,
    headers: {
      authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
  })
}

/**
 * Parse the JSON response from a NextResponse.
 */
export async function parseResponse(response: Response) {
  const json = await response.json()
  return { status: response.status, body: json }
}

/**
 * Assert that a vi.fn() was called with a specific tenant slug.
 */
export function assertCalledWithTenant(mockFn: any, expectedSlug: string) {
  const calls = mockFn.mock.calls
  const foundTenantCall = calls.some((args: any[]) => {
    const firstArg = args[0]
    return firstArg && typeof firstArg === 'object' && firstArg.slug === expectedSlug
  })
  if (!foundTenantCall) {
    const actualSlugs = calls
      .map((args: any[]) => args[0]?.slug)
      .filter(Boolean)
    throw new Error(
      `Expected mock to be called with tenant slug "${expectedSlug}", ` +
      `but was called with: [${actualSlugs.join(', ') || 'no tenant objects'}]`
    )
  }
}

/**
 * Assert that a vi.fn() was NEVER called with a specific tenant slug.
 */
export function assertNeverCalledWithTenant(mockFn: any, forbiddenSlug: string) {
  const calls = mockFn.mock.calls
  const found = calls.some((args: any[]) => {
    const firstArg = args[0]
    return firstArg && typeof firstArg === 'object' && firstArg.slug === forbiddenSlug
  })
  if (found) {
    throw new Error(`Expected mock to NEVER be called with tenant slug "${forbiddenSlug}", but it was.`)
  }
}
