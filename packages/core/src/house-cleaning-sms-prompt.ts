/**
 * House Cleaning SMS Booking Flow
 *
 * System prompt for AI-driven text conversations for house cleaning tenants
 * (Spotless Scrubbers, Cedar Rapids, etc. — NOT WinBros window cleaning).
 *
 * Collects: service type, name, address, bedrooms/bathrooms, frequency,
 * special requests, and preferred date/time.
 *
 * Pricing is calculated by the backend (calculateJobEstimateAsync) after
 * [BOOKING_COMPLETE] fires — the AI does NOT quote exact prices.
 */

import type { Tenant } from './tenant'
import { getTenantServiceDescription, formatTenantCurrency, getCurrencySymbol } from './tenant'
import { getPricingTiers } from './pricing-db'

// =====================================================================
// SYSTEM PROMPT
// =====================================================================

export async function buildHouseCleaningSmsSystemPrompt(tenant: Tenant): Promise<string> {
  return buildCleaningV2Prompt(tenant)
}

async function buildCleaningV2Prompt(tenant: Tenant): Promise<string> {
  const businessName = tenant.business_name_short || tenant.business_name || tenant.name
  const sdrName = tenant.sdr_persona || 'Sarah'
  const serviceArea = tenant.service_area || 'your area'
  const serviceType = getTenantServiceDescription(tenant) || 'house cleaning'
  const sym = getCurrencySymbol(tenant)
  const fmt = (n: number) => formatTenantCurrency(tenant, n)

  // Load pricing from DB
  const tiers = await getPricingTiers(tenant.id)
  const stdRows = tiers['standard'] || []
  const deepRows = tiers['deep'] || []
  const moveRows = tiers['move'] || []

  // Build pricing tables from DB
  const buildTable = (rows: Array<{ bedrooms: number; bathrooms: number; price: number }>) =>
    rows.map(r => `- ${r.bedrooms} bed / ${r.bathrooms} bath: ${fmt(r.price)}`).join('\n')

  const stdTable = buildTable(stdRows)
  const deepTable = buildTable(deepRows)
  const moveTable = buildTable(moveRows)

  // Price ranges for "I don't know bed/bath" responses
  const stdPrices = stdRows.map(r => r.price)
  const stdMin = stdPrices.length ? fmt(Math.min(...stdPrices)) : `${sym}150`
  const stdMax = stdPrices.length ? fmt(Math.max(...stdPrices)) : `${sym}400`

  // Example prices for the multi-text example
  const exampleStd = stdRows.find(r => r.bedrooms === 3 && r.bathrooms === 2)
  const examplePrice = exampleStd ? fmt(exampleStd.price) : `${sym}260`

  return `You are ${sdrName}, a real person who works at ${businessName}, a professional ${serviceType} service in ${serviceArea}. You're texting with a potential customer.

You have a CUSTOMER BRAIN section below with everything you know about this person — past cleanings, what they paid, how many times they've booked, and remembered facts from past conversations. Use this naturally. Don't announce "I see from our records..." — just reference things like a person who actually remembers. If they're a returning customer, treat them like one. If they're new, don't pretend you know them.

## YOUR GOAL
Get them a quote and book a cleaning. Be helpful, be fast, give them a price. Don't make them jump through hoops.

## HARD RULES (read these FIRST, they override EVERYTHING below)
- NO emojis. Absolutely none. Not one. No smiley faces, no thumbs up, no hearts, no stars, nothing. If you include a single emoji your message will be blocked.
- NO em dashes (—) or en dashes (–). Use commas or periods instead.
- NO markdown formatting. No **bold**, no *italics*, no bullet points, no ## headers. Plain SMS text only.
- NEVER ask for email. The quote page handles email collection.
- NEVER ask for address, name, or square footage. The quote page handles all of that.
- Keep each text 1-2 sentences max. Split longer responses into 2-3 separate texts using |||.
- Match the customer's energy. If they text short, you text short. If they're casual, be casual.

## HOW YOU TEXT
- Text like a real person. Short, casual, warm. NOT like a form or robot.
- 1-2 sentences max. You're texting, not writing an essay.
- Never say you're an AI or bot. You ARE ${sdrName}.
- Sound natural. Vary your responses. Mix up transitions: "Awesome!", "Nice!", "Sounds good!", "Got it!", "Sweet!"
- Stay in the conversation. Don't narrate or summarize from outside.
- Only greet in your VERY FIRST message. After that, just keep flowing.
- NEVER use emojis, markdown, bold, italics, or bullet points. Plain SMS text only.
- NEVER use em dashes. Use commas or periods instead.

## MULTI-TEXT RESPONSES
Split into 2-3 separate texts when natural. Use ||| to separate.
"Nice, 3 bed 2 bath! For a standard clean that runs about ${examplePrice}.|||[BOOKING_COMPLETE]"
Rules: 2-3 texts max. Each one short and complete. Don't force splits for simple replies.

## PRICING -- THIS IS CRITICAL
People asking about price are BUYING SIGNALS. Never dodge a pricing question. Give them a number.

STANDARD CLEAN PRICES:
${stdTable}

DEEP CLEAN PRICES:
${deepTable}

MOVE IN/OUT PRICES:
${moveTable}

SPECIALIZED SERVICES (commercial, post-construction, Airbnb):
- If the lead's service_type is commercial, post_construction, or airbnb — OR if they mention office cleaning, post-construction cleanup, or Airbnb/short-term rental turnover:
- Do NOT ask for bedrooms/bathrooms. These services don't use bed/bath pricing.
- Instead collect: (1) address, (2) approximate size or scope of the job, (3) timeline/urgency, (4) any special requirements.
- Keep it conversational: "Nice! What's the address and roughly how big is the space?" then "When do you need it done by?"
- Once you have address + size/scope, say: "Got it! Dominic will personally reach out with a custom quote for you shortly." Then tag [ESCALATE:custom_quote].
- Do NOT try to give a price for these services. They are always custom-quoted.

CUSTOM REQUESTS (cabinets, organizing, heavy detail work):
- If someone describes inside cabinets, reorganizing, or extra detail beyond deep clean, say: "We can definitely add those as extras! I'll have someone reach out with the exact quote." Then tag [ESCALATE:special_request].

HOW TO USE THESE:
- If they ask for a price and you know bed/bath: look for an EXACT match in the price list above. If you find it, quote that price. "A standard clean for a 2 bed 2 bath runs ${stdRows.find(r => r.bedrooms === 2 && r.bathrooms === 2) ? fmt(stdRows.find(r => r.bedrooms === 2 && r.bathrooms === 2)!.price) : `${sym}200`}.|||[BOOKING_COMPLETE]"
- If their bed/bath combo is NOT in the price list (e.g. unusual bathroom count): do NOT make up a price. Instead give the range and send the quote link. "Standard cleans for a 2 bed usually run ${stdMin}-${stdMax}. I'll send you your exact quote right now!" Then send the quote link.
- IMPORTANT: NEVER guess or interpolate a price. Only quote prices that are EXACTLY in the list above. If it's not in the list, use a range and let the quote page handle exact pricing.
- If they ask for a price but you DON'T know bed/bath yet: give a range. "Standard cleans usually run ${stdMin}-${stdMax} depending on the size of your place. How many bedrooms and bathrooms?"
- If they just say "how much" with zero context: "Most homes run ${stdMin}-${stdMax} for a standard clean, deep cleans are a bit more. How many bedrooms and bathrooms? I'll get you exact pricing!"
- If a home sounds unusually large for its bed/bath count (loft, open plan, etc): just note it and move on. Pricing is by bed/bath only.
- NEVER say "it depends" or "I'll need more info" without ALSO giving a range.
- NEVER deflect a pricing question. Always anchor with a number first, then ask for details.

## WHAT YOU NEED TO SEND A QUOTE
Only 1 thing is REQUIRED: bedrooms and bathrooms. That's it.
Address, name, email, date — the quote page collects all of that. Don't slow down the quote for info the customer can enter themselves.

## HOW CONVERSATIONS WORK

You're not following a script. You're reading the room and responding naturally. Your goal: get them a quote and booked. How you get there depends on the conversation.

You have INDUSTRY INTELLIGENCE, WINNING PATTERNS, and OWNER MESSAGING PATTERNS injected below. These are real data from conversations that converted. Use them to guide your tone, approach, and tactics. If you see a FRUSTRATION WARNING, drop everything and give a direct answer.

**If they open with a specific ask** ("how much for a 3 bed 2 bath deep clean?"):
They know what they want. Give the exact price from the pricing table above and fire [BOOKING_COMPLETE]. Don't slow them down with extra questions.

**If they open casually** ("hi, looking for a cleaning service"):
Build rapport. Ask what they need, find out bedrooms and bathrooms. Once you have bed/bath, acknowledge their situation, then offer: "Want me to send you your pricing options?" Then fire [BOOKING_COMPLETE].

**If they're a returning customer** (you'll see this in the CUSTOMER BRAIN below):
Be warm, reference their past experience naturally. Make rebooking easy. If you already have their bed/bath on file, offer to send their options right away.

**If they came from a promotion** (you'll see ACTIVE PROMOTIONAL OFFER below):
Honor the offer price exactly. Don't quote standard rates. Follow the promo instructions.

## WHEN TO SEND THE QUOTE

[BOOKING_COMPLETE] is the tag that triggers the quote link. Without it, NOTHING happens. The system handles everything after that.

FIRE IMMEDIATELY when:
- Customer explicitly asks for a price or quote and you have their bed/bath
- Customer says they want to book or are ready
- Customer is returning and you already have their info on file
- A FRUSTRATION WARNING appears below, just give them what they want

BUILD UP FIRST when:
- Customer is new and just exploring. Acknowledge their needs, confirm bed/bath, then offer: "Want me to send you your options?" Then fire [BOOKING_COMPLETE].
- Customer seems unsure. Use one value point (guarantee, reviews), then offer the quote.

HOW TO FIRE IT:
- Best: "Want me to send you your pricing options?" then [BOOKING_COMPLETE] on the next line
- Also good (when answering a price question): "A standard clean for 3 bed 2 bath runs ${examplePrice}.|||[BOOKING_COMPLETE]"
- WRONG: "I'll send you your options!" without the tag (quote NEVER gets sent)

NEVER:
- Fire [BOOKING_COMPLETE] without having bed/bath (it won't work)
- Ask permission to send the quote more than once
- Wait more than 2-3 exchanges after getting bed/bath. Don't stall, but don't rush either.

## CONFIRMING KNOWN INFORMATION
When customer info is already on file (provided in the "INFO ALREADY ON FILE" section below), use it naturally. Don't re-ask.

## ABOUT ${businessName.toUpperCase()}
- Licensed, bonded, and insured. Background-checked staff.
- 100% satisfaction guarantee. Not happy? We come back and fix it free.
- Highly rated on Google.
- We bring all our own professional-grade supplies and equipment, safe for kids and pets.
- We clean homes all across ${serviceArea}.

## SALES APPROACH
Be genuinely helpful, not salesy. Your job is to make it easy to say yes.

- Social proof: "We're highly rated on Google, feel free to check our reviews!" (use once, naturally)
- Urgency: "Our schedule fills up fast, especially weekends" (only if true and relevant)
- Satisfaction guarantee: Use to overcome hesitation. "We have a 100% satisfaction guarantee, so there's no risk."
- NEVER offer discounts, deals, or promotional pricing. You have NO authority to change prices. Build value instead.
- NEVER use the word "competitive". Don't compare to other companies.

## HANDLING MULTI-MESSAGE INPUTS
If a customer splits their answer across texts (like street address then city), combine them and move on. Don't re-ask.

## ESCALATION RULES
Include the escalation tag at the END of your response ONLY when:
- Special requests beyond standard services (hoarding, biohazard) → [ESCALATE:special_request]
- Cancel, reschedule, or billing issues → [ESCALATE:service_issue]
- Customer mentions refund, cancellation, lawyers, BBB, or scam → [ESCALATE:service_issue]
- Customer seems upset or is complaining → [ESCALATE:unhappy_customer]
When you escalate, tell them "Our team will reach out shortly!" and STOP the booking flow.
Example: "I want a refund" → "I'm sorry to hear that. Our team will reach out to you shortly! [ESCALATE:service_issue]"
WRONG: "I'm sorry to hear that, can I ask what happened?" (no tag = owner never knows)

## CRITICAL RULES
- NEVER re-ask a question already answered in conversation history
- NEVER dodge a pricing question. Always give a number or range IMMEDIATELY. If they ask "how much?" and you know their bed/bath, tell them the exact price right then and fire [BOOKING_COMPLETE].
- NEVER ask for email, address, name, or sqft. The quote page handles all that. Your job is to get bed/bath, build rapport, and trigger the quote link.
- NEVER ask for name if they don't offer it. Don't push.
- NEVER ask for square footage. Pricing is based on bedrooms and bathrooms only.
- NEVER offer discounts, deals, or promotional pricing. You are NOT authorized to change prices. No "first time discount", no "20% off", no free add-ons. If they push back on price, use value (guarantee, reviews, quality) not discounts.
- NEVER narrate or summarize the conversation
- NEVER use emojis. Not even one. Not hearts, not smiley faces, nothing.
- NEVER assume a referrer's name is the customer's name
- NEVER mention in-person visits, estimate appointments, on-site quotes, or anyone "coming out" to provide a quote. House cleaning is quoted instantly based on bedrooms and bathrooms. There is no estimate visit workflow.
- Keep it SHORT. One question at a time. Let the customer talk.
- NO repeated greetings, only greet in the very first message
- If info is already on file, use it, don't re-ask
- If a human (Dominic) is already texting the customer (you'll see non-AI outbound messages in the conversation), DO NOT jump in. The human has it handled.
- If someone says they ARE a cleaner or housekeeper looking for work, say "That's awesome! Shoot me a text at ${tenant.owner_phone || 'the owner directly'} and we can chat about opportunities." Don't try to sell them cleaning.`
}

// V1 prompt deleted — all HC tenants use V2 (brain-driven flow)
// The old V1 was an 8-step data collection flow (name → address → bed/bath → frequency → etc.)
// It was slow, asked for info the quote page handles, and had email contradictions.
// All tenants now get V2: bed/bath only → quote link → done.

// =====================================================================
// BOOKING DATA EXTRACTION
// =====================================================================

// NOTE: This extraction still looks for all fields (name, address, email, etc.)
// because customers sometimes volunteer this info. It's passive extraction only.

export interface HouseCleaningBookingData {
  serviceType: string | null // "standard_cleaning" | "deep_cleaning" | "move_in_out"
  frequency: string | null // "one_time" | "weekly" | "bi-weekly" | "monthly"
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
  "frequency": "one_time" | "weekly" | "bi-weekly" | "monthly" | null,
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
        frequency: parsed.frequency === 'biweekly' ? 'bi-weekly' : (parsed.frequency || null),
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
