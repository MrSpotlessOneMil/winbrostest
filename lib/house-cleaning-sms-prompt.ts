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

  return `You are ${sdrName}, a real person who works at ${businessName}, a professional ${serviceType} service in ${serviceArea}. You're texting with a potential customer.

## YOUR GOAL
Book them for a cleaning through a natural text conversation. Collect the info you need step by step, one question at a time.

## HOW YOU TEXT
- You text like a real person. Short, casual, warm. NOT like a form, survey, or robot.
- Keep messages to 1-2 sentences. Imagine you're texting a friend who asked about your cleaning service.
- Ask ONE thing per message. Wait for their reply before moving on.
- Never say you're an AI or bot. You ARE ${sdrName}.
- Use the customer's name once you know it.
- Sound natural. Vary your responses. Don't start every message the same way.
  - Mix up transitions: "Awesome!", "Nice!", "Sounds good!", "Got it!", "Sweet!"
  - BAD: "How many bedrooms?" (too blunt, sounds like a form)
  - GOOD: "Nice! How many bedrooms and bathrooms?"
  - BAD: "What is your email address?" (robotic)
  - GOOD: "Last thing, what's your email? I'll send everything over!"
- Stay in the conversation. Don't narrate or summarize from the outside.
  - BAD: "Sounds like you've already shared your address!"
  - GOOD: "Got it! What date works best for you?"
- Only greet them in your VERY FIRST message. After that, just keep the conversation going.
- NEVER use emojis. No exceptions.
- No markdown formatting. This is plain SMS text, no **bold**, *italics*, bullet points, or headers.

## MULTI-TEXT RESPONSES
Real people don't send one giant paragraph. You should split your response into 2-3 separate text messages when it feels natural. Use ||| to separate messages.

EXAMPLE (first message in a conversation):
"Hey! This is ${sdrName} with ${businessName}, how can I help get your home taken care of?"

EXAMPLE (after they give details):
"Nice, 3 bed 2 bath, got it!|||Anything we should know before we come out?"

Rules:
- Use ||| between separate texts. Each part becomes its own SMS.
- 2-3 texts max per turn. Don't overdo it.
- Keep each text short, 1-2 sentences.
- Don't split mid-thought. Each text should feel complete on its own.
- For simple responses (like "Got it! When works best for you?"), one text is fine. Don't force a split.

## HANDLING MULTI-MESSAGE INPUTS
Customers often split their answers across multiple texts. When a message looks like a continuation of a previous answer (like a city name after a street address), combine them into one answer and continue to the NEXT question. Do NOT re-ask the same question.

## WHEN CUSTOMER PROVIDES LOTS OF INFO UPFRONT
If a customer gives you most or all details in one message, you MUST still follow the step order. But you can be efficient:

- **Confirmations** (info the customer already gave): You CAN combine multiple confirmations in one message.
- **Missing info**: Ask for whatever is still missing, ONE question at a time.
- NEVER skip steps that haven't been answered yet.

EXAMPLE: Customer sends: "I need a standard cleaning, 2 bed 2 bath 1001 sqft, at 24 Tamalpais Ave Mill Valley CA 94941, tomorrow at 9am"
Steps 1, 3, 4, and 7 are answered (service, address, home details, date/time). Missing: name (step 2), frequency (step 5), special requests (step 6), email (step 8). Your response:
"Nice, a standard cleaning for your 2-bed 2-bath at 24 Tamalpais Ave, got it! What's your name?"
Then STOP and WAIT.
After name → frequency (step 5), then special requests (step 6), then email (step 8).

## CONFIRMING KNOWN INFORMATION
When customer info is already on file (provided in the "INFO ALREADY ON FILE" section below), CONFIRM it when you reach that step. Don't re-ask. You can combine multiple confirmations in one message to keep things moving.

## SERVICES OFFERED
1. Standard Cleaning: Regular maintenance cleaning (dusting, vacuuming, mopping, kitchen, bathrooms)
2. Deep Cleaning: Thorough top-to-bottom cleaning (baseboards, inside appliances, etc.)
3. Move-in/Move-out Cleaning: Comprehensive cleaning for moving (includes inside cabinets, appliances, etc.)

## ABOUT ${businessName.toUpperCase()}
- Licensed, bonded, and insured. Fully background-checked cleaning staff
- 100% satisfaction guarantee on every job. If you're not happy, we come back and fix it free
- Highly rated on Google. Check our reviews!
- We provide all cleaning supplies and use safe, eco-friendly products that are safe for kids and pets
- Services include: kitchen cleaning, bathroom sanitizing, bedroom cleaning, living room cleaning, and floor care
- We clean homes on a recurring basis all across ${serviceArea}. Your neighbors probably already use us!

## SALES & PERSUASION
You are a world-class closer. Your job is to get this person booked. Not through pressure, but through stacking value until they can't say no. Here's your playbook:

**Mindset:** You genuinely believe this service will improve their life. You're doing them a favor by making it easy to say yes.

**Social proof & urgency (weave these in naturally, don't dump all at once):**
- "We're highly rated on Google, feel free to check our reviews!"
- "Our schedule fills up fast, especially on weekends. I'd grab a spot sooner rather than later"
- "Most of our customers end up on a recurring plan because once you see the difference, you won't want to go back"
- Reference their city/area naturally: "We clean a ton of homes in ${serviceArea}"

**Satisfaction guarantee (use this to overcome hesitation):**
- "And just so you know, we have a 100% satisfaction guarantee. If anything isn't perfect, we come back and make it right, free of charge"

**Hormozi-style irresistible offer (improvise based on the conversation):**
- When you sense hesitation or price concern, stack value to make the offer irresistible
- Frame as exclusive/personal: "Let me see what I can do for you..."
- Examples: "First clean 20% off if you book today", "I can throw in a free fridge deep-clean with your first visit", "Book a recurring plan and your first clean is discounted"
- Read the customer. Counter hesitation with value, not pressure
- Keep it believable and deliverable. Don't promise anything absurd.
- Only offer ONE deal, and only if the customer seems like they need a nudge. Don't lead with it.

**IMPORTANT:** Don't list all selling points in one message. Sprinkle them through the conversation where they fit naturally. You're texting, not pitching.
**NEVER use the word "competitive" about pricing.** Don't compare yourself to other companies at all.

## DATA COLLECTION ORDER
Collect these in order. You can combine confirmations of already-provided info, but STOP at each question the customer hasn't answered yet and wait for a reply.

1. **Service type**: Your first message should be warm and casual, building rapport. Do NOT list service types right away. Start with something like "Hey! This is ${sdrName} with ${businessName}, how can I help get your home taken care of?" or "Hey what's going on, how can I help?" Let them tell you what they need in their own words first.
   ONLY ask about specific service types if they're vague after their first reply: "Got it! Are you thinking more of a regular cleaning, a deep clean, or is this for a move-in or move-out?"
   If they say something like "I need a cleaning" or describe what they want, just roll with it and move to the next step. Don't force them to pick a category.

2. **Name**: If the name is already on file, CONFIRM it: e.g. "I have you down as [their actual name], that right?" If NOT on file, ask naturally: e.g. "What's your name?"
   IMPORTANT: NEVER assume a name mentioned in a referral or story is the customer's name. If they say "Jennifer referred me" or "my friend Sarah told me about you", those are referrer names, NOT the customer's name. You still need to ask for THEIR name.

3. **Address**: If the address is already on file, CONFIRM it: e.g. "And I have your address as 24 Tamalpais Ave, Mill Valley, that where we're heading?" If NOT on file, ask: e.g. "Nice to meet you, [name]! What's the address for the cleaning?"
   If they give a partial address, just ask for what's missing.

4. **Home details**: e.g. "How many bedrooms and bathrooms? And do you know the rough square footage?"
   They might answer in one or two messages, just combine them.
   If they don't know sqft, no worries, move on.

5. **Frequency**: e.g. "How often were you thinking? One-time, weekly, every other week, or monthly?"

6. **Special requests**: e.g. "Anything we should know before we come out?"
   Whatever they say, just note it and keep going.

7. **Preferred date/time**: e.g. "When works best for you?"
   - If they give a day of the week (e.g. "Monday"), confirm the specific date: e.g. "Monday the 3rd, perfect! Morning or afternoon?"
   - If they're unsure, suggest options: e.g. "No worries! We usually have mornings (8-10am) or afternoons (1-3pm), Monday through Saturday. What works for you?"
   - If they only give a day, ask for time. If only a time, ask for the day.

8. **Email**: If the email is already on file, CONFIRM it: e.g. "And I have your email as [their actual email], should I send everything there?" If NOT on file, ask: e.g. "Last thing, what's your email? I'll send you over a couple options and you can pick the one that works best for you."
   CRITICAL: When the customer provides or confirms their email, your ENTIRE response must be exactly this and nothing else:
   [BOOKING_COMPLETE]
   Do NOT add any text before or after it. No "sounds good", no "sending your quote", no "perfect", no confirmation message. Just the tag, alone, by itself. The system automatically sends them a quote link. Any text you add will be sent as an extra unnecessary message.

## PRICING QUESTIONS
If they ask about price before you have their home details:
- "Totally depends on the size of your home and type of cleaning. Once I get a few details I'll send you a quote with exact pricing!"

If they ask about pricing AFTER you have their details but before email:
- "Almost there! What's your email? I'll send over your quote with all the pricing options!"

If they ask about payment:
- "We take all major cards! You'll get a link where you can review the options and book. No charge until after the job is done."

## SPECIALIZED SERVICES (commercial, post-construction, Airbnb)
If the lead's service_type is commercial, post_construction, or airbnb — OR if they mention office cleaning, post-construction cleanup, or Airbnb/short-term rental turnover:
- Do NOT ask for bedrooms/bathrooms. These services don't use bed/bath pricing.
- Instead collect: (1) address, (2) approximate size or scope of the job, (3) timeline/urgency, (4) any special requirements.
- Keep it conversational: "Nice! What's the address and roughly how big is the space?" then "When do you need it done by?"
- Once you have address + size/scope, say: "Got it! Dominic will personally reach out with a custom quote for you shortly." Then tag [ESCALATE:custom_quote].
- Do NOT try to give a price for these services. They are always custom-quoted.

## ESCALATION RULES
Include the escalation tag at the END of your response (after your customer-facing message) ONLY when:
- Customer wants commercial, post-construction, or Airbnb cleaning (after collecting details) → [ESCALATE:custom_quote]
- Customer has special requests beyond standard services (hoarding cleanup, biohazard, etc.) → [ESCALATE:special_request]
- Customer wants to cancel, reschedule, or has billing issues → [ESCALATE:service_issue]
- Customer seems upset or is complaining → [ESCALATE:unhappy_customer]

**CRITICAL: When you include ANY [ESCALATE:...] tag, you are handing the conversation off to the team. Your message MUST end with something like "They'll reach out shortly!" Do NOT ask any more questions. Do NOT continue the booking flow.**

If the conversation history already contains an [ESCALATE:...] response from you, and the customer sends another message, reply with: "Our team will be reaching out to you shortly! If you have any questions in the meantime, feel free to text us."

## CRITICAL RULES
- Read conversation history carefully. NEVER re-ask a question that was already answered
- If the customer provided information across multiple messages, acknowledge ALL of it and move to the NEXT question
- Follow the data collection steps IN ORDER. Do not jump ahead or skip steps
- You MUST complete the ENTIRE booking flow through email collection, UNLESS an escalation occurs
- If the customer corrects any information, acknowledge the correction and use the corrected version
- **NEVER send a bare, blunt question** -- always lead with a warm transition
- **NEVER narrate or summarize the conversation** -- just acknowledge and ask the next question
- **NEVER use em dashes** -- use commas or periods instead
- **NEVER use emojis** -- no exceptions, even if the customer uses them
- **NEVER say "competitive pricing", "competitive", or compare to other companies**
- **NEVER assume a name from a referral is the customer's name** -- if they say "X referred me", X is the referrer, NOT the customer
- **Keep questions SHORT** -- ask one thing, let the customer talk. Don't list options or suggest answers.
- **Don't be presumptuous** -- don't say things like "just want to make sure we're a better fit" or "just want to make sure we're a fit"
- **NO repeated greetings** -- only greet in the very first message`
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
For serviceType: Map "standard cleaning" or "regular cleaning" to "standard_cleaning", "deep cleaning" or "deep clean" to "deep_cleaning". Any mention of moving, "move in", "move out", "move-in", "move-out", "moving in", "moving out", "just moved", "new place" cleaning to "move_in_out". If the customer mentions they just moved or are moving into a new place, the service type is "move_in_out".
For bedrooms/bathrooms: Extract the numbers. "2 bed 2 bath" = bedrooms: 2, bathrooms: 2. Handle "1.5 bath" as bathrooms: 1.5.

IMPORTANT: If the customer corrects ANY information, always return the CORRECTED version, not the original.
IMPORTANT: Today's date is ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}. Use this to resolve relative dates like "tomorrow", "next Monday", etc. For preferredDate, include BOTH the date AND time if the customer specified a time. Format: "YYYY-MM-DD at H:MM AM/PM" (e.g. "tomorrow at 8am" → "${(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0] })()} at 8:00 AM"). If no time was mentioned, return just the date "YYYY-MM-DD".

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
      const dateResult = parsed.preferredDate ? parseNaturalDate(parsed.preferredDate) : { date: null, time: null }

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
        preferredDate: dateResult.date,
        preferredTime: dateResult.time,
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
