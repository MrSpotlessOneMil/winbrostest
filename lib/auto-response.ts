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
}

/**
 * Generate an AI-powered auto-response based on the incoming message and intent analysis
 */
export async function generateAutoResponse(
  incomingMessage: string,
  intentAnalysis: IntentAnalysis,
  tenant: Tenant | null,
  conversationHistory?: Array<{ role: 'client' | 'assistant'; content: string }>
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

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `You are ${sdrName}, a friendly sales rep for ${businessContext}.

${historyContext}
Customer just texted: "${message}"
${responseTypeHint}

Intent analysis: ${intent.hasBookingIntent ? 'INTERESTED in booking' : 'Not clearly interested'} (${intent.confidence} confidence)
${intent.extractedInfo.serviceType ? `Service mentioned: ${intent.extractedInfo.serviceType}` : ''}
${intent.extractedInfo.preferredDate ? `Date mentioned: ${intent.extractedInfo.preferredDate}` : ''}

Write a SHORT, friendly SMS reply (under 160 chars if possible, max 300 chars).
Your goal: Guide them toward booking ${serviceType}.

Rules:
- Be warm but professional
- Don't use emojis excessively (1-2 max)
- ${serviceGuidance}
- Ask a specific next question to move toward booking
- If they mentioned details, acknowledge them
- If unclear intent, ask if they need ${serviceType} help
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

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 200,
    messages: [
      {
        role: 'system',
        content: `You are ${sdrName}, a friendly sales rep. ${businessContext}. Write short, friendly SMS replies that guide customers toward booking ${serviceType}. Keep under 160 chars when possible, max 300. Be warm but not pushy. Ask specific questions to move toward booking. ${conversationHistory?.length ? 'This is an ongoing conversation - don\'t re-introduce yourself.' : ''}`
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
