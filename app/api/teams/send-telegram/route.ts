import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { sendTelegramMessage } from '@/lib/telegram'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  try {
    const { telegram_id, message } = await request.json()

    if (!telegram_id) {
      return NextResponse.json({ success: false, error: 'telegram_id is required' }, { status: 400 })
    }
    if (!message || !message.trim()) {
      return NextResponse.json({ success: false, error: 'message is required' }, { status: 400 })
    }

    // Verify the telegram_id belongs to a cleaner in the caller's tenant
    const serviceClient = getSupabaseServiceClient()
    const { data: cleaner } = await serviceClient
      .from('cleaners')
      .select('id')
      .eq('telegram_id', telegram_id)
      .eq('tenant_id', tenant.id)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()

    if (!cleaner) {
      return NextResponse.json(
        { success: false, error: 'Cleaner not found in your organization' },
        { status: 404 }
      )
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