/**
 * Send SMS Action Endpoint
 *
 * POST /api/actions/send-sms
 * Body: { to: string, message: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { sendSMS } from '@/lib/openphone'
import { normalizePhone, toE164 } from '@/lib/phone-utils'
import { appendToTextingTranscript, getSupabaseServiceClient, getTenantScopedClient } from '@/lib/supabase'
import { getTenantBusinessName } from '@/lib/tenant'
import { requireAuthWithTenant } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  try {
    // Rate limit: max 30 outbound SMS per tenant per minute
    const serviceClient = getSupabaseServiceClient()
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString()
    const { count: recentCount } = await serviceClient
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', authTenant.id)
      .eq('source', 'dashboard')
      .eq('direction', 'outbound')
      .gte('timestamp', oneMinuteAgo)

    if (recentCount && recentCount >= 30) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Max 30 messages per minute.' },
        { status: 429 }
      )
    }

    let to: string | undefined
    let message: string | undefined
    try {
      const body = await request.json()
      ;({ to, message } = body)
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

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

    // Pre-resolve customer and insert DB record BEFORE sending so the
    // outbound webhook dedup check always finds it (fixes double messages)
    const client = await getTenantScopedClient(authTenant.id)
    const e164Phone = toE164(phoneNumber)

    const { data: customer } = await client
      .from('customers')
      .select('id')
      .eq('phone_number', e164Phone)
      .eq('tenant_id', authTenant.id)
      .maybeSingle()

    const { data: msgRecord, error: msgError } = await client.from('messages').insert({
      tenant_id: authTenant.id,
      customer_id: customer?.id || null,
      phone_number: e164Phone,
      role: 'assistant',
      content: message,
      direction: 'outbound',
      message_type: 'sms',
      ai_generated: false,
      timestamp: new Date().toISOString(),
      source: 'dashboard',
    }).select('id').single()

    if (msgError) {
      console.error('[send-sms] Failed to save message to DB:', msgError)
    }

    // Send the SMS (use tenant for proper OpenPhone routing)
    // skipDedup: the route pre-inserts the DB record above, so the dedup check
    // inside sendSMS would find it and block the send as a false positive.
    // skipThrottle: manual dashboard sends should never be throttled by automated message counts.
    const result = await sendSMS(authTenant, phoneNumber, message, { skipDedup: true, skipThrottle: true })

    if (!result.success) {
      // Clean up the pre-inserted record since send failed
      if (msgRecord?.id) {
        await client.from('messages').delete().eq('id', msgRecord.id)
      }
      return NextResponse.json(
        { error: result.error || 'Failed to send SMS' },
        { status: 500 }
      )
    }

    console.log(`[send-sms] Saved outbound message to DB for ${e164Phone}`)

    // Pause AI auto-response for this customer (manual takeover)
    // Done AFTER send so the pause doesn't block our own message.
    if (customer?.id) {
      await serviceClient
        .from('customers')
        .update({
          auto_response_paused: true,
          manual_takeover_at: new Date().toISOString(),
        })
        .eq('id', customer.id)

      // Also pause the active lead's follow-up sequence (mirrors webhook behavior)
      const { data: activeLead } = await serviceClient
        .from('leads')
        .select('id, form_data')
        .eq('phone_number', e164Phone)
        .eq('tenant_id', authTenant.id)
        .not('status', 'in', '("completed","lost","duplicate")')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (activeLead) {
        const fd = typeof activeLead.form_data === 'object' && activeLead.form_data ? activeLead.form_data : {}
        await serviceClient.from('leads').update({ form_data: { ...fd, followup_paused: true } }).eq('id', activeLead.id)
      }
    }

    // Update texting transcript (legacy)
    const timestamp = new Date().toISOString()
    const businessNameShort = getTenantBusinessName(authTenant, true)
    await appendToTextingTranscript(
      phoneNumber,
      `[${timestamp}] ${businessNameShort}: ${message}`
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
