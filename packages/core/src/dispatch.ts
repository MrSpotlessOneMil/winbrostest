/**
 * Dispatch System
 *
 * After route optimization, this module:
 * 1. Persists team assignments to the database
 * 2. Sends optimized routes to team leads via SMS
 * 3. Sends ETA arrival windows to customers via SMS
 *
 * WinBros-specific: assignments are created as 'confirmed' directly
 * (no accept/decline buttons — teams are auto-assigned).
 */

import { getSupabaseServiceClient } from './supabase'
import { sendSMS } from './openphone'
import { syncNewJobToHCP } from './hcp-job-sync'
import { maybeMarkBooked } from './maybe-mark-booked'
import type { Tenant } from './tenant'
import { getTenantById, getTenantBusinessName } from './tenant'
import type { OptimizationResult, OptimizedRoute, OptimizedStop, TeamForRouting } from './route-optimizer'

// ── Types ──────────────────────────────────────────────────────

export interface DispatchResult {
  success: boolean
  jobsUpdated: number
  assignmentsCreated: number
  telegramsSent: number
  smsSent: number
  errors: string[]
}

interface DispatchOptions {
  sendTelegramToTeams?: boolean
  sendSmsToCustomers?: boolean
  sendOwnerSummary?: boolean
  dryRun?: boolean
}

// ── Main Dispatch ──────────────────────────────────────────────

/**
 * Dispatch optimized routes: persist assignments and send notifications.
 */
export async function dispatchRoutes(
  optimization: OptimizationResult,
  tenantId: string,
  options?: DispatchOptions
): Promise<DispatchResult> {
  const sendTelegram = options?.sendTelegramToTeams !== false
  const sendCustomerSms = options?.sendSmsToCustomers !== false
  const dryRun = options?.dryRun ?? false

  const tenant = await getTenantById(tenantId)
  if (!tenant) {
    return { success: false, jobsUpdated: 0, assignmentsCreated: 0, telegramsSent: 0, smsSent: 0, errors: ['No tenant configured'] }
  }

  const client = getSupabaseServiceClient()
  const errors: string[] = []
  let jobsUpdated = 0
  let assignmentsCreated = 0
  let telegramsSent = 0
  let smsSent = 0

  for (const route of optimization.routes) {
    // 1. Update jobs with team_id and optimized scheduled_at
    for (const stop of route.stops) {
      if (dryRun) {
        console.log(`[Dispatch:DRY] Would update job ${stop.jobId}: team_id=${route.teamId}, scheduled_at="${stop.estimatedArrival}"`)
        jobsUpdated++
        continue
      }

      // Fetch existing scheduled_at — never overwrite a time already set by a user or prior booking
      const { data: existingJob } = await client
        .from('jobs')
        .select('scheduled_at')
        .eq('id', stop.jobId)
        .maybeSingle()

      const jobUpdate: Record<string, unknown> = {
        team_id: route.teamId,
        updated_at: new Date().toISOString(),
      }
      if (!existingJob?.scheduled_at) {
        jobUpdate.scheduled_at = stop.estimatedArrival
      }

      const { error: updateErr } = await client
        .from('jobs')
        .update(jobUpdate)
        .eq('id', stop.jobId)

      if (updateErr) {
        errors.push(`Failed to update job ${stop.jobId}: ${updateErr.message}`)
      } else {
        jobsUpdated++

        // Keep HCP calendar in sync with OSIRIS team/time assignment changes.
        await syncNewJobToHCP({
          tenant,
          jobId: stop.jobId,
          phone: stop.customerPhone || undefined,
          source: 'dispatch',
        })
      }

      // 2. Create cleaner_assignments with 'confirmed' status (no accept/decline)
      // Assign to the team lead
      const { error: asnErr } = await client
        .from('cleaner_assignments')
        .upsert(
          {
            job_id: stop.jobId,
            cleaner_id: route.leadId,
            status: 'confirmed',
            tenant_id: tenantId,
            created_at: new Date().toISOString(),
          },
          { onConflict: 'job_id,cleaner_id', ignoreDuplicates: true }
        )

      if (asnErr) {
        // If upsert fails (e.g. no unique constraint), try insert
        const { error: insertErr } = await client
          .from('cleaner_assignments')
          .insert({
            job_id: stop.jobId,
            cleaner_id: route.leadId,
            status: 'confirmed',
            tenant_id: tenantId,
          })

        if (insertErr) {
          errors.push(`Failed to create assignment for job ${stop.jobId}: ${insertErr.message}`)
        } else {
          assignmentsCreated++
        }
      } else {
        assignmentsCreated++
      }

      // Update associated lead status to 'assigned'
      const { data: associatedLead } = await client
        .from('leads')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('converted_to_job_id', stop.jobId)
        .maybeSingle()

      if (associatedLead) {
        await client
          .from('leads')
          .update({ status: 'assigned', updated_at: new Date().toISOString() })
          .eq('id', associatedLead.id)
      }

      // Cleaner assigned — check if payment also confirmed → mark booked
      await maybeMarkBooked(stop.jobId)
    }

    // 3. Send route to team lead via SMS
    if (sendTelegram && route.leadId) {
      if (dryRun) {
        console.log(`[Dispatch:DRY] Would send SMS route to team "${route.teamName}" (lead ${route.leadId})`)
        telegramsSent++
      } else {
        const result = await sendRouteToTeamLead(tenant, route)
        if (result.success) {
          telegramsSent++
        } else {
          errors.push(`SMS failed for team "${route.teamName}": ${result.error}`)
        }
      }
    }

    // 4. Send ETA SMS to customers
    if (sendCustomerSms) {
      for (const stop of route.stops) {
        if (!stop.customerPhone) continue

        if (dryRun) {
          console.log(`[Dispatch:DRY] Would SMS ${stop.customerPhone}: ETA ${stop.arrivalWindow}`)
          smsSent++
          continue
        }

        const result = await sendCustomerEtaSms(tenant, stop, route.teamName)
        if (result.success) {
          smsSent++
        } else {
          errors.push(`SMS failed for ${stop.customerPhone}: ${result.error}`)
        }
      }
    }
  }

  console.log(`[Dispatch] ${dryRun ? 'DRY RUN - ' : ''}Jobs: ${jobsUpdated}, Assignments: ${assignmentsCreated}, Telegrams: ${telegramsSent}, SMS: ${smsSent}, Errors: ${errors.length}`)

  const result: DispatchResult = {
    success: errors.length === 0,
    jobsUpdated,
    assignmentsCreated,
    telegramsSent,
    smsSent,
    errors,
  }

  // Send owner a summary (skip for single-estimate dispatches to avoid noise)
  const sendOwnerSummary = options?.sendOwnerSummary !== false
  if (!dryRun && sendOwnerSummary) {
    await sendOwnerDispatchSummary(tenant, optimization, result)
  }

  return result
}

// ── Team Lead Route Message (SMS) ──────────────────────────────

/**
 * Send the optimized route to a team lead via SMS.
 * Informational only — no accept/decline buttons.
 */
async function sendRouteToTeamLead(
  tenant: Tenant,
  route: OptimizedRoute
): Promise<{ success: boolean; error?: string }> {
  // Look up team lead phone from cleaners table
  const client = getSupabaseServiceClient()
  const { data: lead } = await client
    .from('cleaners')
    .select('phone')
    .eq('id', route.leadId)
    .eq('active', true)
    .maybeSingle()

  if (!lead?.phone) {
    return { success: false, error: 'Team lead has no phone number' }
  }

  const stopLines = route.stops.map((stop, idx) => {
    const driveFrom = idx === 0 ? 'home' : `stop ${idx}`
    const duration = stop.jobDurationMinutes >= 60
      ? `${(stop.jobDurationMinutes / 60).toFixed(1)}h`
      : `${stop.jobDurationMinutes}min`
    const service = stop.serviceType ? ` | ${humanize(stop.serviceType)}` : ''

    return `${stop.order}. ${stop.estimatedArrival} - ${stop.address}\n   ${stop.customerName || 'Customer'} | ~${duration}${service}\n   Drive: ${stop.driveTimeMinutes} min from ${driveFrom}`
  }).join('\n\n')

  const message = `Good morning, ${route.teamName}!

Your route today (${route.stops.length} job${route.stops.length > 1 ? 's' : ''}):

${stopLines}

Total drive time: ${route.totalDriveTimeMinutes} min
Estimated finish: ${route.lastCompletionTime}
${route.totalRevenueEstimate > 0 ? `Revenue target: $${route.totalRevenueEstimate.toLocaleString()}` : ''}

Have a great day!`.trim()

  const result = await sendSMS(tenant, lead.phone, message)
  return { success: result.success, error: result.error }
}

// ── Customer ETA SMS ───────────────────────────────────────────

/**
 * Send ETA arrival window to a customer via SMS.
 */
async function sendCustomerEtaSms(
  tenant: Tenant,
  stop: OptimizedStop,
  teamName: string
): Promise<{ success: boolean; error?: string }> {
  if (!stop.customerPhone) {
    return { success: false, error: 'No customer phone' }
  }

  const businessName = getTenantBusinessName(tenant, true)
  const customerGreeting = stop.customerName ? `Hi ${stop.customerName}!` : 'Hi!'
  const service = stop.serviceType ? humanize(stop.serviceType) : 'window cleaning'

  const message = `${customerGreeting} Your ${businessName} ${service} is scheduled for today. Estimated arrival: ${stop.arrivalWindow}. Your team: ${teamName}. Reply with any questions!`

  const result = await sendSMS(tenant, stop.customerPhone, message)
  return { success: result.success, error: result.error }
}

// ── Owner Dispatch Summary ────────────────────────────────────

/**
 * Send the owner an SMS summary after dispatch.
 * Always sends a brief status. Highlights warnings and errors prominently.
 */
async function sendOwnerDispatchSummary(
  tenant: Tenant,
  optimization: OptimizationResult,
  dispatch: DispatchResult
): Promise<void> {
  if (!tenant.owner_phone) return

  // Build message
  const lines: string[] = []

  lines.push(`LOGISTICS DISPATCH - ${optimization.date}`)

  // Stats line
  lines.push('')
  lines.push(`Jobs: ${dispatch.jobsUpdated} dispatched to ${optimization.stats.activeTeams} team${optimization.stats.activeTeams !== 1 ? 's' : ''}`)
  if (dispatch.telegramsSent > 0) {
    lines.push(`Telegram routes sent: ${dispatch.telegramsSent}`)
  }
  if (dispatch.smsSent > 0) {
    lines.push(`Customer ETA texts: ${dispatch.smsSent}`)
  }

  // Warnings (skipped teams, missing data, feasibility)
  if (optimization.warnings.length > 0) {
    lines.push('')
    lines.push('WARNINGS:')
    for (const w of optimization.warnings) {
      lines.push(`  - ${w}`)
    }
  }

  // Unassigned jobs
  if (optimization.unassignedJobs.length > 0) {
    lines.push('')
    lines.push(`UNASSIGNED JOBS (${optimization.unassignedJobs.length}):`)
    for (const uj of optimization.unassignedJobs.slice(0, 5)) {
      lines.push(`  - Job #${uj.jobId}: ${uj.reason}`)
    }
    if (optimization.unassignedJobs.length > 5) {
      lines.push(`  ... and ${optimization.unassignedJobs.length - 5} more`)
    }
  }

  // Dispatch errors
  if (dispatch.errors.length > 0) {
    lines.push('')
    lines.push('ERRORS:')
    for (const e of dispatch.errors.slice(0, 5)) {
      lines.push(`  - ${e}`)
    }
    if (dispatch.errors.length > 5) {
      lines.push(`  ... and ${dispatch.errors.length - 5} more`)
    }
  }

  const message = lines.join('\n')

  try {
    await sendSMS(tenant, tenant.owner_phone, message)
  } catch (err) {
    console.error('[Dispatch] Failed to send owner summary:', err)
  }
}

// ── Helpers ────────────────────────────────────────────────────

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

