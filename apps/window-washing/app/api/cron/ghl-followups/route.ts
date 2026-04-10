/**
 * Follow-up Queue Processor
 *
 * Processes pending follow-ups (calls, SMS) and checks for customer silence.
 * Called every 2 minutes by Vercel Cron.
 *
 * Endpoint: GET /api/cron/ghl-followups
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import {
  getPendingFollowups,
  processFollowUp,
  checkAndTriggerSilenceFollowups,
} from '@/integrations/ghl/follow-up-scheduler'

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
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
