import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { queryBrain } from '@/lib/brain'
import type { KnowledgeDomain } from '@/lib/brain/types'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: { question: string; domain?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.question?.trim()) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 })
  }

  const answer = await queryBrain({
    question: body.question,
    tenantId: tenant.id,
    domain: (body.domain as KnowledgeDomain) || undefined,
    triggeredBy: 'dashboard',
  })

  return NextResponse.json({ success: true, ...answer })
}
