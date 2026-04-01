import { NextRequest, NextResponse } from 'next/server'
import { sendSMS } from '@/lib/openphone'
import { toE164 } from '@/lib/phone-utils'
import { getTenantBySlug } from '@/lib/tenant'
import { getSupabaseServiceClient } from '@/lib/supabase'

// route-check:no-vercel-cron

/**
 * VAPI function tool endpoint — sends an SMS to a customer mid-call or post-call.
 *
 * Called by the VAPI `send-customer-text` function tool.
 * VAPI sends: { message: { type: "function-call", call: {...}, functionCall: { name, parameters } } }
 * The caller's phone is extracted from call.customer.number.
 * The tenant is resolved from the assistantId on the call.
 */

// Map VAPI assistant IDs → tenant slugs
const ASSISTANT_TENANT_MAP: Record<string, string> = {
  'e3ed2426-dc28-4046-a5e9-0fbb945ff706': 'spotless-scrubbers',
  '81cee3b3-324f-4d05-900e-ac0f57ed283f': 'west-niagara',
  '4c673d16-436d-42ae-bf51-10b2c2d30fa0': 'cedar-rapids',
}

async function resolveTenantSlugFromAssistant(assistantId: string): Promise<string | null> {
  // Fast path: static map
  if (ASSISTANT_TENANT_MAP[assistantId]) return ASSISTANT_TENANT_MAP[assistantId]

  // Fallback: check DB for vapi_assistant_id
  const supabase = getSupabaseServiceClient()
  const { data } = await supabase
    .from('tenants')
    .select('slug')
    .or(`vapi_assistant_id.eq.${assistantId},vapi_outbound_assistant_id.eq.${assistantId}`)
    .single()
  return data?.slug || null
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Parse VAPI function-call envelope
  const message = body.message as Record<string, unknown> | undefined
  const call = message?.call as Record<string, unknown> | undefined
  const functionCall = message?.functionCall as Record<string, unknown> | undefined
  const params = (functionCall?.parameters || body) as Record<string, unknown>

  // Extract phone from call metadata (caller's number)
  const customerNumber = (call?.customer as Record<string, unknown>)?.number as string | undefined
  const phoneFromParams = typeof params.phone === 'string' ? params.phone.trim() : ''
  const phone = customerNumber || phoneFromParams

  // Extract tenant from assistant ID or params
  const assistantId = call?.assistantId as string | undefined
  const tenantSlugFromParams = typeof params.tenant_slug === 'string' ? params.tenant_slug.trim() : ''
  const tenantSlug = (assistantId ? await resolveTenantSlugFromAssistant(assistantId) : null) || tenantSlugFromParams

  console.log(`[send-customer-text] Raw phone: customerNumber=${customerNumber}, phoneFromParams=${phoneFromParams}, resolved=${phone}`)
  console.log(`[send-customer-text] assistantId=${assistantId}, tenantSlug=${tenantSlug}`)

  if (!phone) {
    console.error('[send-customer-text] No phone found. Full body:', JSON.stringify(body).slice(0, 1000))
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
  const price = typeof params.price === 'string' ? params.price.trim() : typeof params.price === 'number' ? String(params.price) : ''
  const bedrooms = typeof params.bedrooms === 'string' ? params.bedrooms.trim() : typeof params.bedrooms === 'number' ? String(params.bedrooms) : ''
  const bathrooms = typeof params.bathrooms === 'string' ? params.bathrooms.trim() : typeof params.bathrooms === 'number' ? String(params.bathrooms) : ''
  const messageType = typeof params.message_type === 'string' ? params.message_type.trim() : 'price_quote'

  const normalizedPhone = toE164(phone)
  const businessName = tenant.business_name || tenant.slug

  let smsMessage: string
  if (messageType === 'booking_followup') {
    smsMessage = customerName
      ? `Hey ${customerName}, thanks for booking with ${businessName}! If you have any questions, just reply to this number and we'll get back to you quickly.`
      : `Hey, thanks for booking with ${businessName}! If you have any questions, just reply to this number and we'll get back to you quickly.`
  } else {
    const priceDisplay = price ? `$${price.replace('$', '')}` : 'TBD'
    const sizeInfo = bedrooms && bathrooms ? `${bedrooms} bed / ${bathrooms} bath` : ''
    smsMessage = customerName
      ? `Hi ${customerName}! Your estimated cleaning price${sizeInfo ? ` for a ${sizeInfo} home` : ''} is ${priceDisplay}. We'll follow up with the full invoice shortly!`
      : `Hi! Your estimated cleaning price${sizeInfo ? ` for a ${sizeInfo} home` : ''} is ${priceDisplay}. We'll follow up with the full invoice shortly!`
  }

  console.log(`[send-customer-text] Sending SMS to ${normalizedPhone} (raw: ${phone}), type=${messageType}, price=${price}, bed=${bedrooms}, bath=${bathrooms}`)
  console.log(`[send-customer-text] Message: ${smsMessage}`)
  console.log(`[send-customer-text] Tenant: ${tenant.slug}, OpenPhone phone_id: ${tenant.openphone_phone_id}, phone_number: ${tenant.openphone_phone_number}`)

  const result = await sendSMS(tenant, normalizedPhone, smsMessage, { skipDedup: true, bypassFilters: true })

  console.log(`[send-customer-text] sendSMS result:`, JSON.stringify(result))

  if (!result.success) {
    console.error(`[send-customer-text] SMS FAILED for ${normalizedPhone}: ${result.error}`)
    return NextResponse.json(
      { success: false, error: result.error || 'SMS send failed' },
      { status: 500 },
    )
  }

  console.log(`[send-customer-text] SMS sent OK to ${normalizedPhone}, messageId=${result.messageId}`)

  return NextResponse.json({ success: true, message_sent: smsMessage, messageId: result.messageId })
}
