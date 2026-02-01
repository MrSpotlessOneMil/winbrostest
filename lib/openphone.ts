/**
 * OpenPhone API client for sending and receiving SMS
 * Multi-tenant version - supports both old (env var) and new (tenant) calling patterns
 *
 * API Documentation: https://www.openphone.com/docs/api
 */

import { createHmac } from 'crypto'
import { toE164, normalizePhoneNumber } from './phone-utils'
import type { Tenant } from './tenant'
import { getDefaultTenant } from './tenant'

// Re-export for dashboard compatibility
export { normalizePhoneNumber }

const OPENPHONE_API_BASE = 'https://api.openphone.com/v1'

interface SendSMSResponse {
  success: boolean
  messageId?: string
  error?: string
}

/**
 * Send an SMS message via OpenPhone
 * Backwards compatible - can be called with (to, message) or (tenant, to, message)
 */
export async function sendSMS(
  tenantOrTo: Tenant | string,
  toOrMessage: string,
  messageOrUndefined?: string
): Promise<SendSMSResponse> {
  // Determine if called with tenant or without (backwards compat)
  let tenant: Tenant | null
  let to: string
  let message: string

  if (typeof tenantOrTo === 'string') {
    // Old calling pattern: sendSMS(to, message)
    tenant = await getDefaultTenant()
    to = tenantOrTo
    message = toOrMessage
  } else {
    // New calling pattern: sendSMS(tenant, to, message)
    tenant = tenantOrTo
    to = toOrMessage
    message = messageOrUndefined || ''
  }

  if (!tenant) {
    console.error('No tenant found - cannot send SMS')
    return { success: false, error: 'No tenant configured' }
  }

  const apiKey = tenant.openphone_api_key

  if (!apiKey) {
    console.error(`[${tenant.slug}] OpenPhone API key not configured`)
    return { success: false, error: 'OpenPhone API key not configured' }
  }

  const phoneNumberId = tenant.openphone_phone_id

  if (!phoneNumberId) {
    console.error(`[${tenant.slug}] OpenPhone phone number ID not configured`)
    return { success: false, error: 'OpenPhone phone number ID not configured' }
  }

  const toE164Format = toE164(to)
  if (!toE164Format) {
    return { success: false, error: `Invalid phone number: ${to}` }
  }

  try {
    const response = await fetch(`${OPENPHONE_API_BASE}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: phoneNumberId,
        to: [toE164Format],
        content: message,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[${tenant.slug}] OpenPhone API error:`, response.status, errorText)
      return {
        success: false,
        error: `OpenPhone API error: ${response.status} - ${errorText}`
      }
    }

    const data = await response.json()

    // Log successful send
    console.log(`[${tenant.slug}] SMS sent to ${toE164Format}: ${message.slice(0, 50)}...`)

    return {
      success: true,
      messageId: data.data?.id || data.id
    }
  } catch (error) {
    console.error(`[${tenant.slug}] Error sending SMS:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * SMS message templates (kept for backwards compatibility)
 */
export const SMS_TEMPLATES = {
  vapiConfirmation: (name: string, serviceType: string, dateTime: string, address: string): string => {
    return `Hi ${name}! Just confirming: ${serviceType} cleaning on ${dateTime} at ${address}.\n\nIf anything looks off, just text me. If it is correct, send your best email and I will send over a confirmed price.`
  },
  paymentConfirmation: (serviceType: string, date: string): string => {
    return `Payment received for your ${serviceType} cleaning on ${date}. We're scheduling your cleaner now and will confirm shortly.`
  },
  invoiceSent: (email: string, invoiceUrl?: string): string => {
    const linkLine = invoiceUrl ? `\nInvoice link: ${invoiceUrl}` : ''
    return `Thanks! I'm sending everything now (and this will be in your email too if you prefer)!${linkLine}`
  },
  footer: '',
}

/**
 * Validate OpenPhone webhook signature for a tenant
 *
 * @param tenant - The tenant configuration
 * @param payload - Raw request body
 * @param signature - Signature from X-OpenPhone-Signature header
 * @returns boolean indicating if signature is valid
 */
export async function validateOpenPhoneWebhook(
  tenant: Tenant | null,
  payload: string,
  signature: string | null,
  timestamp?: string | null
): Promise<boolean> {
  // OpenPhone doesn't have a per-tenant webhook secret in our schema
  // Use a global secret from env or skip validation
  const webhookSecret = process.env.OPENPHONE_WEBHOOK_SECRET

  // If no secret configured, skip validation (not recommended for production)
  if (!webhookSecret) {
    console.warn('OPENPHONE_WEBHOOK_SECRET not configured - skipping validation')
    return true
  }

  if (!signature) {
    console.warn('No signature provided in webhook request')
    return false
  }

  const candidateSignatures = extractSignatureCandidates(signature)
  const candidateKeys = getCandidateKeys(webhookSecret)
  const payloadVariants = getPayloadVariants(payload, timestamp)

  // OpenPhone uses HMAC-SHA256 for webhook signatures
  try {
    for (const keyBytes of candidateKeys) {
      for (const payloadBytes of payloadVariants) {
        const signatureBytes = createHmac('sha256', keyBytes)
          .update(payloadBytes)
          .digest()

        const hexSig = signatureBytes.toString('hex')
        const base64Sig = signatureBytes.toString('base64')
        const base64UrlSig = base64Sig
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/g, '')

        for (const candidate of candidateSignatures) {
          const cleaned = candidate.trim()
          if (!cleaned) continue
          if (cleaned.toLowerCase() === hexSig) {
            return true
          }
          if (cleaned === base64Sig || cleaned === base64UrlSig) {
            return true
          }
        }
      }
    }

    console.warn('[OpenPhone] Signature validation failed')
    return false
  } catch (error) {
    console.error('Error validating webhook signature:', error)
    return false
  }
}

/**
 * Extract message content from OpenPhone webhook payload
 */
export function extractMessageFromOpenPhonePayload(
  body: Record<string, unknown>
): { from: string; content: string; createdAt: string; direction?: string } | null {
  // OpenPhone webhook structure varies, try common patterns
  const data = (body.data as Record<string, unknown>) || body
  const message = (data.object as Record<string, unknown>) || data

  const content = firstString(
    message.content,
    message.body,
    message.text,
    message.message,
    (message.message as Record<string, unknown> | undefined)?.content,
    (message.message as Record<string, unknown> | undefined)?.body,
    (message.message as Record<string, unknown> | undefined)?.text
  )

  const from = firstPhone(
    message.from,
    message.sender,
    message.phoneNumber,
    message.phone_number,
    data.from,
    data.sender,
    data.phoneNumber,
    data.phone_number
  )

  const createdAt = firstString(
    message.createdAt,
    message.created_at,
    message.timestamp,
    data.createdAt,
    data.timestamp
  ) || new Date().toISOString()

  const rawDirection = firstString(message.direction, data.direction, body.direction)

  // Normalize direction: OpenPhone uses "incoming"/"outgoing", we use "inbound"/"outbound"
  let direction: string | undefined
  if (rawDirection === 'incoming' || rawDirection === 'inbound') {
    direction = 'inbound'
  } else if (rawDirection === 'outgoing' || rawDirection === 'outbound') {
    direction = 'outbound'
  } else {
    direction = rawDirection
  }

  // Try to find the message content
  if (!from || !content) {
    console.warn('Could not extract message from OpenPhone payload:', JSON.stringify(body).slice(0, 500))
    return null
  }

  return {
    from,
    content,
    createdAt,
    direction,
  }
}

function firstString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }
  return undefined
}

function firstPhone(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      const candidate = firstString(
        record.phoneNumber,
        record.phone_number,
        record.number,
        record.phone
      )
      if (candidate) {
        return candidate
      }
    }
  }
  return undefined
}

function getCandidateKeys(secret: string): Buffer[] {
  const trimmed = secret.trim()
  const candidates: Buffer[] = [Buffer.from(trimmed, 'utf8')]

  const base64Bytes = decodeIfBase64ToBuffer(trimmed)
  if (base64Bytes) {
    candidates.push(base64Bytes)
  }

  const hexBytes = decodeIfHexToBuffer(trimmed)
  if (hexBytes) {
    candidates.push(hexBytes)
  }

  return candidates
}

function decodeIfBase64ToBuffer(value: string): Buffer | null {
  try {
    const buffer = Buffer.from(value, 'base64')
    if (!buffer.length) {
      return null
    }

    const reencoded = buffer.toString('base64').replace(/=+$/g, '')
    const normalized = value.replace(/=+$/g, '')
    if (reencoded !== normalized) {
      return null
    }

    return buffer
  } catch {
    return null
  }
}

function decodeIfHexToBuffer(value: string): Buffer | null {
  const trimmed = value.trim()
  if (!/^[0-9a-fA-F]+$/.test(trimmed) || trimmed.length % 2 !== 0) {
    return null
  }

  try {
    return Buffer.from(trimmed, 'hex')
  } catch {
    return null
  }
}

function extractSignatureCandidates(signature: string): string[] {
  const candidates = new Set<string>()
  const raw = signature.trim()
  if (!raw) return []

  const cleaned = raw.replace(/^sha256=/i, '')
  candidates.add(raw)
  candidates.add(cleaned)

  const parts = raw.split(',')
  for (const part of parts) {
    const segment = part.trim()
    if (!segment) continue

    const eqIndex = segment.indexOf('=')
    if (eqIndex > 0) {
      const key = segment.slice(0, eqIndex).trim().toLowerCase()
      const value = segment.slice(eqIndex + 1).trim().replace(/^"|"$/g, '')
      if (value && ['v1', 'v0', 'sig', 'signature', 'sha256', 'hmac'].includes(key)) {
        candidates.add(value)
      }
    }
  }

  return Array.from(candidates)
}

function getPayloadVariants(payload: string, timestamp?: string | null): Buffer[] {
  const variants = [Buffer.from(payload, 'utf8')]
  const trimmedTimestamp = timestamp?.trim()
  if (trimmedTimestamp) {
    variants.push(Buffer.from(`${trimmedTimestamp}.${payload}`, 'utf8'))
  }
  return variants
}
