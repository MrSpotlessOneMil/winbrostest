import { NextRequest, NextResponse } from 'next/server'
import { sendSMS } from '@/lib/openphone'
import { toE164 } from '@/lib/phone-utils'
import { getTenantBySlug } from '@/lib/tenant'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { PRICING_TABLE } from '@/lib/pricing-config'

// route-check:no-vercel-cron

/**
 * VAPI function tool endpoint — sends an SMS to a customer mid-call or post-call.
 *
 * Called by the VAPI `send-customer-text` function tool.
 * VAPI sends: { message: { type: "function-call", call: {...}, functionCall: { name, parameters } } }
 * The caller's phone is extracted from call.customer.number.
 * The tenant is resolved from the assistantId on the call.
 *
 * Price is calculated SERVER-SIDE from bedrooms + bathrooms using pricing-data.json.
 * This removes dependency on GPT-4o passing the price correctly.
 */

// Map VAPI assistant IDs → tenant slugs
const ASSISTANT_TENANT_MAP: Record<string, string> = {
  'e3ed2426-dc28-4046-a5e9-0fbb945ff706': 'spotless-scrubbers',
  '81cee3b3-324f-4d05-900e-ac0f57ed283f': 'west-niagara',
  '4c673d16-436d-42ae-bf51-10b2c2d30fa0': 'cedar-rapids',
}

async function resolveTenantSlugFromAssistant(assistantId: string): Promise<string | null> {
  if (ASSISTANT_TENANT_MAP[assistantId]) return ASSISTANT_TENANT_MAP[assistantId]

  const supabase = getSupabaseServiceClient()
  const { data } = await supabase
    .from('tenants')
    .select('slug')
    .or(`vapi_assistant_id.eq.${assistantId},vapi_outbound_assistant_id.eq.${assistantId}`)
    .single()
  return data?.slug || null
}

/**
 * Look up the standard cleaning price from pricing-data.json.
 * Matches exact bedrooms + closest bathrooms (rounds up to nearest .5 or whole).
 * Returns null if no match found.
 */
function lookupPrice(bedrooms: number, bathrooms: number, serviceType?: string): number | null {
  const table = PRICING_TABLE.standard
  if (!table || !Array.isArray(table)) return null

  // Try exact match first
  const exact = table.find(r => r.bedrooms === bedrooms && r.bathrooms === bathrooms)
  if (exact) {
    const base = exact.price
    if (serviceType === 'deep') return Math.round(base * 1.5 * 100) / 100
    if (serviceType === 'move') return Math.round(base * 1.75 * 100) / 100
    return base
  }

  // Fallback: same bedrooms, closest bathrooms (round up)
  const sameBed = table
    .filter(r => r.bedrooms === bedrooms && r.bathrooms >= bathrooms)
    .sort((a, b) => a.bathrooms - b.bathrooms)
  if (sameBed.length > 0) {
    const base = sameBed[0].price
    if (serviceType === 'deep') return Math.round(base * 1.5 * 100) / 100
    if (serviceType === 'move') return Math.round(base * 1.75 * 100) / 100
    return base
  }

  // Last resort: closest bedrooms >= requested, then closest bathrooms
  const higher = table
    .filter(r => r.bedrooms >= bedrooms && r.bathrooms >= bathrooms)
    .sort((a, b) => a.bedrooms - b.bedrooms || a.bathrooms - b.bathrooms)
  if (higher.length > 0) {
    const base = higher[0].price
    if (serviceType === 'deep') return Math.round(base * 1.5 * 100) / 100
    if (serviceType === 'move') return Math.round(base * 1.75 * 100) / 100
    return base
  }

  return null
}

/** Safely extract a number from a string or number value */
function toNumber(val: unknown): number | null {
  if (typeof val === 'number' && !isNaN(val)) return val
  if (typeof val === 'string') {
    const n = parseFloat(val.replace(/[^0-9.]/g, ''))
    if (!isNaN(n)) return n
  }
  return null
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Parse VAPI function-call envelope
  // Format: { message: { type: "function-call", call: {...}, functionCall: { name, parameters } } }
  const message = body.message as Record<string, unknown> | undefined
  const call = message?.call as Record<string, unknown> | undefined
  const functionCall = message?.functionCall as Record<string, unknown> | undefined
  const params = (functionCall?.parameters ?? {}) as Record<string, unknown>
  const customerNumber = (call?.customer as Record<string, unknown>)?.number as string | undefined
  const assistantId = call?.assistantId as string | undefined

  // Single combined diagnostic log (Vercel only captures first log per invocation)
  console.log(`[send-customer-text] DIAG | keys=${Object.keys(body).join(',')} | msg_type=${message?.type} | fc_name=${functionCall?.name} | fc_params=${JSON.stringify(params).slice(0, 300)} | customer_num=${customerNumber} | assistant=${assistantId} | raw_keys=${message ? Object.keys(message).join(',') : 'no-msg'}`)

  const phoneFromParams = typeof params.phone === 'string' ? params.phone.trim() : ''
  const phone = customerNumber || phoneFromParams
  const tenantSlugFromParams = typeof params.tenant_slug === 'string' ? params.tenant_slug.trim() : ''
  const tenantSlug = (assistantId ? await resolveTenantSlugFromAssistant(assistantId) : null) || tenantSlugFromParams

  if (!phone) {
    return NextResponse.json({ error: 'Could not determine customer phone number' }, { status: 400 })
  }
  if (!tenantSlug) {
    return NextResponse.json({ error: 'Could not determine tenant' }, { status: 400 })
  }

  const tenant = await getTenantBySlug(tenantSlug)
  if (!tenant) {
    return NextResponse.json({ error: `Tenant not found: ${tenantSlug}` }, { status: 404 })
  }

  const customerName = typeof params.customer_name === 'string' ? params.customer_name.trim() : ''
  const messageType = typeof params.message_type === 'string' ? params.message_type.trim() : 'price_quote'

  // Extract bedrooms/bathrooms (handle both string and number from GPT-4o)
  const bedrooms = toNumber(params.bedrooms)
  const bathrooms = toNumber(params.bathrooms)

  // Price: prefer server-side lookup, fall back to model-provided value
  const modelPrice = typeof params.price === 'string'
    ? params.price.replace('$', '').trim()
    : typeof params.price === 'number'
      ? String(params.price)
      : ''

  let finalPrice = ''
  if (bedrooms !== null && bathrooms !== null) {
    const lookedUp = lookupPrice(bedrooms, bathrooms)
    if (lookedUp !== null) {
      // Round to nearest dollar to match what the bot says on the call
      finalPrice = String(Math.round(lookedUp))
    } else if (modelPrice) {
      finalPrice = modelPrice
    }
  } else if (modelPrice) {
    finalPrice = modelPrice
  }

  const normalizedPhone = toE164(phone)
  const businessName = tenant.business_name || tenant.slug

  let smsMessage: string
  if (messageType === 'booking_followup') {
    smsMessage = customerName
      ? `Hey ${customerName}, thanks for booking with ${businessName}! If you have any questions, just reply to this number and we'll get back to you quickly.`
      : `Hey, thanks for booking with ${businessName}! If you have any questions, just reply to this number and we'll get back to you quickly.`
  } else {
    const priceDisplay = finalPrice ? `$${finalPrice.replace('$', '')}` : null
    const sizeInfo = bedrooms !== null && bathrooms !== null ? `${bedrooms} bed / ${bathrooms} bath` : ''

    if (priceDisplay) {
      smsMessage = customerName
        ? `Hi ${customerName}! Your estimated cleaning price${sizeInfo ? ` for a ${sizeInfo} home` : ''} is ${priceDisplay}. We'll follow up with the full invoice shortly!`
        : `Hi! Your estimated cleaning price${sizeInfo ? ` for a ${sizeInfo} home` : ''} is ${priceDisplay}. We'll follow up with the full invoice shortly!`
    } else {
      // No price available — don't say TBD, send a softer message
      smsMessage = customerName
        ? `Hi ${customerName}! Thanks for your interest in ${businessName}. We'll follow up shortly with your exact cleaning quote!`
        : `Hi! Thanks for your interest in ${businessName}. We'll follow up shortly with your exact cleaning quote!`
    }
  }

  const result = await sendSMS(tenant, normalizedPhone, smsMessage, { skipDedup: true, bypassFilters: true })

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error || 'SMS send failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, message_sent: smsMessage, messageId: result.messageId })
}
