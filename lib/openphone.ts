/**
 * OpenPhone API client for sending and receiving SMS
 * Multi-tenant: tenant is REQUIRED for all SMS operations
 *
 * API Documentation: https://www.openphone.com/docs/api
 */

import { createHmac } from 'crypto'
import { toE164, normalizePhoneNumber } from './phone-utils'
import type { Tenant } from './tenant'
import { getSupabaseServiceClient } from './supabase'

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
 * Tenant is REQUIRED — no more fallback to WinBros default tenant.
 */
export async function sendSMS(
  tenant: Tenant,
  to: string,
  message: string,
  options?: { skipThrottle?: boolean; skipDedup?: boolean }
): Promise<SendSMSResponse> {

  if (!tenant) {
    console.error('No tenant found - cannot send SMS')
    return { success: false, error: 'No tenant configured' }
  }

  // Try tenant config first, then fall back to env var
  const apiKey = tenant.openphone_api_key || process.env.OPENPHONE_API_KEY

  if (!apiKey) {
    console.error(`[${tenant.slug}] OpenPhone API key not configured in tenant or env`)
    return { success: false, error: 'OpenPhone API key not configured' }
  }

  console.log(`[${tenant.slug}] Using OpenPhone API key from: ${tenant.openphone_api_key ? 'tenant config' : 'env var'}`)

  // Try tenant config first, then fall back to env var
  const phoneNumberId = tenant.openphone_phone_id || process.env.OPENPHONE_PHONE_ID

  if (!phoneNumberId) {
    console.error(`[${tenant.slug}] OpenPhone phone number ID not configured in tenant or env`)
    return { success: false, error: 'OpenPhone phone number ID not configured' }
  }

  console.log(`[${tenant.slug}] Using OpenPhone phone ID from: ${tenant.openphone_phone_id ? 'tenant config' : 'env var'}`)

  const toE164Format = toE164(to)
  if (!toE164Format) {
    return { success: false, error: `Invalid phone number: ${to}` }
  }

  // ── SMS Opt-Out Check ──
  // Block automated SMS to customers who texted STOP. Safe for cleaners (cleaners table, not customers).
  try {
    const optOutClient = getSupabaseServiceClient()
    const { data: optedOut } = await optOutClient
      .from('customers')
      .select('id')
      .eq('phone_number', toE164Format)
      .eq('tenant_id', tenant.id)
      .eq('sms_opt_out', true)
      .limit(1)
      .maybeSingle()

    if (optedOut) {
      console.log(`[${tenant.slug}] SMS blocked: ${toE164Format} opted out`)
      return { success: false, error: 'Customer opted out of SMS' }
    }
  } catch (optOutErr) {
    // Don't block SMS if opt-out check fails — log and continue
    console.error(`[${tenant.slug}] SMS opt-out check failed:`, optOutErr)
  }

  // ── Content dedup (skip when caller pre-inserted the DB record) ──
  // Prevents the exact same message from being sent twice within 5 minutes.
  // Uses full content match (not prefix) to avoid false positives when
  // different templates share a similar opening (e.g. "Hey {name} it's {business}...")
  if (!options?.skipDedup) try {
    const dedupClient = getSupabaseServiceClient()
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { data: recentDupes } = await dedupClient
      .from('messages')
      .select('id')
      .eq('phone_number', toE164Format)
      .eq('direction', 'outbound')
      .eq('content', message)
      .gte('created_at', fiveMinsAgo)
      .limit(1)

    if (recentDupes && recentDupes.length > 0) {
      console.warn(`[${tenant.slug}] SMS deduped for ${toE164Format}: same message sent within 5 min`)
      return { success: false, error: 'SMS deduped: identical message recently sent' }
    }
  } catch (dedupErr) {
    console.error(`[${tenant.slug}] SMS dedup check failed:`, dedupErr)
  }

  // ── Per-recipient daily limit (skipped for cleaner operational SMS) ──
  if (!options?.skipThrottle) try {
    const throttleClient = getSupabaseServiceClient()
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { count: dailyCount } = await throttleClient
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('phone_number', toE164Format)
      .eq('direction', 'outbound')
      .gte('created_at', twentyFourHoursAgo)

    if (dailyCount && dailyCount >= 20) {
      console.warn(`[${tenant.slug}] SMS throttled for ${toE164Format}: ${dailyCount} messages in 24h (limit 20)`)
      return { success: false, error: `SMS throttled: customer received ${dailyCount} messages in 24h` }
    }
  } catch (throttleErr) {
    console.error(`[${tenant.slug}] SMS throttle check failed:`, throttleErr)
  }

  try {
    const controller = new AbortController()
    const fetchTimeout = setTimeout(() => controller.abort(), 15_000)
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
      signal: controller.signal,
    })
    clearTimeout(fetchTimeout)

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[${tenant.slug}] OpenPhone API error:`, response.status, errorText)
      return {
        success: false,
        error: `OpenPhone API error: ${response.status} - ${errorText}`
      }
    }

    const data = await response.json()
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
 * Create or update a contact in OpenPhone so names show up in the app.
 * Uses externalId = "customer-{id}" for dedup (409 = already exists).
 */
export async function syncContactToOpenPhone(
  tenant: { openphone_api_key?: string; slug: string },
  customer: { id: number; first_name?: string | null; last_name?: string | null; phone_number: string; email?: string | null }
): Promise<{ success: boolean; contactId?: string; skipped?: boolean; error?: string }> {
  const apiKey = tenant.openphone_api_key
  if (!apiKey) return { success: false, error: 'No OpenPhone API key' }

  const firstName = customer.first_name || 'Unknown'
  const externalId = `customer-${customer.id}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    const body: Record<string, unknown> = {
      externalId,
      source: 'osiris',
      defaultFields: {
        firstName,
        ...(customer.last_name ? { lastName: customer.last_name } : {}),
        phoneNumbers: [{ name: 'mobile', value: customer.phone_number }],
        ...(customer.email ? { emails: [{ name: 'main', value: customer.email }] } : {}),
      },
    }

    const response = await fetch('https://api.openphone.com/v1/contacts', {
      method: 'POST',
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (response.status === 409) {
      return { success: true, skipped: true }
    }

    if (!response.ok) {
      const err = await response.text()
      return { success: false, error: `${response.status}: ${err}` }
    }

    const data = await response.json()
    return { success: true, contactId: data.id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * SMS message templates (kept for backwards compatibility)
 */
export const SMS_TEMPLATES = {
  vapiConfirmation: (name: string, serviceType: string, dateTime: string, address: string, isEstimate?: boolean, offerEarned?: boolean, offerApplied?: boolean): string => {
    // Avoid "Cleaning cleaning" — if serviceType already contains "cleaning", don't append it
    const humanType = serviceType.replace(/_/g, ' ')
    const serviceLabel = /cleaning/i.test(humanType) ? humanType : `${humanType} cleaning`
    const displayLabel = isEstimate ? `free ${serviceLabel} estimate` : serviceLabel
    const nextStep = isEstimate
      ? `send your best email and I'll get you confirmed`
      : `send your best email and I will send over a confirmed price`
    let msg = `Hi ${name}! Just confirming: ${displayLabel} on ${dateTime} at ${address}.\n\nIf anything looks off, just text me. If it is correct, ${nextStep}.`
    if (offerApplied) {
      msg += `\n\n🎉 Your FREE standard cleaning has been applied to this booking!`
    }
    if (offerEarned) {
      msg += `\n\n🎁 BONUS: You've earned a FREE standard cleaning on your next visit! Book again within 90 days and it's on us.`
    }
    return msg
  },
  paymentConfirmation: (serviceType: string, date: string): string => {
    const humanType = serviceType.replace(/_/g, ' ')
    const serviceLabel = /cleaning/i.test(humanType) ? humanType : `${humanType} cleaning`
    return `Payment received for your ${serviceLabel} on ${date}. We're scheduling your cleaner now and will confirm shortly.`
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
  if (!signature) {
    console.warn('No signature provided in webhook request')
    return false
  }

  // Collect all secrets to try: global env var + all per-tenant secrets
  const secretsToTry: string[] = []

  // 1. Global env var (backward compat)
  const globalSecret = process.env.OPENPHONE_WEBHOOK_SECRET
  if (globalSecret) secretsToTry.push(globalSecret)

  // 2. Per-tenant secrets from DB (each tenant has their own OpenPhone account)
  // NOTE: Do NOT filter by active — inactive tenants must still receive webhooks
  // so their messages are stored and visible on the dashboard.
  try {
    const { getSupabaseServiceClient } = await import('./supabase')
    const client = getSupabaseServiceClient()
    const { data: tenants } = await client
      .from('tenants')
      .select('openphone_webhook_secret')
      .not('openphone_webhook_secret', 'is', null)
    if (tenants) {
      for (const t of tenants) {
        if (t.openphone_webhook_secret && !secretsToTry.includes(t.openphone_webhook_secret)) {
          secretsToTry.push(t.openphone_webhook_secret)
        }
      }
    }
  } catch (err) {
    console.warn('[OpenPhone] Could not fetch tenant webhook secrets:', err)
  }

  // If no secrets configured anywhere, skip validation
  if (secretsToTry.length === 0) {
    console.warn('No OpenPhone webhook secrets configured - skipping validation')
    return true
  }

  const candidateSignatures = extractSignatureCandidates(signature)
  const payloadVariants = getPayloadVariants(payload, timestamp)

  // Try each secret until one matches
  try {
    for (const secret of secretsToTry) {
      const candidateKeys = getCandidateKeys(secret)
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
    }

    console.warn('[OpenPhone] Signature validation failed against all secrets')
    return false
  } catch (error) {
    console.error('Error validating webhook signature:', error)
    return false
  }
}

/**
 * Extract message content from OpenPhone webhook payload
 *
 * OpenPhone v3 webhook structure:
 * {
 *   "object": {
 *     "type": "message.received",
 *     "data": {
 *       "object": {
 *         "from": "+1...",
 *         "body": "message text",
 *         "direction": "incoming"
 *       }
 *     }
 *   }
 * }
 */
export function extractMessageFromOpenPhonePayload(
  body: Record<string, unknown>
): { from: string; to?: string; content: string; createdAt: string; direction?: string; eventType?: string } | null {
  // Log full payload for debugging (truncated)
  console.log('[OpenPhone] Raw payload structure:', JSON.stringify(body).slice(0, 1000))

  // Handle OpenPhone v3 nested structure: body.object.data.object
  const rootObject = (body.object as Record<string, unknown>) || body
  const eventType = (rootObject.type as string) || (body.type as string)
  const dataWrapper = (rootObject.data as Record<string, unknown>) || (body.data as Record<string, unknown>) || body
  const message = (dataWrapper.object as Record<string, unknown>) || dataWrapper

  // Also try to get conversation info which may contain the phone number
  const conversation = (message.conversation as Record<string, unknown>) ||
                       (dataWrapper.conversation as Record<string, unknown>) || {}
  const conversationParticipants = (conversation.participants as Array<Record<string, unknown>>) || []

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
    dataWrapper.from,
    dataWrapper.sender,
    dataWrapper.phoneNumber,
    dataWrapper.phone_number
  )

  // Extract the "to" phone number - this is the business phone that received the message
  // OpenPhone may send this in different ways:
  // 1. Direct "to" field with phone number
  // 2. phoneNumberId (OpenPhone internal ID)
  // 3. In the conversation participants
  // 4. In a nested phoneNumber object
  const phoneNumberObj = (message.phoneNumber as Record<string, unknown>) ||
                         (dataWrapper.phoneNumber as Record<string, unknown>) || {}

  const to = firstPhone(
    // Direct to fields
    message.to,
    message.recipient,
    message.toPhoneNumber,
    message.to_phone_number,
    dataWrapper.to,
    dataWrapper.recipient,
    dataWrapper.toPhoneNumber,
    dataWrapper.to_phone_number,
    // Phone number from nested object
    phoneNumberObj.number,
    phoneNumberObj.phoneNumber,
    // OpenPhone phone ID (fallback)
    message.phoneNumberId,
    dataWrapper.phoneNumberId,
    // Conversation phone number (for incoming, the "to" is the conversation phone)
    conversation.phoneNumber,
    conversation.phoneNumberId,
    // Try participants (business phone is usually the one that's not the "from" number)
    ...conversationParticipants
      .filter((p: Record<string, unknown>) => p.phoneNumber !== from && p.number !== from)
      .map((p: Record<string, unknown>) => p.phoneNumber || p.number)
  )

  // Log what we found for debugging
  console.log('[OpenPhone] Extracted to field:', to, 'from fields:', {
    'message.to': message.to,
    'message.phoneNumberId': message.phoneNumberId,
    'dataWrapper.phoneNumberId': dataWrapper.phoneNumberId,
    'phoneNumberObj': phoneNumberObj,
    'conversation.phoneNumber': conversation.phoneNumber,
  })

  const createdAt = firstString(
    message.createdAt,
    message.created_at,
    message.timestamp,
    dataWrapper.createdAt,
    dataWrapper.timestamp
  ) || new Date().toISOString()

  const rawDirection = firstString(message.direction, dataWrapper.direction, body.direction)

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
    to,
    content,
    createdAt,
    direction,
    eventType,
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

  candidates.add(raw)
  candidates.add(raw.replace(/^sha256=/i, ''))

  // OpenPhone format: "hmac;{version};{timestamp};{digest}"
  const semicolonParts = raw.split(';')
  if (semicolonParts.length >= 4 && semicolonParts[0].toLowerCase() === 'hmac') {
    candidates.add(semicolonParts[3])
  }

  // Stripe-style format: "t=1234,v1=abc..."
  const commaParts = raw.split(',')
  for (const part of commaParts) {
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
