import { NextResponse } from 'next/server'

// Disabled: This SSE endpoint had zero authentication and broadcast all tenant data
// to any connected client. No active consumers exist (no frontend references /api/events).
// Re-implement with auth + tenant-scoped Realtime when polling-to-Realtime migration is tackled.
export async function GET() {
  return NextResponse.json(
    { error: 'This endpoint has been disabled' },
    { status: 404 }
  )
}