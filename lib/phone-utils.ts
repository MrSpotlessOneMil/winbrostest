/**
 * Phone number utilities for consistent formatting
 *
 * Storage format: E.164 (e.g., "+14246771146")
 * OpenPhone API format: E.164 (e.g., "+14246771146")
 */

/**
 * Normalize a phone number to 10 digits only
 * Strips +1, spaces, parentheses, dashes, and any other non-digit characters
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return ''

  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, '')

  // Remove leading 1 if 11 digits (US country code)
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1)
  }

  // Validate 10 digit US number
  if (digits.length !== 10) {
    console.warn(`Invalid phone number length: ${phone} → ${digits}`)
  }

  return digits
}

/**
 * Convert a phone number to E.164 format for OpenPhone API
 * E.164 format: +1XXXXXXXXXX
 */
export function toE164(phone: string | null | undefined): string {
  const normalized = normalizePhone(phone)

  if (!normalized || normalized.length !== 10) {
    console.warn(`Cannot convert to E.164: ${phone}`)
    return ''
  }

  return `+1${normalized}`
}

// Alias for dashboard compatibility
export const normalizePhoneNumber = toE164

/**
 * Format phone number for display (XXX) XXX-XXXX
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  const normalized = normalizePhone(phone)

  if (!normalized || normalized.length !== 10) {
    return phone || ''
  }

  return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`
}

/**
 * Extract phone number from OpenPhone webhook payload
 * OpenPhone sends phone numbers in various formats
 */
export function extractPhoneFromOpenPhonePayload(body: Record<string, unknown>): string {
  // Try common field names in OpenPhone webhooks
  const possibleFields = ['from', 'to', 'phoneNumber', 'phone', 'Phone']

  for (const field of possibleFields) {
    if (body[field] && typeof body[field] === 'string') {
      return normalizePhone(body[field] as string)
    }
  }

  // Try nested data object
  if (body.data && typeof body.data === 'object') {
    const data = body.data as Record<string, unknown>
    for (const field of possibleFields) {
      if (data[field] && typeof data[field] === 'string') {
        return normalizePhone(data[field] as string)
      }
    }
  }

  console.warn('Could not extract phone from payload:', JSON.stringify(body).slice(0, 200))
  return ''
}

/**
 * Extract phone number from VAPI webhook payload
 */
export function extractPhoneFromVapiPayload(body: Record<string, unknown>): string {
  // VAPI typically sends customer phone in message.customer.number
  if (body.message && typeof body.message === 'object') {
    const message = body.message as Record<string, unknown>

    if (message.customer && typeof message.customer === 'object') {
      const customer = message.customer as Record<string, unknown>
      if (customer.number && typeof customer.number === 'string') {
        return normalizePhone(customer.number)
      }
    }

    // Try call object
    if (message.call && typeof message.call === 'object') {
      const call = message.call as Record<string, unknown>
      if (call.customer && typeof call.customer === 'object') {
        const customer = call.customer as Record<string, unknown>
        if (customer.number && typeof customer.number === 'string') {
          return normalizePhone(customer.number)
        }
      }
    }

    // Try artifact.variables.customer (VAPI end-of-call-report format)
    if (message.artifact && typeof message.artifact === 'object') {
      const artifact = message.artifact as Record<string, unknown>
      if (artifact.variables && typeof artifact.variables === 'object') {
        const variables = artifact.variables as Record<string, unknown>
        if (variables.customer && typeof variables.customer === 'object') {
          const customer = variables.customer as Record<string, unknown>
          if (customer.number && typeof customer.number === 'string') {
            return normalizePhone(customer.number)
          }
        }
      }
    }
  }

  // Try top-level phone field
  if (body.phone && typeof body.phone === 'string') {
    return normalizePhone(body.phone)
  }

  // Try customer field at top level
  if (body.customer && typeof body.customer === 'object') {
    const customer = body.customer as Record<string, unknown>
    if (customer.number && typeof customer.number === 'string') {
      return normalizePhone(customer.number)
    }
  }

  console.warn('Could not extract phone from VAPI payload:', JSON.stringify(body).slice(0, 200))
  return ''
}

/**
 * Check if a string contains a valid email address
 */
export function extractEmail(text: string): string | null {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i
  const match = text.match(emailRegex)
  return match ? match[0].toLowerCase() : null
}

/**
 * Check if two phone numbers are the same (after normalization)
 */
export function phonesMatch(phone1: string | null | undefined, phone2: string | null | undefined): boolean {
  return normalizePhone(phone1) === normalizePhone(phone2)
}
