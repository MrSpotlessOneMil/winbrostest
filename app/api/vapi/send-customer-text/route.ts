import { NextRequest, NextResponse } from 'next/server'
import { sendSMS } from '@/lib/openphone'
import { toE164 } from '@/lib/phone-utils'
import { getTenantBySlug, formatTenantCurrency } from '@/lib/tenant'
import { getSupabaseServiceClient } from '@/lib/supabase'

// route-check:no-vercel-cron

/**
 * VAPI function tool endpoint — sends an SMS to a customer mid-call or post-call.
 *
 * For price_quote: creates a quote in the DB with a public link where the customer
 * can review pricing, add extras, and pay. SMS includes the price AND the link.
 *
 * For booking_followup: sends a thank-you text after booking is confirmed.
 */

const ASSISTANT_TENANT_MAP: Record<string, string> = {
  'e3ed2426-dc28-4046-a5e9-0fbb945ff706': 'spotless-scrubbers',
  '3aab40c8-6f4e-4a12-a411-85ace7b86ba8': 'spotless-scrubbers',
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

/** Look up price from DB pricing tiers. Falls back to formula if no DB rows. */
async function lookupPriceFromDB(tenantId: string, bedrooms: number, bathrooms: number, serviceType?: string): Promise<number | null> {
  try {
    const { getPricingRow } = await import('@/lib/pricing-db')
    const tier = (serviceType === 'deep' || serviceType === 'move' || serviceType === 'move_in_out') ? (serviceType === 'move_in_out' ? 'move' : serviceType) : 'standard'
    const row = await getPricingRow(tier as any, bedrooms, bathrooms, null, tenantId)
    if (row?.price) return row.price
  } catch (e) {
    console.error('[send-customer-text] DB price lookup failed:', e)
  }
  // Formula fallback (should rarely hit now that all tenants have DB pricing)
  if (serviceType === 'deep' || serviceType === 'move' || serviceType === 'move_in_out') {
    return Math.max(125 * bedrooms + 50 * bathrooms, 250)
  }
  return Math.max(100 * bedrooms + 35 * bathrooms, 200)
}

function toNumber(val: unknown): number | null {
  if (typeof val === 'number' && !isNaN(val)) return val
  if (typeof val === 'string') {
    const n = parseFloat(val.replace(/[^0-9.]/g, ''))
    if (!isNaN(n)) return n
  }
  return null
}

/** Map service_type param to DB service_category value.
 *  DB constraint only allows 'standard' | 'move_in_out'.
 *  Deep clean is a tier within standard, not a separate category. */
function toServiceCategory(serviceType: string): string {
  if (serviceType === 'move' || serviceType === 'move_in_out') return 'move_in_out'
  return 'standard'
}

async function createQuoteAndGetLink(
  tenantId: string,
  phone: string,
  bedrooms: number,
  bathrooms: number,
  customerName: string | null,
  serviceCategory: string,
  price: number | null,
  domain: string,
  preferredDate?: string | null,
  preferredTime?: string | null,
): Promise<string | null> {
  const supabase = getSupabaseServiceClient()

  const baseRow = {
    tenant_id: tenantId,
    customer_name: customerName || null,
    customer_phone: phone,
    bedrooms,
    bathrooms,
    service_category: serviceCategory,
    notes: 'Created from VAPI voice call',
  }

  // First attempt: include date/time if provided
  const insertRow = {
    ...baseRow,
    ...(preferredDate ? { service_date: preferredDate } : {}),
    ...(preferredTime ? { service_time: preferredTime } : {}),
  }

  console.log('[send-customer-text] Creating quote:', JSON.stringify(insertRow))

  const { data: quote, error } = await supabase
    .from('quotes')
    .insert(insertRow)
    .select('token')
    .single()

  if (error || !quote?.token) {
    console.error('[send-customer-text] Quote insert failed:', error?.message, '| Retrying without date/time...')
    // Retry without date/time in case those fields caused the error
    const { data: retry, error: retryErr } = await supabase
      .from('quotes')
      .insert(baseRow)
      .select('token')
      .single()

    if (retryErr || !retry?.token) {
      console.error('[send-customer-text] Quote retry also failed:', retryErr?.message)
      return null
    }
    return `${domain}/quote/${retry.token}`
  }

  return `${domain}/quote/${quote.token}`
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const message = body.message as Record<string, unknown> | undefined
  const call = message?.call as Record<string, unknown> | undefined
  const functionCall = message?.functionCall as Record<string, unknown> | undefined

  // VAPI sends multiple formats depending on version and tool type:
  // 1. message.toolCallList[].parameters (newer format)
  // 2. message.toolWithToolCallList[].toolCall.parameters (newer format, nested)
  // 3. message.functionCall.parameters (older format)
  // 4. message.toolCalls[].function.arguments (OpenAI-style passthrough)
  const toolCallList = message?.toolCallList as Array<Record<string, unknown>> | undefined
  const toolWithToolCallList = message?.toolWithToolCallList as Array<Record<string, unknown>> | undefined
  const toolCalls = message?.toolCalls as Array<Record<string, unknown>> | undefined

  // Extract toolCallId from whichever format is present
  const toolCallId =
    (toolCallList?.[0]?.id as string) ||
    ((toolWithToolCallList?.[0]?.toolCall as Record<string, unknown>)?.id as string) ||
    (toolCalls?.[0]?.id as string) ||
    (functionCall?.id as string) ||
    ''

  // Extract parameters — try every known VAPI format
  const rawParams =
    toolCallList?.[0]?.parameters ??
    (toolWithToolCallList?.[0]?.toolCall as Record<string, unknown>)?.parameters ??
    toolCalls?.[0]?.parameters ??
    (() => {
      // OpenAI-style: toolCalls[].function.arguments (JSON string)
      const fn = toolCalls?.[0]?.function as Record<string, unknown> | undefined
      return fn?.arguments ?? fn?.parameters
    })() ??
    functionCall?.parameters

  const params: Record<string, unknown> = typeof rawParams === 'string'
    ? (() => { try { return JSON.parse(rawParams) } catch { return {} } })()
    : (rawParams as Record<string, unknown>) ?? {}

  const customerNumber = (call?.customer as Record<string, unknown>)?.number as string | undefined
  const assistantId = call?.assistantId as string | undefined

  // Log which format was used and full body keys if params are empty (for debugging)
  const paramSource = toolCallList?.[0]?.parameters ? 'toolCallList' :
    (toolWithToolCallList?.[0]?.toolCall as Record<string, unknown>)?.parameters ? 'toolWithToolCallList' :
    toolCalls?.[0]?.parameters ? 'toolCalls' :
    functionCall?.parameters ? 'functionCall' : 'NONE'

  console.log(`[send-customer-text] DIAG | source=${paramSource} | params=${JSON.stringify(params).slice(0, 400)} | customer=${customerNumber} | assistant=${assistantId} | toolCallId=${toolCallId} | bed=${params.bedrooms} | bath=${params.bathrooms} | price=${params.price}`)

  if (paramSource === 'NONE') {
    console.error(`[send-customer-text] NO PARAMS FOUND — raw body keys: message=[${Object.keys(message || {}).join(',')}] body=[${Object.keys(body).join(',')}] | full message: ${JSON.stringify(message).slice(0, 1000)}`)
  }

  const phoneFromParams = typeof params.phone === 'string' ? params.phone.trim() : ''
  const phone = customerNumber || phoneFromParams
  const tenantSlugFromParams = typeof params.tenant_slug === 'string' ? params.tenant_slug.trim() : ''
  const tenantSlug = (assistantId ? await resolveTenantSlugFromAssistant(assistantId) : null) || tenantSlugFromParams

  // Helper: return result in VAPI's expected format
  const vapiResult = (result: string) => NextResponse.json({
    results: [{ toolCallId, result }],
  })

  if (!phone) {
    return vapiResult('Error: Could not determine customer phone number')
  }
  if (!tenantSlug) {
    return vapiResult('Error: Could not determine tenant')
  }

  const tenant = await getTenantBySlug(tenantSlug)
  if (!tenant) {
    return vapiResult(`Error: Tenant not found: ${tenantSlug}`)
  }

  const customerName = typeof params.customer_name === 'string' ? params.customer_name.trim() : ''
  const messageType = typeof params.message_type === 'string' ? params.message_type.trim() : 'price_quote'
  const serviceType = typeof params.service_type === 'string' ? params.service_type.trim() : 'standard'
  const preferredDate = typeof params.preferred_date === 'string' ? params.preferred_date.trim() : null
  const preferredTime = typeof params.preferred_time === 'string' ? params.preferred_time.trim() : null

  const bedrooms = toNumber(params.bedrooms)
  const bathrooms = toNumber(params.bathrooms)

  const modelPrice = typeof params.price === 'string'
    ? params.price.replace('$', '').trim()
    : typeof params.price === 'number'
      ? String(params.price)
      : ''

  // Price resolution: DB lookup is source of truth. Model price is fallback only.
  let finalPrice = ''
  if (bedrooms !== null && bathrooms !== null) {
    const dbPrice = await lookupPriceFromDB(tenant.id, bedrooms, bathrooms, serviceType)
    if (dbPrice !== null) {
      finalPrice = String(dbPrice)
    } else if (modelPrice) {
      finalPrice = modelPrice
    }
  } else if (modelPrice) {
    finalPrice = modelPrice
  }

  const normalizedPhone = toE164(phone)
  const businessName = tenant.business_name || tenant.slug
  // Always use the Osiris app domain for quote links — tenant.website_url may point to
  // a marketing site (e.g. Hostinger) that doesn't host the /quote/ page.
  const domain = process.env.NEXT_PUBLIC_SITE_URL || 'https://cleanmachine.live'
  const serviceCategory = toServiceCategory(serviceType)

  let smsMessage: string
  if (messageType === 'booking_followup') {
    smsMessage = customerName
      ? `Hey ${customerName}, thanks for booking with ${businessName}! If you have any questions, just reply to this number and we'll get back to you quickly.`
      : `Hey, thanks for booking with ${businessName}! If you have any questions, just reply to this number and we'll get back to you quickly.`
  } else {
    const priceAmount = finalPrice ? parseFloat(finalPrice) : null
    const priceDisplay = priceAmount ? formatTenantCurrency(tenant, priceAmount) : null

    let quoteLink: string | null = null
    if (bedrooms !== null && bathrooms !== null) {
      quoteLink = await createQuoteAndGetLink(
        tenant.id, normalizedPhone, bedrooms, bathrooms,
        customerName || null, serviceCategory, priceAmount, domain,
        preferredDate, preferredTime,
      )
    }
    const sizeInfo = bedrooms !== null && bathrooms !== null ? `${bedrooms} bed / ${bathrooms} bath` : ''
    const namePrefix = customerName ? `Hi ${customerName}! ` : 'Hi! '

    if (priceDisplay && quoteLink) {
      smsMessage = `${namePrefix}Your estimated cleaning price${sizeInfo ? ` for a ${sizeInfo} home` : ''} is ${priceDisplay}. Review your quote and book here: ${quoteLink}`
    } else if (priceDisplay) {
      smsMessage = `${namePrefix}Your estimated cleaning price${sizeInfo ? ` for a ${sizeInfo} home` : ''} is ${priceDisplay}. We'll follow up with the full details shortly!`
    } else if (quoteLink) {
      smsMessage = `${namePrefix}Thanks for your interest in ${businessName}! Review your custom quote here: ${quoteLink}`
    } else {
      smsMessage = `${namePrefix}Thanks for your interest in ${businessName}. We'll follow up shortly with your exact cleaning quote!`
    }
  }

  // Pre-insert DB record BEFORE sending so OpenPhone webhook recognizes this as
  // system-sent and does NOT trigger manual_takeover (which ghosts the customer).
  const supabase = getSupabaseServiceClient()

  // Look up customer ID for the DB record
  const { data: customerRow } = await supabase
    .from('customers')
    .select('id')
    .eq('phone_number', normalizedPhone)
    .eq('tenant_id', tenant.id)
    .limit(1)
    .maybeSingle()

  const { data: msgRecord } = await supabase.from('messages').insert({
    tenant_id: tenant.id,
    customer_id: customerRow?.id || null,
    phone_number: normalizedPhone,
    role: 'assistant',
    content: smsMessage,
    direction: 'outbound',
    message_type: 'sms',
    ai_generated: false,
    source: 'vapi_booking_confirmation',
    timestamp: new Date().toISOString(),
  }).select('id').single()

  const smsResult = await sendSMS(tenant, normalizedPhone, smsMessage, { skipThrottle: true, skipDedup: true, bypassFilters: true })

  if (!smsResult.success) {
    // Clean up pre-inserted record since send failed
    if (msgRecord?.id) {
      await supabase.from('messages').delete().eq('id', msgRecord.id)
    }
    return vapiResult(`Error: SMS failed - ${smsResult.error || 'unknown error'}`)
  }

  // Return the actual price so the AI can quote it accurately on the call
  const priceInfo = finalPrice ? ` The exact price is ${formatTenantCurrency(tenant, parseFloat(finalPrice))}.` : ''
  return vapiResult(`SMS sent successfully.${priceInfo} Message: ${smsMessage}`)
}
