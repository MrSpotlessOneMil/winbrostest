import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { embedPendingChunks } from '@/lib/brain/embed'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  try {
    const embedded = await embedPendingChunks(100)
    return NextResponse.json({ success: true, embedded })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Cron:BrainEmbed] Error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
