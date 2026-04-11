/**
 * Notify Cleaners — send job details to selected cleaners for accept/decline.
 * Does NOT auto-assign. Creates pending assignments and sends SMS with portal link.
 *
 * POST /api/actions/notify-cleaners
 * Body: { jobId: string, cleanerIds: string[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getJobById,
  getCustomerByPhone,
  getCleanerById,
  createCleanerAssignment,
} from '@/lib/supabase'
import { notifyCleanerAssignment } from '@/lib/cleaner-sms'
import { requireAuthWithTenant } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { jobId, cleanerIds } = body

  if (!jobId || !Array.isArray(cleanerIds) || cleanerIds.length === 0) {
    return NextResponse.json(
      { error: 'jobId and cleanerIds[] are required' },
      { status: 400 }
    )
  }

  const job = await getJobById(jobId)
  if (!job || (job as any).tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const customer = job.phone_number
    ? await getCustomerByPhone(job.phone_number)
    : null

  let notified = 0

  for (const cleanerId of cleanerIds) {
    const cleaner = await getCleanerById(cleanerId)
    if (!cleaner || cleaner.tenant_id !== tenant.id) continue

    // Create pending assignment (cleaner must accept)
    const assignment = await createCleanerAssignment(jobId, cleaner.id!)
    if (!assignment) {
      console.error(`[notify-cleaners] Failed to create assignment for ${cleaner.name}`)
      continue
    }

    // Send SMS with job details + portal link
    if (cleaner.phone) {
      const result = await notifyCleanerAssignment(
        tenant,
        cleaner,
        job,
        customer || undefined,
        assignment.id
      )
      if (result.success) {
        notified++
      } else {
        console.error(`[notify-cleaners] SMS failed for ${cleaner.name}: ${result.error}`)
      }
    }
  }

  return NextResponse.json({
    success: true,
    notified,
    total: cleanerIds.length,
  })
}
