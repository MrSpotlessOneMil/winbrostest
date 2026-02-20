/**
 * Dispatch System
 *
 * After route optimization, this module:
 * 1. Persists team assignments to the database
 * 2. Sends optimized routes to team leads via Telegram
 * 3. Sends ETA arrival windows to customers via SMS
 *
 * WinBros-specific: assignments are created as 'confirmed' directly
 * (no accept/decline buttons — teams are auto-assigned).
 */

import { getSupabaseServiceClient } from './supabase'
import { sendTelegramMessage } from './telegram'
import { sendSMS } from './openphone'
import { syncNewJobToHCP } from './hcp-job-sync'
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

      const { error: updateErr } = await client
        .from('jobs')
        .update({
          team_id: route.teamId,
          scheduled_at: stop.estimatedArrival,
          updated_at: new Date().toISOString(),
        })
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
    }

    // 3. Send route to team lead via Telegram
    if (sendTelegram && route.leadTelegramId) {
      if (dryRun) {
        console.log(`[Dispatch:DRY] Would send Telegram route to team "${route.teamName}" (${route.leadTelegramId})`)
        telegramsSent++
      } else {
        const result = await sendRouteToTeamLead(tenant, route)
        if (result.success) {
          telegramsSent++
        } else {
          errors.push(`Telegram failed for team "${route.teamName}": ${result.error}`)
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

  // Send owner a summary if there were any issues
  if (!dryRun) {
    await sendOwnerDispatchSummary(tenant, optimization, result)
  }

  return result
}

// ── Telegram Route Message ─────────────────────────────────────

/**
 * Send the optimized route to a team lead via Telegram.
 * Informational only — no accept/decline buttons.
 */
async function sendRouteToTeamLead(
  tenant: Tenant,
  route: OptimizedRoute
): Promise<{ success: boolean; error?: string }> {
  if (!route.leadTelegramId) {
    return { success: false, error: 'Team lead has no Telegram ID' }
  }

  const stopLines = route.stops.map((stop, idx) => {
    const driveFrom = idx === 0 ? 'home' : `stop ${idx}`
    const duration = stop.jobDurationMinutes >= 60
      ? `${(stop.jobDurationMinutes / 60).toFixed(1)}h`
      : `${stop.jobDurationMinutes}min`
    const service = stop.serviceType ? ` | ${humanize(stop.serviceType)}` : ''

    return `<b>${stop.order}. ${stop.estimatedArrival}</b> - ${escapeHtml(stop.address)}
   ${stop.customerName || 'Customer'} | ~${duration}${service}
   Drive: ${stop.driveTimeMinutes} min from ${driveFrom}`
  }).join('\n\n')

  const message = `<b>Good morning, ${escapeHtml(route.teamName)}!</b>

Here's your optimized route for today (${route.stops.length} job${route.stops.length > 1 ? 's' : ''}):

${stopLines}

<b>Total drive time:</b> ${route.totalDriveTimeMinutes} min
<b>Estimated finish:</b> ${route.lastCompletionTime}
${route.totalRevenueEstimate > 0 ? `<b>Revenue target:</b> $${route.totalRevenueEstimate.toLocaleString()}` : ''}

Have a great day!`.trim()

  const result = await sendTelegramMessage(tenant, route.leadTelegramId, message, 'HTML')
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
 * Send the owner a Telegram summary after dispatch.
 * Always sends a brief status. Highlights warnings and errors prominently.
 */
async function sendOwnerDispatchSummary(
  tenant: Tenant,
  optimization: OptimizationResult,
  dispatch: DispatchResult
): Promise<void> {
  if (!tenant.owner_telegram_chat_id) return

  const hasIssues = optimization.warnings.length > 0 ||
    dispatch.errors.length > 0 ||
    optimization.unassignedJobs.length > 0

  // Build message
  const lines: string[] = []

  if (hasIssues) {
    lines.push(`<b>Logistics Dispatch — ${optimization.date}</b>`)
  } else {
    lines.push(`<b>Logistics Dispatch — ${optimization.date}</b>`)
  }

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
    lines.push('<b>Warnings:</b>')
    for (const w of optimization.warnings) {
      lines.push(`  - ${escapeHtml(w)}`)
    }
  }

  // Unassigned jobs
  if (optimization.unassignedJobs.length > 0) {
    lines.push('')
    lines.push(`<b>Unassigned jobs (${optimization.unassignedJobs.length}):</b>`)
    for (const uj of optimization.unassignedJobs.slice(0, 5)) {
      lines.push(`  - Job #${uj.jobId}: ${escapeHtml(uj.reason)}`)
    }
    if (optimization.unassignedJobs.length > 5) {
      lines.push(`  ... and ${optimization.unassignedJobs.length - 5} more`)
    }
  }

  // Dispatch errors
  if (dispatch.errors.length > 0) {
    lines.push('')
    lines.push('<b>Errors:</b>')
    for (const e of dispatch.errors.slice(0, 5)) {
      lines.push(`  - ${escapeHtml(e)}`)
    }
    if (dispatch.errors.length > 5) {
      lines.push(`  ... and ${dispatch.errors.length - 5} more`)
    }
  }

  const message = lines.join('\n')

  try {
    await sendTelegramMessage(tenant, tenant.owner_telegram_chat_id, message, 'HTML')
  } catch (err) {
    console.error('[Dispatch] Failed to send owner summary:', err)
  }
}

// ── Helpers ────────────────────────────────────────────────────

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
