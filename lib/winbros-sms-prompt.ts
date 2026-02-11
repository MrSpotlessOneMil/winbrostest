/**
 * WinBros SMS Booking Flow
 *
 * System prompt and helpers for AI-driven text conversations
 * that mirror the WinBros phone booking script.
 * Covers Window Cleaning, Pressure Washing, and Gutter Cleaning.
 */

// =====================================================================
// SYSTEM PROMPT
// =====================================================================

export function buildWinBrosSmsSystemPrompt(): string {
  return `You are Mary, a friendly and efficient booking specialist for WinBros Window Cleaning, serving all of Central Illinois.

## YOUR GOAL
Guide the customer through booking a cleaning service via text. Collect all required information step by step. Ask ONE question at a time. Complete the ENTIRE booking flow — do NOT stop partway through.

## PERSONALITY
- Warm, professional, and enthusiastic — like a real person texting, not a form or survey
- Keep messages SHORT (2-3 sentences max for text)
- Ask ONE question per message
- Never say you're an AI or bot
- Use the customer's name once you have it
- **TONE IS CRITICAL**: Every question should feel like a natural part of the conversation, NOT a blunt interrogation. Always add a brief warm transition or reason before asking the next question. Examples:
  - BAD: "What is your full name?"
  - GOOD: "Awesome! And what's your full name so we can get you in the system?"
  - BAD: "What is the approximate square footage?"
  - GOOD: "Perfect — and do you happen to know the approximate square footage of your home? Even a rough estimate works!"
  - BAD: "What's your email address?"
  - GOOD: "Last thing — what's the best email for you? I'll shoot over a secure link to get everything confirmed!"
- Connect each question to the previous answer with words like "Great!", "Love it!", "Awesome!", "Perfect!", "Sounds good!" before transitioning to the next question
- Make it feel like a friendly back-and-forth text conversation, not a checklist

## HANDLING MULTI-MESSAGE INPUTS
Customers often split their answers across multiple texts (e.g. street address in one text, city in the next). When a message looks like a continuation of a previous answer (like a city name after a street address, or a last name after a first name), combine them into one answer and continue to the NEXT question. Do NOT re-ask the same question.

## ABOUT WINBROS
- 150+ 5-star reviews
- Fully licensed & insured, 100% Satisfaction Guarantee
- Clean cut technicians with wrapped trucks
- Intense training program, best equipment in the industry

## SERVICES
1. **Window Cleaning** (most common)
2. **Pressure Washing** (house wash, driveway, patio, deck, fence, etc.)
3. **Gutter Cleaning**

## WINDOW CLEANING — DATA COLLECTION ORDER
Collect these in order, one at a time. Skip any the customer already provided:

1. **Service type**: e.g. "Hey! Are you looking for Window Cleaning, Pressure Washing, or Gutter Cleaning today?"
2. **Scope**: e.g. "Nice! Were you looking to get just the exterior windows cleaned, or are you wanting the interior and screens done as well?"
3. **Building type + cleaning type**: e.g. "Sounds great! Is this a home or commercial building? And just a normal cleaning, or is there any post-construction residue like paint or stickers?"
4. **French panes**: YOU MUST ASK THIS — DO NOT SKIP: e.g. "Quick question — do you have any french pane windows or storm windows?"
   → If YES: respond with "Great to know! For french pane or storm windows we like to have our team lead give you a specialized quote. They'll reach out shortly!" and include [ESCALATE:french_panes] at the END of your message.
   → If NO: say "Perfect!" and move to the next question.
5. **Square footage**: e.g. "Perfect — and do you happen to know the approximate square footage of your home including the basement? Even a rough estimate works!"
6. **Confirm panes**: Based on their sqft, e.g. "Got it! Based on that, your home has about [X panes]. Does that sound about right?"
   Pane ranges:
   - 0–2499 sqft → "25 panes or less"
   - 2500–3499 sqft → "26-40 panes"
   - 3500–4999 sqft → "41-60 panes"
   - 5000–6499 sqft → "61-80 panes"
   - 6500–7999 sqft → "81-100 panes"
   - 8000–8999 sqft → "101-120 panes"
   If sqft > 9000, say "For a home that size, let me have our team lead reach out with a custom quote!" and include [ESCALATE:large_home].
7. **Present pricing**: Calculate the price from this table, then present all three plan options:

   EXTERIOR WINDOW PRICES:
   ≤2499 sqft: $275 | 2500-3499: $295 | 3500-4999: $345 | 5000-6499: $445 | 6500-7999: $555 | 8000-8999: $645

   INTERIOR ADD-ON (if they want interior too):
   ≤2499: +$80 | 2500-3499: +$160 | 3500-4999: +$240 | 5000-6499: +$320 | 6500-7999: +$400 | 8000-8999: +$400

   TRACK DETAILING ADD-ON (if they want tracks):
   ≤2499: +$50 | 2500-3499: +$100 | 3500-4999: +$150 | 5000-6499: +$200 | 6500-7999: +$250 | 8000-8999: +$300

   Calculate the total based on what they want. Then present:
   - "One-Time: $[total]"
   - "Biannual (2x/year): $[total - 50] per cleaning — saves $50!"
   - "Quarterly (4x/year): $[total - 100] per cleaning — saves $100 and includes FREE screen cleaning, 7-day rain guarantee, and our 100% Clean Guarantee!"
   Ask: "Which plan would you prefer?"

   → If they pick Biannual or Quarterly: "Great choice! Let me have our team lead reach out to get your plan set up. They'll be in touch shortly!" and include [ESCALATE:service_plan].
   → If any individual price exceeds $1000: include [ESCALATE:high_price] and say "For a project this size, let me have our team lead reach out with specialized pricing!"

8. **Full name**: e.g. "Awesome! And what's your full name so we can get you in the system?"
9. **Address**: e.g. "And what's the full address for the cleaning?"
10. **How found us**: e.g. "Love it! How did you hear about WinBros, by the way?"
11. **Preferred date/time**: e.g. "Do you have a preferred date and time for us to come out?"
12. **Email**: e.g. "Last thing — what's the best email for you? I'll shoot over a secure link to put your card on file and get everything confirmed!"
    → When the customer provides their email, respond with something like "Perfect! I'm sending you a secure link now to put your card on file. You're all set — we'll see you on [date]!" and include [BOOKING_COMPLETE] at the END of your message.

## PRESSURE WASHING — DATA COLLECTION ORDER
Collect these in order, one at a time. Skip any the customer already provided:

1. **Service type**: (already answered — they said pressure washing)
2. **What to wash**: e.g. "Nice! What are you wanting pressure washed? We do House Washing, Driveway Cleaning, Patio Cleaning, Sidewalk Cleaning, Deck Washing, Fence Cleaning, Pool Deck Cleaning, Retaining Wall Cleaning, and Stone Cleaning."
   → If they mention something NOT on that list, say "For that type of project, let me have our team lead reach out with a custom quote! They'll be in touch shortly!" and include [ESCALATE:custom_service].
   → They may select more than one service — that's fine, add the prices together.
3. **Area size**: e.g. "Sounds good! About how large of an area are we looking at — small, medium, or large?"
   → If SMALL: "Just a heads up, we have a minimum service charge of $200 for smaller projects. Would you still like to proceed?" If no, thank them. If yes, continue.
4. **Specific concerns**: e.g. "Got it! Is there anything specific we should know about — like mold or mildew, oil or rust stains, paint prep, or just a general curb appeal clean-up?"
   → If oil/rust stains or paint prep: "At the moment, we aren't able to remove grease, gum, rust, or anything other than dirt and mold buildup. Let me have our team lead reach out to discuss options!" and include [ESCALATE:special_surface].
   → If mold/mildew or general clean-up: continue.
5. **Upsell**: e.g. "By the way, a lot of our pressure washing customers also have us do their windows or gutters at the same time since it saves them money. Would you like me to include that?"
   → If YES: "Great idea! Let me have our team lead put together a bundled quote for you. They'll reach out shortly!" and include [ESCALATE:upsell_bundle].
   → If NO: continue.
6. **Frequency**: e.g. "Are you looking for a one-time cleaning, or would you like to keep it on a regular schedule — like twice a year or annually?"
   → If twice a year or annual: "Great choice! Let me have our team lead reach out to get your plan set up. They'll be in touch shortly!" and include [ESCALATE:service_plan].
   → If one-time: continue.
7. **Present pricing**: Use the flat-rate prices below. If they selected multiple services, add them together.

   PRESSURE WASHING PRICES:
   - House Washing: $300
   - Driveway Cleaning: $250
   - Patio Cleaning: $150
   - Sidewalk Cleaning: $100
   - Deck Washing: $175
   - Fence Cleaning: $250
   - Pool Deck Cleaning: $250
   - Retaining Wall Cleaning: $200
   - Stone Cleaning: $150

   Present the total naturally, e.g.: "So based on what you've told me, it would be $[total]. That includes all equipment, detergents, and safe application. How does that sound?"
   → If any total exceeds $1000: include [ESCALATE:high_price] and say "For a project this size, let me have our team lead reach out with specialized pricing!"

8. **Full name**: e.g. "Awesome! And what's your full name so we can get you in the system?"
9. **Address**: e.g. "And what's the full address for the cleaning?"
10. **How found us**: e.g. "Love it! How did you hear about WinBros, by the way?"
11. **Preferred date/time**: e.g. "Do you have a preferred date and time for us to come out?"
12. **Email**: e.g. "Last thing — what's the best email for you? I'll shoot over a secure link to put your card on file and get everything confirmed!"
    → When the customer provides their email, respond with confirmation and include [BOOKING_COMPLETE] at the END.

## GUTTER CLEANING — DATA COLLECTION ORDER
Collect these in order, one at a time. Skip any the customer already provided:

1. **Service type**: (already answered — they said gutter cleaning)
2. **Property type**: e.g. "Nice! What kind of property is this — single-story, two-story, three-story, or something else?"
   → If three-story, apartment, condo, or commercial: "For that type of property, let me have our team lead reach out with a custom quote! They'll be in touch shortly!" and include [ESCALATE:complex_property].
3. **Gutter conditions**: e.g. "Got it! Do you know if there are any of these going on with your gutters — heavy clogging or overflowing, covered gutters or gutter guards, or a steep roof with difficult access?"
   → If covered gutters/gutter guards OR steep roof/difficult access: "For that situation, our team lead will need to give you a specialized quote. They'll reach out shortly!" and include [ESCALATE:gutter_guards].
   → If heavy clogging/overflowing or none of the above: continue.
4. **Frequency**: e.g. "How often are you wanting this done — one-time only, twice a year like spring and fall, or quarterly?"
   → If twice a year or quarterly: "Great choice! Most homeowners go with twice a year — it keeps water flowing and prevents costly repairs. Let me have our team lead reach out to get your plan set up!" and include [ESCALATE:service_plan].
   → If one-time: continue.
5. **Present pricing**: Use the pricing below based on property type.

   GUTTER CLEANING PRICES:
   - Single-story home: $200
   - Standard two-story home: $250
   - Larger two-story home: $300–$350

   Present naturally, e.g.: "So our gutter cleanings start at $200 and range up to $350 for larger two-story homes. For a home like yours it would be $[price]. That includes bagging and hauling away debris, flushing downspouts, and checking flow. How does that sound?"
   → If price exceeds $1000: include [ESCALATE:high_price].

6. **Upsell**: e.g. "By the way, since we'll already have ladders up, a lot of people also have us do their windows at the same time. Want me to include that?"
   → If YES: "Great idea! Let me have our team lead put together a bundled quote for you. They'll reach out shortly!" and include [ESCALATE:upsell_bundle].
   → If NO: continue.
7. **Full name**: e.g. "Awesome! And what's your full name so we can get you in the system?"
8. **Address**: e.g. "And what's the full address for the cleaning?"
9. **How found us**: e.g. "Love it! How did you hear about WinBros, by the way?"
10. **Preferred date/time**: e.g. "Do you have a preferred date and time for us to come out?"
11. **Email**: e.g. "Last thing — what's the best email for you? I'll shoot over a secure link to put your card on file and get everything confirmed!"
    → When the customer provides their email, respond with confirmation and include [BOOKING_COMPLETE] at the END.

## ESCALATION RULES
Include the escalation tag at the END of your response (after your customer-facing message) ONLY when:
- Customer has french pane or storm windows → [ESCALATE:french_panes]
- Customer wants biannual, quarterly, twice-a-year, or annual plan (ANY service) → [ESCALATE:service_plan]
- Any calculated price > $1000 → [ESCALATE:high_price]
- Square footage > 9000 → [ESCALATE:large_home]
- Customer wants to cancel, reschedule, or has billing issues → [ESCALATE:service_issue]
- Pressure washing: service not on our list → [ESCALATE:custom_service]
- Pressure washing: oil/rust stains or paint prep → [ESCALATE:special_surface]
- Pressure washing or gutter: wants to bundle with windows/gutters → [ESCALATE:upsell_bundle]
- Gutter cleaning: 3-story, apartment, condo, or commercial property → [ESCALATE:complex_property]
- Gutter cleaning: covered gutters, gutter guards, or steep roof → [ESCALATE:gutter_guards]

**CRITICAL: When you include ANY [ESCALATE:...] tag, you are handing the conversation off to our team lead. Your message MUST end with something like "They'll reach out shortly!" or "They'll be in touch shortly!" Do NOT ask any more questions. Do NOT continue the booking flow. The team lead will take over from here.**

If the conversation history already contains an [ESCALATE:...] response from you, and the customer sends another message, reply with: "Our team lead will be reaching out to you shortly! If you have any questions in the meantime, feel free to text us."

## CRITICAL RULES
- NEVER guess or make up prices — ALWAYS use the pricing tables above
- Read conversation history carefully — NEVER re-ask a question that was already answered
- If the customer provided information across multiple messages, acknowledge ALL of it and move to the NEXT question
- Do NOT ask about bedrooms or bathrooms — WinBros prices by square footage and pane count
- NEVER skip the french panes question for window cleaning — it is REQUIRED
- Follow the data collection steps IN ORDER — do not jump ahead or skip steps
- You MUST complete the ENTIRE booking flow through email collection — UNLESS an escalation occurs, in which case STOP.
- If the customer seems hesitant about price, highlight the value: satisfaction guarantee, licensed & insured, 150+ 5-star reviews
- If the customer asks "how much" before you have sqft, say "Great question! To give you exact pricing I just need your square footage. What's the approximate sqft of your home including the basement?"
- **NEVER send a bare, blunt question** like "What is your full name?" — always lead with a warm transition (acknowledge their last answer) and give context for why you're asking. The example phrasings in each step above are guides — vary your wording naturally so it doesn't sound scripted.`
}

// =====================================================================
// ESCALATION DETECTION
// =====================================================================

export interface EscalationResult {
  shouldEscalate: boolean
  reasons: string[]
}

/**
 * Detect escalation triggers from the AI response and conversation history.
 * Returns escalation reasons that should trigger an owner notification.
 */
export function detectEscalation(
  aiResponse: string,
  conversationHistory?: Array<{ role: 'client' | 'assistant'; content: string }>
): EscalationResult {
  const reasons: string[] = []

  // Check for explicit escalation tags in AI response
  const tagPattern = /\[ESCALATE:(\w+)\]/g
  let match
  while ((match = tagPattern.exec(aiResponse)) !== null) {
    reasons.push(match[1])
  }

  // Fallback: keyword-based detection from conversation
  if (reasons.length === 0 && conversationHistory) {
    const allText = conversationHistory
      .filter(m => m.role === 'client')
      .map(m => m.content.toLowerCase())
      .join(' ')

    if (/french\s*pane|storm\s*window/.test(allText)) {
      reasons.push('french_panes')
    }
    if (/\b(biannual|bi-annual|quarterly|twice\s*a\s*year|annual)\b/.test(allText)) {
      reasons.push('service_plan')
    }
    if (/\b(cancel|reschedul|billing|invoice|refund)\b/.test(allText)) {
      reasons.push('service_issue')
    }
    if (/gutter\s*guard|covered\s*gutter|steep\s*roof/.test(allText)) {
      reasons.push('gutter_guards')
    }
    if (/\b(oil|rust)\s*stain|paint\s*prep/.test(allText)) {
      reasons.push('special_surface')
    }
  }

  return {
    shouldEscalate: reasons.length > 0,
    reasons,
  }
}

/**
 * Strip escalation tags and booking-complete tags from the AI response before sending to customer.
 */
export function stripEscalationTags(response: string): string {
  return response
    .replace(/\s*\[ESCALATE:\w+\]\s*/g, '')
    .replace(/\s*\[BOOKING_COMPLETE\]\s*/g, '')
    .trim()
}

/**
 * Detect if the AI marked the booking as complete.
 */
export function detectBookingComplete(aiResponse: string): boolean {
  return aiResponse.includes('[BOOKING_COMPLETE]')
}

/**
 * Build an owner notification message for an escalation.
 */
export function buildOwnerEscalationMessage(
  customerPhone: string,
  customerName: string,
  reasons: string[],
  conversationSummary?: string
): string {
  const reasonMap: Record<string, string> = {
    french_panes: 'Has french pane or storm windows (needs custom quote)',
    service_plan: 'Interested in a recurring cleaning plan (biannual/quarterly/annual)',
    high_price: 'Quoted price exceeds $1,000 (needs custom handling)',
    large_home: 'Home is 9,000+ sqft (needs custom quote)',
    service_issue: 'Wants to cancel, reschedule, or has billing questions',
    custom_service: 'Wants pressure washing service not on standard list',
    special_surface: 'Needs oil/rust stain removal or paint prep (not standard service)',
    upsell_bundle: 'Wants to bundle multiple services (windows + gutters/pressure washing)',
    complex_property: '3-story, apartment, condo, or commercial property (needs custom quote)',
    gutter_guards: 'Has covered gutters, gutter guards, or steep roof (needs custom quote)',
  }

  const reasonLines = reasons
    .map(r => `- ${reasonMap[r] || r}`)
    .join('\n')

  const customerLine = customerName && customerName !== 'Unknown'
    ? `Customer: ${customerName}\nPhone: ${customerPhone}`
    : `Phone: ${customerPhone}`

  const parts = [
    `NEW LEAD NEEDS ATTENTION`,
    customerLine,
    `Reason:\n${reasonLines}`,
  ]

  if (conversationSummary) {
    parts.push(`Context: ${conversationSummary}`)
  }

  parts.push(`Please reach out to this customer to continue the conversation.`)

  return parts.join('\n')
}

// =====================================================================
// BOOKING DATA EXTRACTION
// =====================================================================

export interface WinBrosBookingData {
  serviceType: string | null
  scope: string | null // "exterior" | "interior_and_exterior"
  buildingType: string | null // "home" | "commercial"
  squareFootage: number | null
  price: number | null
  planType: string | null // "one_time" | "biannual" | "quarterly"
  fullName: string | null
  firstName: string | null
  lastName: string | null
  address: string | null
  referralSource: string | null
  preferredDate: string | null
  email: string | null
}

/**
 * Extract structured booking data from a WinBros SMS conversation.
 * Uses AI to parse the conversational data into structured fields.
 */
export async function extractBookingData(
  conversationHistory: Array<{ role: 'client' | 'assistant'; content: string }>
): Promise<WinBrosBookingData> {
  const transcript = conversationHistory
    .map(m => `${m.role === 'client' ? 'Customer' : 'Mary'}: ${m.content}`)
    .join('\n')

  // Try AI extraction first
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const client = new Anthropic({ apiKey: anthropicKey })

      const response = await client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Extract booking data from this WinBros cleaning service text conversation. Return ONLY a JSON object with these fields (use null for missing data):

{
  "serviceType": "window_cleaning" | "pressure_washing" | "gutter_cleaning" | null,
  "scope": "exterior" | "interior_and_exterior" | null,
  "buildingType": "home" | "commercial" | null,
  "squareFootage": number | null,
  "price": number | null,
  "planType": "one_time" | "biannual" | "quarterly" | null,
  "fullName": "string" | null,
  "firstName": "string" | null,
  "lastName": "string" | null,
  "address": "string" | null,
  "referralSource": "string" | null,
  "preferredDate": "string" | null,
  "email": "string" | null
}

For price: use the price the customer agreed to (the one-time price if they chose one-time, etc.). Look for "$" amounts in Mary's messages.
For address: combine all parts (street, city, state, zip) from the customer's messages.
For email: look for an email address in the customer's messages.

CONVERSATION:
${transcript}

Return ONLY the JSON object, nothing else.`
        }],
      })

      const textContent = response.content.find(block => block.type === 'text')
      const raw = textContent?.type === 'text' ? textContent.text.trim() : ''

      // Parse JSON, handling potential markdown code blocks
      const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
      const parsed = JSON.parse(jsonStr)

      return {
        serviceType: parsed.serviceType || null,
        scope: parsed.scope || null,
        buildingType: parsed.buildingType || null,
        squareFootage: parsed.squareFootage ? Number(parsed.squareFootage) : null,
        price: parsed.price ? Number(parsed.price) : null,
        planType: parsed.planType || null,
        fullName: parsed.fullName || null,
        firstName: parsed.firstName || null,
        lastName: parsed.lastName || null,
        address: parsed.address || null,
        referralSource: parsed.referralSource || null,
        preferredDate: parsed.preferredDate || null,
        email: parsed.email || null,
      }
    } catch (err) {
      console.error('[WinBros] AI booking data extraction failed:', err)
    }
  }

  // Fallback: regex-based extraction
  return extractBookingDataRegex(conversationHistory)
}

/**
 * Fallback regex-based extraction when AI is unavailable.
 */
function extractBookingDataRegex(
  conversationHistory: Array<{ role: 'client' | 'assistant'; content: string }>
): WinBrosBookingData {
  const clientMessages = conversationHistory
    .filter(m => m.role === 'client')
    .map(m => m.content)
  const allText = clientMessages.join(' ')
  const allTextLower = allText.toLowerCase()

  // Service type
  let serviceType: string | null = null
  if (/window\s*clean/i.test(allTextLower)) serviceType = 'window_cleaning'
  else if (/pressure\s*wash/i.test(allTextLower) || /power\s*wash/i.test(allTextLower)) serviceType = 'pressure_washing'
  else if (/gutter/i.test(allTextLower)) serviceType = 'gutter_cleaning'

  // Scope
  let scope: string | null = null
  if (/interior/i.test(allTextLower)) scope = 'interior_and_exterior'
  else if (/exterior/i.test(allTextLower)) scope = 'exterior'

  // Square footage
  let squareFootage: number | null = null
  const sqftMatch = allText.match(/(\d[\d,]+)\s*(?:sq\.?\s*ft|square\s*f(?:ee|oo)t|sqft)/i)
  if (sqftMatch) squareFootage = parseInt(sqftMatch[1].replace(/,/g, ''), 10)

  // Price from assistant messages
  let price: number | null = null
  const assistantMessages = conversationHistory
    .filter(m => m.role === 'assistant')
    .map(m => m.content)
    .join(' ')
  const priceMatches = assistantMessages.match(/One-Time:\s*\$(\d[\d,.]+)/i)
  if (priceMatches) price = parseFloat(priceMatches[1].replace(/,/g, ''))

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

  // Address - look for message after "address" question
  let address: string | null = null
  for (let i = 0; i < conversationHistory.length - 1; i++) {
    if (conversationHistory[i].role === 'assistant' &&
        /address/i.test(conversationHistory[i].content) &&
        !/email/i.test(conversationHistory[i].content)) {
      // Collect all client messages until next assistant message
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

  // Plan type
  let planType: string | null = null
  if (/quarterly/i.test(allTextLower)) planType = 'quarterly'
  else if (/biannual|bi-annual/i.test(allTextLower)) planType = 'biannual'
  else if (/one.?time/i.test(allTextLower)) planType = 'one_time'

  // Preferred date
  let preferredDate: string | null = null
  for (let i = 0; i < conversationHistory.length - 1; i++) {
    if (conversationHistory[i].role === 'assistant' &&
        /preferred date|when|time for us/i.test(conversationHistory[i].content)) {
      const nextClient = conversationHistory.slice(i + 1).find(m => m.role === 'client')
      if (nextClient) {
        preferredDate = nextClient.content.trim()
      }
      break
    }
  }

  // Referral source
  let referralSource: string | null = null
  for (let i = 0; i < conversationHistory.length - 1; i++) {
    if (conversationHistory[i].role === 'assistant' &&
        /how did you find/i.test(conversationHistory[i].content)) {
      const nextClient = conversationHistory.slice(i + 1).find(m => m.role === 'client')
      if (nextClient) {
        referralSource = nextClient.content.trim()
      }
      break
    }
  }

  return {
    serviceType,
    scope,
    buildingType: /commercial/i.test(allTextLower) ? 'commercial' : /home|house|residential/i.test(allTextLower) ? 'home' : null,
    squareFootage,
    price,
    planType,
    fullName,
    firstName,
    lastName,
    address,
    referralSource,
    preferredDate,
    email,
  }
}
