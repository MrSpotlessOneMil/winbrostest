/**
 * Send SMS Action Endpoint
 *
 * POST /api/actions/send-sms
 * Body: { to: string, message: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { sendSMS } from '@/lib/openphone'
import { normalizePhone, toE164 } from '@/lib/phone-utils'
import { appendToTextingTranscript, getTenantScopedClient, getSupabaseServiceClient } from '@/lib/supabase'
import { getClientConfig } from '@/lib/client-config'
import { requireAuth, getAuthTenant } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    const body = await request.json()
    const { to, message } = body

    if (!to) {
      return NextResponse.json(
        { error: 'Phone number (to) is required' },
        { status: 400 }
      )
    }

    if (!message) {
      return NextResponse.json(
        { error: 'Message content is required' },
        { status: 400 }
      )
    }

    const phoneNumber = normalizePhone(to)
    if (!phoneNumber || phoneNumber.length !== 10) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      )
    }

    // Get tenant for proper phone formatting
    const tenant = await getAuthTenant(request)

    // Send the SMS
    const result = await sendSMS(phoneNumber, message)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send SMS' },
        { status: 500 }
      )
    }

    // Save outbound message to messages table for UI display
    const client = tenant ? await getTenantScopedClient(tenant.id) : getSupabaseServiceClient()
    const e164Phone = toE164(phoneNumber)

    // Find customer by phone number
    const { data: customer } = await client
      .from('customers')
      .select('id')
      .eq('phone_number', e164Phone)
      .eq('tenant_id', tenant?.id)
      .maybeSingle()

    const { error: msgError } = await client.from('messages').insert({
      tenant_id: tenant?.id,
      customer_id: customer?.id || null,
      phone_number: e164Phone,
      role: 'assistant',
      content: message,
      direction: 'outbound',
      message_type: 'sms',
      ai_generated: false,
      timestamp: new Date().toISOString(),
      source: 'dashboard',
    })

    if (msgError) {
      console.error('[send-sms] Failed to save message to DB:', msgError)
    } else {
      console.log(`[send-sms] Saved outbound message to DB for ${e164Phone}`)
    }

    // Update texting transcript (legacy)
    const timestamp = new Date().toISOString()
    const config = getClientConfig()
    await appendToTextingTranscript(
      phoneNumber,
      `[${timestamp}] ${config.businessNameShort}: ${message}`
    )

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      to: phoneNumber,
    })
  } catch (error) {
    console.error('Send SMS error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'send-sms',
    method: 'POST',
    body: {
      to: 'string (phone number)',
      message: 'string (SMS content)',
    },
  })
}
