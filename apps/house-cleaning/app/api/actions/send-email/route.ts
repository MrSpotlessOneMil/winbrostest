/**
 * Send Email Action Endpoint
 *
 * POST /api/actions/send-email
 * Body: { to: string, subject: string, body: string, customerId?: number }
 *
 * Mirrors send-sms pattern: pre-insert `messages` row (source=dashboard,
 * message_type=email) BEFORE calling sendCustomEmail so downstream systems
 * don't treat the outbound email as a manual takeover signal.
 */

import { NextRequest, NextResponse } from 'next/server'
import { sendCustomEmail } from '@/lib/gmail-client'
import { getSupabaseServiceClient, getTenantScopedClient } from '@/lib/supabase'
import { getTenantBusinessName } from '@/lib/tenant'
import { requireAuthWithTenant } from '@/lib/auth'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  try {
    // Rate limit: max 30 outbound emails per tenant per minute
    const serviceClient = getSupabaseServiceClient()
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString()
    const { count: recentCount } = await serviceClient
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', authTenant.id)
      .eq('message_type', 'email')
      .eq('source', 'dashboard')
      .eq('direction', 'outbound')
      .gte('timestamp', oneMinuteAgo)

    if (recentCount && recentCount >= 30) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Max 30 emails per minute.' },
        { status: 429 }
      )
    }

    let to: string | undefined
    let subject: string | undefined
    let body: string | undefined
    let customerId: number | undefined
    try {
      const payload = await request.json()
      ;({ to, subject, body, customerId } = payload)
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    if (!to) {
      return NextResponse.json({ error: 'Recipient (to) is required' }, { status: 400 })
    }
    if (!subject) {
      return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
    }
    if (!body) {
      return NextResponse.json({ error: 'Body is required' }, { status: 400 })
    }

    const normalizedEmail = to.trim().toLowerCase()
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
    }

    // Resolve customer by id (if passed) or by email match
    const client = await getTenantScopedClient(authTenant.id)
    let resolvedCustomerId: number | null = customerId ?? null
    if (!resolvedCustomerId) {
      const { data: customer } = await client
        .from('customers')
        .select('id')
        .eq('email', normalizedEmail)
        .eq('tenant_id', authTenant.id)
        .maybeSingle()
      resolvedCustomerId = customer?.id ?? null
    }

    // Pre-insert the outbound email record BEFORE sending
    const { data: msgRecord, error: msgError } = await client
      .from('messages')
      .insert({
        tenant_id: authTenant.id,
        customer_id: resolvedCustomerId,
        email_address: normalizedEmail,
        role: 'assistant',
        content: body,
        direction: 'outbound',
        message_type: 'email',
        ai_generated: false,
        timestamp: new Date().toISOString(),
        source: 'dashboard',
        metadata: { subject },
      })
      .select('id')
      .single()

    if (msgError) {
      console.error('[send-email] Failed to save message to DB:', msgError)
    }

    const fromName = getTenantBusinessName(authTenant, true)

    const result = await sendCustomEmail({
      to: normalizedEmail,
      subject,
      body,
      fromName,
      tenant: authTenant,
    })

    if (!result.success) {
      if (msgRecord?.id) {
        await client.from('messages').delete().eq('id', msgRecord.id)
      }
      return NextResponse.json(
        { error: result.error || 'Failed to send email' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      to: normalizedEmail,
      messageId: msgRecord?.id ?? null,
    })
  } catch (error) {
    console.error('Send email error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'send-email',
    method: 'POST',
    body: {
      to: 'string (email)',
      subject: 'string',
      body: 'string (plain text; converted to HTML paragraphs by gmail-client)',
      customerId: 'number (optional — auto-resolved from email if omitted)',
    },
  })
}
