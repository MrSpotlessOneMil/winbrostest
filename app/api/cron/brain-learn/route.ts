import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { learnFromOperations, discoverNewContent } from '@/lib/brain/learn'

export const maxDuration = 120

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  try {
    // 1. Learn from real business data
    const insights = await learnFromOperations()

    // 2. Discover new content to ingest
    const discovered = await discoverNewContent()

    return NextResponse.json({
      success: true,
      insightsGenerated: insights,
      newVideosDiscovered: discovered,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Cron:BrainLearn] Error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
