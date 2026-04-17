/**
 * AI Response Generator for customer SMS conversations
 *
 * Uses Claude (Anthropic) as primary AI, with OpenAI as fallback
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { Customer, Job, Cleaner } from './supabase'
import { SMS_TEMPLATES } from './openphone'
import { getClientConfig } from './client-config'
import { queryBrain } from './brain'

interface ResponseContext {
  customerInfo: Partial<Customer>
  textingTranscript: string
  currentJobs: Job[]
  cleanerAvailability: Cleaner[]
  incomingMessage: string
  currentDateTime: Date
  pricingGuidance?: string
}

interface AIResponse {
  message: string
  shouldUpdateEmail?: string
  shouldUpdateJob?: Partial<Job>
  error?: string
}

/**
 * Generate an AI response to a customer SMS
 */
export async function generateResponse(context: ResponseContext): Promise<AIResponse> {
  // Try Claude first, fall back to OpenAI
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  if (anthropicKey) {
    try {
      return await generateClaudeResponse(context)
    } catch (error) {
      console.error('Claude error, falling back to OpenAI:', error)
    }
  }

  if (openaiKey) {
    try {
      return await generateOpenAIResponse(context)
    } catch (error) {
      console.error('OpenAI error:', error)
    }
  }

  // If both fail, return a fallback response
  return {
    message: "Thanks for the message! A member of our team will follow up shortly.",
    error: 'AI service unavailable'
  }
}

/**
 * Build the system prompt for the AI
 */
function buildSystemPrompt(): string {
  const config = getClientConfig()
  return `You are texting customers on behalf of ${config.businessName}, a professional cleaning service. You ARE the business — speak in first person as a friendly team member, not as a bot or outside observer.

Write like a real person texting: short, warm, casual-professional. Use contractions. Never sound robotic or scripted.

CRITICAL RULES:
- NEVER summarize or recap the conversation back to the customer. Don't say things like "We've already confirmed..." or "As we discussed..." — the customer already knows what they said. Just move the conversation forward.
- NEVER narrate what is happening. Don't describe the state of the conversation. Just respond naturally to what the customer said, like a real person would.
- Keep it SHORT. 1-3 sentences max. Real texts are brief.

1. CONVERSATION CONTINUITY
   - Continue the conversation naturally — do not re-greet if already greeted
   - If the customer sends multiple back-to-back texts, treat them as one message
   - Pick up where the conversation left off, don't restart or recap

2. SCHEDULING
   - When offering times, prefer "tomorrow" or "the day after tomorrow" over specific dates
   - Only offer times when cleaners are actually available
   - If no availability info is provided, ask for preferred days/times

3. BOOKING FLOW
   - If the customer has not provided an email, politely ask for it
   - Say: "please send us your email and we can send you a confirmed price"
   - If an email is already on file, do not ask again
   - When they provide an email, acknowledge it briefly

4. PAST vs FUTURE BOOKINGS
   - Do not discuss past cleanings as if they are upcoming
   - If a cleaning date has passed, refer to it in past tense

5. UPDATES
   - If the customer wants to reschedule, confirm the change (do not promise a new confirmation)
   - If they provide new info (address, rooms, notes), confirm you noted it

6. TONE
   - Friendly and professional — like a helpful coworker texting
   - Use the customer's first name if known
   - Keep it concise and helpful

7. PRICING GUIDANCE (INTERNAL)
   - If pricing guidance is provided, use it to adjust tone and offers
   - Do NOT reveal internal reasoning or analysis

8. PRICING AUTHORITY — CRITICAL
   - You have ZERO authority to change, reduce, or discount prices. EVER.
   - NEVER offer discounts, deals, promotional pricing, percentage off, dollar off, free add-ons, or any price reduction
   - NEVER say "I can do it for $X" if that's lower than the quoted price
   - NEVER agree to a customer's counter-offer or requested discount
   - If a customer asks for a discount or says the price is too high, respond ONLY with value:
     * "We have a 100% satisfaction guarantee — if anything isn't perfect, we come back and fix it free"
     * "Our cleaners are background-checked, insured, and bring all their own professional supplies"
     * "We've cleaned over 2,500 homes across LA with a 5.0 star rating"
   - If they keep pushing on price, say: "I understand — let me have [owner name] reach out to discuss options"
   - You cannot make price exceptions. You cannot honor expired offers. You cannot match competitor prices.

Output ONLY the SMS message text, nothing else.`
}

/**
 * Build the user prompt with all context
 */
function buildUserPrompt(context: ResponseContext): string {
  const {
    customerInfo,
    textingTranscript,
    currentJobs,
    cleanerAvailability,
    incomingMessage,
    currentDateTime,
    pricingGuidance
  } = context

  // Format jobs for context with day of week
  const jobsContext = currentJobs.length > 0
    ? currentJobs.map(j => {
        const jobDate = j.date ? new Date(j.date + 'T12:00:00') : null
        const isPast = jobDate && jobDate < currentDateTime
        const dateWithDay = jobDate
          ? jobDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
          : 'TBD'
        return `- ${j.service_type || 'Cleaning'} on ${dateWithDay} at ${j.scheduled_at || 'TBD'}${isPast ? ' (PAST)' : ''} | Status: ${j.status} | Booked: ${j.booked} | Paid: ${j.paid}`
      }).join('\n')
    : 'No current bookings'

  // Format availability
  const availabilityContext = cleanerAvailability.length > 0
    ? `Available cleaners: ${cleanerAvailability.map(c => c.name).join(', ')}`
    : 'No cleaners available at this time'

  // Format customer info
  const customerContext = `
Name: ${customerInfo.first_name || 'Unknown'} ${customerInfo.last_name || ''}
Phone: ${customerInfo.phone_number || 'Unknown'}
Email: ${customerInfo.email || 'NOT PROVIDED'}
Address: ${customerInfo.address || 'NOT PROVIDED'}
Bedrooms: ${customerInfo.bedrooms || 'Unknown'}
Bathrooms: ${customerInfo.bathrooms || 'Unknown'}
`.trim()

  return `Current Date/Time: ${currentDateTime.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })}

CUSTOMER INFO:
${customerContext}

PREVIOUS CONVERSATION:
${textingTranscript || 'No previous messages'}

CURRENT BOOKINGS:
${jobsContext}

CLEANER AVAILABILITY:
${availabilityContext}

${pricingGuidance ? `PRICING GUIDANCE (internal, do not disclose):\n${pricingGuidance}\n\n` : ''}CUSTOMER'S NEW MESSAGE:
"${incomingMessage}"

Respond to this message following the guidelines. Output only the SMS response text.`
}

/**
 * Generate response using Claude (Anthropic)
 */
async function generateClaudeResponse(context: ResponseContext): Promise<AIResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  // Check for malformed API key
  if (apiKey.includes('\n') || apiKey.includes('\r') || apiKey !== apiKey.trim()) {
    throw new Error('ANTHROPIC_API_KEY contains invalid whitespace/line breaks')
  }

  try {
    const client = new Anthropic({ apiKey })

    let systemPrompt = buildSystemPrompt()
    const userPrompt = buildUserPrompt(context)

    // Consult the Brain for relevant industry knowledge
    try {
      const brainResult = await queryBrain({
        question: `Customer said: "${context.incomingMessage}". What's the best approach to respond to maximize booking conversion for a cleaning business?`,
        tenantId: (context.customerInfo as Record<string, unknown>).tenant_id as string | undefined,
        domain: 'sales',
        maxChunks: 3,
        minSimilarity: 0.5,
        triggeredBy: 'sms',
        decisionType: 'sms_response',
      })
      if (brainResult.confidence > 0.3 && brainResult.answer) {
        systemPrompt += `\n\nINDUSTRY INTELLIGENCE (from top cleaning business coaches — use to inform your tone and approach, do NOT quote directly):\n${brainResult.answer}`
      }
    } catch {
      // Brain unavailable — proceed without it
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ],
      system: systemPrompt,
    })

    // Extract text from response
    const textContent = response.content.find(block => block.type === 'text')
    const message = textContent?.type === 'text' ? textContent.text : ''
    const normalizedMessage = ensureFooter(message)

    // Check if customer provided an email in their message
    const emailMatch = context.incomingMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i)
    const shouldUpdateEmail = emailMatch ? emailMatch[0].toLowerCase() : undefined

    return {
      message: normalizedMessage || buildFallbackMessage(context),
      shouldUpdateEmail
    }
  } catch (error) {
    console.error('Claude response generation error:', error)
    if (error instanceof Error) {
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
    }
    throw error
  }
}

/**
 * Generate response using OpenAI
 */
async function generateOpenAIResponse(context: ResponseContext): Promise<AIResponse> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  if (apiKey.includes('\n') || apiKey.includes('\r') || apiKey !== apiKey.trim()) {
    throw new Error('OPENAI_API_KEY contains invalid whitespace/line breaks')
  }

  const client = new OpenAI({ apiKey })

  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(context)

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 500,
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
  })

  const message = response.choices[0]?.message?.content || ''
  const normalizedMessage = ensureFooter(message)

  // Check if customer provided an email
  const emailMatch = context.incomingMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i)
  const shouldUpdateEmail = emailMatch ? emailMatch[0].toLowerCase() : undefined

  return {
    message: normalizedMessage || buildFallbackMessage(context),
    shouldUpdateEmail
  }
}

/**
 * Ensure the response ends with the standard footer
 */
function ensureFooter(message: string): string {
  const footerText = SMS_TEMPLATES.footer.trim()
  const cleaned = message.trim()

  if (!footerText) {
    return cleaned
  }

  if (cleaned.includes(footerText)) {
    return cleaned
  }

  return `${cleaned}\n\n${footerText}`
}

function buildFallbackMessage(context: ResponseContext): string {
  const firstName = context.customerInfo.first_name
  const greeting = firstName ? `Thanks, ${firstName}!` : 'Thanks!'
  return `${greeting} Got it. How can I help next?`
}

/**
 * Check if a message contains an email address
 */
export function containsEmail(message: string): string | null {
  const match = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i)
  return match ? match[0].toLowerCase() : null
}

/**
 * Check if a message is requesting a reschedule
 */
export function isRescheduleRequest(message: string): boolean {
  const rescheduleKeywords = [
    'reschedule',
    'change the date',
    'change the time',
    'different day',
    'different time',
    'move my appointment',
    'can we do',
    'switch to',
    'postpone',
    'cancel and rebook'
  ]

  const lowerMessage = message.toLowerCase()
  return rescheduleKeywords.some(keyword => lowerMessage.includes(keyword))
}
