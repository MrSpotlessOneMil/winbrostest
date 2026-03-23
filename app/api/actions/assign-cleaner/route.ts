/**
 * Assign Cleaner Action Endpoint
 *
 * POST /api/actions/assign-cleaner
 * Body: { jobId: string, cleanerId?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getJobById,
  getCustomerByPhone,
  getCleanerById,
  getCleanerAvailability,
  createCleanerAssignment,
  updateJob,
} from '@/lib/supabase'
import { notifyCleanerAssignment } from '@/lib/cleaner-sms'
import { requireAuthWithTenant } from '@/lib/auth'
import { maybeMarkBooked } from '@/lib/maybe-mark-booked'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  try {
    const body = await request.json()
    const { jobId, cleanerId } = body

    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      )
    }

    // Get job details
    const job = await getJobById(jobId)
    if (!job || job.tenant_id !== tenant.id) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }

    // Get customer details
    const customer = await getCustomerByPhone(job.phone_number)

    let selectedCleaner

    if (cleanerId) {
      // Use specified cleaner
      selectedCleaner = await getCleanerById(cleanerId)
      if (!selectedCleaner) {
        return NextResponse.json(
          { error: 'Cleaner not found' },
          { status: 404 }
        )
      }
      // Cross-tenant check: cleaner must belong to the same tenant as the job
      if (selectedCleaner.tenant_id !== tenant.id) {
        console.error(`[assign-cleaner] BLOCKED: Cleaner ${cleanerId} belongs to tenant ${selectedCleaner.tenant_id}, not ${tenant.id}`)
        return NextResponse.json(
          { error: 'Cleaner not found' },
          { status: 404 }
        )
      }
    } else {
      // Find available cleaner for the job date
      if (!job.date) {
        return NextResponse.json(
          { error: 'Job date required to auto-assign cleaner' },
          { status: 400 }
        )
      }

      const availableCleaners = await getCleanerAvailability(job.date, undefined, (job as any).tenant_id)
      if (availableCleaners.length === 0) {
        return NextResponse.json(
          { error: 'No cleaners available for this date' },
          { status: 409 }
        )
      }

      // Select the first available cleaner
      // In a real system, you might have more sophisticated selection logic
      selectedCleaner = availableCleaners[0]
    }

    // Clear all existing assignments for this job (reassignment)
    // Delete cancelled/declined ones (stale) and cancel active ones
    const supabase = (await import('@/lib/supabase')).getSupabaseServiceClient()
    await supabase
      .from('cleaner_assignments')
      .delete()
      .eq('job_id', Number(jobId))
      .in('status', ['cancelled', 'declined'])

    await supabase
      .from('cleaner_assignments')
      .update({ status: 'cancelled' })
      .eq('job_id', Number(jobId))
      .in('status', ['pending', 'accepted', 'confirmed'])

    // Create new assignment
    const assignment = await createCleanerAssignment(jobId, selectedCleaner.id!)
    if (!assignment) {
      return NextResponse.json(
        { error: 'Failed to create assignment' },
        { status: 500 }
      )
    }

    // Update job cleaner_id so calendar reflects the change
    await updateJob(jobId, { cleaner_id: selectedCleaner.id })

    // Cleaner assigned — check if payment also confirmed → mark booked
    await maybeMarkBooked(jobId)

    // Notify cleaner via SMS
    const notifyResult = await notifyCleanerAssignment(
      tenant,
      selectedCleaner,
      job,
      customer || undefined
    )

    return NextResponse.json({
      success: true,
      assignmentId: assignment.id,
      cleaner: {
        id: selectedCleaner.id,
        name: selectedCleaner.name,
      },
      notified: notifyResult.success,
    })
  } catch (error) {
    console.error('Assign cleaner error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'assign-cleaner',
    method: 'POST',
    body: {
      jobId: 'string (required)',
      cleanerId: 'string (optional, auto-assigns if not provided)',
    },
  })
}
