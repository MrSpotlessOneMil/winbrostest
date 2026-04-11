import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { queueChannel } from '@/lib/brain/ingest'
import { getBrainStats } from '@/lib/brain'

export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { channelId: string; channelName: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.channelId?.trim() || !body.channelName?.trim()) {
    return NextResponse.json({ error: 'channelId and channelName are required' }, { status: 400 })
  }

  const queued = await queueChannel(body.channelId, body.channelName)
  const stats = await getBrainStats()

  return NextResponse.json({ success: true, videosQueued: queued, stats })
}

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const stats = await getBrainStats()
  return NextResponse.json({ success: true, stats })
}
