import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { sendTelegramMessage } from '@/lib/telegram'

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    const { telegram_id, message } = await request.json()

    if (!telegram_id) {
      return NextResponse.json({ success: false, error: 'telegram_id is required' }, { status: 400 })
    }
    if (!message || !message.trim()) {
      return NextResponse.json({ success: false, error: 'message is required' }, { status: 400 })
    }

    // sendTelegramMessage auto-logs to messages table via logTelegramMessage
    const result = await sendTelegramMessage(telegram_id, message.trim())

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 })
    }

    return NextResponse.json({ success: true, messageId: result.messageId })
  } catch (error) {
    console.error('[send-telegram] Error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
