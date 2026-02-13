import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { sendTelegramMessage } from '@/lib/telegram'
import { getDefaultTenant } from '@/lib/tenant'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { toE164 } from '@/lib/phone-utils'

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    const { telegram_id, message, phone } = await request.json()

    if (!telegram_id) {
      return NextResponse.json({ success: false, error: 'telegram_id is required' }, { status: 400 })
    }
    if (!message || !message.trim()) {
      return NextResponse.json({ success: false, error: 'message is required' }, { status: 400 })
    }

    const result = await sendTelegramMessage(telegram_id, message.trim())

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 })
    }

    // Store the sent message in the messages table so it appears in chat history
    if (phone) {
      try {
        const normalizedPhone = toE164(phone)
        const tenant = await getDefaultTenant()
        if (tenant && normalizedPhone) {
          const client = getSupabaseServiceClient()
          const now = new Date().toISOString()
          await client.from('messages').insert({
            tenant_id: tenant.id,
            phone_number: normalizedPhone,
            direction: 'outbound',
            message_type: 'sms',
            body: message.trim(),
            content: message.trim(),
            role: 'assistant',
            ai_generated: false,
            status: 'sent',
            source: 'telegram_dashboard',
            timestamp: now,
            metadata: { telegram_id, telegram_message_id: result.messageId },
          })
        }
      } catch (dbErr) {
        console.error('[send-telegram] Failed to store message in DB:', dbErr)
      }
    }

    return NextResponse.json({ success: true, messageId: result.messageId })
  } catch (error) {
    console.error('[send-telegram] Error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
