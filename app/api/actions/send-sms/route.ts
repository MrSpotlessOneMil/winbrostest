/**
 * Send SMS Action Endpoint
 *
 * POST /api/actions/send-sms
 * Body: { to: string, message: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { sendSMS } from '@/lib/openphone'
import { normalizePhone } from '@/lib/phone-utils'
import { appendToTextingTranscript } from '@/lib/supabase'
import { getClientConfig } from '@/lib/client-config'

export async function POST(request: NextRequest) {
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

    // Send the SMS
    const result = await sendSMS(phoneNumber, message)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send SMS' },
        { status: 500 }
      )
    }

    // Update texting transcript
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
