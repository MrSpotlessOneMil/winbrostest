/**
 * House Cleaning SMS Responder — Operation Beat Human
 *
 * Co-located with the webhook route so Turbopack always picks it up.
 * Replaces the broken dynamic-import pipeline in packages/core/src/auto-response.ts.
 *
 * This file owns:
 * 1. The system prompt (inline, no imports)
 * 2. Brain chunk loading (direct Supabase query)
 * 3. Claude API call
 * 4. Sanitization (emojis, email, dashes, markdown)
 * 5. Auto-split long messages
 */

import Anthropic from '@anthropic-ai/sdk'
import { buildIntakeSnapshot, decideIntake } from '@/lib/intake-state-machine'
import { stripCurrencyForQuoteSend, computeRapportGate } from '@/lib/auto-response'

// ── Types ──

interface HCResponderInput {
  message: string
  tenant: {
    id: string
    slug: string
    name: string
    business_name?: string | null
    business_name_short?: string | null
    sdr_persona?: string | null
    service_area?: string | null
    owner_phone?: string | null
    timezone?: string | null
  }
  conversationHistory: Array<{ role: 'client' | 'assistant'; content: string }>
  customer?: {
    id: number
    first_name?: string | null
    last_name?: string | null
    email?: string | null
    address?: string | null
    notes?: string | null
    bedrooms?: number | null
    bathrooms?: number | null
    /** Build 1 #2: rapport-first state. NULL = AI must send rapport before quote. */
    pre_quote_rapport_sent_at?: string | null
    /** Build 1 #3: takeover hold. AI does NOT respond if in the future. */
    human_takeover_until?: string | null
  } | null
  knownInfo?: {
    firstName?: string | null
    address?: string | null
    bedrooms?: number | null
    bathrooms?: number | null
    serviceType?: string | null
    frequency?: string | null
    estimatedPrice?: number | null
  } | null
  customerContext?: {
    totalJobs: number
    totalSpend: number
    activeJobs: Array<{ service_type?: string | null; date?: string | null; status: string }>
    recentJobs: Array<{ service_type?: string | null; price?: number | null; completed_at?: string | null }>
  } | null
  isRetargetingReply?: boolean
  isReturningCustomer?: boolean
  supabaseClient: any
}

interface HCResponderResult {
  response: string
  shouldSend: boolean
  reason: string
  bookingComplete?: boolean
  escalation?: { shouldEscalate: boolean; reasons: string[] }
  /**
   * True when this turn is the rapport / value-build message that fires once
   * per lead lifecycle BEFORE the quote link. Webhook caller must stamp
   * customers.pre_quote_rapport_sent_at when this is true.
   * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md (Build 1 #2)
   */
  rapportSent?: boolean
}

// ── Sanitizer ──

function sanitize(text: string): string {
  let c = text
  // Strip emojis
  c = c.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}]/gu, '')
  // Em/en dashes
  c = c.replace(/\u2014/g, ',').replace(/\u2013/g, '-')
  // Markdown
  c = c.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '').replace(/^[-*+]\s+/gm, '')
  // Strip email sentences
  if (c.toLowerCase().includes('email')) {
    const sentences = c.split(/(?<=[.!?])\s+/)
    c = sentences.filter(s => !s.toLowerCase().includes('email')).join(' ')
  }
  // Whitespace
  c = c.replace(/  +/g, ' ').replace(/ +\n/g, '\n').trim()
  return c
}

function autoSplit(text: string, max = 200): string {
  if (text.includes('|||') || text.length <= max) return text
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g)
  if (!sentences || sentences.length <= 1) return text
  const chunks: string[] = []
  let cur = ''
  for (const s of sentences) {
    if (cur.length + s.length > max && cur.length > 0) { chunks.push(cur.trim()); cur = s }
    else cur += s
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks.slice(0, 3).join('|||')
}

// ── Brain Loading ──

async function loadBrainChunks(client: any, message: string): Promise<string[]> {
  try {
    const { data } = await client
      .from('brain_chunks')
      .select('chunk_text')
      .in('domain', ['sales', 'operations', 'marketing'])
      .limit(5)
    return (data || []).map((c: any) => c.chunk_text).filter(Boolean)
  } catch {
    return []
  }
}

async function loadWinningPatterns(client: any, tenantId: string): Promise<string[]> {
  try {
    const { data } = await client
      .from('conversation_outcomes')
      .select('conversation_summary, patterns')
      .eq('tenant_id', tenantId)
      .eq('outcome', 'won')
      .order('created_at', { ascending: false })
      .limit(5)
    return (data || []).map((o: any) => {
      const summary = o.conversation_summary || ''
      const tactics = o.patterns?.winning_tactics || []
      return tactics.length ? `${summary} (tactics: ${tactics.join(', ')})` : summary
    }).filter(Boolean)
  } catch {
    return []
  }
}

async function loadPricing(client: any, tenantId: string): Promise<string> {
  try {
    const { data } = await client
      .from('pricing_tiers')
      .select('service_type, bedrooms, bathrooms, price')
      .eq('tenant_id', tenantId)
      .order('service_type')
      .order('bedrooms')
      .order('bathrooms')
    if (!data?.length) return ''
    const lines: string[] = ['VERIFIED PRICING (use these EXACT numbers):']
    let currentType = ''
    for (const row of data) {
      if (row.service_type !== currentType) {
        currentType = row.service_type
        lines.push(`  ${currentType.toUpperCase()}:`)
      }
      lines.push(`    ${row.bedrooms} bed / ${row.bathrooms} bath: $${row.price}`)
    }
    return lines.join('\n')
  } catch {
    return ''
  }
}

// ── Prompt Builder ──

function buildSystemPrompt(tenant: HCResponderInput['tenant']): string {
  const name = tenant.business_name_short || tenant.business_name || tenant.name
  const sdr = tenant.sdr_persona || 'Sarah'
  const area = tenant.service_area || 'your area'

  return `You are ${sdr}. You work at ${name}. You text customers about house cleaning in ${area}.

ABSOLUTELY NEVER DO THESE (your message gets blocked):
- Emojis. Zero. None.
- Em dashes
- Markdown
- Ask for email, address, name, or sqft
- Offer discounts or lower prices
- Send more than ONE message per turn

HOW YOU TEXT:
You send ONE short text. Then you SHUT UP and wait for them to reply. This is a conversation, not a pitch. You never send 2 messages in a row. You never combine price + trust + booking offer in one message. You respond to what THEY said, not to your script.

Look at how real people text:
- "Hey! How many bedrooms and bathrooms?" (that's the whole text. send it. wait.)
- "Nice, a standard clean for that is $362. We're insured and background-checked." (that's one text. wait for their reaction.)
- "Want me to send your booking options? No charge until after the job." (only after they say ok/sounds good/yes)

Study the conversation history below. Match the customer's vibe. If they text short, you text short. If they text long, you can go a little longer. But never more than 2 sentences.

THE FLOW:
Each of these is ONE text, sent on separate turns. Wait for their reply between each.

1. They text in -> you greet and ask the FIRST missing piece (service type, then bed/bath).
2. Once you have service type + bed + bath:
   FIRST TIME: send a short rapport / value-build message (NO price, NO link). Ask one casual question that invites a reply. Close with one trust point. Example: "Real quick before I send your quote, anything specific you want us to focus on? We bring all our own supplies and are fully insured."
   AFTER they reply: CLOSE. Tell them you are sending the quote, fire [BOOKING_COMPLETE]. Example: "Got it — sending your quote options now. [BOOKING_COMPLETE]"
3. CRITICAL — NEVER include any dollar amount, price number, or currency symbol in your SMS. The customer sees the price ONLY when they click the quote link. If you write a number like 325 or $362.50, the message will be blocked.
4. If they push back BEFORE you've sent the link (e.g. "how much", "thats a lot", "too expensive"):
   - "Want me to send your options? Standard / deep / move clean each have different rates." Then wait.
   - Stack value: "We're fully insured, background-checked, and guarantee your satisfaction or we come back free."
   - Close on the next turn with [BOOKING_COMPLETE]. The link reveals price.

CRITICAL: NEVER quote a dollar amount in your message. Pricing lives ONLY on the quote page behind the link the system sends after [BOOKING_COMPLETE].

PRICE OBJECTIONS:
Don't flinch. Don't apologize. Stack value one point at a time:
- "We're fully insured and every cleaner is background-checked"
- "100% satisfaction guarantee, not happy and we come back free"
- "Check our Google reviews, we're highly rated"
If they push 3 times: "Let me have the owner reach out to chat about options"

WHAT YOU KNOW ABOUT ${name.toUpperCase()}:
Licensed, bonded, insured. Background-checked. Satisfaction guarantee. Highly rated on Google. Professional supplies, safe for kids and pets. Cleans homes across ${area}.

ESCALATION (tag at END of message):
- Commercial/Airbnb/post-construction: [ESCALATE:custom_quote]
- Cancel/reschedule/billing: [ESCALATE:service_issue]
- Upset customer: [ESCALATE:unhappy_customer]
Say "Our team will reach out shortly!" and stop.

CRITICAL:
- ONE message per turn. This is the most important rule.
- Never re-ask something already answered
- NEVER include a dollar amount, price number, or currency symbol in your SMS body. Pricing lives only on the quote link page.
- Never send a number AND [BOOKING_COMPLETE] in the same message
- If a human is already texting this customer, stay out of it
- If they want a job as a cleaner: "Text ${tenant.owner_phone || 'the owner'} about opportunities"

BOOKING LANGUAGE (NEVER claim a confirmed booking that doesn't exist):
- NEVER say "you're all set", "you're booked", "you're confirmed", "we've got you booked", "scheduled for [day]", "locked in for", "booking confirmed", or "see you [day]" unless the CUSTOMER BRAIN above says "ALREADY BOOKED".
- If you're proposing a time, use: "Want me to hold [time]?" / "I can pencil you in for [time] — I'll confirm once it's locked" / "Sound good? Just say yes and I'll get you on the calendar".
- The system sends the real confirmation text automatically after a booking is created. You do NOT author confirmations.
- Hallucinating a confirmation causes no-shows and chargebacks. This is a hard rule.`
}

// ── Main Responder ──

export async function generateHCResponse(input: HCResponderInput): Promise<HCResponderResult> {
  const {
    message, tenant, conversationHistory, customer, knownInfo,
    customerContext, isRetargetingReply, isReturningCustomer, supabaseClient
  } = input

  const sdrName = tenant.sdr_persona || 'Sarah'

  // Build system prompt
  const systemPrompt = buildSystemPrompt(tenant)

  // Build conversation history
  const historyContext = conversationHistory.length
    ? conversationHistory.slice(-30).map(m => `${m.role === 'client' ? 'Customer' : sdrName}: ${m.content}`).join('\n')
    : '(New conversation, no prior messages.)'

  // Build customer brain
  let customerBrain = ''
  if (customer) {
    const parts: string[] = ['CUSTOMER BRAIN:']
    if (customer.first_name) parts.push(`Name: ${customer.first_name}`)
    if (customer.address) parts.push(`Address: ${customer.address}`)
    if (customerContext && customerContext.totalJobs > 0) {
      parts.push(`History: ${customerContext.totalJobs} completed jobs, $${customerContext.totalSpend} total`)
      if (customerContext.recentJobs?.length > 0) {
        const last = customerContext.recentJobs[0]
        parts.push(`Last service: ${(last.service_type || 'cleaning').replace(/_/g, ' ')} ($${last.price || 0})`)
      }
    }
    if (customerContext?.activeJobs?.length) {
      parts.push('\n-> ALREADY BOOKED. Help with their upcoming service, don\'t re-sell.')
    } else if (customerContext && customerContext.totalJobs > 0) {
      parts.push('\n-> Returning customer. Be warm, make rebooking easy.')
    } else {
      parts.push('\n-> New customer.')
    }
    customerBrain = '\n\n' + parts.join('\n')
  }

  // Build known info
  let knownInfoBlock = ''
  if (knownInfo) {
    const parts: string[] = []
    if (knownInfo.firstName) parts.push(`Name: ${knownInfo.firstName}`)
    if (knownInfo.address) parts.push(`Address: ${knownInfo.address}`)
    if (knownInfo.bedrooms) parts.push(`Bedrooms: ${knownInfo.bedrooms}`)
    if (knownInfo.bathrooms) parts.push(`Bathrooms: ${knownInfo.bathrooms}`)
    if (knownInfo.serviceType) parts.push(`Service: ${knownInfo.serviceType.replace(/[-_]/g, ' ')}`)
    if (parts.length) {
      const hasBedBath = !!(knownInfo.bedrooms && knownInfo.bathrooms)
      let hint = ''
      if (hasBedBath) hint = '\nIMPORTANT: You have bed/bath. Quote the exact price and fire [BOOKING_COMPLETE].'
      knownInfoBlock = `\n\nINFO ON FILE:\n${parts.join('\n')}${hint}\n`
    }
  }

  // ── Intake state machine (T4 — 2026-04-20) ─────────────────────────
  // Deterministic decision: are we ready to quote? If yes, force the LLM
  // toward [BOOKING_COMPLETE]. If no, pin the focus gap so it asks for the
  // right thing instead of freelancing. Fixes the Natasha Jones stall
  // where the agent collected bed+bath then just stopped.
  //
  // Build 1 #2: BEFORE firing [BOOKING_COMPLETE], we check the rapport gate.
  // If facts are complete AND customer has never received the rapport turn,
  // we send rapport ONLY and explicitly NOT [BOOKING_COMPLETE] this turn.
  // Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
  let intakeBlock = ''
  // Compute rapport-first + takeover-resume gates from canonical helper.
  const gate = computeRapportGate({
    knownCustomerInfo: knownInfo
      ? {
          firstName: knownInfo.firstName ?? null,
          address: knownInfo.address ?? null,
          bedrooms: knownInfo.bedrooms ?? null,
          bathrooms: knownInfo.bathrooms ?? null,
          serviceType: knownInfo.serviceType ?? null,
        }
      : undefined,
    customerContext: customer
      ? {
          activeJobs: (customerContext?.activeJobs ?? []).map(j => ({
            id: 0, service_type: j.service_type ?? null, date: j.date ?? null,
            scheduled_at: null, price: null, status: j.status,
            address: null, cleaner_name: null,
          })),
          recentJobs: (customerContext?.recentJobs ?? []).map(j => ({
            id: 0, service_type: j.service_type ?? null, date: null,
            price: j.price ?? null, completed_at: j.completed_at ?? null,
          })),
          customer: {
            id: customer.id, first_name: customer.first_name ?? null,
            last_name: customer.last_name ?? null, email: customer.email ?? null,
            address: customer.address ?? null, notes: customer.notes ?? null,
            housecall_pro_customer_id: null,
            pre_quote_rapport_sent_at: customer.pre_quote_rapport_sent_at ?? null,
            human_takeover_until: customer.human_takeover_until ?? null,
          },
          lead: null,
          totalJobs: customerContext?.totalJobs ?? 0,
          totalSpend: customerContext?.totalSpend ?? 0,
        }
      : null,
    isRetargetingReply,
  })

  try {
    const snap = buildIntakeSnapshot(null, customer, knownInfo)
    const decision = decideIntake(snap)
    if (decision.complete) {
      if (gate.shouldDeliverRapportFirst) {
        intakeBlock = `\n\nINTAKE STATE: COMPLETE — but you have NEVER sent this customer the rapport / value-build message. You MUST send rapport NOW before the quote link.\n`
          + `Rules for THIS turn ONLY:\n`
          + `  - Send ONE short message (under 160 chars). NO price. NO dollar amount. NO link.\n`
          + `  - Briefly acknowledge what they want.\n`
          + `  - Ask ONE casual rapport question that invites a reply (examples: "anything specific you want us to focus on?", "any pets we should know about?", "how is your day going?").\n`
          + `  - Mention ONE value point: insured + background-checked, all supplies included, satisfaction guarantee, or highly rated on Google.\n`
          + `  - DO NOT include [BOOKING_COMPLETE] in this turn.\n`
          + `  - Do NOT promise to send the quote NOW; say "send your quote next" or similar future tense.\n`
      } else {
        intakeBlock = `\n\nINTAKE STATE: COMPLETE. You have every required field AND the customer already received the rapport turn. Tell them you are sending the quote and fire [BOOKING_COMPLETE] in this same message. The system will text the booking URL right after. NEVER include a dollar amount in your SMS body — the link reveals price.\n`
      }
    } else if (decision.gaps.length > 0) {
      intakeBlock = `\n\nINTAKE STATE: missing ${decision.gaps.join(', ')}. FOCUS: ${decision.focus}. Ask ONE short question: "${decision.nextQuestion}". Do NOT ask for anything in INFO ON FILE.\n`
    }
  } catch {
    // Non-blocking — fall back to existing behavior if snapshot fails.
  }

  // Build 1 #3: takeover-resume awareness — prepend instruction when AI is
  // resuming a thread a human just handed back.
  if (gate.humanTakeoverRecentlyEnded) {
    intakeBlock = `\n\nHUMAN-OPERATOR-WAS-HANDLING-THIS-THREAD: A human operator was managing this conversation until very recently. Read the FULL history below carefully. Do NOT repeat anything the human already said. If the human already addressed the customer's last question, briefly acknowledge and move forward. Be especially careful not to undo or contradict anything the human told the customer.\n` + intakeBlock
  }

  // Load brain + patterns + pricing in parallel
  const [brainChunks, winningPatterns, pricingBlock] = await Promise.all([
    loadBrainChunks(supabaseClient, message),
    loadWinningPatterns(supabaseClient, tenant.id),
    loadPricing(supabaseClient, tenant.id),
  ])

  let brainBlock = ''
  if (brainChunks.length) {
    brainBlock = '\n\nINDUSTRY INTELLIGENCE (use to guide your approach, do NOT quote directly):\n'
    brainBlock += 'IMPORTANT: NEVER offer discounts. NEVER ask for email.\n'
    for (const chunk of brainChunks) brainBlock += `- ${chunk.slice(0, 300)}\n`
  }

  let patternsBlock = ''
  if (winningPatterns.length) {
    patternsBlock = '\n\nWINNING PATTERNS FROM PAST CONVERSATIONS (replicate these tactics):\n'
    for (const p of winningPatterns) patternsBlock += `- ${p.slice(0, 300)}\n`
  }

  let pricingContext = ''
  if (pricingBlock) pricingContext = '\n\n' + pricingBlock

  // Retargeting/returning context
  let specialContext = ''
  if (isRetargetingReply) {
    specialContext = '\n\nThis customer is replying to a retargeting text. They know who you are. Be warm, not salesy.'
  } else if (isReturningCustomer) {
    specialContext = '\n\nReturning customer replying to a seasonal offer. Welcome them back warmly.'
  }

  // Frustration detection (simple version)
  let frustrationWarning = ''
  if (conversationHistory.length >= 4) {
    const customerMsgs = conversationHistory.filter(m => m.role === 'client').map(m => m.content.toLowerCase())
    const repeatedPrice = customerMsgs.filter(m => /how much|price|cost|charge|quote/.test(m)).length >= 2
    const givingUp = /nevermind|forget it|nvm|not interested|waste/.test(message.toLowerCase())
    const wantsDirect = /just tell me|just answer|simple question/.test(message.toLowerCase())
    if (repeatedPrice || givingUp || wantsDirect) {
      frustrationWarning = '\n\nWARNING: Customer seems frustrated. Give a DIRECT answer NOW. If you have bed/bath, quote the exact price and fire [BOOKING_COMPLETE] immediately.'
    }
  }

  // Build the date context
  const tz = tenant.timezone || 'America/Los_Angeles'
  const now = new Date()
  const today = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz,
  }).format(now)

  // Assemble user message
  const userMessage = `Today: ${today}

Conversation so far:
${historyContext}${knownInfoBlock}${intakeBlock}${pricingContext}${specialContext}${customerBrain}${brainBlock}${patternsBlock}${frustrationWarning}

Customer just texted: "${message}"

Respond as ${sdrName}. Write ONLY the SMS text (and [BOOKING_COMPLETE] or [ESCALATE:reason] tag if needed). Nothing else.

REMEMBER: ONE message only. No emojis. No em dashes. No markdown. If intake is COMPLETE (service + bed + bath), give the price AND fire [BOOKING_COMPLETE] in this same message — the system sends the booking URL automatically right after.`

  // Call Claude
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { response: '', shouldSend: false, reason: 'No Anthropic API key' }
  }

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 400,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    })

    const textContent = response.content.find(block => block.type === 'text')
    const rawText = textContent?.type === 'text' ? textContent.text.trim() : ''

    if (!rawText) {
      return { response: '', shouldSend: false, reason: 'Empty Claude response' }
    }

    // Detect tags
    let hasBookingComplete = rawText.includes('[BOOKING_COMPLETE]')
    const escalationMatch = rawText.match(/\[ESCALATE:(\w+)\]/)

    // Clean response
    let cleaned = rawText
      .replace(/\[BOOKING_COMPLETE\]/gi, '')
      .replace(/\[ESCALATE:\w+\]/gi, '')
      .trim()

    // Sanitize (no auto-split — ONE message per turn, always)
    cleaned = sanitize(cleaned)
    // Strip ||| — the AI should never send multiple texts in one turn
    cleaned = cleaned.split('|||')[0].trim()

    // Build 1 #2: rapport-first override. If we instructed rapport-only and
    // the model still emitted [BOOKING_COMPLETE], we cancel the booking trigger
    // and treat this turn as a rapport message. Webhook caller will stamp
    // customers.pre_quote_rapport_sent_at.
    let isRapportTurn = false
    if (gate.shouldDeliverRapportFirst) {
      isRapportTurn = true
      hasBookingComplete = false
    }

    // Build 1 #1: defense-in-depth currency strip when a quote-send is imminent
    // OR when we're in the rapport turn (rapport must NEVER include a price).
    if (isRapportTurn || hasBookingComplete) {
      const { stripped, didStrip } = stripCurrencyForQuoteSend(cleaned)
      if (didStrip) {
        console.warn(`[HC Responder] ${tenant.slug}: currency leaked into SMS — stripped. Raw: "${rawText.slice(0, 200)}"`)
      }
      cleaned = stripped
    }

    if (!cleaned) {
      return { response: '', shouldSend: false, reason: 'Response empty after sanitization' }
    }

    console.log(`[HC Responder] ${tenant.slug}: "${message.slice(0, 50)}" -> "${cleaned.slice(0, 80)}" booking=${hasBookingComplete} rapport=${isRapportTurn}`)

    return {
      response: cleaned,
      shouldSend: true,
      reason: isRapportTurn ? 'HC SMS responder (rapport-first turn)' : 'HC SMS responder (operation-beat-human)',
      bookingComplete: hasBookingComplete || undefined,
      rapportSent: isRapportTurn || undefined,
      escalation: escalationMatch
        ? { shouldEscalate: true, reasons: [escalationMatch[1]] }
        : undefined,
    }
  } catch (err) {
    console.error('[HC Responder] Claude call failed:', err)
    return { response: '', shouldSend: false, reason: `Claude error: ${err}` }
  }
}
