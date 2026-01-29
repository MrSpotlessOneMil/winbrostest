/**
 * Follow-up Queue Processor
 *
 * Processes pending follow-ups (calls, SMS) and checks for customer silence.
 * Called every 15 minutes by Upstash QStash.
 *
 * Endpoint: GET /api/cron/ghl-followups
 */

import { NextRequest, NextResponse } from 'next/server'
import { Receiver } from '@upstash/qstash'
import {
  getPendingFollowups,
  processFollowUp,
  checkAndTriggerSilenceFollowups,
} from '@/integrations/ghl/follow-up-scheduler'

export async function GET(request: NextRequest) {
  const qstashSignature = request.headers.get('upstash-signature')

  if (qstashSignature) {
    const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
    const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY

    if (!currentSigningKey || !nextSigningKey) {
      console.error('QStash signing keys not configured')
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    try {
      const receiver = new Receiver({ currentSigningKey, nextSigningKey })
      const body = await request.text()
      const isValid = await receiver.verify({ signature: qstashSignature, body })

      if (!isValid) {
        return NextResponse.json({ error: 'Invalid QStash signature' }, { status: 401 })
      }
    } catch (error) {
      console.error('QStash verification error:', error)
      return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 })
    }
  } else {
    // Fall back to CRON_SECRET for manual triggers
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret) {
      const authHeader = request.headers.get('authorization')
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }
  }

  return executeFollowups()
}

async function executeFollowups() {
  try {
    const now = new Date()
    const results = {
      timestamp: now.toISOString(),
      processed: 0,
      succeeded: 0,
      failed: 0,
      silenceTriggered: 0,
      details: [] as Array<{ id: string; type: string; action: string; success: boolean }>,
    }

    // 1. Process pending follow-ups that are due
    const pendingFollowups = await getPendingFollowups(now)
    console.log(`[Follow-up Cron] Found ${pendingFollowups.length} pending follow-ups`)

    for (const followUp of pendingFollowups) {
      const result = await processFollowUp(followUp)
      results.processed++

      if (result.success) {
        results.succeeded++
      } else {
        results.failed++
      }

      results.details.push({
        id: followUp.id!,
        type: followUp.followup_type,
        action: result.action,
        success: result.success,
      })
    }

    // 2. Check for leads with customer silence and trigger follow-ups
    const silenceTriggered = await checkAndTriggerSilenceFollowups()
    results.silenceTriggered = silenceTriggered

    if (results.processed > 0) {
      console.log(`[Follow-up Cron] Processed ${results.processed}: ${results.succeeded} succeeded, ${results.failed} failed`)
    }

    return NextResponse.json({
      success: true,
      ...results,
    })
  } catch (error) {
    console.error('[Follow-up Cron] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

// POST method for QStash (QStash uses POST by default)
export async function POST(request: NextRequest) {
  return GET(request)
}
