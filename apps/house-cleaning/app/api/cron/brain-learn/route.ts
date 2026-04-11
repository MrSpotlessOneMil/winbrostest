import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { learnFromOperations, discoverNewContent, ingestVapiTranscripts, ingestWinningSmsConversations } from '@/lib/brain/learn'

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

    // 3. Ingest winning call/SMS transcripts as knowledge
    const vapiIngested = await ingestVapiTranscripts()
    const smsIngested = await ingestWinningSmsConversations()

    return NextResponse.json({
      success: true,
      insightsGenerated: insights,
      newVideosDiscovered: discovered,
      vapiTranscriptsIngested: vapiIngested,
      smsConversationsIngested: smsIngested,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Cron:BrainLearn] Error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
