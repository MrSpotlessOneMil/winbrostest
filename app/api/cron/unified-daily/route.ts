import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'

/**
 * Unified daily cron endpoint that consolidates multiple cron jobs
 * into a single daily execution (Vercel Hobby plan limitation)
 *
 * This endpoint calls:
 * - ghl-followups: GHL lead follow-up processing
 * - send-reminders: Cleaner reminder notifications
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  try {
    const results = {
      ghl_followups: { success: false, error: null as string | null },
      send_reminders: { success: false, error: null as string | null },
      timestamp: new Date().toISOString(),
    }

    const domain = process.env.NEXT_PUBLIC_DOMAIN || process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`
    const cronSecret = process.env.CRON_SECRET || ''

    // 1. Execute GHL followups
    try {
      console.log('Executing ghl-followups...')
      const ghlResponse = await fetch(`${domain}/api/cron/ghl-followups`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cronSecret}`,
        },
      })

      if (ghlResponse.ok) {
        results.ghl_followups.success = true
        console.log('✓ ghl-followups completed successfully')
      } else {
        results.ghl_followups.error = `Status ${ghlResponse.status}`
        console.error('✗ ghl-followups failed:', ghlResponse.status)
      }
    } catch (error) {
      results.ghl_followups.error = String(error)
      console.error('✗ ghl-followups error:', error)
    }

    // 2. Execute send reminders
    try {
      console.log('Executing send-reminders...')
      const remindersResponse = await fetch(`${domain}/api/cron/send-reminders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cronSecret}`,
        },
      })

      if (remindersResponse.ok) {
        results.send_reminders.success = true
        console.log('✓ send-reminders completed successfully')
      } else {
        results.send_reminders.error = `Status ${remindersResponse.status}`
        console.error('✗ send-reminders failed:', remindersResponse.status)
      }
    } catch (error) {
      results.send_reminders.error = String(error)
      console.error('✗ send-reminders error:', error)
    }

    return NextResponse.json({
      success: true,
      results,
    })
  } catch (error) {
    console.error('Unified daily cron error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
