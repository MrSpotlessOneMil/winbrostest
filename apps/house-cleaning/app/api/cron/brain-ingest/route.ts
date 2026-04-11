import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { processQueuedSources } from '@/lib/brain/ingest'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  try {
    const processed = await processQueuedSources(5)
    return NextResponse.json({ success: true, processed })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Cron:BrainIngest] Error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
