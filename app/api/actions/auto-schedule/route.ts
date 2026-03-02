/**
 * Auto-Schedule Action Endpoint
 *
 * POST /api/actions/auto-schedule
 * Body: { jobId: string }
 *
 * Finds the soonest available date (up to 14 days out),
 * runs route optimization, dispatches the team, and texts the customer.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { optimizeRoutesIncremental } from '@/lib/route-optimizer'
import { dispatchRoutes } from '@/lib/dispatch'
import { sendSMS } from '@/lib/openphone'
import { logSystemEvent } from '@/lib/system-events'
import { getTenantById, getTenantBusinessName } from '@/lib/tenant'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  try {
    const body = await request.json()
    const { jobId } = body

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 })
    }

    const client = getSupabaseServiceClient()

    // Fetch the job and verify ownership
    const { data: job } = await client
      .from('jobs')
      .select('id, tenant_id, customer_id, phone_number, address, service_type, date, scheduled_at, status, job_type, team_id, customers ( id, name )')
      .eq('id', jobId)
      .maybeSingle()

    if (!job || job.tenant_id !== tenant.id) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (job.date && job.team_id) {
      return NextResponse.json({ error: 'Job is already scheduled and assigned' }, { status: 400 })
    }

    // Iterate dates to find the soonest slot with team capacity
    const MAX_DAYS = 14
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)

    let scheduledDate: string | null = null
    let optimization = null
    let assignedTeamId: number | undefined

    for (let i = 0; i < MAX_DAYS; i++) {
      const candidate = new Date(tomorrow)
      candidate.setDate(candidate.getDate() + i)
      const dateStr = candidate.toISOString().split('T')[0]

      try {
        const result = await optimizeRoutesIncremental(
          Number(job.id),
          dateStr,
          tenant.id,
          'technician'
        )

        // Check if the job was assigned (not in unassigned list)
        const isUnassigned = result.optimization.unassignedJobs?.some(
          (u) => u.jobId === Number(job.id)
        )

        if (!isUnassigned && result.assignedTeamId) {
          scheduledDate = dateStr
          optimization = result.optimization
          assignedTeamId = result.assignedTeamId
          break
        }
      } catch (err) {
        console.warn(`[AutoSchedule] Optimization failed for ${dateStr}:`, err)
        continue
      }
    }

    if (!scheduledDate || !optimization) {
      return NextResponse.json(
        { error: 'No available slot found in the next 14 days. All teams are at capacity.' },
        { status: 409 }
      )
    }

    // Atomic update: only proceed if job is still unscheduled (prevents double-dispatch race)
    const { data: claimed } = await client.from('jobs').update({
      date: scheduledDate,
      status: 'scheduled',
      updated_at: new Date().toISOString(),
    })
      .eq('id', job.id)
      .is('date', null)
      .select('id')
      .maybeSingle()

    if (!claimed) {
      return NextResponse.json({ error: 'Job was already scheduled by another request' }, { status: 409 })
    }

    // Dispatch: persist assignments, send Telegram to team, SMS to customer
    const dispatch = await dispatchRoutes(optimization, tenant.id, {
      sendTelegramToTeams: true,
      sendSmsToCustomers: true,
      sendOwnerSummary: false, // owner already got the initial alert
    })

    // Find the assigned time for response
    let scheduledTime: string | null = null
    for (const route of optimization.routes) {
      for (const stop of route.stops) {
        if (stop.jobId === Number(job.id)) {
          scheduledTime = stop.estimatedArrival
          break
        }
      }
      if (scheduledTime) break
    }

    // Get team name for response
    let teamName: string | null = null
    if (assignedTeamId) {
      const { data: team } = await client
        .from('teams')
        .select('name')
        .eq('id', assignedTeamId)
        .maybeSingle()
      teamName = team?.name || null
    }

    // Log event
    await logSystemEvent({
      tenant_id: tenant.id,
      event_type: 'AUTO_SCHEDULE_DISPATCHED',
      source: 'actions',
      message: `Auto-scheduled job #${job.id} for ${scheduledDate} at ${scheduledTime || 'TBD'} (team: ${teamName || assignedTeamId})`,
      job_id: String(job.id),
      customer_id: job.customer_id ? String(job.customer_id) : undefined,
      phone_number: job.phone_number || undefined,
      metadata: {
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime,
        team_id: assignedTeamId,
        team_name: teamName,
        dispatch_result: dispatch,
      },
    })

    // Format date for response
    const dateObj = new Date(scheduledDate + 'T12:00:00')
    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' })
    const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

    return NextResponse.json({
      success: true,
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      team_name: teamName,
      team_id: assignedTeamId,
      display: `${dayName}, ${formattedDate}${scheduledTime ? ` at ${scheduledTime}` : ''}`,
    })
  } catch (error) {
    console.error('[AutoSchedule] Error:', error)
    return NextResponse.json(
      { error: 'Failed to auto-schedule job' },
      { status: 500 }
    )
  }
}
