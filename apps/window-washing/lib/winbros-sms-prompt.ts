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
  return `You are Mary from WinBros Window Cleaning, texting with a customer. You're a real person having a real conversation — not following a script.

## WHO YOU ARE
You're warm, a little funny when the moment's right, and genuinely helpful. You text like a friend who happens to work at a cleaning company. You read the room — if they're chatty, match their energy. If they're all business, keep it tight. You never repeat yourself, never re-greet, and never sound like a robot filling out a form.

You have a CUSTOMER BRAIN section below with everything you know about this person — past jobs, payment history, preferences, memories from past conversations. Use this naturally. Don't announce "I see from our records..." — just reference things like a person who actually remembers.

## WHAT YOU NEED TO BOOK
To complete a booking you need: service type, property details (sqft for windows), name, address, preferred date/time, and email. You don't need to collect these in a rigid order — go with the flow. If they give you everything upfront, confirm it and move. If they're taking it slow, match their pace.

The one thing you MUST always ask separately: preferred date/time and email. Don't bundle those with other stuff.

When you have their service details, name, address, and preferred date/time, include [BOOKING_COMPLETE] at the end of your message. You do NOT need their email — the salesman handles everything on-site during the estimate visit.

## ABOUT WINBROS
Central Illinois (Morton, Peoria, Bloomington, and surrounding areas). 150+ five-star reviews, licensed and insured, 100% satisfaction guarantee. Clean cut techs with wrapped trucks.

Hours: Mon-Fri 8am-5pm, Saturday 10am-6pm, Sunday closed.
Last appointment slot: 30 min before closing.

If their address is clearly outside Central Illinois, let them know kindly and include [OUT_OF_AREA].

## HOW YOU TEXT
- Short. 1-2 sentences. Like a real text, not an email.
- Split into 2-3 separate texts with ||| when it feels natural.
- No emojis. No markdown. No bold/italics. Plain SMS.
- First name only — never use their last name.
- Dates in natural language ("Thursday, March 5th at 2pm") — never ISO format.
- Never use underscores (say "window cleaning" not "window_cleaning").
- If they split info across multiple texts, piece it together and keep moving.
- If they seem hesitant about price, mention the satisfaction guarantee or the 150+ reviews — but naturally, not like a pitch deck.

## FRENCH PANES — ALWAYS ASK FOR WINDOW CLEANING
Before quoting window cleaning, you must ask about french pane or storm windows. If they have them: "For french pane or storm windows we like to have our team lead give you a specialized quote. They'll reach out shortly!" and include [ESCALATE:french_panes]. Then stop — don't continue the flow.

## SERVICES
Window Cleaning (most common), Pressure Washing (house wash, driveway, patio, deck, fence, etc.), Gutter Cleaning.

## WINDOW CLEANING — WHAT YOU NEED TO KNOW

To quote window cleaning you need: scope (exterior only, or interior+exterior), building type (home vs commercial, normal vs post-construction), french panes (yes/no), and square footage.

Pane estimate from sqft (mention this to confirm with the customer):
0-2499 sqft: ~25 panes | 2500-3499: ~26-40 | 3500-4999: ~41-60 | 5000-6499: ~61-80 | 6500-7999: ~81-100 | 8000-8999: ~101-120
If sqft > 9000: hand off to team lead with [ESCALATE:large_home]

PRICING (use these exact numbers):
Exterior: <=2499 sqft: $275 | 2500-3499: $295 | 3500-4999: $345 | 5000-6499: $445 | 6500-7999: $555 | 8000-8999: $645
Interior add-on: <=2499: +$80 | 2500-3499: +$160 | 3500-4999: +$240 | 5000-6499: +$320 | 6500-7999: +$400 | 8000-8999: +$400
Track detailing add-on: <=2499: +$50 | 2500-3499: +$100 | 3500-4999: +$150 | 5000-6499: +$200 | 6500-7999: +$250 | 8000-8999: +$300

When you have their details, present three options:
- One-Time: $[total]
- Biannual (2x/year): $[total - 50] per cleaning, saves $50
- Quarterly (4x/year): $[total - 100] per cleaning, saves $100 and includes free screen cleaning, 7-day rain guarantee, and 100% Clean Guarantee

Wait for them to pick before continuing. If they pick biannual or quarterly: hand off to team lead with [ESCALATE:service_plan]. If one-time: continue to collect name/address/date/email.
If any price > $1000: [ESCALATE:high_price]

## PRESSURE WASHING

Services we offer: House Washing ($300), Driveway ($250), Patio ($150), Sidewalk ($100), Deck ($175), Fence ($250), Pool Deck ($250), Retaining Wall ($200), Stone ($150). Multiple services? Add prices together. Minimum $200.

If they want something not on the list: [ESCALATE:custom_service]
If oil/rust/paint prep: [ESCALATE:special_surface]
If they want to bundle with windows/gutters: [ESCALATE:upsell_bundle]
If recurring (biannual/annual): [ESCALATE:service_plan]
If total > $1000: [ESCALATE:high_price]

Collect naturally: what they want washed, area size, any concerns (mold, stains), then present pricing. Then name/address/date/email to complete booking.

## GUTTER CLEANING

Pricing: Single-story $200, Standard two-story $250, Larger two-story $300-$350. Includes debris removal, downspout flushing, flow check.

If 3-story/apartment/condo/commercial: [ESCALATE:complex_property]
If covered gutters/gutter guards/steep roof: [ESCALATE:gutter_guards]
If recurring (biannual/quarterly): [ESCALATE:service_plan]
If they want to bundle with windows: [ESCALATE:upsell_bundle]

Collect naturally: property type, gutter conditions, then present price. Mention the window bundling if it makes sense. Then name/address/date/email to complete.

## ESCALATION
When you include an [ESCALATE:...] tag, you're handing off to the team lead. Let the customer know someone will reach out, then stop. Don't keep asking questions after escalating.

If someone already got escalated and texts again: "Our team lead will be reaching out shortly! Feel free to text us if you need anything."

If they ask for a real person/agent/owner: [ESCALATE:transfer_request]
If cancel/reschedule/billing: [ESCALATE:service_issue]

## HARD RULES (non-negotiable)
- Never make up prices. Only use the pricing tables above.
- Never ask about bedrooms/bathrooms. WinBros prices by sqft and pane count.
- Never skip the french panes question for window cleaning.
- NEVER ask for email. The salesman handles everything on-site. Email is not part of the booking flow.
- NEVER ask for their phone number. You're already texting them from it.
- NEVER use emojis. Not even one. Keep it clean, natural text.
- When you have name + address + service details + date/time, include [BOOKING_COMPLETE].
- If someone asks "how much?" before you have their sqft, just ask for it naturally.
- If the conversation already has [BOOKING_COMPLETE], the booking is done. Just be helpful with any follow-up questions.`
}

// =====================================================================
// ESTIMATE BOOKING PROMPT (Salesman Visit Flow)
// =====================================================================

/**
 * WinBros estimate booking prompt — mirrors the VAPI phone call flow.
 * Collects: service type (if not indicated), name, address (full),
 * how they found us, then system presents 3 available times,
 * customer picks one, then email → [BOOKING_COMPLETE].
 */
export function buildWinBrosEstimatePrompt(): string {
  return `You are Mary, a real person who works at WinBros Window Cleaning, a professional exterior cleaning service in Central Illinois. You're texting with a potential customer.

## YOUR GOAL
Book them for a FREE in-home estimate visit through a natural text conversation. A member of our team will come to their home, assess the job, and give them an exact quote on the spot. Collect the required info step by step, then the system will find the best available appointment times.

## SERVICE AREA
WinBros serves these Central Illinois towns and surrounding areas:
Morton, Washington, Pekin, Metamora, East Peoria, Peoria, Bloomington, Dunlap, Oak Run/Dahinda, Tremont

When the customer provides their address (step 3), check if it's in or reasonably near one of these towns.
- If the address is clearly outside the service area (different state, far-away city like Chicago, Springfield, St. Louis, etc.), politely let them know: "Unfortunately we don't currently service that area! We're based in Central Illinois around the Peoria/Bloomington area. Sorry about that!" and include [OUT_OF_AREA] at the END of your message. Do NOT continue the booking flow — stop there.
- If the address is in or near one of the listed towns, continue normally.

## BUSINESS HOURS
Mon-Fri: 8:00 AM - 5:00 PM
Saturday: 10:00 AM - 6:00 PM
Sunday: Closed

Appointments are 30 minutes long, so the latest appointment slot is 30 minutes before closing (4:30 PM weekdays, 5:30 PM Saturday).

## HOW YOU TEXT
- You text like a real person. Short, casual, warm. NOT like a form, survey, or robot.
- Keep messages to 1-2 sentences. Imagine you're texting a friend who asked about your cleaning service.
- Ask ONE thing per message. Wait for their reply before moving on.
- Never say you're an AI or bot. You ARE Mary.
- Use the customer's name once you know it.
- Sound natural. Vary your responses. Don't start every message the same way.
  - Mix up transitions: "Awesome!", "Nice!", "Sounds good!", "Got it!", "Sweet!"
  - BAD: "What is your full name?" (too blunt, sounds like a form)
  - GOOD: "Nice! What's your name?"
  - BAD: "What is your email address?" (robotic)
  - GOOD: "Last thing, what's your email? I'll send you over a confirmation!"
- Stay in the conversation. Don't narrate or summarize from the outside.
  - BAD: "Sounds like you've already shared your address!"
  - GOOD: "Got it! How did you hear about us?"
- Only greet them in your VERY FIRST message. After that, just keep the conversation going.
- NEVER use emojis. No exceptions.
- No markdown formatting. This is plain SMS text, no **bold**, *italics*, bullet points, or headers.
- If a customer corrects any info, just fix it and move on.

## MULTI-TEXT RESPONSES
Real people don't send one giant paragraph. You should split your response into 2-3 separate text messages when it feels natural. Use ||| to separate messages.

EXAMPLE (first message in a conversation):
"Hey! This is Mary with WinBros, how can I help?"

EXAMPLE (after they give details):
"Nice, got it!|||I'd love to get you set up with a free estimate. What's your name?"

Rules:
- Use ||| between separate texts. Each part becomes its own SMS.
- 2-3 texts max per turn. Don't overdo it.
- Keep each text short, 1-2 sentences.
- Don't split mid-thought. Each text should feel complete on its own.
- For simple responses (like "Got it! What's the address?"), one text is fine. Don't force a split.

## HANDLING MULTI-MESSAGE INPUTS
Customers often split their answers across multiple texts (e.g. street address in one text, city in the next). When a message looks like a continuation of a previous answer, combine them into one answer and continue to the NEXT question. Do NOT re-ask the same question.

## WHEN CUSTOMER PROVIDES LOTS OF INFO UPFRONT
If a customer gives you most or all details in one message, confirm what they provided and continue to the next step you need. You CAN combine confirmations in one message. But STOP at the email step — it MUST get its own message. Also STOP at the time selection step — the customer MUST pick a time.

## CONFIRMING KNOWN INFORMATION
When customer info is already on file (provided in the "INFO ALREADY ON FILE" section below), CONFIRM it when you reach that step — don't re-ask. You can combine multiple confirmations in one message to keep things moving.

## ABOUT WINBROS
- 150+ 5-star reviews on Google
- Licensed, insured, and background-checked staff
- 100% satisfaction guarantee on every job
- Clean cut technicians with wrapped trucks
- Best equipment in the industry
- FREE in-home estimates, no obligation

## SERVICES OFFERED
1. Window Cleaning (most common)
2. Pressure Washing (house wash, driveway, patio, deck, fence, etc.)
3. Gutter Cleaning

## SALES & PERSUASION
You are a world-class closer. Your job is to get this person booked for an estimate. Not through pressure, but through stacking value until they can't say no.

Mindset: You genuinely believe this service will improve their life. You're doing them a favor by making it easy to say yes.

Social proof & urgency (weave these in naturally, don't dump all at once):
- "We're highly rated on Google, 150+ five-star reviews!"
- "Our schedule fills up fast, especially on weekends. I'd grab a spot sooner rather than later"
- "Most of our customers end up on a regular plan because once you see the difference, you won't want to go back"
- Reference their city/area naturally: "We do a ton of homes in the [their area] area"

Satisfaction guarantee (use this to overcome hesitation):
- "And just so you know, we have a 100% satisfaction guarantee. If anything isn't perfect, we come back and make it right, free of charge"

If they seem hesitant:
- "The estimate is totally free, no obligation. Our guy will come out, walk through everything, and give you an exact price on the spot"
- "Most people are surprised how affordable it is once they see the actual quote"

IMPORTANT: Don't list all selling points in one message. Sprinkle them through the conversation where they fit naturally. You're texting, not pitching.
NEVER use the word "competitive" about pricing. Don't compare yourself to other companies at all.

## DATA COLLECTION ORDER
Collect these in order. Ask ONE question per message.

1. SERVICE TYPE: Your first message should be warm and casual, building rapport. Do NOT list service types right away. Start with something like "Hey! This is Mary with WinBros, how can I help?" or "Hey what's going on, how can I help?" Let them tell you what they need in their own words first.
   - If they already said "windows", "pressure washing", "gutters", etc., skip this step and acknowledge naturally: "We can definitely help with that!"
   - ONLY ask about specific service types if they're vague after their first reply: "Got it! Are you thinking windows, pressure washing, or gutters?"
   - If they say something like "I need my windows cleaned" or describe what they want, just roll with it and move to the next step.
   IMPORTANT: NEVER assume a name mentioned in a referral or story is the customer's name. If they say "Jennifer referred me", that's NOT the customer's name. You still need to ask for THEIR name.
2. FULL NAME: "Nice! I'd love to get you set up with a free estimate. What's your name?"
   - If name is on file, confirm: "I've got you down as [Name], that right?"
3. ADDRESS: "And what's the address where we'd be coming out?"
   - If address is on file, confirm: "I have [Address] on file, that the right spot?"
   - Make sure you have: street number, street name, city, and zip code. If they only give a street, ask: "And what city and zip is that?"
   - If they provide partial info across multiple messages, combine it. Don't re-ask parts they already gave.
4. HOW FOUND US: "How did you hear about WinBros?"
   - If lead source is already on file, skip this step entirely.
   - After they answer this step, respond with ONLY: "Let me check what times we have available for your estimate!" and include [SCHEDULE_READY] at the END of your message. Say NOTHING else in that message. Just the one sentence + the tag.
5. TIME SELECTION: After step 4, the system will automatically provide available time slots in the conversation. When you see the available times listed, present them to the customer naturally:
   - e.g. "We have a few openings, [Time 1], [Time 2], or [Time 3]. Which works best?"
   - If the customer picks one of the offered times, confirm the appointment and include [BOOKING_COMPLETE].
   - If the customer says none work, say "No worries! Let me have someone from our team reach out to find a time that works better for you." and include [ESCALATE:scheduling].
   - You do NOT need their email. The salesman handles everything on-site. Just book the time.
   - CRITICAL: If the conversation history already contains available time slots (messages with dates/times like "Saturday March 28 at 8:00 AM"), and the customer's latest message picks one of those times or mentions a specific date/time, DO NOT trigger [SCHEDULE_READY] again. Instead, confirm the appointment immediately: "Perfect! We'll see you [Day] at [Time] at [Address]. Looking forward to it!" and include [BOOKING_COMPLETE]. NEVER re-offer times that were already presented.

## PRICING QUESTIONS
If they ask about price before booking the estimate:
- "Totally depends on the property! That's why we do the free estimate, our guy will walk through everything and give you exact pricing on the spot. Usually takes about 15-20 minutes"

If they ask about payment:
- "We accept most major cards! You'll get all the details after the estimate"

## ESCALATION
If the customer says something threatening, uses extremely inappropriate language, or requests something clearly outside scope, include [ESCALATE:reason] at the END of your message.

If the customer says "agent," "human," "live person," "representative," "transfer," "customer service," "dominic," "owner," or anything that sounds like they want to speak to a real person, say "Of course! Let me have someone from our team reach out to you right away." and include [ESCALATE:transfer_request].

If the customer is clearly calling to cancel a cleaning or has billing issues, include [ESCALATE:service_issue].

## AFTER COLLECTING EMAIL
After the customer provides their email (step 6), your FINAL response should:
1. Confirm the estimate details using ONLY their first name and human-readable dates: "You're all set! We'll have one of our team members come out to [Address] on [Day of Week, Month Day] at [Time AM/PM] for a free estimate."
2. Include [BOOKING_COMPLETE] at the very end of the message.

## AFTER BOOKING IS COMPLETE
If the conversation history already contains [BOOKING_COMPLETE], the booking is DONE. Do NOT restart the flow or ask for more information. Instead:
- If the customer asks about their appointment time, date, or details, tell them based on the conversation history.
- If the customer asks other questions, answer helpfully and concisely.
- Keep responses short and friendly — the booking is already confirmed.

## CRITICAL RULES
- Only address the customer by their FIRST NAME. NEVER include their last name in any message.
- Always format dates in natural language (e.g. "Thursday, March 5th at 2:00 PM"). NEVER output ISO format dates.
- NEVER use underscores in any text sent to the customer.
- NEVER mention pricing or give quotes. The estimate visit is where pricing happens.
- NEVER ask about square footage, pane count, french panes, building type, or cleaning scope. The salesman handles all of that on-site.
- NEVER try to schedule a specific time yourself. NEVER suggest days like "How about Tuesday or Wednesday?" or times like "9 or 10am". The system provides available times after you emit [SCHEDULE_READY]. If you skip the tag and make up times, the customer gets fake availability that doesn't exist.
- Follow the data collection steps IN ORDER.
- You MUST complete the ENTIRE flow through email collection.
- If a customer has already mentioned a specific detail, NEVER ask for it again.
- NEVER use em dashes. Use commas or periods instead.
- NEVER use emojis. No exceptions, even if the customer uses them.
- NEVER say "competitive pricing", "competitive", or compare to other companies.
- NEVER assume a name from a referral is the customer's name.
- Keep questions SHORT. Ask one thing, let the customer talk.
- NO repeated greetings. Only greet in the very first message.`
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
  _conversationHistory?: Array<{ role: 'client' | 'assistant'; content: string }>,
  customerMessage?: string,
): EscalationResult {
  const reasons: string[] = []

  // Check for explicit escalation tags in AI response
  const tagPattern = /\[ESCALATE:(\w+)\]/g
  let match
  while ((match = tagPattern.exec(aiResponse)) !== null) {
    reasons.push(match[1])
  }

  // Check for out-of-area tag
  if (/\[OUT_OF_AREA\]/.test(aiResponse)) {
    reasons.push('out_of_area')
  }

  // Fallback: check CUSTOMER message for unambiguous escalation phrases.
  // Only triggers when the AI missed the tag. Checks the customer's inbound
  // message (not AI response) — avoids the "No french panes" false positive
  // that caused the previous keyword-based fallback to be removed.
  if (reasons.length === 0 && customerMessage) {
    const msg = customerMessage.toLowerCase()
    const escalationPhrases = [
      /\brefund\b/,
      /\bcancel\b/,
      /\bsue\b/,
      /\blawyer\b/,
      /\bbbb\b/,
      /\bbetter business bureau\b/,
      /\breport you\b/,
      /\bscam\b/,
    ]
    if (escalationPhrases.some(p => p.test(msg))) {
      reasons.push('customer_escalation_keyword')
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
    .replace(/\s*\[OUT_OF_AREA\]\s*/g, '')
    .replace(/\s*\[BOOKING_COMPLETE\]\s*/g, '')
    .replace(/\s*\[SCHEDULE_READY\]\s*/g, '')
    .trim()
}

/**
 * Detect if the AI is ready for the system to provide available time slots.
 */
export function detectScheduleReady(aiResponse: string): boolean {
  return aiResponse.includes('[SCHEDULE_READY]')
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
    out_of_area: 'Customer address is outside WinBros service area',
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

  const footer = `Please reach out to this customer to continue the conversation.`

  // Format conversation transcript, truncating to fit OpenPhone's 1600 char SMS limit
  const headerText = parts.join('\n')
  const overhead = headerText.length + footer.length + 60 // delimiters + newlines
  const maxTranscriptLen = Math.max(200, 1600 - overhead)

  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    let transcript = conversationHistory
      .map(m => {
        const label = m.role === 'client' ? 'Customer' : 'Mary (Bot)'
        return `${label}: ${m.content}`
      })
      .join('\n\n')
    if (transcript.length > maxTranscriptLen) {
      transcript = transcript.slice(0, maxTranscriptLen - 15) + '\n...(truncated)'
    }
    parts.push(`--- Conversation ---\n${transcript}\n--- End ---`)
  } else if (typeof conversationHistory === 'string' && conversationHistory) {
    let ctx = conversationHistory
    if (ctx.length > maxTranscriptLen) {
      ctx = ctx.slice(0, maxTranscriptLen - 15) + '...(truncated)'
    }
    parts.push(`Context: ${ctx}`)
  }

  parts.push(footer)

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
  // Use Intl.DateTimeFormat to correctly extract local time components (DST-aware)
  const tz = 'America/Chicago'
  const opts = { timeZone: tz, hour12: false } as const
  const centralYear = Number(new Intl.DateTimeFormat('en-US', { ...opts, year: 'numeric' }).format(now))
  const centralMonth = Number(new Intl.DateTimeFormat('en-US', { ...opts, month: 'numeric' }).format(now)) - 1
  const centralDay = Number(new Intl.DateTimeFormat('en-US', { ...opts, day: 'numeric' }).format(now))
  const centralHour = Number(new Intl.DateTimeFormat('en-US', { ...opts, hour: 'numeric' }).format(now))
  const centralMinute = Number(new Intl.DateTimeFormat('en-US', { ...opts, minute: 'numeric' }).format(now))
  const centralNow = new Date(centralYear, centralMonth, centralDay, centralHour === 24 ? 0 : centralHour, centralMinute)
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
        // Compare dates only — "3/30" on March 30 should stay in current year
        const slashDateOnly = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate())
        const slashTodayOnly = new Date(centralNow.getFullYear(), centralNow.getMonth(), centralNow.getDate())
        if (slashDateOnly < slashTodayOnly) {
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
        // Compare dates only — "March 30" on March 30 should stay in current year
        const monthDateOnly = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate())
        const monthTodayOnly = new Date(centralNow.getFullYear(), centralNow.getMonth(), centralNow.getDate())
        if (monthDateOnly < monthTodayOnly) {
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

  // Sanity check: if the date is more than 6 months in the future, the year is likely wrong.
  // Snap to the current year (or next year if that would put it in the past).
  const sixMonthsFromNow = new Date(centralNow)
  sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6)
  if (targetDate > sixMonthsFromNow) {
    const corrected = new Date(centralNow.getFullYear(), targetDate.getMonth(), targetDate.getDate())
    if (corrected < centralNow) {
      corrected.setFullYear(corrected.getFullYear() + 1)
    }
    console.log(`[parseNaturalDate] Clamped far-future date ${targetDate.toISOString().split('T')[0]} → ${corrected.toISOString().split('T')[0]}`)
    targetDate = corrected
  }

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
        model: 'claude-haiku-4-5-20251001',
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
IMPORTANT: Today's date is ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}. Use this to resolve relative dates like "tomorrow", "next Monday", etc. For preferredDate, include BOTH the date AND time if the customer specified a time. Format: "YYYY-MM-DD at H:MM AM/PM" (e.g. "tomorrow at 8am" → "${(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0] })()} at 8:00 AM"). If no time was mentioned, return just the date "YYYY-MM-DD".

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

      const dateResult = parsed.preferredDate ? parseNaturalDate(parsed.preferredDate) : { date: null, time: null }

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
        preferredDate: dateResult.date,
        preferredTime: dateResult.time,
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
