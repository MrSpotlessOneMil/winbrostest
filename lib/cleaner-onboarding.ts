import OpenAI from 'openai'
import type { Cleaner } from './supabase'
import { extractJsonObject, safeJsonParse } from './json-utils'
import { toE164 } from './phone-utils'

export type CleanerAvailabilityRule = {
  days: string[]
  start: string
  end: string
}

export type CleanerAvailability = {
  tz: string
  rules: CleanerAvailabilityRule[]
}

export type CleanerUpdateDecision = {
  updateNeeded: boolean
  updates: {
    name?: string
    phone?: string
    availability?: CleanerAvailability
  }
  reply?: string
  intent?: 'onboarding' | 'availability_update' | 'job_question' | 'cancel_job' | 'other'
  confidence?: number
  reason?: string
}

type CleanerUpdateContext = {
  message: string
  transcript?: string
  jobContext?: string
  cleaner?: Partial<Cleaner> | null
  missingFields?: string[]
}

export async function extractCleanerUpdatesWithLLM(
  context: CleanerUpdateContext
): Promise<CleanerUpdateDecision | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return null
  }

  const model = process.env.OPENAI_CLEANER_MODEL || 'gpt-4o-mini'
  const client = new OpenAI({ apiKey })

  try {
    const response = await client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      temperature: 0.2,
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
      console.error('Cleaner onboarding JSON parse error:', parsed.error)
      return null
    }

    return normalizeDecision(parsed.value)
  } catch (error) {
    console.error('Cleaner onboarding LLM error:', error)
    return null
  }
}

function buildSystemPrompt(): string {
  return [
    'You help onboard cleaners for a cleaning business and answer their questions.',
    'Extract profile updates and craft a natural, human reply. Return ONLY JSON.',
    '',
    'Schema:',
    '{',
    '  "update_needed": true|false,',
    '  "intent": "onboarding"|"availability_update"|"job_question"|"cancel_job"|"other",',
    '  "updates": {',
    '    "name": string|null,',
    '    "phone": string|null,',
    '    "availability": {',
    '      "tz": "America/Los_Angeles",',
    '      "rules": [',
    '        { "days": ["MO","TU"], "start": "09:00", "end": "17:00" }',
    '      ]',
    '    } | null',
    '  },',
    '  "reply": string,',
    '  "confidence": number (0-1),',
    '  "reason": string',
    '}',
    '',
    'Rules:',
    '- Use the recent transcript to combine details across multiple messages.',
    '- Only include fields explicitly stated or corrected in the recent transcript.',
    '- If availability is mentioned, convert to the JSON format with tz + rules.',
    '- Days must be two-letter codes: MO TU WE TH FR SA SU.',
    '- Times must be 24-hour HH:MM.',
    '- If you include any update fields, set update_needed=true.',
    '- If no updates are present, set update_needed=false and updates to null fields.',
    '- Always provide a short reply.',
    '- If the cleaner is missing profile info, ask for the missing details.',
    '- Respond in the same language as the cleaner.',
    '- If the cleaner asks about their jobs, answer using the provided job context.',
    '- Cleaners are NOT allowed to reschedule jobs themselves.',
    '- If a cleaner asks to reschedule or change time/date, tell them: "I\'m sorry, but cleaners cannot reschedule jobs. You can either cancel this job, or contact Dominic at +1 (424) 275-5847 to discuss rescheduling."',
    '- Do NOT mark intent="cancel_job" for reschedule requests unless they explicitly confirm they want to cancel.',
    '- Only set intent="cancel_job" when the cleaner clearly says they want to cancel/decline or cannot do the job they were assigned.',
    '- Phrases like "I need to cancel", "I want to decline", "I can\'t do it", "not available anymore" should be intent="cancel_job".',
    '- In Spanish: "cancelar", "no puedo", "declinar" should also be intent="cancel_job".',
    '- If the message is a greeting, confusion, or correction (e.g., "hello", "who are you", "that\'s not what I said"), do NOT mention cancellation. Ask a brief clarifying question instead.',
    '- Never offer to help with rescheduling - only cancellation or contacting the owner.',
  ].join('\n')
}

function buildUserPrompt(context: CleanerUpdateContext): string {
  const cleaner = context.cleaner || {}
  const availability = cleaner.availability
    ? JSON.stringify(cleaner.availability)
    : 'Unknown'
  const missingFields = (context.missingFields || []).join(', ') || 'None'

  return [
    `Incoming message: ${context.message}`,
    '',
    `Recent transcript:\n${context.transcript || 'None'}`,
    '',
    `Job context:\n${context.jobContext || 'No jobs available.'}`,
    '',
    `Missing profile fields: ${missingFields}`,
    '',
    'Existing cleaner profile:',
    `- Name: ${cleaner.name || 'Unknown'}`,
    `- Phone: ${cleaner.phone || 'Unknown'}`,
    `- Availability: ${availability}`,
  ].join('\n')
}

function normalizeDecision(raw: Record<string, unknown>): CleanerUpdateDecision {
  const updatesRaw = (raw.updates as Record<string, unknown> | undefined) || {}
  const normalizedUpdates = {
    name: normalizeString(updatesRaw.name),
    phone: normalizePhone(updatesRaw.phone),
    availability: normalizeAvailability(updatesRaw.availability),
  }
  const updateNeeded = Boolean(
    raw.update_needed ?? raw.updateNeeded ?? hasUpdates(normalizedUpdates)
  )

  return {
    updateNeeded,
    updates: normalizedUpdates,
    reply: normalizeString(raw.reply),
    intent: normalizeIntent(raw.intent),
    confidence: normalizeNumber(raw.confidence),
    reason: normalizeString(raw.reason),
  }
}

function hasUpdates(updates: CleanerUpdateDecision['updates']): boolean {
  return Boolean(updates.name || updates.phone || updates.availability)
}

function normalizeIntent(value: unknown): CleanerUpdateDecision['intent'] {
  if (typeof value !== 'string') return undefined
  const normalized = value.toLowerCase()
  if (normalized === 'onboarding') return 'onboarding'
  if (normalized === 'availability_update') return 'availability_update'
  if (normalized === 'job_question') return 'job_question'
  if (normalized === 'cancel_job') return 'cancel_job'
  if (normalized === 'other') return 'other'
  return undefined
}

function normalizeAvailability(value: unknown): CleanerAvailability | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const tzRaw = typeof record.tz === 'string' ? record.tz.trim() : ''
  const tz = normalizeTimezone(tzRaw)
  if (!tz) return undefined

  const rulesRaw = Array.isArray(record.rules) ? record.rules : []
  const rules: CleanerAvailabilityRule[] = []

  for (const rule of rulesRaw) {
    if (!rule || typeof rule !== 'object') continue
    const ruleRecord = rule as Record<string, unknown>
    const days = Array.isArray(ruleRecord.days)
      ? ruleRecord.days
          .filter((day) => typeof day === 'string')
          .map((day) => day.trim().toUpperCase())
          .filter((day) => ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].includes(day))
      : []
    const start = typeof ruleRecord.start === 'string' ? ruleRecord.start.trim() : ''
    const end = typeof ruleRecord.end === 'string' ? ruleRecord.end.trim() : ''

    if (!days.length || !isValidTime(start) || !isValidTime(end)) continue
    rules.push({ days, start, end })
  }

  if (!rules.length) return undefined

  return { tz, rules }
}

function isValidTime(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value)
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function normalizePhone(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return toE164(trimmed) || trimmed
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

function normalizeTimezone(value: string): string | undefined {
  if (!value) return undefined
  const normalized = value.trim()
  const upper = normalized.toUpperCase()
  if (upper === 'PST' || upper === 'PDT' || upper === 'PT' || upper === 'PACIFIC') {
    return 'America/Los_Angeles'
  }
  return normalized
}
