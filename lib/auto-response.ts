/**
 * AI-Powered Auto-Response for SMS
 * Generates immediate, contextual replies to incoming messages
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { IntentAnalysis } from './ai-intent'
import type { Tenant } from './tenant'
import { getTenantServiceDescription, getTenantBusinessContext } from './tenant'

export interface AutoResponseResult {
  response: string
  shouldSend: boolean
  reason: string
  escalation?: {
    shouldEscalate: boolean
    reasons: string[]
  }
  bookingComplete?: boolean
}

/**
 * Generate an AI-powered auto-response based on the incoming message and intent analysis
 */
export interface KnownCustomerInfo {
  firstName?: string | null
  lastName?: string | null
  address?: string | null
  email?: string | null
  phone?: string | null
  source?: string | null // "housecall_pro", "ghl", etc.
}

export async function generateAutoResponse(
  incomingMessage: string,
  intentAnalysis: IntentAnalysis,
  tenant: Tenant | null,
  conversationHistory?: Array<{ role: 'client' | 'assistant'; content: string }>,
  knownCustomerInfo?: KnownCustomerInfo
): Promise<AutoResponseResult> {
  // Don't respond to obvious opt-outs
  const lowerMessage = incomingMessage.toLowerCase().trim()
  const optOutKeywords = ['stop', 'unsubscribe', 'remove', 'opt out', 'optout', 'cancel', 'quit']
  if (optOutKeywords.some(kw => lowerMessage.includes(kw))) {
    return {
      response: '',
      shouldSend: false,
      reason: 'Opt-out message detected'
    }
  }

  // Don't respond to very short acknowledgments that don't need a reply
  // BUT: "yes", "no", "sure" could be responses to our questions - let AI handle those
  const noReplyNeeded = ['ok', 'k', 'kk', 'thanks', 'thx', 'ty', 'cool', 'great', 'got it', 'okay', 'np']
  if (noReplyNeeded.includes(lowerMessage)) {
    return {
      response: '',
      shouldSend: false,
      reason: 'Simple acknowledgment, no reply needed'
    }
  }

  // Special handling for "yes" / "no" / "sure" - these are likely responses to our questions
  const isAffirmativeResponse = ['yes', 'yeah', 'yep', 'yup', 'sure', 'absolutely', 'definitely'].includes(lowerMessage)
  const isNegativeResponse = ['no', 'nope', 'nah', 'not really', 'no thanks'].includes(lowerMessage)

  // WinBros-specific SMS booking flow (window cleaning)
  if (tenant?.slug === 'winbros') {
    try {
      return await generateWinBrosResponse(incomingMessage, tenant, conversationHistory, knownCustomerInfo)
    } catch (error) {
      console.error('[Auto-Response] WinBros response failed, falling back to generic:', error)
    }
  }

  // House cleaning SMS booking flow (all non-WinBros tenants)
  if (tenant && tenant.slug !== 'winbros') {
    try {
      return await generateHouseCleaningResponse(incomingMessage, tenant, conversationHistory, knownCustomerInfo)
    } catch (error) {
      console.error('[Auto-Response] House cleaning response failed, falling back to generic:', error)
    }
  }

  const businessName = tenant?.business_name_short || tenant?.business_name || 'WinBros'
  const sdrName = tenant?.sdr_persona || 'Mary'
  const serviceArea = tenant?.service_area || 'your area'
  // Get the service type from tenant - this differentiates window cleaning from house cleaning etc.
  const serviceType = tenant ? getTenantServiceDescription(tenant) : 'cleaning'
  const businessContext = tenant ? getTenantBusinessContext(tenant) : `${businessName} is a professional ${serviceType} service`

  // Try AI generation first
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  // Build context about the message type
  const messageContext: MessageContext = {
    isAffirmativeResponse,
    isNegativeResponse,
    hasConversationHistory: !!(conversationHistory && conversationHistory.length > 0),
  }

  if (anthropicKey) {
    try {
      return await generateWithClaude(
        incomingMessage,
        intentAnalysis,
        businessName,
        sdrName,
        serviceType,
        businessContext,
        conversationHistory,
        messageContext
      )
    } catch (error) {
      console.error('[Auto-Response] Claude generation failed, trying OpenAI:', error)
    }
  }

  if (openaiKey) {
    try {
      return await generateWithOpenAI(
        incomingMessage,
        intentAnalysis,
        businessName,
        sdrName,
        serviceType,
        businessContext,
        conversationHistory,
        messageContext
      )
    } catch (error) {
      console.error('[Auto-Response] OpenAI generation failed, using fallback:', error)
    }
  }

  // Fallback to template-based responses
  return generateFallbackResponse(incomingMessage, intentAnalysis, businessName, sdrName, serviceType, conversationHistory, messageContext)
}

interface MessageContext {
  isAffirmativeResponse: boolean
  isNegativeResponse: boolean
  hasConversationHistory: boolean
}

/**
 * Generate response using Claude
 */
async function generateWithClaude(
  message: string,
  intent: IntentAnalysis,
  businessName: string,
  sdrName: string,
  serviceType: string,
  businessContext: string,
  conversationHistory?: Array<{ role: 'client' | 'assistant'; content: string }>,
  messageContext?: MessageContext
): Promise<AutoResponseResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const historyContext = conversationHistory?.length
    ? `\nRecent conversation:\n${conversationHistory.slice(-5).map(m => `${m.role === 'client' ? 'Customer' : 'Us'}: ${m.content}`).join('\n')}\n`
    : ''

  // Build context about the response type
  let responseTypeHint = ''
  if (messageContext?.isAffirmativeResponse && messageContext?.hasConversationHistory) {
    responseTypeHint = '\nIMPORTANT: Customer said "yes" - this is likely a response to our last question. Continue the booking conversation based on what we last asked.'
  } else if (messageContext?.isNegativeResponse && messageContext?.hasConversationHistory) {
    responseTypeHint = '\nIMPORTANT: Customer said "no" - acknowledge gracefully and try a different approach to keep them engaged.'
  }

  // Build service-specific guidance
  const serviceGuidance = serviceType === 'window cleaning'
    ? 'Ask about number of windows, stories, or when they last had windows cleaned.'
    : serviceType === 'house cleaning'
    ? 'Ask about bedrooms, bathrooms, or square footage.'
    : `Ask relevant questions for ${serviceType}.`

  // Detect if customer provided an email address
  const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  const emailHint = emailMatch
    ? `\nIMPORTANT: Customer provided their email address (${emailMatch[0]}). Acknowledge receipt and let them know you'll send the confirmed price/details to that email.`
    : ''

  // Detect if customer is confirming/responding to our previous message
  const isConfirming = messageContext?.isAffirmativeResponse && messageContext?.hasConversationHistory
  const confirmHint = isConfirming && !emailMatch
    ? `\nIMPORTANT: Customer is confirming. If our last message asked for their email, ask for it. If it was a booking confirmation, acknowledge and ask for email to send pricing.`
    : ''

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `You are ${sdrName}, a friendly sales rep for ${businessContext}.

${historyContext}
Customer just texted: "${message}"
${responseTypeHint}${emailHint}${confirmHint}

Intent analysis: ${intent.hasBookingIntent ? 'INTERESTED in booking' : 'Not clearly interested'} (${intent.confidence} confidence)
${intent.extractedInfo.serviceType ? `Service mentioned: ${intent.extractedInfo.serviceType}` : ''}
${intent.extractedInfo.preferredDate ? `Date mentioned: ${intent.extractedInfo.preferredDate}` : ''}

Write a SHORT, friendly SMS reply (under 160 chars if possible, max 300 chars).

Rules:
- Be warm but professional
- Don't use emojis excessively (1-2 max)
- CRITICAL: Read the conversation history carefully. Respond to what the customer is actually saying.
- If they confirmed something (yes/yup/sure), acknowledge and move to the next step (usually asking for email to send pricing).
- If they provided an email, thank them and say you'll send details there.
- If they already have a booking, do NOT ask generic questions about service needs. Continue the booking conversation.
- Only ask about ${serviceType} details if this is a NEW inquiry with no prior conversation.
- Never repeat information or questions that were already covered.
- Never be pushy or salesy
- Sign off as ${sdrName} only on first contact (not if there's conversation history)

Return ONLY the SMS text, nothing else.`
      }
    ],
  })

  const textContent = response.content.find(block => block.type === 'text')
  const smsText = textContent?.type === 'text' ? textContent.text.trim() : ''

  if (!smsText) {
    throw new Error('Empty response from Claude')
  }

  return {
    response: smsText,
    shouldSend: true,
    reason: 'AI-generated response'
  }
}

/**
 * Generate response using OpenAI
 */
async function generateWithOpenAI(
  message: string,
  intent: IntentAnalysis,
  businessName: string,
  sdrName: string,
  serviceType: string,
  businessContext: string,
  conversationHistory?: Array<{ role: 'client' | 'assistant'; content: string }>,
  messageContext?: MessageContext
): Promise<AutoResponseResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const historyContext = conversationHistory?.length
    ? `\nRecent conversation:\n${conversationHistory.slice(-5).map(m => `${m.role === 'client' ? 'Customer' : 'Us'}: ${m.content}`).join('\n')}\n`
    : ''

  // Build context about the response type
  let responseTypeHint = ''
  if (messageContext?.isAffirmativeResponse && messageContext?.hasConversationHistory) {
    responseTypeHint = 'Customer said YES - continue based on your last question. '
  } else if (messageContext?.isNegativeResponse && messageContext?.hasConversationHistory) {
    responseTypeHint = 'Customer said NO - acknowledge gracefully, try different approach. '
  }

  // Detect email in message
  const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  const emailHint = emailMatch ? ` Customer provided email (${emailMatch[0]}) - acknowledge and say you'll send details.` : ''

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 200,
    messages: [
      {
        role: 'system',
        content: `You are ${sdrName}, a friendly sales rep. ${businessContext}. Write short, friendly SMS replies. Keep under 160 chars when possible, max 300. Be warm but not pushy. ${conversationHistory?.length ? 'This is an ongoing conversation - read the history carefully and respond appropriately. Do NOT re-introduce yourself or ask questions that were already answered.' : ''} If customer is confirming (yes/yup), acknowledge and move to next step. If they provided an email, thank them and say you will send details.${emailHint}`
      },
      {
        role: 'user',
        content: `${historyContext}Customer texted: "${message}"
${responseTypeHint}Intent: ${intent.hasBookingIntent ? 'INTERESTED' : 'Unclear'} (${intent.confidence})
${intent.extractedInfo.serviceType ? `Service: ${intent.extractedInfo.serviceType}` : ''}

Write the SMS reply only.`
      }
    ],
  })

  const smsText = response.choices[0]?.message?.content?.trim() || ''

  if (!smsText) {
    throw new Error('Empty response from OpenAI')
  }

  return {
    response: smsText,
    shouldSend: true,
    reason: 'AI-generated response'
  }
}

/**
 * Fallback template-based responses when AI is unavailable
 */
function generateFallbackResponse(
  message: string,
  intent: IntentAnalysis,
  businessName: string,
  sdrName: string,
  serviceType: string,
  conversationHistory?: Array<{ role: 'client' | 'assistant'; content: string }>,
  messageContext?: MessageContext
): AutoResponseResult {
  const hasHistory = conversationHistory && conversationHistory.length > 0
  const signoff = hasHistory ? '' : ` -${sdrName}`

  // Service-specific question based on service type
  const quoteQuestion = serviceType === 'window cleaning'
    ? `How many windows or stories does your home have?`
    : serviceType === 'house cleaning'
    ? `How many bedrooms and bathrooms?`
    : `What details can you share about the job?`

  // Handle affirmative responses (yes, yeah, sure, etc.)
  if (messageContext?.isAffirmativeResponse && hasHistory) {
    return {
      response: `Perfect! To get you a quote, I just need a few details. What's the address?`,
      shouldSend: true,
      reason: 'Template: affirmative response'
    }
  }

  // Handle negative responses (no, nope, etc.)
  if (messageContext?.isNegativeResponse && hasHistory) {
    return {
      response: `No problem! If you ever need ${serviceType} help in the future, just text us. Have a great day!`,
      shouldSend: true,
      reason: 'Template: negative response'
    }
  }

  if (intent.hasBookingIntent && intent.confidence !== 'low') {
    // High/medium confidence booking intent
    if (intent.extractedInfo.preferredDate) {
      return {
        response: `Hi! Thanks for reaching out to ${businessName}! I see you're looking at ${intent.extractedInfo.preferredDate}. What's the address?${signoff}`,
        shouldSend: true,
        reason: 'Template: booking intent with date'
      }
    }

    if (intent.extractedInfo.serviceType) {
      return {
        response: `Hi! Thanks for your interest in ${intent.extractedInfo.serviceType}! To get you a quick quote, ${quoteQuestion}${signoff}`,
        shouldSend: true,
        reason: 'Template: booking intent with service type'
      }
    }

    return {
      response: `Hi! Thanks for reaching out to ${businessName}! I'd love to help with your ${serviceType} needs. ${quoteQuestion}${signoff}`,
      shouldSend: true,
      reason: 'Template: general booking intent'
    }
  }

  // Question or inquiry without clear booking intent
  if (message.includes('?')) {
    return {
      response: hasHistory
        ? `Happy to help! Are you looking for ${serviceType} services? I can get you a quick quote.`
        : `Hi! This is ${sdrName} from ${businessName}. Happy to help! Are you looking for ${serviceType} services? I can get you a quick quote.`,
      shouldSend: true,
      reason: 'Template: question response'
    }
  }

  // Default engagement response
  return {
    response: hasHistory
      ? `Thanks for texting! Are you looking for ${serviceType} help? I'd be happy to get you a quote.`
      : `Hi! This is ${sdrName} from ${businessName}. Thanks for texting! Are you looking for ${serviceType} help? I'd be happy to get you a quote.`,
    shouldSend: true,
    reason: 'Template: default engagement'
  }
}

// =====================================================================
// WINBROS-SPECIFIC SMS RESPONSE
// =====================================================================

/**
 * Generate a WinBros-specific SMS response using the dedicated booking prompt.
 * This mirrors the WinBros phone script, collecting service type, sqft,
 * pricing, etc. instead of bedrooms/bathrooms.
 */
async function generateWinBrosResponse(
  message: string,
  tenant: Tenant,
  conversationHistory?: Array<{ role: 'client' | 'assistant'; content: string }>,
  knownCustomerInfo?: KnownCustomerInfo
): Promise<AutoResponseResult> {
  const { buildWinBrosSmsSystemPrompt, detectEscalation, detectBookingComplete, stripEscalationTags } = await import('./winbros-sms-prompt')

  const systemPrompt = buildWinBrosSmsSystemPrompt()

  const historyContext = conversationHistory?.length
    ? conversationHistory.slice(-10).map(m => `${m.role === 'client' ? 'Customer' : 'Mary'}: ${m.content}`).join('\n')
    : '(No prior messages — this is a new conversation.)'

  // Build known info context so the AI can confirm rather than re-ask
  let knownInfoBlock = ''
  if (knownCustomerInfo) {
    const parts: string[] = []
    if (knownCustomerInfo.firstName || knownCustomerInfo.lastName) {
      parts.push(`Name: ${[knownCustomerInfo.firstName, knownCustomerInfo.lastName].filter(Boolean).join(' ')}`)
    }
    if (knownCustomerInfo.address) {
      parts.push(`Address on file: ${knownCustomerInfo.address}`)
    }
    if (knownCustomerInfo.email) {
      parts.push(`Email on file: ${knownCustomerInfo.email}`)
    }
    if (knownCustomerInfo.source) {
      parts.push(`Lead source: ${knownCustomerInfo.source}`)
    }
    if (parts.length > 0) {
      knownInfoBlock = `\n\nINFO ALREADY ON FILE FOR THIS CUSTOMER:\n${parts.join('\n')}\nWhen you reach the step for any info listed above, CONFIRM it instead of asking. But still follow the step order — don't jump ahead to confirm these early.\n`
    }
  }

  const userMessage = `Conversation so far:\n${historyContext}${knownInfoBlock}\n\nCustomer just texted: "${message}"\n\nRespond as Mary. Write ONLY the SMS text (and escalation tag if needed). Nothing else.`

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    const client = new Anthropic({ apiKey: anthropicKey })

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const textContent = response.content.find(block => block.type === 'text')
    const rawText = textContent?.type === 'text' ? textContent.text.trim() : ''

    if (!rawText) {
      throw new Error('Empty response from Claude (WinBros)')
    }

    const escalation = detectEscalation(rawText, conversationHistory)
    const isBookingComplete = detectBookingComplete(rawText)
    const cleanResponse = stripEscalationTags(rawText)

    return {
      response: cleanResponse,
      shouldSend: true,
      reason: 'WinBros AI-generated response',
      escalation: escalation.shouldEscalate ? escalation : undefined,
      bookingComplete: isBookingComplete || undefined,
    }
  }

  // OpenAI fallback for WinBros
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    const client = new OpenAI({ apiKey: openaiKey })

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 500,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''

    if (!rawText) {
      throw new Error('Empty response from OpenAI (WinBros)')
    }

    const escalation = detectEscalation(rawText, conversationHistory)
    const isBookingComplete = detectBookingComplete(rawText)
    const cleanResponse = stripEscalationTags(rawText)

    return {
      response: cleanResponse,
      shouldSend: true,
      reason: 'WinBros AI-generated response (OpenAI)',
      escalation: escalation.shouldEscalate ? escalation : undefined,
      bookingComplete: isBookingComplete || undefined,
    }
  }

  // Template fallback for WinBros (no AI keys)
  const hasHistory = conversationHistory && conversationHistory.length > 0
  return {
    response: hasHistory
      ? `Thanks for your message! Are you looking for Window Cleaning, Pressure Washing, or Gutter Cleaning today?`
      : `Hi! This is Mary from WinBros Window Cleaning. Are you looking for Window Cleaning, Pressure Washing, or Gutter Cleaning today?`,
    shouldSend: true,
    reason: 'WinBros template fallback',
  }
}

// =====================================================================
// HOUSE CLEANING SMS RESPONSE (non-WinBros tenants)
// =====================================================================

/**
 * Generate a house cleaning SMS response using the dedicated booking prompt.
 * Routes through a structured booking flow with [BOOKING_COMPLETE] detection.
 */
async function generateHouseCleaningResponse(
  message: string,
  tenant: Tenant,
  conversationHistory?: Array<{ role: 'client' | 'assistant'; content: string }>,
  knownCustomerInfo?: KnownCustomerInfo
): Promise<AutoResponseResult> {
  const { buildHouseCleaningSmsSystemPrompt } = await import('./house-cleaning-sms-prompt')
  // Reuse escalation/booking detection from WinBros (same tag format)
  const { detectEscalation, detectBookingComplete, stripEscalationTags } = await import('./winbros-sms-prompt')

  const systemPrompt = buildHouseCleaningSmsSystemPrompt(tenant)
  const sdrName = tenant.sdr_persona || 'Sarah'

  const historyContext = conversationHistory?.length
    ? conversationHistory.slice(-10).map(m => `${m.role === 'client' ? 'Customer' : sdrName}: ${m.content}`).join('\n')
    : '(No prior messages — this is a new conversation.)'

  // Build known info context so the AI can confirm rather than re-ask
  let knownInfoBlock = ''
  if (knownCustomerInfo) {
    const parts: string[] = []
    if (knownCustomerInfo.firstName || knownCustomerInfo.lastName) {
      parts.push(`Name: ${[knownCustomerInfo.firstName, knownCustomerInfo.lastName].filter(Boolean).join(' ')}`)
    }
    if (knownCustomerInfo.address) {
      parts.push(`Address on file: ${knownCustomerInfo.address}`)
    }
    if (knownCustomerInfo.email) {
      parts.push(`Email on file: ${knownCustomerInfo.email}`)
    }
    if (knownCustomerInfo.source) {
      parts.push(`Lead source: ${knownCustomerInfo.source}`)
    }
    if (parts.length > 0) {
      knownInfoBlock = `\n\nINFO ALREADY ON FILE FOR THIS CUSTOMER:\n${parts.join('\n')}\nWhen you reach the step for any info listed above, CONFIRM it instead of asking. But still follow the step order — don't jump ahead to confirm these early.\n`
    }
  }

  const userMessage = `Conversation so far:\n${historyContext}${knownInfoBlock}\n\nCustomer just texted: "${message}"\n\nRespond as ${sdrName}. Write ONLY the SMS text (and escalation/booking-complete tag if needed). Nothing else.`

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: anthropicKey })

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const textContent = response.content.find(block => block.type === 'text')
    const rawText = textContent?.type === 'text' ? textContent.text.trim() : ''

    if (!rawText) {
      throw new Error('Empty response from Claude (HouseCleaning)')
    }

    const escalation = detectEscalation(rawText, conversationHistory)
    const isBookingComplete = detectBookingComplete(rawText)
    const cleanResponse = stripEscalationTags(rawText)

    return {
      response: cleanResponse,
      shouldSend: true,
      reason: 'House cleaning AI-generated response',
      escalation: escalation.shouldEscalate ? escalation : undefined,
      bookingComplete: isBookingComplete || undefined,
    }
  }

  // OpenAI fallback
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey: openaiKey })

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 500,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })

    const rawText = response.choices[0]?.message?.content?.trim() || ''

    if (!rawText) {
      throw new Error('Empty response from OpenAI (HouseCleaning)')
    }

    const escalation = detectEscalation(rawText, conversationHistory)
    const isBookingComplete = detectBookingComplete(rawText)
    const cleanResponse = stripEscalationTags(rawText)

    return {
      response: cleanResponse,
      shouldSend: true,
      reason: 'House cleaning AI-generated response (OpenAI)',
      escalation: escalation.shouldEscalate ? escalation : undefined,
      bookingComplete: isBookingComplete || undefined,
    }
  }

  // Template fallback (no AI keys)
  const businessName = tenant.business_name_short || tenant.business_name || tenant.name
  const hasHistory = conversationHistory && conversationHistory.length > 0
  return {
    response: hasHistory
      ? `Thanks for your message! Are you looking for a Standard Cleaning, Deep Cleaning, or Move-in/Move-out Cleaning?`
      : `Hi! This is ${sdrName} from ${businessName}. Are you looking for a Standard Cleaning, Deep Cleaning, or Move-in/Move-out Cleaning?`,
    shouldSend: true,
    reason: 'House cleaning template fallback',
  }
}
