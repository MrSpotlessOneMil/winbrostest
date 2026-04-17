import OpenAI from 'openai'
import type { Customer, Job } from './supabase'
import { extractJsonObject, safeJsonParse } from './json-utils'

export type LlmUpdateDecision = {
  updateNeeded: boolean
  customerUpdates?: {
    firstName?: string
    lastName?: string
    email?: string
    address?: string
    bedrooms?: number
    bathrooms?: number
    squareFootage?: number
  }
  jobUpdates?: {
    address?: string
    date?: string
    time?: string
    notesAppend?: string
  }
  confidence?: number
  reason?: string
}

type LlmUpdateContext = {
  incomingMessage: string
  textingTranscript?: string
  customer?: Partial<Customer> | null
  activeJob?: Partial<Job> | null
}

export async function decideUpdatesWithLLM(
  context: LlmUpdateContext
): Promise<LlmUpdateDecision | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return null
  }

  const model = process.env.OPENAI_UPDATE_MODEL || 'gpt-4o-mini'
  const client = new OpenAI({ apiKey })

  try {
    const response = await client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(),
        },
        {
          role: 'user',
          content: buildUserPrompt(context),
        },
      ],
    })

    const jsonText = response.choices[0]?.message?.content || '{}'
    const candidate = extractJsonObject(jsonText)
    const parsed = safeJsonParse<Record<string, unknown>>(candidate)
    if (!parsed.value) {
      console.error('LLM update decision JSON parse error:', parsed.error)
      return null
    }

    return normalizeDecision(parsed.value)
  } catch (error) {
    console.error('LLM update decision error:', error)
    return null
  }
}

function buildSystemPrompt(): string {
  return [
    'You extract structured database updates from SMS messages for a cleaning business.',
    'Return ONLY valid JSON with the schema below.',
    '',
    'Schema:',
    '{',
    '  "update_needed": true|false,',
    '  "customer_updates": {',
    '    "first_name": string|null,',
    '    "last_name": string|null,',
    '    "email": string|null,',
    '    "address": string|null,',
    '    "bedrooms": number|null,',
    '    "bathrooms": number|null,',
    '    "square_footage": number|null',
    '  },',
    '  "job_updates": {',
    '    "address": string|null,',
    '    "date": "YYYY-MM-DD"|null,',
    '    "time": "HH:MM AM/PM"|null,',
    '    "notes_append": string|null',
    '  },',
    '  "confidence": number (0-1),',
    '  "reason": string',
    '}',
    '',
    'Rules:',
    '- Only update fields explicitly mentioned or corrected.',
    '- Never copy values from the customer/job records into the output unless the message explicitly mentions them.',
    '- If the message only corrects a name, set first_name/last_name only and set all other fields to null.',
    '- If the message only corrects address spelling, set address only and set all other fields to null.',
    '- Do NOT invent missing data.',
    '- If the message is just a correction like "It\'s spelled Tamalpais" or "You got spelling wrong. Tamalpais", use the existing address to reconstruct a full address with the corrected street name.',
    '- If the message corrects a first or last name, update the corresponding name field.',
    '- If no update is needed, set update_needed=false and all fields to null.',
    '- CRITICAL: NEVER return date or time values unless the customer explicitly requests a NEW date or time.',
    '- Address corrections, name corrections, or spelling fixes are NOT schedule changes - do NOT set date or time for these.',
    '- Only set date/time if the message contains phrases like "change to", "move to", "reschedule", or explicitly mentions a new date/time.',
  ].join('\n')
}

function buildUserPrompt(context: LlmUpdateContext): string {
  const customer = context.customer || {}
  const activeJob = context.activeJob || {}

  return [
    `Incoming message: ${context.incomingMessage}`,
    '',
    'Customer record:',
    `- Name: ${[customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unknown'}`,
    `- Email: ${customer.email || 'Unknown'}`,
    `- Address: ${customer.address || 'Unknown'}`,
    `- Bedrooms: ${customer.bedrooms ?? 'Unknown'}`,
    `- Bathrooms: ${customer.bathrooms ?? 'Unknown'}`,
    `- Square footage: ${customer.square_footage ?? 'Unknown'}`,
    '',
    'Active job:',
    `- Address: ${activeJob.address || 'Unknown'}`,
    `- Date: ${activeJob.date || 'Unknown'}`,
    `- Time: ${activeJob.scheduled_at || 'Unknown'}`,
    '',
    `Recent transcript:\n${context.textingTranscript || 'None'}`,
  ].join('\n')
}

function normalizeDecision(raw: Record<string, unknown>): LlmUpdateDecision {
  const updateNeeded = Boolean(raw.update_needed ?? raw.updateNeeded)
  const customerRaw =
    (raw.customer_updates as Record<string, unknown> | undefined) ||
    (raw.customerUpdates as Record<string, unknown> | undefined) ||
    {}
  const jobRaw =
    (raw.job_updates as Record<string, unknown> | undefined) ||
    (raw.jobUpdates as Record<string, unknown> | undefined) ||
    {}

  return {
    updateNeeded,
    customerUpdates: {
      firstName: normalizeString(customerRaw.first_name ?? customerRaw.firstName),
      lastName: normalizeString(customerRaw.last_name ?? customerRaw.lastName),
      email: normalizeString(customerRaw.email),
      address: normalizeString(customerRaw.address),
      bedrooms: normalizeNumber(customerRaw.bedrooms),
      bathrooms: normalizeNumber(customerRaw.bathrooms),
      squareFootage: normalizeNumber(customerRaw.square_footage ?? customerRaw.squareFootage),
    },
    jobUpdates: {
      address: normalizeString(jobRaw.address),
      date: normalizeString(jobRaw.date),
      time: normalizeString(jobRaw.time),
      notesAppend: normalizeString(jobRaw.notes_append ?? jobRaw.notesAppend),
    },
    confidence: normalizeNumber(raw.confidence),
    reason: normalizeString(raw.reason),
  }
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const parsed = Number(trimmed)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }
  return undefined
}
