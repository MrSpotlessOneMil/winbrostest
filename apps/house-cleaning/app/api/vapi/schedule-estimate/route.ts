import { NextRequest, NextResponse } from 'next/server'
import { safeJsonParse } from '@/lib/json-utils'
import { isRecord, extractPayload, resolveTenantFromCall } from '@/lib/vapi-utils'
import { scheduleEstimate } from '@/lib/vapi-estimate-scheduler'

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  if (!rawBody) {
    return NextResponse.json({ error: 'Empty payload' }, { status: 400 })
  }

  const parsed = safeJsonParse<Record<string, unknown>>(rawBody)
  if (!parsed.value || !isRecord(parsed.value)) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  // Resolve tenant from VAPI call metadata
  const tenantId = await resolveTenantFromCall(request)

  const payload = extractPayload(parsed.value)
  const response = await scheduleEstimate(payload, tenantId)

  // Strip internal fields — VAPI only needs date, time, and day_of_week
  const vapiResponse = {
    ...response,
    options: response.options?.map(({ date, time, day_of_week }) => ({ date, time, day_of_week })),
  }

  return NextResponse.json(vapiResponse)
}
