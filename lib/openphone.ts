/**
 * OpenPhone API client for sending and receiving SMS
 *
 * API Documentation: https://www.openphone.com/docs/api
 */

import { createHmac } from 'crypto'
import { toE164, normalizePhoneNumber } from './phone-utils'

// Re-export for dashboard compatibility
export { normalizePhoneNumber }
import { getJobsByPhone, getGHLLeadByPhone, getSupabaseClient } from './supabase'
import { getClientConfig } from './client-config'

const OPENPHONE_API_BASE = 'https://api.openphone.com/v1'

interface SendSMSResponse {
  success: boolean
  messageId?: string
  error?: string
}

function isTruthy(value?: string | null): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function getAllowlist(): Set<string> {
  const entries = []
  if (process.env.SMS_ALLOWLIST) {
    entries.push(...process.env.SMS_ALLOWLIST.split(/[,\s]+/))
  }
  if (process.env.OWNER_PHONE) {
    entries.push(process.env.OWNER_PHONE)
  }

  const normalized = entries
    .map(item => toE164(item))
    .filter(Boolean) as string[]

  return new Set(normalized)
}

function getBlocklist(): Set<string> {
  const entries = []
  if (process.env.SMS_BLOCKLIST) {
    entries.push(...process.env.SMS_BLOCKLIST.split(/[,\s]+/))
  }

  const normalized = entries
    .map(item => toE164(item))
    .filter(Boolean) as string[]

  return new Set(normalized)
}

export function isSmsDisabled(): boolean {
  return isTruthy(process.env.SMS_DISABLED)
}

export function shouldBlockUnknownSms(): boolean {
  if (process.env.SMS_BLOCK_UNKNOWN === undefined) {
    return true
  }
  return isTruthy(process.env.SMS_BLOCK_UNKNOWN)
}

export function isSmsInboundDisabled(): boolean {
  return isSmsDisabled() || isTruthy(process.env.SMS_INBOUND_DISABLED)
}

export function isSmsBlockedNumber(phoneNumber: string): boolean {
  const normalized = toE164(phoneNumber)
  if (!normalized) return false
  return getBlocklist().has(normalized)
}

export function isSmsAllowlisted(phoneNumber: string): boolean {
  const normalized = toE164(phoneNumber)
  if (!normalized) return false
  return getAllowlist().has(normalized)
}

export async function isSystemKnownSmsContact(phoneNumber: string): Promise<boolean> {
  const normalized = toE164(phoneNumber)
  if (!normalized) return false

  const jobs = await getJobsByPhone(normalized)
  if (jobs.length > 0) {
    return true
  }

  const config = getClientConfig()
  if (config.features.ghl) {
    const lead = await getGHLLeadByPhone(normalized)
    if (lead) {
      return true
    }
  }

  return false
}

async function canSendSms(toE164Format: string): Promise<{ allowed: boolean; reason?: string }> {
  if (isSmsDisabled()) {
    return { allowed: false, reason: 'SMS disabled' }
  }

  if (getBlocklist().has(toE164Format)) {
    return { allowed: false, reason: 'SMS blocked for number' }
  }

  const allowlist = getAllowlist()
  if (allowlist.has(toE164Format)) {
    return { allowed: true }
  }

  if (shouldBlockUnknownSms()) {
    const isKnown = await isSystemKnownSmsContact(toE164Format)
    if (!isKnown) {
      return { allowed: false, reason: 'SMS blocked for unknown number' }
    }
  }

  return { allowed: true }
}

/**
 * Send an SMS message via OpenPhone
 *
 * @param to - Recipient phone number (any format, will be normalized)
 * @param message - Message content
 * @param brandMode - Optional brand mode to use brand-specific phone number
 * @returns Promise with success status and message ID
 */
export async function sendSMS(to: string, message: string, brandMode?: string): Promise<SendSMSResponse> {
  const apiKey = process.env.OPENPHONE_API_KEY

  if (!apiKey) {
    console.error('OPENPHONE_API_KEY not configured')
    return { success: false, error: 'OpenPhone API key not configured' }
  }

  // Get brand-specific phone number if brand provided
  let phoneNumberId: string | undefined
  if (brandMode) {
    const config = getClientConfig(brandMode)
    phoneNumberId = config.openphonePhoneId
  } else {
    phoneNumberId = process.env.OPENPHONE_PHONE_NUMBER_ID
  }

  if (!phoneNumberId) {
    console.error(`OPENPHONE_PHONE_NUMBER_ID not configured for brand: ${brandMode || 'default'}`)
    return { success: false, error: 'OpenPhone phone number ID not configured' }
  }

  const toE164Format = toE164(to)
  if (!toE164Format) {
    return { success: false, error: `Invalid phone number: ${to}` }
  }

  const guard = await canSendSms(toE164Format)
  if (!guard.allowed) {
    console.warn(`SMS blocked for ${toE164Format}: ${guard.reason || 'blocked'}`)
    return { success: false, error: guard.reason || 'SMS blocked' }
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
      console.error('OpenPhone API error:', response.status, errorText)
      return {
        success: false,
        error: `OpenPhone API error: ${response.status} - ${errorText}`
      }
    }

    const data = await response.json()

    // Log successful send
    console.log(`SMS sent to ${toE164Format}: ${message.slice(0, 50)}...`)

    // Store message in messages table for dashboard display
    try {
      const client = getSupabaseClient()
      await client.from('messages').insert({
        phone_number: toE164Format,
        direction: 'outbound',
        content: message,
        brand: brandMode || null,
        source: 'openphone',
        metadata: { message_id: data.data?.id || data.id },
      })
    } catch (msgErr) {
      console.warn('Failed to store outbound message:', msgErr)
    }

    return {
      success: true,
      messageId: data.data?.id || data.id
    }
  } catch (error) {
    console.error('Error sending SMS:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Validate OpenPhone webhook signature
 *
 * @param payload - Raw request body
 * @param signature - Signature from X-OpenPhone-Signature header
 * @returns boolean indicating if signature is valid
 */
export async function validateOpenPhoneWebhook(
  payload: string,
  signature: string | null,
  timestamp?: string | null
): Promise<boolean> {
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

  const direction = firstString(message.direction, data.direction, body.direction)

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

/**
 * SMS message templates
 */
export const SMS_TEMPLATES = {
  /**
   * Confirmation SMS after a VAPI call creates a booking
   */
  vapiConfirmation: (
    name: string,
    serviceType: string,
    dateTime: string,
    address: string
  ): string => {
    return `Hi ${name}! Just confirming: ${serviceType} cleaning on ${dateTime} at ${address}.

If anything looks off, just text me. If it is correct, send your best email and I will send over a confirmed price.`
  },

  /**
   * Confirmation SMS after payment is received
   */
  paymentConfirmation: (serviceType: string, date: string): string => {
    return `Payment received for your ${serviceType} cleaning on ${date}. We're scheduling your cleaner now and will confirm shortly.`
  },

  /**
   * Invoice sent notification
   */
  invoiceSent: (email: string, invoiceUrl?: string): string => {
    const linkLine = invoiceUrl ? `\nInvoice link: ${invoiceUrl}` : ''
    return `Thanks! I'm sending everything now (and this will be in your email too if you prefer)!${linkLine}`
  },

  /**
   * Standard footer for all AI responses
   */
  footer: '',
}
