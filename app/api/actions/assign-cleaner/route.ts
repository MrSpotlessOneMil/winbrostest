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
import { notifyCleanerAssignment } from '@/lib/telegram'

export async function POST(request: NextRequest) {
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
    if (!job) {
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
    } else {
      // Find available cleaner for the job date
      if (!job.date) {
        return NextResponse.json(
          { error: 'Job date required to auto-assign cleaner' },
          { status: 400 }
        )
      }

      const availableCleaners = await getCleanerAvailability(job.date)
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

    // Create assignment
    const assignment = await createCleanerAssignment(jobId, selectedCleaner.id!)
    if (!assignment) {
      return NextResponse.json(
        { error: 'Failed to create assignment' },
        { status: 500 }
      )
    }

    // Update job with assigned cleaner name
    await updateJob(jobId, {
      // Store cleaner name in a field if you have one, or in notes
    })

    // Notify cleaner via Telegram
    const notifyResult = await notifyCleanerAssignment(
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
      telegramNotified: notifyResult.success,
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
