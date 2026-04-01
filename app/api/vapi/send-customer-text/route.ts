import { NextRequest, NextResponse } from 'next/server'
import { sendSMS } from '@/lib/openphone'
import { toE164 } from '@/lib/phone-utils'
import { getTenantBySlug } from '@/lib/tenant'

// route-check:no-vercel-cron

/**
 * VAPI tool endpoint — sends an SMS to a customer mid-call or post-call.
 *
 * Called by the VAPI `send-customer-text` apiRequest tool.
 * VAPI POSTs the tool parameters directly as the JSON body.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  const customerName = typeof body.customer_name === 'string' ? body.customer_name.trim() : ''
  const price = typeof body.price === 'string' ? body.price.trim() : typeof body.price === 'number' ? String(body.price) : ''
  const bedrooms = typeof body.bedrooms === 'string' ? body.bedrooms.trim() : typeof body.bedrooms === 'number' ? String(body.bedrooms) : ''
  const bathrooms = typeof body.bathrooms === 'string' ? body.bathrooms.trim() : typeof body.bathrooms === 'number' ? String(body.bathrooms) : ''
  const messageType = typeof body.message_type === 'string' ? body.message_type.trim() : 'price_quote'
  const tenantSlug = typeof body.tenant_slug === 'string' ? body.tenant_slug.trim() : ''

  if (!phone || !tenantSlug) {
    return NextResponse.json({ error: 'Missing required fields: phone, tenant_slug' }, { status: 400 })
  }

  const tenant = await getTenantBySlug(tenantSlug)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const normalizedPhone = toE164(phone)
  const businessName = tenant.business_name || tenant.slug

  let message: string
  if (messageType === 'booking_followup') {
    message = customerName
      ? `Hey ${customerName}, thanks for booking with ${businessName}! If you have any questions, just reply to this number and we'll get back to you quickly.`
      : `Hey, thanks for booking with ${businessName}! If you have any questions, just reply to this number and we'll get back to you quickly.`
  } else {
    // price_quote (default)
    const priceDisplay = price ? `$${price.replace('$', '')}` : 'TBD'
    const sizeInfo = bedrooms && bathrooms ? `${bedrooms} bed / ${bathrooms} bath` : ''
    message = customerName
      ? `Hi ${customerName}! Your estimated cleaning price${sizeInfo ? ` for a ${sizeInfo} home` : ''} is ${priceDisplay}. We'll follow up with the full invoice shortly!`
      : `Hi! Your estimated cleaning price${sizeInfo ? ` for a ${sizeInfo} home` : ''} is ${priceDisplay}. We'll follow up with the full invoice shortly!`
  }

  const result = await sendSMS(tenant, normalizedPhone, message, { skipDedup: true })

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error || 'SMS send failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, message_sent: message })
}
