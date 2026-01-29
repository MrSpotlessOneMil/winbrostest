/**
 * SDR AI Prompts for GHL Leads
 *
 * Aggressive but friendly SDR-style prompts designed to
 * close deals via text conversation.
 */

import Anthropic from '@anthropic-ai/sdk'
import { getClientConfig } from '@/lib/client-config'

function formatServiceList(services: string[]): string {
  if (services.length === 0) return 'Standard, Deep clean, or Move-In/Move-Out'
  if (services.length === 1) return services[0]
  if (services.length === 2) return `${services[0]} or ${services[1]}`
  const allButLast = services.slice(0, -1)
  const last = services[services.length - 1]
  return `${allButLast.join(', ')}, or ${last}`
}

// SDR System Prompt - aligned with the booking flow
export function buildSDRSystemPrompt(): string {
  const config = getClientConfig()
  const services = formatServiceList(config.services)
  const frequencies = config.frequencies.join(', ')
  const founded = config.foundedYear ? `since ${config.foundedYear}` : ''
  const ownershipLine = config.tagline || 'Family and women-owned'
  const businessLine = [ownershipLine, founded].filter(Boolean).join(' ')

  return `You are ${config.sdrPersona}, a friendly but assertive booking specialist for ${config.businessName}, a professional cleaning company serving ${config.serviceArea}.

## YOUR GOAL
Your PRIMARY GOAL is to BOOK the cleaning appointment via text. Every response should move toward collecting their info and getting them scheduled.

## PERSONALITY
- Friendly, helpful, cheerful, and efficient
- Patient and positive throughout
- Ask ONE question at a time
- DRIVEN to close - assume they WANT the cleaning (they submitted an ad asking for it!)
- Never discuss internal tools or automation
- Never say you're an AI or bot

## ABOUT THE BUSINESS
- ${businessLine}
- Licensed, insured, and background-checked staff
- 100% satisfaction guarantee on every job
- Eco-friendly products safe for kids and pets
- We provide all cleaning supplies
- Serves ${config.serviceArea}

## SERVICES OFFERED
- ${services}

## FREQUENCY OPTIONS
- ${frequencies}

## INFORMATION TO COLLECT (in this order)
1. Service type - "What kind of cleaning are you looking for?"
2. Bedrooms - "How many bedrooms?"
3. Bathrooms - "And how many bathrooms?"
4. Square footage - "What's the approximate square footage?" (estimate is fine)
5. Frequency - "How often would you like us to come?"
6. Address - "What's the address we'll be cleaning?"
7. Preferred date/time - "When would you like us to come?"
8. Email - "What's your email? I'll send your quote and payment link there."

## PRICING RULES - IMPORTANT!
- NEVER give prices over text
- When asked about price, say: "Pricing depends on a few details. Let me get your info and I'll text you the exact price!"
- Once you have all info, say you'll send the quote via text/email
- Mention: "You'll pay 50% upfront as a deposit, and the rest after the job is completed."

## ADD-ONS (mention if they ask about windows)
- Inside window cleaning: +$50
- Exterior window cleaning: +$100

## RESPONSE GUIDELINES
- Keep responses SHORT (1-2 sentences max)
- Ask only ONE question at a time
- Don't repeat information they already gave
- If they give multiple pieces of info, acknowledge all of them
- Use their name when you have it
- Always end with the next question or clear next step

## OBJECTION HANDLING
- "Just looking" -> "No problem! Let me get you a quick quote - what type of cleaning did you need?"
- "How much?" -> "Great question! To give you the exact price, I just need a few details. What type of cleaning and how many bed/bath?"
- "Too expensive" -> "Our prices include supplies, equipment, and insurance. We also have a 100% satisfaction guarantee! Want me to check availability?"
- "Need to think about it" -> "Of course! What questions can I answer? I can send the details to your email so you have them."
- "Not right now" -> "No worries! When would be a better time? I can follow up then."

## BOOKING CONFIRMATION
Once you have all info (service, bed/bath, sqft, frequency, address, date, email):
"Awesome, [name]! Got you down for a [service] on [date]. I'm sending your quote and payment link now - just pay the 50% deposit to confirm your spot. You're gonna love it!"

## EXAMPLE CONVERSATION FLOW
Customer: "Hi"
You: "Hey! This is ${config.sdrPersona} from ${config.businessName}. What kind of cleaning are you looking for - ${services}?"

Customer: "Deep clean"
You: "Great choice! How many bedrooms do you have?"

Customer: "3"
You: "Got it! And how many bathrooms?"

Customer: "2"
You: "Perfect! What's the approximate square footage? Even a rough estimate works!"

...and so on until you have all the info.

Remember: They reached out because they WANT a cleaning. Make it easy for them to book!`
}

// Generate SDR response using Claude
export async function generateSDRResponse(context: {
  customerName?: string
  textingTranscript: string
  incomingMessage: string
  jobDetails?: {
    bedrooms?: number
    bathrooms?: number
    serviceType?: string
    date?: string
    address?: string
    price?: number
  }
  leadStatus?: string
}): Promise<{ message: string; extractedInfo?: Record<string, unknown> }> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY

  if (!anthropicApiKey) {
    console.error('ANTHROPIC_API_KEY not configured')
    return {
      message: getDefaultSDRResponse(context.incomingMessage, context.customerName),
    }
  }

  const client = new Anthropic({ apiKey: anthropicApiKey })

  // Build context message
  const contextMessage = buildContextMessage(context)

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: buildSDRSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: contextMessage,
        },
      ],
    })

    const textBlock = response.content.find(block => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return {
        message: getDefaultSDRResponse(context.incomingMessage, context.customerName),
      }
    }

    // Clean up the response
    let message = textBlock.text.trim()

    // Remove any "AI" self-references that might slip through
    message = message
      .replace(/as an ai/gi, '')
      .replace(/i'm an ai/gi, '')
      .replace(/i am an ai/gi, '')
      .trim()

    return { message }
  } catch (error) {
    console.error('Error generating SDR response:', error)
    return {
      message: getDefaultSDRResponse(context.incomingMessage, context.customerName),
    }
  }
}

// Build context message for AI
function buildContextMessage(context: {
  customerName?: string
  textingTranscript: string
  incomingMessage: string
  jobDetails?: {
    bedrooms?: number
    bathrooms?: number
    serviceType?: string
    date?: string
    address?: string
    price?: number
  }
  leadStatus?: string
}): string {
  const parts: string[] = []

  // Customer info
  if (context.customerName) {
    parts.push(`Customer name: ${context.customerName}`)
  }

  // Lead status
  if (context.leadStatus) {
    parts.push(`Lead status: ${context.leadStatus}`)
  }

  // Job details we already have
  if (context.jobDetails) {
    const details: string[] = []
    if (context.jobDetails.bedrooms) details.push(`${context.jobDetails.bedrooms} bedrooms`)
    if (context.jobDetails.bathrooms) details.push(`${context.jobDetails.bathrooms} bathrooms`)
    if (context.jobDetails.serviceType) details.push(`Service: ${context.jobDetails.serviceType}`)
    if (context.jobDetails.date) details.push(`Requested date: ${context.jobDetails.date}`)
    if (context.jobDetails.address) details.push(`Address: ${context.jobDetails.address}`)
    if (context.jobDetails.price) details.push(`Quoted price: $${context.jobDetails.price}`)

    if (details.length > 0) {
      parts.push(`Info gathered so far: ${details.join(', ')}`)
    }
  }

  // Conversation history
  if (context.textingTranscript) {
    parts.push(`\nConversation history:\n${context.textingTranscript}`)
  }

  // Current message
  parts.push(`\nCustomer's latest message: "${context.incomingMessage}"`)
  parts.push(`\nRespond as the SDR. Keep it short (1-3 sentences). Push toward booking.`)

  return parts.join('\n')
}

// Default response when AI is unavailable - follows the booking flow
function getDefaultSDRResponse(
  incomingMessage: string,
  customerName?: string
): string {
  const name = customerName || 'there'
  const config = getClientConfig()
  const services = formatServiceList(config.services)
  const tagline = config.tagline || 'family-owned with a 100% satisfaction guarantee'
  const lowerMessage = incomingMessage.toLowerCase()

  // Check for price questions - never give prices, collect info first
  if (lowerMessage.includes('price') || lowerMessage.includes('cost') || lowerMessage.includes('how much') || lowerMessage.includes('rate')) {
    return `Great question, ${name}! Pricing depends on a few things. What type of cleaning did you need - ${services}?`
  }

  // Check for service type mentioned
  const serviceKeywords = config.services
    .flatMap(service => service.toLowerCase().split('/'))
    .map(service => service.replace('cleaning', '').trim())
    .filter(Boolean)

  if (serviceKeywords.some(keyword => lowerMessage.includes(keyword))) {
    return `Great choice, ${name}! How many bedrooms do you have?`
  }

  // Check for bedroom/bathroom numbers
  if (lowerMessage.includes('bed') || lowerMessage.includes('bath') || /\d\s*(bed|bath|br|ba)/i.test(lowerMessage)) {
    return `Got it! What's the approximate square footage? Even a rough estimate works!`
  }

  // Numbers without context - likely bed/bath count
  if (/^\d+$/.test(lowerMessage.trim()) || /\d+\s*(and|&)\s*\d+/.test(lowerMessage)) {
    return `Thanks ${name}! And what's the approximate square footage?`
  }

  // Check for affirmative responses
  if (lowerMessage.includes('yes') || lowerMessage.includes('sure') || lowerMessage.includes('ok') || lowerMessage.includes('sounds good')) {
    return `Awesome! What kind of cleaning are you looking for - Standard, Deep clean, or Move-In/Out?`
  }

  // Check for date/time mentions
  if (lowerMessage.includes('monday') || lowerMessage.includes('tuesday') || lowerMessage.includes('wednesday') ||
      lowerMessage.includes('thursday') || lowerMessage.includes('friday') || lowerMessage.includes('saturday') ||
      lowerMessage.includes('sunday') || lowerMessage.includes('tomorrow') || lowerMessage.includes('next week')) {
    return `Perfect! And what's your email? I'll send your quote and payment link there.`
  }

  // Check for hesitation
  if (lowerMessage.includes('busy') || lowerMessage.includes('later') || lowerMessage.includes('not sure') || lowerMessage.includes('thinking')) {
    return `No problem, ${name}! We're ${tagline}. What questions can I answer for you?`
  }

  // Check for simple greetings
  if (lowerMessage.includes('hi') || lowerMessage.includes('hello') || lowerMessage.includes('hey') || lowerMessage.trim().length < 10) {
    return `Hey ${name}! This is ${config.sdrPersona} from ${config.businessName}. What kind of cleaning are you looking for - ${services}?`
  }

  // Default response - ask for service type
  return `Thanks for reaching out, ${name}! What kind of cleaning are you looking for - ${services}?`
}

// Quick extraction helpers for common info from messages
export function extractBedroomCount(message: string): number | undefined {
  const match = message.match(/(\d+)\s*(?:bed(?:room)?s?|br)\b/i)
  if (match) {
    const value = parseInt(match[1], 10)
    if (value > 0 && value <= 10) return value
  }
  return undefined
}

export function extractBathroomCount(message: string): number | undefined {
  const match = message.match(/(\d+(?:\.\d+)?)\s*(?:bath(?:room)?s?|ba)\b/i)
  if (match) {
    const value = parseFloat(match[1])
    if (value > 0 && value <= 10) return value
  }
  return undefined
}

export function containsBookingIntent(message: string): boolean {
  const lowerMessage = message.toLowerCase()
  const bookingWords = [
    'book', 'schedule', 'appointment', 'available',
    'slot', 'opening', 'when can', 'sign up',
    'ready', "let's do it", 'sounds good', 'yes'
  ]
  return bookingWords.some(word => lowerMessage.includes(word))
}

export function containsPriceQuestion(message: string): boolean {
  const lowerMessage = message.toLowerCase()
  const priceWords = [
    'price', 'cost', 'how much', 'rate', 'charge',
    'fee', 'quote', 'estimate', 'expensive', 'cheap'
  ]
  return priceWords.some(word => lowerMessage.includes(word))
}
