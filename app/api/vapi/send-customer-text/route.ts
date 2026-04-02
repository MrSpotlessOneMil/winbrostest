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
 * For price_quote: creates a quote in the DB with a public link where the customer
 * can review pricing, add extras, and pay. SMS includes the price AND the link.
 *
 * For booking_followup: sends a thank-you text after booking is confirmed.
 */

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

/** Look up price from pricing-data.json with optional service type multiplier. */
function lookupPrice(bedrooms: number, bathrooms: number, serviceType?: string): number | null {
  const table = PRICING_TABLE.standard
  if (!table || !Array.isArray(table)) return null

  let base: number | null = null

  const exact = table.find(r => r.bedrooms === bedrooms && r.bathrooms === bathrooms)
  if (exact) {
    base = exact.price
  } else {
    const sameBed = table
      .filter(r => r.bedrooms === bedrooms && r.bathrooms >= bathrooms)
      .sort((a, b) => a.bathrooms - b.bathrooms)
    if (sameBed.length > 0) {
      base = sameBed[0].price
    } else {
      const higher = table
        .filter(r => r.bedrooms >= bedrooms && r.bathrooms >= bathrooms)
        .sort((a, b) => a.bedrooms - b.bedrooms || a.bathrooms - b.bathrooms)
      if (higher.length > 0) base = higher[0].price
    }
  }

  if (base === null) return null

  if (serviceType === 'deep') return Math.round(base * 1.5)
  if (serviceType === 'move' || serviceType === 'move_in_out') return Math.round(base * 1.75)
  return Math.round(base)
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
): Promise<string | null> {
  const supabase = getSupabaseServiceClient()
  const { data: quote, error } = await supabase
    .from('quotes')
    .insert({
      tenant_id: tenantId,
      customer_name: customerName || null,
      customer_phone: phone,
      bedrooms,
      bathrooms,
      service_category: serviceCategory,
      ...(price ? { custom_base_price: price } : {}),
      notes: 'Created from VAPI voice call',
    })
    .select('token')
    .single()

  if (error || !quote?.token) {
    console.error('[send-customer-text] Failed to create quote:', error?.message)
    return null
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

  // VAPI may send parameters as a JSON string OR a parsed object — handle both
  const rawParams = functionCall?.parameters
  const params: Record<string, unknown> = typeof rawParams === 'string'
    ? (() => { try { return JSON.parse(rawParams) } catch { return {} } })()
    : (rawParams as Record<string, unknown>) ?? {}

  const customerNumber = (call?.customer as Record<string, unknown>)?.number as string | undefined
  const assistantId = call?.assistantId as string | undefined

  // Extract toolCallId for VAPI response format
  const toolCallList = message?.toolCallList as Array<Record<string, unknown>> | undefined
  const toolCallId = (toolCallList?.[0]?.id as string) || (functionCall?.id as string) || ''

  console.log(`[send-customer-text] DIAG | rawParamsType=${typeof rawParams} | fc_params=${JSON.stringify(params).slice(0, 300)} | customer=${customerNumber} | assistant=${assistantId} | toolCallId=${toolCallId} | bed=${params.bedrooms} | bath=${params.bathrooms} | price=${params.price}`)

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

  const bedrooms = toNumber(params.bedrooms)
  const bathrooms = toNumber(params.bathrooms)

  const modelPrice = typeof params.price === 'string'
    ? params.price.replace('$', '').trim()
    : typeof params.price === 'number'
      ? String(params.price)
      : ''

  // Price resolution:
  // 1. If service_type provided → use server lookup with that multiplier
  // 2. If model price > standard lookup → trust model (it calculated deep/move-out from prompt)
  // 3. Else → standard lookup
  let finalPrice = ''
  if (bedrooms !== null && bathrooms !== null) {
    const standardPrice = lookupPrice(bedrooms, bathrooms)
    const tieredPrice = lookupPrice(bedrooms, bathrooms, serviceType)
    const modelPriceNum = modelPrice ? parseFloat(modelPrice) : 0

    if (serviceType !== 'standard' && tieredPrice !== null) {
      finalPrice = String(tieredPrice)
    } else if (modelPriceNum > 0 && standardPrice !== null && modelPriceNum > standardPrice) {
      // Model quoted higher than standard — trust it (deep/move-out pricing from prompt)
      finalPrice = String(Math.round(modelPriceNum))
    } else if (standardPrice !== null) {
      finalPrice = String(standardPrice)
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
    let quoteLink: string | null = null
    if (bedrooms !== null && bathrooms !== null) {
      const priceNum = finalPrice ? parseFloat(finalPrice) : null
      quoteLink = await createQuoteAndGetLink(
        tenant.id, normalizedPhone, bedrooms, bathrooms,
        customerName || null, serviceCategory, priceNum, domain,
      )
    }

    const priceDisplay = finalPrice ? `$${finalPrice.replace('$', '')}` : null
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

  const smsResult = await sendSMS(tenant, normalizedPhone, smsMessage, { skipThrottle: true, skipDedup: true, bypassFilters: true })

  if (!smsResult.success) {
    return vapiResult(`Error: SMS failed - ${smsResult.error || 'unknown error'}`)
  }

  return vapiResult(`SMS sent successfully. Message: ${smsMessage}`)
}
