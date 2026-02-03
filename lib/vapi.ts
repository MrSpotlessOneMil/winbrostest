/**
 * VAPI Integration - Voice AI call transcript parsing
 * Multi-tenant version - requires Tenant parameter for outbound calls
 *
 * Extracts booking information from call transcripts using AI
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { extractJsonObject, safeJsonParse } from './json-utils'
import { extractPhoneFromVapiPayload, toE164 } from './phone-utils'
import type { Tenant } from './tenant'

export interface BookingInfo {
  firstName?: string
  lastName?: string
  phone?: string
  address?: string
  bedrooms?: number
  bathrooms?: number
  squareFootage?: number
  serviceType?: string
  requestedDate?: string
  requestedTime?: string
  notes?: string
  frequency?: string
  freeCouchCleaningRequested?: boolean | null
}

export interface VapiCallData {
  callId: string
  phone: string
  transcript: string
  duration: number
  outcome: 'booked' | 'not_booked' | 'voicemail'
  audioUrl?: string
}

/**
 * Extract booking information from a VAPI call transcript using AI
 * Uses universal AI keys (ANTHROPIC_API_KEY, OPENAI_API_KEY)
 */
export async function parseTranscript(transcript: string): Promise<BookingInfo> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  if (anthropicKey) {
    try {
      return await parseWithClaude(transcript)
    } catch (error) {
      console.error('Claude parsing error, trying OpenAI:', error)
    }
  }

  if (openaiKey) {
    try {
      return await parseWithOpenAI(transcript)
    } catch (error) {
      console.error('OpenAI parsing error:', error)
    }
  }

  // Fallback: basic regex parsing
  return parseWithRegex(transcript)
}

/**
 * Parse transcript using Claude
 */
async function parseWithClaude(transcript: string): Promise<BookingInfo> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  // Check for malformed API key (line breaks, extra whitespace)
  if (apiKey.includes('\n') || apiKey.includes('\r') || apiKey !== apiKey.trim()) {
    throw new Error('ANTHROPIC_API_KEY contains invalid whitespace/line breaks')
  }

  try {
    const client = new Anthropic({ apiKey })
    const currentDate = new Date().toISOString().split('T')[0]

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `Extract booking information from this cleaning service phone call transcript.

IMPORTANT: Today's date is ${currentDate} (YYYY-MM-DD format).
When the customer says "tomorrow", "next week", "next Monday", etc., calculate the date relative to today.

CRITICAL: If the customer mentions MULTIPLE dates or changes their mind during the call, use ONLY the FINAL/LAST date they confirmed. Look for phrases like "actually", "wait", "change that", "no make it", "instead" - these indicate the customer is correcting themselves. Always extract the most recent date mentioned at the end of the conversation.

Return a JSON object with these fields (use null for missing info):
- firstName: customer's first name
- lastName: customer's last name
- address: full street address
- bedrooms: number of bedrooms (integer)
- bathrooms: number of bathrooms (allow .5 increments)
- squareFootage: square footage (integer)
- serviceType: "Standard cleaning", "Deep cleaning", or "Move in/out"
- requestedDate: date in YYYY-MM-DD format (calculate from today if relative, use FINAL date if customer changes)
- requestedTime: time in HH:MM AM/PM format
- notes: any special requests, add-ons (inside fridge/oven/cabinets, windows), pet info, access instructions
- frequency: "One-time", "Weekly", "Bi-weekly", or "Monthly"
- freeCouchCleaningRequested: true if customer explicitly wants to redeem the free couch cleaning for this booking, false if they explicitly decline, null if not mentioned or they want to save it for later

TRANSCRIPT:
${transcript}

Respond with ONLY the JSON object, no other text.`
        }
      ],
    })

    const textContent = response.content.find(block => block.type === 'text')
    const jsonText = textContent?.type === 'text' ? textContent.text : '{}'

    // Clean the response (remove markdown code blocks if present)
    const cleaned = jsonText.replace(/```json\n?|\n?```/g, '').trim()
    const candidate = extractJsonObject(cleaned)
    const parsed = safeJsonParse<BookingInfo>(candidate)

    if (!parsed.value) {
      throw new Error(`Failed to parse Claude JSON: ${parsed.error || 'Unknown error'}`)
    }

    if (parsed.repaired) {
      console.warn('Repaired invalid JSON from Claude output')
    }

    return parsed.value
  } catch (error) {
    // Log detailed error information
    console.error('Claude parsing error:', error)
    if (error instanceof Error) {
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
    }
    throw error
  }
}

/**
 * Parse transcript using OpenAI
 */
async function parseWithOpenAI(transcript: string): Promise<BookingInfo> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  // Check for malformed API key
  if (apiKey.includes('\n') || apiKey.includes('\r') || apiKey !== apiKey.trim()) {
    throw new Error('OPENAI_API_KEY contains invalid whitespace/line breaks')
  }

  try {
    const client = new OpenAI({ apiKey })
    const currentDate = new Date().toISOString().split('T')[0]

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You extract booking information from cleaning service phone call transcripts.

IMPORTANT: Today's date is ${currentDate} (YYYY-MM-DD format).
When the customer says "tomorrow", "next week", "next Monday", etc., calculate the date relative to today.

CRITICAL: If the customer mentions MULTIPLE dates or changes their mind during the call, use ONLY the FINAL/LAST date they confirmed. Look for phrases like "actually", "wait", "change that", "no make it", "instead" - these indicate the customer is correcting themselves. Always extract the most recent date mentioned at the end of the conversation.

Return a JSON object with these fields (use null for missing info):
- firstName, lastName, address, bedrooms, bathrooms (allow .5), squareFootage
- serviceType: "Standard cleaning", "Deep cleaning", or "Move in/out"
- requestedDate (YYYY-MM-DD, calculate from today if relative, use FINAL date if changed), requestedTime (HH:MM AM/PM)
- notes (include add-ons like inside fridge/oven/cabinets, windows), frequency
- freeCouchCleaningRequested (true if they want to redeem the free couch cleaning for this booking, false if they explicitly decline, null if not mentioned or they want to save it for later)`
        },
        {
          role: 'user',
          content: `Extract booking info from this transcript:\n\n${transcript}`
        }
      ],
    })

    const jsonText = response.choices[0]?.message?.content || '{}'
    const candidate = extractJsonObject(jsonText)
    const parsed = safeJsonParse<BookingInfo>(candidate)

    if (!parsed.value) {
      throw new Error(`Failed to parse OpenAI JSON: ${parsed.error || 'Unknown error'}`)
    }

    if (parsed.repaired) {
      console.warn('Repaired invalid JSON from OpenAI output')
    }

    return parsed.value
  } catch (error) {
    console.error('OpenAI parsing error:', error)
    if (error instanceof Error) {
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
    }
    throw error
  }
}

/**
 * Basic regex-based parsing as fallback
 */
function parseWithRegex(transcript: string): BookingInfo {
  const info: BookingInfo = {}
  const notes: string[] = []

  // Try to extract common patterns
  const lowerTranscript = transcript.toLowerCase()

  // Service type
  if (lowerTranscript.includes('deep clean')) {
    info.serviceType = 'Deep cleaning'
  } else if (lowerTranscript.includes('move in') || lowerTranscript.includes('move out')) {
    info.serviceType = 'Move in/out'
  } else if (lowerTranscript.includes('standard') || lowerTranscript.includes('regular')) {
    info.serviceType = 'Standard cleaning'
  }

  // Bedrooms
  const bedroomMatch = transcript.match(/(\d+)\s*(?:bed(?:room)?s?|br)/i)
  if (bedroomMatch) {
    info.bedrooms = parseInt(bedroomMatch[1])
  }

  // Bathrooms
  const bathroomMatch = transcript.match(/(\d+(?:\.\d+)?)\s*(?:bath(?:room)?s?|ba)/i)
  if (bathroomMatch) {
    info.bathrooms = parseFloat(bathroomMatch[1])
  }

  // Square footage
  const sqftMatch = transcript.match(/(\d{3,5})\s*(?:sq(?:uare)?\.?\s*(?:ft|feet)?|sqft)/i)
  if (sqftMatch) {
    info.squareFootage = parseInt(sqftMatch[1])
  }

  if (/inside\s+(the\s+)?fridge|clean\s+fridge|fridge\s+interior/i.test(transcript)) {
    notes.push('inside fridge')
  }
  if (/inside\s+(the\s+)?oven|clean\s+oven|oven\s+interior/i.test(transcript)) {
    notes.push('inside oven')
  }
  if (/inside\s+(the\s+)?cabinet|inside\s+cabinet|inside\s+cupboard/i.test(transcript)) {
    notes.push('inside cabinets')
  }
  if (/windows?/i.test(transcript)) {
    notes.push('windows')
  }
  if (/\b(pet|pets|dog|dogs|cat|cats|puppy|puppies|kitten|kittens)\b/i.test(transcript)) {
    notes.push('pet')
  }

  if (notes.length > 0) {
    info.notes = notes.join(', ')
  }

  const couchRequest = detectFreeCouchCleaningRequest(transcript)
  if (couchRequest !== null) {
    info.freeCouchCleaningRequested = couchRequest
  }

  return info
}

export function detectFreeCouchCleaningRequest(transcript: string): boolean | null {
  if (!transcript) return null

  const couchMatch = /\b(couch|sofa|sectional|loveseat|upholstery)\b/i
  if (!couchMatch.test(transcript)) {
    return null
  }

  const declinePatterns: RegExp[] = [
    /\b(no|nope|nah)\b[\s\S]{0,40}\b(couch|sofa|sectional|loveseat|upholstery)\b/i,
    /\b(don't|do not|dont)\b[\s\S]{0,40}\b(want|need)\b[\s\S]{0,40}\b(couch|sofa|sectional|loveseat|upholstery)\b/i,
    /\b(not interested|not right now|maybe later|later on|another time)\b/i,
  ]

  for (const pattern of declinePatterns) {
    if (pattern.test(transcript)) {
      return false
    }
  }

  const acceptPatterns: RegExp[] = [
    /\b(yes|yeah|yep|sure|please|ok|okay|sounds good)\b[\s\S]{0,40}\b(couch|sofa|sectional|loveseat|upholstery)\b/i,
    /\b(couch|sofa|sectional|loveseat|upholstery)\b[\s\S]{0,40}\b(yes|yeah|yep|sure|please|ok|okay)\b/i,
    /\b(add|include|redeem|use|claim|want|need)\b[\s\S]{0,40}\b(couch|sofa|sectional|loveseat|upholstery)\b/i,
    /\b(couch|sofa|sectional|loveseat|upholstery)\b[\s\S]{0,40}\b(add|include|redeem|use|claim|want|need)\b/i,
  ]

  for (const pattern of acceptPatterns) {
    if (pattern.test(transcript)) {
      return true
    }
  }

  return null
}

/**
 * Extract call data from VAPI webhook payload
 */
export function extractVapiCallData(payload: Record<string, unknown>): VapiCallData | null {
  try {
    // VAPI webhook structure can vary, handle common patterns
    const message = (payload.message as Record<string, unknown>) || payload
    const call = (message.call as Record<string, unknown>) || (payload.call as Record<string, unknown>) || message
    const analysis = message.analysis && typeof message.analysis === 'object'
      ? (message.analysis as Record<string, unknown>)
      : null

    // Extract phone number
    let phone = extractPhoneFromVapiPayload(payload)
    if (!phone && call.customer && typeof call.customer === 'object') {
      const customer = call.customer as Record<string, unknown>
      if (typeof customer.number === 'string') {
        phone = customer.number
      }
    }

    // Extract transcript
    let transcript = ''
    if (message.transcript && typeof message.transcript === 'string') {
      transcript = message.transcript
    } else if (call.transcript && typeof call.transcript === 'string') {
      transcript = call.transcript
    } else if (message.artifact && typeof message.artifact === 'object') {
      const artifact = message.artifact as Record<string, unknown>
      if (artifact.transcript && typeof artifact.transcript === 'string') {
        transcript = artifact.transcript
      } else if (Array.isArray(artifact.messages)) {
        transcript = buildTranscriptFromMessages(artifact.messages)
      }
    } else if (message.messages && Array.isArray(message.messages)) {
      // Construct transcript from messages array
      transcript = buildTranscriptFromMessages(message.messages)
    } else if (Array.isArray(call.messages)) {
      transcript = buildTranscriptFromMessages(call.messages)
    }

    if (!transcript && analysis && typeof analysis.summary === 'string') {
      transcript = analysis.summary
    }

    // Extract call ID
    const callId =
      (call.id as string) ||
      (call.callId as string) ||
      (message.callId as string) ||
      (message.id as string) ||
      ''

    // Extract duration
    const durationSeconds =
      coerceNumber(call.duration) ??
      coerceNumber(call.durationSeconds) ??
      coerceNumber(call.duration_seconds) ??
      coerceNumber(message.duration) ??
      coerceNumber(message.durationSeconds) ??
      coerceNumber(message.duration_seconds)

    const durationMs =
      coerceNumber(call.durationMs) ??
      coerceNumber(call.duration_ms) ??
      coerceNumber(message.durationMs) ??
      coerceNumber(message.duration_ms)

    const duration = durationSeconds ?? (durationMs ? durationMs / 1000 : 0)

    // Extract audio URL
    const audioUrl = (call.recordingUrl as string) || (message.recordingUrl as string)

    // Determine outcome
    let outcome: 'booked' | 'not_booked' | 'voicemail' = 'not_booked'
    const status = (call.status as string) || (message.status as string) || ''
    const endedReason = (call.endedReason as string) || (message.endedReason as string) || ''
    const successEvaluation = analysis?.successEvaluation
    const summary = typeof analysis?.summary === 'string' ? analysis.summary : ''

    if (endedReason.includes('voicemail') || status.includes('voicemail')) {
      outcome = 'voicemail'
    } else if (
      successEvaluation === true ||
      successEvaluation === 'true' ||
      status.includes('book') ||
      transcript.toLowerCase().includes('book') ||
      transcript.toLowerCase().includes('schedule') ||
      summary.toLowerCase().includes('booked') ||
      summary.toLowerCase().includes('scheduled')
    ) {
      outcome = 'booked'
    }

    return {
      callId,
      phone,
      transcript,
      duration,
      outcome,
      audioUrl,
    }
  } catch (error) {
    console.error('Error extracting VAPI call data:', error)
    return null
  }
}

function buildTranscriptFromMessages(messages: unknown[]): string {
  const lines: string[] = []
  for (const item of messages) {
    if (typeof item === 'string') {
      if (item.trim()) {
        lines.push(item.trim())
      }
      continue
    }
    if (!item || typeof item !== 'object') {
      continue
    }
    const message = item as Record<string, unknown>
    const role = typeof message.role === 'string' ? message.role : 'unknown'
    const content =
      typeof message.content === 'string'
        ? message.content
        : typeof message.message === 'string'
          ? message.message
          : typeof message.text === 'string'
            ? message.text
            : ''

    const text = content.trim()
    if (text) {
      lines.push(`${role}: ${text}`)
    }
  }
  return lines.join('\n')
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }
  return null
}

/**
 * Format date and time for SMS confirmation
 */
export function formatDateTimeForSMS(date: string | null, time: string | null): string {
  if (!date) return 'TBD'

  try {
    const dateObj = new Date(date)
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }
    const formattedDate = dateObj.toLocaleDateString('en-US', options)

    if (time) {
      return `${formattedDate}, ${time}`
    }
    return formattedDate
  } catch {
    return date + (time ? ` ${time}` : '')
  }
}

/**
 * Initiate an outbound call via VAPI
 * Backwards compatible - can be called with:
 * - (phoneNumber, customerName, context, leadId) - old pattern
 * - (tenant, phoneNumber, customerName, context) - new pattern
 */
export async function initiateOutboundCall(
  tenantOrPhone: Tenant | string,
  phoneOrName: string,
  nameOrContext?: string | { leadId?: string; jobId?: string },
  contextOrLeadId?: { leadId?: string; jobId?: string } | string
): Promise<{ success: boolean; callId?: string; error?: string }> {
  // Import getDefaultTenant dynamically to avoid circular dependencies
  const { getDefaultTenant } = await import('./tenant')

  // Determine if called with tenant or without (backwards compat)
  let tenant: Tenant | null
  let phoneNumber: string
  let customerName: string
  let context: { leadId?: string; jobId?: string } | undefined

  if (typeof tenantOrPhone === 'string') {
    // Old calling pattern: initiateOutboundCall(phoneNumber, customerName, context?, leadId?)
    tenant = await getDefaultTenant()
    phoneNumber = tenantOrPhone
    customerName = phoneOrName
    if (typeof nameOrContext === 'object') {
      context = nameOrContext
    } else if (typeof contextOrLeadId === 'string') {
      context = { leadId: contextOrLeadId }
    }
  } else {
    // New calling pattern: initiateOutboundCall(tenant, phoneNumber, customerName, context?)
    tenant = tenantOrPhone
    phoneNumber = phoneOrName
    customerName = typeof nameOrContext === 'string' ? nameOrContext : ''
    context = typeof contextOrLeadId === 'object' ? contextOrLeadId : undefined
  }

  if (!tenant) {
    console.error('No tenant found - cannot initiate outbound call')
    return { success: false, error: 'No tenant configured' }
  }

  try {
    // Check if tenant has VAPI configured
    if (!tenant.workflow_config.use_vapi_outbound) {
      console.log(`[${tenant.slug}] VAPI outbound calls disabled in workflow config`)
      return { success: false, error: 'VAPI outbound calls disabled for this tenant' }
    }

    // Get required API keys from tenant
    const vapiApiKey = tenant.vapi_api_key
    if (!vapiApiKey) {
      console.error(`[${tenant.slug}] VAPI API key not configured`)
      return { success: false, error: 'VAPI API key not configured' }
    }

    const outboundPhoneId = tenant.vapi_phone_id
    if (!outboundPhoneId) {
      console.error(`[${tenant.slug}] VAPI phone ID not configured`)
      return { success: false, error: 'VAPI phone ID not configured' }
    }

    // Use outbound assistant ID if available, fall back to inbound assistant ID
    const assistantId = tenant.vapi_outbound_assistant_id || tenant.vapi_assistant_id
    if (!assistantId) {
      console.error(`[${tenant.slug}] VAPI assistant ID not configured (neither outbound nor inbound)`)
      return { success: false, error: 'VAPI assistant ID not configured' }
    }

    // Normalize phone number to E.164 format
    const normalizedPhone = toE164(phoneNumber)
    if (!normalizedPhone) {
      console.error(`[${tenant.slug}] Invalid phone number format:`, phoneNumber)
      return { success: false, error: 'Invalid phone number format' }
    }

    // Build metadata from context
    const metadata: Record<string, string> = {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
    }
    if (context?.leadId) {
      metadata.leadId = context.leadId
    }
    if (context?.jobId) {
      metadata.jobId = context.jobId
    }

    // Make the API call to VAPI
    console.log(`[${tenant.slug}] Initiating outbound call via VAPI:`, {
      phoneNumber: normalizedPhone,
      customerName,
      assistantId,
      outboundPhoneId,
    })

    const response = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vapiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumberId: outboundPhoneId,
        assistantId: assistantId,
        customer: {
          number: normalizedPhone,
          name: customerName,
        },
        metadata,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[${tenant.slug}] VAPI API error:`, response.status, errorText)
      return {
        success: false,
        error: `VAPI API error: ${response.status} - ${errorText}`,
      }
    }

    const data = await response.json()
    console.log(`[${tenant.slug}] VAPI outbound call initiated successfully:`, data)

    return {
      success: true,
      callId: data.id || data.callId,
    }
  } catch (error) {
    console.error(`[${tenant.slug}] Error initiating outbound call:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    }
  }
}
