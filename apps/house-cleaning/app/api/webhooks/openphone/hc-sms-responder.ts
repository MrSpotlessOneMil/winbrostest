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

1. They text in -> you greet and ask how many bedrooms and bathrooms
2. They give bed/bath -> you give the EXACT price from VERIFIED PRICING below. Just the price and one trust signal. That's it.
3. They react (could be "ok", "thats a lot", "sounds good", anything) -> you respond to THEIR reaction:
   - If positive: "Want me to send your booking options? No charge until after the job is done." then [BOOKING_COMPLETE]
   - If price objection: stack one value point. "We're fully insured, background-checked, and guarantee your satisfaction or we come back free." Then wait.
   - If question: answer it. Then wait.
4. ONLY fire [BOOKING_COMPLETE] AFTER they signal yes/ok/ready/send it/book me

NEVER fire [BOOKING_COMPLETE] on the same turn you give the price. NEVER. Give price -> wait -> they respond -> then close.

If they gave bed/bath in their FIRST message along with "how much", you can give the price in your first reply. But still wait for their reaction before firing [BOOKING_COMPLETE].

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
- Never send a price AND [BOOKING_COMPLETE] in the same message
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
  let intakeBlock = ''
  try {
    const snap = buildIntakeSnapshot(null, customer, knownInfo)
    const decision = decideIntake(snap)
    if (decision.complete) {
      intakeBlock = `\n\nINTAKE STATE: COMPLETE. You have every required field. Quote the exact price from the PRICING block above and fire [BOOKING_COMPLETE] on the NEXT turn (not this one — give the price first, let the customer react).\n`
    } else if (decision.gaps.length > 0) {
      intakeBlock = `\n\nINTAKE STATE: missing ${decision.gaps.join(', ')}. FOCUS: ${decision.focus}. Ask ONE short question: "${decision.nextQuestion}". Do NOT ask for anything in INFO ON FILE.\n`
    }
  } catch {
    // Non-blocking — fall back to existing behavior if snapshot fails.
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

REMEMBER: ONE message only. No emojis. No em dashes. No markdown. Do NOT include [BOOKING_COMPLETE] if you are giving a price in this same message. Give the price, wait for their reply, THEN close on the next turn.`

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

    // CRITICAL: If the response contains a price ($XXX) AND [BOOKING_COMPLETE],
    // suppress the booking tag. The customer hasn't reacted to the price yet.
    // Let them respond first, then close on the next turn.
    const hasPrice = /\$\d/.test(rawText)
    if (hasBookingComplete && hasPrice) {
      console.log(`[HC Responder] Suppressed [BOOKING_COMPLETE] — price in same message, waiting for customer reaction`)
      hasBookingComplete = false
    }

    // Clean response
    let cleaned = rawText
      .replace(/\[BOOKING_COMPLETE\]/gi, '')
      .replace(/\[ESCALATE:\w+\]/gi, '')
      .trim()

    // Sanitize (no auto-split — ONE message per turn, always)
    cleaned = sanitize(cleaned)
    // Strip ||| — the AI should never send multiple texts in one turn
    cleaned = cleaned.split('|||')[0].trim()

    if (!cleaned) {
      return { response: '', shouldSend: false, reason: 'Response empty after sanitization' }
    }

    console.log(`[HC Responder] ${tenant.slug}: "${message.slice(0, 50)}" -> "${cleaned.slice(0, 80)}" booking=${hasBookingComplete}`)

    return {
      response: cleaned,
      shouldSend: true,
      reason: 'HC SMS responder (operation-beat-human)',
      bookingComplete: hasBookingComplete || undefined,
      escalation: escalationMatch
        ? { shouldEscalate: true, reasons: [escalationMatch[1]] }
        : undefined,
    }
  } catch (err) {
    console.error('[HC Responder] Claude call failed:', err)
    return { response: '', shouldSend: false, reason: `Claude error: ${err}` }
  }
}
