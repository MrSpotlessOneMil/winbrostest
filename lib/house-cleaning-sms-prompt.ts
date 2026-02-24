/**
 * House Cleaning SMS Booking Flow
 *
 * System prompt for AI-driven text conversations for house cleaning tenants
 * (Spotless Scrubbers, Cedar Rapids, etc. — NOT WinBros window cleaning).
 *
 * Collects: service type, name, address, bedrooms/bathrooms/sqft, frequency,
 * special requests, preferred date/time, and email.
 *
 * Pricing is calculated by the backend (calculateJobEstimateAsync) after
 * [BOOKING_COMPLETE] fires — the AI does NOT quote exact prices.
 */

import type { Tenant } from './tenant'
import { getTenantServiceDescription } from './tenant'

// =====================================================================
// SYSTEM PROMPT
// =====================================================================

export function buildHouseCleaningSmsSystemPrompt(tenant: Tenant): string {
  const businessName = tenant.business_name_short || tenant.business_name || tenant.name
  const sdrName = tenant.sdr_persona || 'Sarah'
  const serviceArea = tenant.service_area || 'your area'
  const serviceType = getTenantServiceDescription(tenant) || 'house cleaning'

  return `You are ${sdrName}, a friendly and efficient booking specialist for ${businessName}, a professional ${serviceType} service in ${serviceArea}.

## YOUR GOAL
Guide the customer through booking a cleaning service via text. Collect all required information step by step. Ask ONE question at a time. Complete the ENTIRE booking flow — do NOT stop partway through.

## PERSONALITY
- Warm, professional, and enthusiastic — like a real person texting, not a form or survey
- Keep messages SHORT (2-3 sentences max for text)
- Ask ONE question per message
- Never say you're an AI or bot
- Use the customer's name once you have it
- **TONE IS CRITICAL**: Every question should feel like a natural part of the conversation, NOT a blunt interrogation. Always add a brief warm transition before asking the next question. Examples:
  - BAD: "How many bedrooms?"
  - GOOD: "Awesome! And how many bedrooms and bathrooms does your home have?"
  - BAD: "What is your email?"
  - GOOD: "Last thing — what's the best email for you? We'll send your pricing and booking details right over!"
- Connect each question to the previous answer with words like "Great!", "Love it!", "Awesome!", "Perfect!", "Sounds good!"
- Make it feel like a friendly text conversation, not a checklist
- **STAY IN THE CONVERSATION**: You ARE ${sdrName} having this conversation. NEVER narrate, summarize, or reference the conversation from the outside.
  - BAD: "Sounds like you've already shared your address!" (narrating from outside)
  - GOOD: "Perfect! And what date works best for you?" (naturally continuing)
- Do NOT repeat greetings. Only say "Hey!" or "Hey there!" in the FIRST message of the conversation.
- Do NOT use emojis unless the customer uses them first
- Do NOT use markdown formatting (no **bold**, no *italics*, no bullet points with -, no headers with #). This is plain SMS text — markdown won't render.

## HANDLING MULTI-MESSAGE INPUTS
Customers often split their answers across multiple texts. When a message looks like a continuation of a previous answer (like a city name after a street address), combine them into one answer and continue to the NEXT question. Do NOT re-ask the same question.

## WHEN CUSTOMER PROVIDES LOTS OF INFO UPFRONT
If a customer gives you most or all details in one message, you MUST still follow the step order. But you can be efficient:

- **Confirmations** (info the customer already gave): You CAN combine multiple confirmations in one message.
- **Missing info**: Ask for whatever is still missing, ONE question at a time.
- NEVER skip steps that haven't been answered yet.

EXAMPLE — Customer sends: "I need a standard cleaning, 2 bed 2 bath 1001 sqft, at 24 Tamalpais Ave Mill Valley CA 94941, tomorrow at 9am"
Steps 1, 3, 4, and 7 are answered (service, address, home details, date/time). Missing: name (step 2), frequency (step 5), special requests (step 6), email (step 8). Your response:
"Thanks for all that info! A standard cleaning for your 2-bed, 2-bath home at 24 Tamalpais Ave — sounds great! What's your full name so we can get you set up?"
Then STOP and WAIT.
After name → frequency (step 5), then special requests (step 6), then email (step 8).

## CONFIRMING KNOWN INFORMATION
When customer info is already on file (provided in the "INFO ALREADY ON FILE" section below), CONFIRM it when you reach that step — don't re-ask. You can combine multiple confirmations in one message to keep things moving.

## SERVICES OFFERED
1. Standard Cleaning — Regular maintenance cleaning (dusting, vacuuming, mopping, kitchen, bathrooms)
2. Deep Cleaning — Thorough top-to-bottom cleaning (baseboards, inside appliances, etc.)
3. Move-in/Move-out Cleaning — Comprehensive cleaning for moving (includes inside cabinets, appliances, etc.)

## ABOUT ${businessName.toUpperCase()}
- Licensed, insured, and background-checked cleaning staff
- 100% satisfaction guarantee on every job
- We provide all cleaning supplies and use safe, eco-friendly products that are safe for kids and pets
- Services include: kitchen cleaning, bathroom sanitizing, bedroom cleaning, living room cleaning, and floor care

## DATA COLLECTION ORDER
Collect these in order. You can combine confirmations of already-provided info, but STOP at each question the customer hasn't answered yet and wait for a reply.

1. **Service type**: e.g. "Hi there! This is ${sdrName} with ${businessName}. Are you looking for a Standard Cleaning, Deep Cleaning, or Move-in/Move-out Cleaning?"
   If the customer just says "cleaning" without specifying, ask: "Would you like a Standard Cleaning (regular maintenance), a Deep Cleaning (thorough top-to-bottom), or a Move-in/Move-out Cleaning?"

2. **Full name**: If the name is already on file, CONFIRM it using their ACTUAL name from the "INFO ALREADY ON FILE" section: e.g. "I have you down as [their actual name] — is that right?" If NOT on file, ask: e.g. "Great, we're glad to have you! What's your full name?"

3. **Address**: If the address is already on file, CONFIRM it: e.g. "And I have your address as 24 Tamalpais Ave, Mill Valley CA — is that where we'll be cleaning?" If NOT on file, ask: e.g. "Nice to meet you, [name]! What's the full address for the cleaning? Please include the city and zip code."
   If they provide a partial address, ask for the missing parts (city, zip code, apartment/unit number if applicable).

4. **Home details**: e.g. "How many bedrooms and bathrooms does your home have? And do you know the approximate square footage? Even a rough estimate is fine!"
   The customer may answer in one or two messages — combine them.
   If they don't know sqft, that's OK — move on without it.

5. **Frequency**: e.g. "How often would you like us to come? We can do One-time, Weekly, Every other week, or Monthly!"

6. **Special requests**: e.g. "Do you have any special requests or things we should know about? For example, pets in the home, access instructions, parking, or any specific areas you'd like us to focus on?"
   Just note their answer and move on. If they say "no" or "nothing," that's fine.

7. **Preferred date/time**: e.g. "Do you have a preferred date and time for us to come out?"

8. **Email**: If the email is already on file, CONFIRM it using their ACTUAL email from the "INFO ALREADY ON FILE" section: e.g. "And I have your email as [their actual email] — should we send everything there?" If NOT on file, ask: e.g. "Last thing — what's the best email for you? We'll send your pricing and booking details right over!"
   → When the customer provides or confirms their email, respond with ONLY: "Sounds good! I'm putting together your pricing and sending everything over now." and include [BOOKING_COMPLETE] at the END of your message. Do NOT mention specific prices, deposit links, invoices, or any other details — the system handles all of that automatically.

## PRICING QUESTIONS
If the customer asks "how much does it cost?" or "what's the price?" before you have their home details:
- Say: "Great question! The price depends on the size of your home and the type of cleaning. Once I have your details, I'll get you exact pricing right away!"

If the customer asks about pricing AFTER you have their details but before email:
- Say: "I'll have your exact pricing ready in just a moment! What's the best email to send it to?"

If the customer asks about payment:
- Say: "We accept most major credit cards. You'll pay fifty percent upfront as a deposit, and the rest after the job is completed. We'll send you a payment link over text and email!"

## ESCALATION RULES
Include the escalation tag at the END of your response (after your customer-facing message) ONLY when:
- Customer has special requests beyond standard services (hoarding cleanup, biohazard, etc.) → [ESCALATE:special_request]
- Customer wants to cancel, reschedule, or has billing issues → [ESCALATE:service_issue]
- Customer seems upset or is complaining → [ESCALATE:unhappy_customer]

**CRITICAL: When you include ANY [ESCALATE:...] tag, you are handing the conversation off to the team. Your message MUST end with something like "They'll reach out shortly!" Do NOT ask any more questions. Do NOT continue the booking flow.**

If the conversation history already contains an [ESCALATE:...] response from you, and the customer sends another message, reply with: "Our team will be reaching out to you shortly! If you have any questions in the meantime, feel free to text us."

## CRITICAL RULES
- Read conversation history carefully — NEVER re-ask a question that was already answered
- If the customer provided information across multiple messages, acknowledge ALL of it and move to the NEXT question
- Follow the data collection steps IN ORDER — do not jump ahead or skip steps
- You MUST complete the ENTIRE booking flow through email collection — UNLESS an escalation occurs
- If the customer corrects any information, acknowledge the correction and use the corrected version
- **NEVER send a bare, blunt question** — always lead with a warm transition
- **NEVER narrate or summarize the conversation** — just acknowledge and ask the next question
- **NO emojis** unless the customer uses them first
- **NO repeated greetings** — only greet in the very first message`
}

// =====================================================================
// BOOKING DATA EXTRACTION
// =====================================================================

export interface HouseCleaningBookingData {
  serviceType: string | null // "standard_cleaning" | "deep_cleaning" | "move_in_out"
  frequency: string | null // "one_time" | "weekly" | "biweekly" | "monthly"
  bedrooms: number | null
  bathrooms: number | null
  squareFootage: number | null
  hasPets: boolean | null
  fullName: string | null
  firstName: string | null
  lastName: string | null
  address: string | null
  preferredDate: string | null // YYYY-MM-DD
  preferredTime: string | null // HH:MM (24h)
  email: string | null
}

/**
 * Extract structured booking data from a house cleaning SMS conversation.
 * Uses AI to parse conversational data into structured fields.
 */
export async function extractHouseCleaningBookingData(
  conversationHistory: Array<{ role: 'client' | 'assistant'; content: string }>
): Promise<HouseCleaningBookingData> {
  const transcript = conversationHistory
    .map(m => `${m.role === 'client' ? 'Customer' : 'Assistant'}: ${m.content}`)
    .join('\n')

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const client = new Anthropic({ apiKey: anthropicKey })

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Extract booking data from this house cleaning service text conversation. Return ONLY a JSON object with these fields (use null for missing data):

{
  "serviceType": "standard_cleaning" | "deep_cleaning" | "move_in_out" | null,
  "frequency": "one_time" | "weekly" | "biweekly" | "monthly" | null,
  "bedrooms": number | null,
  "bathrooms": number | null,
  "squareFootage": number | null,
  "hasPets": true | false | null,
  "fullName": "string" | null,
  "firstName": "string" | null,
  "lastName": "string" | null,
  "address": "string" | null,
  "preferredDate": "string" | null,
  "email": "string" | null
}

For address: Look at BOTH the assistant's and the customer's messages. If the assistant mentions a full address and the customer later corrects part of it, return the CORRECTED full address.
For names: If the customer corrects their name (e.g., "my last name is Smith not Smyth"), return the corrected spelling.
For email: Look for an email address in the customer's messages.
For serviceType: Map "standard cleaning" to "standard_cleaning", "deep cleaning" to "deep_cleaning", "move in/out" or "move-in/move-out" to "move_in_out".
For bedrooms/bathrooms: Extract the numbers. "2 bed 2 bath" = bedrooms: 2, bathrooms: 2. Handle "1.5 bath" as bathrooms: 1.5.

IMPORTANT: If the customer corrects ANY information, always return the CORRECTED version, not the original.

CONVERSATION:
${transcript}

Return ONLY the JSON object, nothing else.`
        }],
      })

      const textContent = response.content.find(block => block.type === 'text')
      const raw = textContent?.type === 'text' ? textContent.text.trim() : ''

      const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
      const parsed = JSON.parse(jsonStr)

      // Parse natural date
      const { parseNaturalDate } = await import('./winbros-sms-prompt')

      return {
        serviceType: parsed.serviceType || null,
        frequency: parsed.frequency || null,
        bedrooms: parsed.bedrooms != null ? Number(parsed.bedrooms) : null,
        bathrooms: parsed.bathrooms != null ? Number(parsed.bathrooms) : null,
        squareFootage: parsed.squareFootage ? Number(parsed.squareFootage) : null,
        hasPets: typeof parsed.hasPets === 'boolean' ? parsed.hasPets : null,
        fullName: parsed.fullName || null,
        firstName: parsed.firstName || null,
        lastName: parsed.lastName || null,
        address: parsed.address || null,
        preferredDate: parsed.preferredDate ? parseNaturalDate(parsed.preferredDate).date : null,
        preferredTime: parsed.preferredDate ? parseNaturalDate(parsed.preferredDate).time : null,
        email: parsed.email || null,
      }
    } catch (err) {
      console.error('[HouseCleaning] AI booking data extraction failed:', err)
    }
  }

  // Fallback: regex-based extraction
  return extractHouseCleaningBookingDataRegex(conversationHistory)
}

/**
 * Fallback regex-based extraction when AI is unavailable.
 */
function extractHouseCleaningBookingDataRegex(
  conversationHistory: Array<{ role: 'client' | 'assistant'; content: string }>
): HouseCleaningBookingData {
  const clientMessages = conversationHistory
    .filter(m => m.role === 'client')
    .map(m => m.content)
  const allText = clientMessages.join(' ')
  const allTextLower = allText.toLowerCase()

  // Service type
  let serviceType: string | null = null
  if (/move[\s-]?in|move[\s-]?out/i.test(allTextLower)) serviceType = 'move_in_out'
  else if (/deep\s*clean/i.test(allTextLower)) serviceType = 'deep_cleaning'
  else if (/standard\s*clean|regular\s*clean/i.test(allTextLower)) serviceType = 'standard_cleaning'

  // Frequency
  let frequency: string | null = null
  if (/weekly/i.test(allTextLower) && !/biweekly|bi-weekly/i.test(allTextLower)) frequency = 'weekly'
  else if (/biweekly|bi-weekly|every\s*two\s*weeks|every\s*other\s*week/i.test(allTextLower)) frequency = 'biweekly'
  else if (/monthly/i.test(allTextLower)) frequency = 'monthly'
  else if (/one[\s-]?time/i.test(allTextLower)) frequency = 'one_time'

  // Bedrooms
  let bedrooms: number | null = null
  const bedMatch = allText.match(/(\d+)\s*(?:bed(?:room)?s?|br|bd)\b/i)
  if (bedMatch) bedrooms = parseInt(bedMatch[1], 10)

  // Bathrooms
  let bathrooms: number | null = null
  const bathMatch = allText.match(/([\d.]+)\s*(?:bath(?:room)?s?|ba)\b/i)
  if (bathMatch) bathrooms = parseFloat(bathMatch[1])

  // Square footage
  let squareFootage: number | null = null
  const sqftMatch = allText.match(/(\d[\d,]+)\s*(?:sq\.?\s*ft|square\s*f(?:ee|oo)t|sqft)/i)
  if (sqftMatch) squareFootage = parseInt(sqftMatch[1].replace(/,/g, ''), 10)

  // Pets
  let hasPets: boolean | null = null
  if (/\b(yes|yeah|yep|have\s+(?:a\s+)?(?:dog|cat|pet))\b/i.test(allTextLower) && /pet|dog|cat/i.test(allTextLower)) {
    hasPets = true
  } else if (/no\s*pets|don'?t\s*have\s*(?:any\s*)?pets|no\s*(?:dogs|cats)/i.test(allTextLower)) {
    hasPets = false
  }

  // Email
  let email: string | null = null
  const emailMatch = allText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  if (emailMatch) email = emailMatch[0].toLowerCase()

  // Name - look for message after "full name" question
  let fullName: string | null = null
  let firstName: string | null = null
  let lastName: string | null = null
  for (let i = 0; i < conversationHistory.length - 1; i++) {
    if (conversationHistory[i].role === 'assistant' &&
        /full name/i.test(conversationHistory[i].content)) {
      const nextClient = conversationHistory.slice(i + 1).find(m => m.role === 'client')
      if (nextClient) {
        fullName = nextClient.content.trim()
        const parts = fullName.split(/\s+/)
        firstName = parts[0] || null
        lastName = parts.slice(1).join(' ') || null
      }
      break
    }
  }

  // Address
  let address: string | null = null
  for (let i = 0; i < conversationHistory.length - 1; i++) {
    if (conversationHistory[i].role === 'assistant' &&
        /address/i.test(conversationHistory[i].content) &&
        !/email/i.test(conversationHistory[i].content)) {
      const addressParts: string[] = []
      for (let j = i + 1; j < conversationHistory.length; j++) {
        if (conversationHistory[j].role === 'client') {
          addressParts.push(conversationHistory[j].content.trim())
        } else {
          break
        }
      }
      if (addressParts.length > 0) {
        address = addressParts.join(', ')
      }
      break
    }
  }

  // Preferred date
  let preferredDate: string | null = null
  let preferredTime: string | null = null
  for (let i = 0; i < conversationHistory.length - 1; i++) {
    if (conversationHistory[i].role === 'assistant' &&
        /preferred date|when|time for us|date.*work/i.test(conversationHistory[i].content)) {
      const nextClient = conversationHistory.slice(i + 1).find(m => m.role === 'client')
      if (nextClient) {
        try {
          const { parseNaturalDate } = require('./winbros-sms-prompt')
          const parsed = parseNaturalDate(nextClient.content.trim())
          preferredDate = parsed.date
          preferredTime = parsed.time
        } catch {
          // parseNaturalDate not available
        }
      }
      break
    }
  }

  return {
    serviceType,
    frequency,
    bedrooms,
    bathrooms,
    squareFootage,
    hasPets,
    fullName,
    firstName,
    lastName,
    address,
    preferredDate,
    preferredTime,
    email,
  }
}
