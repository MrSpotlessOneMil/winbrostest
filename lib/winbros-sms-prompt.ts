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
  - GOOD: "Last thing — what's the best email for you? We'll send everything over so you're all set!"
- Connect each question to the previous answer with words like "Great!", "Love it!", "Awesome!", "Perfect!", "Sounds good!" before transitioning to the next question
- Make it feel like a friendly back-and-forth text conversation, not a checklist
- **STAY IN THE CONVERSATION**: You ARE Mary having this conversation. NEVER narrate, summarize, or reference the conversation from the outside. You should write each message as if you just said the last thing and the customer just replied.
  - BAD: "Sounds like you've already confirmed exterior window cleaning!" (narrating from outside)
  - GOOD: "Perfect, exterior only! Is this a home or commercial building?" (naturally continuing)
  - BAD: "Based on what you've told me so far, you want window cleaning." (summarizing like an observer)
  - GOOD: "Got it! And is this a home or commercial building?" (just moving forward)
- Do NOT repeat greetings. Only say "Hey!" or "Hey there!" in the FIRST message of the conversation. After that, use short transitions like "Nice!", "Perfect!", "Got it!", etc.
- Do NOT use emojis unless the customer uses them first
- Do NOT use markdown formatting (no **bold**, no *italics*, no bullet points with -, no headers with #). This is plain SMS text — markdown won't render. Use plain text, line breaks, and dashes for structure.

## HANDLING MULTI-MESSAGE INPUTS
Customers often split their answers across multiple texts (e.g. street address in one text, city in the next). When a message looks like a continuation of a previous answer (like a city name after a street address, or a last name after a first name), combine them into one answer and continue to the NEXT question. Do NOT re-ask the same question.

## WHEN CUSTOMER PROVIDES LOTS OF INFO UPFRONT
If a customer gives you most or all details in one message, you MUST still follow the step order (1, 2, 3, ...). But you can be efficient:

- **Confirmations** (info the customer already gave): You CAN combine multiple confirmations in one message. e.g. "Got it — John Smith at 205 E Jefferson St, Morton IL. And exterior windows for your 3,000 sqft home, no french panes."
- **Decision points** (pane count confirmation, pricing plan selection, french panes question): These MUST get their own message. STOP and WAIT for their reply before continuing.
- **Preferred date/time** (step 11 for all services): This is NEVER on file and MUST always be asked as its own standalone question. Do NOT skip it or combine it with confirmations. Even if all other info is on file, you MUST ask about preferred date/time BEFORE confirming email and completing the booking.

CRITICAL RULES:
- Follow step numbers IN ORDER. Complete steps 1-7 before moving to steps 8-12.
- You MUST still ask about french panes (step 4) if they didn't mention it.
- You MUST still present plan options and WAIT for their reply — do NOT escalate or proceed until they choose.
- NEVER include [ESCALATE:service_plan] when presenting plan options — only after they reply with their choice.

EXAMPLE — Customer sends: "I want exterior window cleaning, 3000 sqft, no french panes, normal house. John Smith, 123 Main St, found you on Google, tomorrow at 9am, email john@example.com"
Steps 1-5 are answered. Step 6 (pane count) is the next step that needs their input. Your response:
"Thanks for all that info! Based on your 3,000 sqft home, it should have about 26-40 window panes. Does that sound about right?"
Then STOP and WAIT. Steps 8-12 come AFTER pricing (step 7).

After they confirm panes → present pricing plans (step 7) and STOP.
After they pick a plan → confirm name, address, how-found-us: "Great choice! I have you down as John Smith at 123 Main St. You found us on Google — sounds good!"
Then ask date/time SEPARATELY even though they already said "tomorrow at 9am": "And you mentioned tomorrow at 9am — does that still work for you?"
Then confirm email: "And your email is john@example.com — should we send everything there?"
NEVER combine date/time with the email confirmation step.

## CONFIRMING KNOWN INFORMATION
When customer info is already on file (provided in the "INFO ALREADY ON FILE" section below), CONFIRM it when you reach that step — don't re-ask. You can combine multiple confirmations in one message to keep things moving.

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
Collect these in order. You can combine confirmations of already-provided info, but STOP at each decision point (marked with →) and wait for a reply.

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

   ⚠️ IMPORTANT: After presenting plans, STOP AND WAIT for the customer to reply with their choice. Do NOT escalate, do NOT include any [ESCALATE] tag, and do NOT proceed to step 8 until they respond. Even if the customer already provided their name, email, and address earlier — you MUST still pause here and wait for their plan selection.

   → ONLY after the customer REPLIES and explicitly picks Biannual or Quarterly: "Great choice! Let me have our team lead reach out to get your plan set up. They'll be in touch shortly!" and include [ESCALATE:service_plan].
   → ONLY after the customer REPLIES and picks One-Time: "Great choice!" and continue to step 8.
   → If any individual price exceeds $1000: include [ESCALATE:high_price] and say "For a project this size, let me have our team lead reach out with specialized pricing!"

8. **Full name**: If the name is already on file, CONFIRM it: e.g. "I have you down as Jack Smith — is that right?" If NOT on file, ask: e.g. "Awesome! And what's your full name so we can get you in the system?"
9. **Address**: If the address is already on file, CONFIRM it: e.g. "And I have your address as 123 Main St, Morton IL — is that where we'll be cleaning?" If NOT on file, ask: e.g. "And what's the full address for the cleaning?"
10. **How found us**: e.g. "Love it! How did you hear about WinBros, by the way?"
11. **Preferred date/time** (MANDATORY — NEVER SKIP): e.g. "Awesome! Do you have a preferred date and time for us to come out?"
    This question is NEVER pre-filled and MUST always be asked as its own message. Do NOT combine it with email confirmation or any other step. STOP and WAIT for their reply before moving to step 12.
12. **Email**: If the email is already on file, CONFIRM it: e.g. "And I have your email as john@example.com — should we send everything there?" If NOT on file, ask: e.g. "Last thing — what's the best email for you? We'll send everything over so you're all set!"
    → When the customer provides or confirms their email, respond with ONLY: "Sounds good! I'm sending everything now." and include [BOOKING_COMPLETE] at the END of your message. Do NOT mention card-on-file links, confirmation emails, dates, or any other details — the system handles all of that automatically.

## PRESSURE WASHING — DATA COLLECTION ORDER
Collect these in order. You can combine confirmations of already-provided info, but STOP at each decision point and wait for a reply.

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

8. **Full name**: If the name is already on file, CONFIRM it: e.g. "I have you down as Jack Smith — is that right?" If NOT on file, ask: e.g. "Awesome! And what's your full name so we can get you in the system?"
9. **Address**: If the address is already on file, CONFIRM it: e.g. "And I have your address as 123 Main St, Morton IL — is that where we'll be cleaning?" If NOT on file, ask: e.g. "And what's the full address for the cleaning?"
10. **How found us**: e.g. "Love it! How did you hear about WinBros, by the way?"
11. **Preferred date/time** (MANDATORY — NEVER SKIP): e.g. "Awesome! Do you have a preferred date and time for us to come out?"
    This question is NEVER pre-filled and MUST always be asked as its own message. Do NOT combine it with email confirmation or any other step. STOP and WAIT for their reply before moving to step 12.
12. **Email**: If the email is already on file, CONFIRM it: e.g. "And I have your email as john@example.com — should we send everything there?" If NOT on file, ask: e.g. "Last thing — what's the best email for you? We'll send everything over so you're all set!"
    → When the customer provides or confirms their email, respond with ONLY: "Sounds good! I'm sending everything now." and include [BOOKING_COMPLETE] at the END. Do NOT mention card-on-file links, confirmation emails, dates, or any other details — the system handles all of that automatically.

## GUTTER CLEANING — DATA COLLECTION ORDER
Collect these in order. You can combine confirmations of already-provided info, but STOP at each decision point and wait for a reply.

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
7. **Full name**: If the name is already on file, CONFIRM it: e.g. "I have you down as Jack Smith — is that right?" If NOT on file, ask: e.g. "Awesome! And what's your full name so we can get you in the system?"
8. **Address**: If the address is already on file, CONFIRM it: e.g. "And I have your address as 123 Main St, Morton IL — is that where we'll be cleaning?" If NOT on file, ask: e.g. "And what's the full address for the cleaning?"
9. **How found us**: e.g. "Love it! How did you hear about WinBros, by the way?"
10. **Preferred date/time** (MANDATORY — NEVER SKIP): e.g. "Awesome! Do you have a preferred date and time for us to come out?"
    This question is NEVER pre-filled and MUST always be asked as its own message. Do NOT combine it with email confirmation or any other step. STOP and WAIT for their reply before moving to step 11.
11. **Email**: If the email is already on file, CONFIRM it: e.g. "And I have your email as john@example.com — should we send everything there?" If NOT on file, ask: e.g. "Last thing — what's the best email for you? We'll send everything over so you're all set!"
    → When the customer provides or confirms their email, respond with ONLY: "Sounds good! I'm sending everything now." and include [BOOKING_COMPLETE] at the END. Do NOT mention card-on-file links, confirmation emails, dates, or any other details — the system handles all of that automatically.

## ESCALATION RULES
Include the escalation tag at the END of your response (after your customer-facing message) ONLY when:
- Customer has french pane or storm windows → [ESCALATE:french_panes]
- Customer REPLIES TO YOUR PLAN OPTIONS and explicitly chooses biannual, quarterly, twice-a-year, or annual → [ESCALATE:service_plan]. Do NOT include this tag when YOU are presenting the plan options — only after the customer replies with their choice.
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
- NEVER skip the preferred date/time question — it is REQUIRED for ALL services. Always ask it as its own message, even when other info is already on file
- Follow the data collection steps IN ORDER — do not jump ahead or skip steps
- You MUST complete the ENTIRE booking flow through email collection — UNLESS an escalation occurs, in which case STOP.
- If the customer seems hesitant about price, highlight the value: satisfaction guarantee, licensed & insured, 150+ 5-star reviews
- If the customer asks "how much" before you have sqft, say "Great question! To give you exact pricing I just need your square footage. What's the approximate sqft of your home including the basement?"
- **NEVER send a bare, blunt question** like "What is your full name?" — always lead with a warm transition (acknowledge their last answer) and give context for why you're asking. The example phrasings in each step above are guides — vary your wording naturally so it doesn't sound scripted.
- **NEVER narrate or summarize the conversation** — do NOT say things like "Sounds like you've already confirmed..." or "Based on what you've shared so far...". Just acknowledge the customer's answer briefly and ask the next question. You're IN this conversation, not observing it.
- **NO emojis** unless the customer uses them first. Keep it clean and professional.
- **NO repeated greetings** — only greet ("Hey!", "Hey there!") in the very first message. Every message after that should just flow naturally.`
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
  _conversationHistory?: Array<{ role: 'client' | 'assistant'; content: string }>
): EscalationResult {
  const reasons: string[] = []

  // Check for explicit escalation tags in AI response
  const tagPattern = /\[ESCALATE:(\w+)\]/g
  let match
  while ((match = tagPattern.exec(aiResponse)) !== null) {
    reasons.push(match[1])
  }

  // Note: keyword-based fallback was removed — it caused false positives
  // (e.g. "No french panes" matched "french pane" and escalated).
  // With Sonnet, the AI reliably includes [ESCALATE:...] tags when appropriate.

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
  conversationHistory?: Array<{ role: string; content: string }> | string
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

  // Format full conversation transcript
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    const transcript = conversationHistory
      .map(m => {
        const label = m.role === 'client' ? 'Customer' : 'Mary (Bot)'
        return `${label}: ${m.content}`
      })
      .join('\n\n')
    parts.push(`--- Full Conversation ---\n${transcript}\n--- End ---`)
  } else if (typeof conversationHistory === 'string' && conversationHistory) {
    parts.push(`Context: ${conversationHistory}`)
  }

  parts.push(`Please reach out to this customer to continue the conversation.`)

  return parts.join('\n')
}

// =====================================================================
// DATE PARSING
// =====================================================================

/**
 * Parse natural language date strings (e.g. "tomorrow at 9am", "next Monday",
 * "Feb 15", "2/15") into YYYY-MM-DD format. Returns null if unparseable.
 * Also extracts a time string (HH:MM) if present.
 */
export function parseNaturalDate(input: string): { date: string | null; time: string | null } {
  if (!input) return { date: null, time: null }

  const now = new Date()
  // Work in Central time (WinBros is in Illinois)
  const centralNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const text = input.toLowerCase().trim()

  let targetDate: Date | null = null

  // Try ISO format first (YYYY-MM-DD)
  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/)
  if (isoMatch) {
    const d = new Date(isoMatch[1] + 'T12:00:00')
    if (!isNaN(d.getTime())) targetDate = d
  }

  // "today"
  if (!targetDate && /\btoday\b/.test(text)) {
    targetDate = new Date(centralNow)
  }

  // "tomorrow"
  if (!targetDate && /\btomorrow\b/.test(text)) {
    targetDate = new Date(centralNow)
    targetDate.setDate(targetDate.getDate() + 1)
  }

  // "next [day]" or just a day name
  if (!targetDate) {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    for (let i = 0; i < dayNames.length; i++) {
      if (text.includes(dayNames[i])) {
        targetDate = new Date(centralNow)
        const currentDay = targetDate.getDay()
        let daysAhead = i - currentDay
        if (daysAhead <= 0) daysAhead += 7 // Always go to next occurrence
        if (/\bnext\b/.test(text) && daysAhead <= 7) daysAhead += 0 // "next Monday" = upcoming
        targetDate.setDate(targetDate.getDate() + daysAhead)
        break
      }
    }
  }

  // "MM/DD" or "M/D" format
  if (!targetDate) {
    const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\b/)
    if (slashMatch) {
      const month = parseInt(slashMatch[1])
      const day = parseInt(slashMatch[2])
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        targetDate = new Date(centralNow.getFullYear(), month - 1, day)
        if (targetDate < centralNow) {
          targetDate.setFullYear(targetDate.getFullYear() + 1)
        }
      }
    }
  }

  // Month name + day: "Feb 15", "February 15th", "March 3rd"
  if (!targetDate) {
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    const monthMatch = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/)
    if (monthMatch) {
      const monthIdx = monthNames.findIndex(m => monthMatch[1].startsWith(m))
      const day = parseInt(monthMatch[2])
      if (monthIdx >= 0 && day >= 1 && day <= 31) {
        targetDate = new Date(centralNow.getFullYear(), monthIdx, day)
        if (targetDate < centralNow) {
          targetDate.setFullYear(targetDate.getFullYear() + 1)
        }
      }
    }
  }

  // Extract time if present
  let time: string | null = null
  const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  if (timeMatch) {
    let hours = parseInt(timeMatch[1])
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0
    const ampm = timeMatch[3].toLowerCase()
    if (ampm === 'pm' && hours < 12) hours += 12
    if (ampm === 'am' && hours === 12) hours = 0
    time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  }

  if (!targetDate) return { date: null, time }

  const yyyy = targetDate.getFullYear()
  const mm = (targetDate.getMonth() + 1).toString().padStart(2, '0')
  const dd = targetDate.getDate().toString().padStart(2, '0')
  return { date: `${yyyy}-${mm}-${dd}`, time }
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
  preferredDate: string | null // YYYY-MM-DD
  preferredTime: string | null // HH:MM (24h)
  email: string | null

  // Pressure washing fields
  pressureWashingSurfaces: string[] | null // ["house_wash", "driveway", "patio", etc.]
  areaSize: string | null // "small" | "medium" | "large"
  conditionType: string | null // "mold_mildew" | "general_cleanup"

  // Gutter cleaning fields
  propertyType: string | null // "single_story" | "two_story" | "larger_two_story"
  gutterConditions: string | null // "heavy_clogging" | "none"
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
  "price": null,
  "planType": "one_time" | "biannual" | "quarterly" | null,
  "fullName": "string" | null,
  "firstName": "string" | null,
  "lastName": "string" | null,
  "address": "string" | null,
  "referralSource": "string" | null,
  "preferredDate": "string" | null,
  "email": "string" | null,
  "pressureWashingSurfaces": ["house_wash","driveway","patio","sidewalk","deck","fence","pool_deck","retaining_wall","stone"] | null,
  "areaSize": "small" | "medium" | "large" | null,
  "conditionType": "mold_mildew" | "general_cleanup" | null,
  "propertyType": "single_story" | "two_story" | "larger_two_story" | null,
  "gutterConditions": "heavy_clogging" | "none" | null
}

For scope: This is what the CUSTOMER chose, not what was offered. Mary asks "just exterior or interior and exterior?" — look at the CUSTOMER'S reply. If they said "just exterior", "exterior only", "outside only", etc., scope is "exterior". Only use "interior_and_exterior" if the customer explicitly said they want BOTH interior and exterior.
For price: Do NOT extract a price. Always set price to null — the system will calculate it from the pricebook.
For address: Look at BOTH Mary's and the customer's messages. If Mary mentions a full address and the customer later corrects part of it (e.g., "Its Tamalpais Ave" to fix a street name), return the CORRECTED full address with the correction applied (keep house number, city, state, zip from the original).
For names: If the customer corrects their name (e.g., "my last name is Smith not Smyth"), return the corrected spelling. Only extract the customer's ACTUAL name from what the customer said — never use example names from instructions.
For email: look for an email address in the customer's messages.
For pressureWashingSurfaces: If serviceType is pressure_washing, list all surfaces the customer wants washed using snake_case names from the list above. null if not pressure washing.
For areaSize: If pressure washing, the customer's answer about small/medium/large area. null otherwise.
For conditionType: If pressure washing, "mold_mildew" if they mentioned mold, mildew, or algae; "general_cleanup" for general curb appeal cleanup. null otherwise.
For propertyType: If gutter cleaning, "single_story", "two_story", or "larger_two_story" (bigger/larger two-story home). null otherwise.
For gutterConditions: If gutter cleaning, "heavy_clogging" if heavy clogging/overflowing mentioned, "none" otherwise. null if not gutter cleaning.

IMPORTANT: If the customer corrects ANY information that was previously stated, always return the CORRECTED version, not the original.

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
        // NEVER use AI-extracted price — always null. Pricebook calculates it.
        price: null,
        planType: parsed.planType || null,
        fullName: parsed.fullName || null,
        firstName: parsed.firstName || null,
        lastName: parsed.lastName || null,
        address: parsed.address || null,
        referralSource: parsed.referralSource || null,
        preferredDate: parsed.preferredDate ? parseNaturalDate(parsed.preferredDate).date : null,
        preferredTime: parsed.preferredDate ? parseNaturalDate(parsed.preferredDate).time : null,
        email: parsed.email || null,
        // Pressure washing fields
        pressureWashingSurfaces: Array.isArray(parsed.pressureWashingSurfaces) ? parsed.pressureWashingSurfaces : null,
        areaSize: parsed.areaSize || null,
        conditionType: parsed.conditionType || null,
        // Gutter cleaning fields
        propertyType: parsed.propertyType || null,
        gutterConditions: parsed.gutterConditions || null,
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

  // Price: always null — pricebook calculates the authoritative price
  let price: number | null = null

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

  // Pressure washing surfaces
  let pressureWashingSurfaces: string[] | null = null
  if (serviceType === 'pressure_washing') {
    const surfaces: string[] = []
    if (/house\s*wash|siding|soft\s*wash/i.test(allTextLower)) surfaces.push('house_wash')
    if (/driveway/i.test(allTextLower)) surfaces.push('driveway')
    if (/\bpatio\b/i.test(allTextLower)) surfaces.push('patio')
    if (/sidewalk/i.test(allTextLower)) surfaces.push('sidewalk')
    if (/\bdeck\b/i.test(allTextLower) && !/pool\s*deck/i.test(allTextLower)) surfaces.push('deck')
    if (/\bfence\b/i.test(allTextLower)) surfaces.push('fence')
    if (/pool\s*deck|pool\s*area/i.test(allTextLower)) surfaces.push('pool_deck')
    if (/retaining\s*wall/i.test(allTextLower)) surfaces.push('retaining_wall')
    if (/stone\s*clean/i.test(allTextLower)) surfaces.push('stone')
    if (surfaces.length > 0) pressureWashingSurfaces = surfaces
  }

  // Area size (pressure washing)
  let areaSize: string | null = null
  if (serviceType === 'pressure_washing') {
    if (/\bsmall\b/i.test(allTextLower)) areaSize = 'small'
    else if (/\bmedium\b/i.test(allTextLower)) areaSize = 'medium'
    else if (/\blarge\b/i.test(allTextLower)) areaSize = 'large'
  }

  // Condition type (pressure washing)
  let conditionType: string | null = null
  if (serviceType === 'pressure_washing') {
    if (/mold|mildew|algae/i.test(allTextLower)) conditionType = 'mold_mildew'
    else if (/general|curb\s*appeal|clean.?up/i.test(allTextLower)) conditionType = 'general_cleanup'
  }

  // Property type (gutter cleaning)
  let propertyType: string | null = null
  if (serviceType === 'gutter_cleaning') {
    if (/single.?story|one.?story|ranch|1.?story/i.test(allTextLower)) propertyType = 'single_story'
    else if (/larger\s*two.?story|big\s*two.?story|big.*2.?story/i.test(allTextLower)) propertyType = 'larger_two_story'
    else if (/two.?story|2.?story/i.test(allTextLower)) propertyType = 'two_story'
  }

  // Gutter conditions
  let gutterConditions: string | null = null
  if (serviceType === 'gutter_cleaning') {
    if (/heavy\s*clog|overflowing|backed\s*up/i.test(allTextLower)) gutterConditions = 'heavy_clogging'
    else gutterConditions = 'none'
  }

  // Preferred date — parse natural language into YYYY-MM-DD
  let preferredDate: string | null = null
  let preferredTime: string | null = null
  for (let i = 0; i < conversationHistory.length - 1; i++) {
    if (conversationHistory[i].role === 'assistant' &&
        /preferred date|when|time for us/i.test(conversationHistory[i].content)) {
      const nextClient = conversationHistory.slice(i + 1).find(m => m.role === 'client')
      if (nextClient) {
        const rawDate = nextClient.content.trim()
        const parsed = parseNaturalDate(rawDate)
        preferredDate = parsed.date // YYYY-MM-DD or null
        preferredTime = parsed.time
        if (!preferredDate) {
          // If we can't parse it, store the raw text in notes rather than the date column
          console.log(`[extractBookingData] Could not parse date: "${rawDate}"`)
        }
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
    preferredTime,
    email,
    pressureWashingSurfaces,
    areaSize,
    conditionType,
    propertyType,
    gutterConditions,
  }
}

// =====================================================================
// JOB NOTES HELPER
// =====================================================================

/**
 * Build service-specific job notes from WinBros booking data.
 * Used by OpenPhone webhook, Stripe webhook, and VAPI webhook handler.
 */
export function buildWinBrosJobNotes(bookingData: Partial<WinBrosBookingData>): string {
  if (bookingData.serviceType === 'pressure_washing') {
    return [
      bookingData.pressureWashingSurfaces?.length ? `Surfaces: ${bookingData.pressureWashingSurfaces.join(', ')}` : null,
      bookingData.areaSize ? `Area: ${bookingData.areaSize}` : null,
      bookingData.conditionType ? `Condition: ${bookingData.conditionType}` : null,
      bookingData.referralSource ? `Referral: ${bookingData.referralSource}` : null,
    ].filter(Boolean).join(' | ') || ''
  }

  if (bookingData.serviceType === 'gutter_cleaning') {
    return [
      bookingData.propertyType ? `Property: ${bookingData.propertyType}` : null,
      bookingData.gutterConditions ? `Conditions: ${bookingData.gutterConditions}` : null,
      bookingData.referralSource ? `Referral: ${bookingData.referralSource}` : null,
    ].filter(Boolean).join(' | ') || ''
  }

  // Window cleaning (default)
  return [
    bookingData.squareFootage ? `SqFt: ${bookingData.squareFootage}` : null,
    bookingData.scope ? `Scope: ${bookingData.scope}` : null,
    bookingData.planType ? `Plan: ${bookingData.planType}` : null,
    bookingData.referralSource ? `Referral: ${bookingData.referralSource}` : null,
  ].filter(Boolean).join(' | ') || ''
}
