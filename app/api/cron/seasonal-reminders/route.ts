/**
 * Seasonal Reminders Cron Job
 *
 * Sends seasonal campaign SMS to targeted customers based on tenant-configured campaigns.
 * Each tenant can create multiple campaigns with date ranges and target segments.
 *
 * Schedule: Daily at 6pm UTC (10am Pacific)
 * Endpoint: GET /api/cron/seasonal-reminders
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { seasonalReminder } from '@/lib/sms-templates'
import { getAllActiveTenants } from '@/lib/tenant'
import { logSystemEvent } from '@/lib/system-events'
import type { SeasonalCampaign } from '@/lib/tenant'

const BATCH_LIMIT = 50 // Max customers per campaign per run

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  console.log('[Seasonal Reminders] Starting cron job...')

  const client = getSupabaseClient()
  const tenants = await getAllActiveTenants()
  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

  let totalSent = 0
  let totalErrors = 0
  const results: Array<{ tenant: string; campaign: string; sent: number; errors: number }> = []

  for (const tenant of tenants) {
    if (!tenant.workflow_config.seasonal_reminders_enabled) continue

    const campaigns = tenant.workflow_config.seasonal_campaigns || []
    const activeCampaigns = campaigns.filter(
      (c: SeasonalCampaign) => c.enabled && c.start_date <= today && c.end_date >= today
    )

    if (activeCampaigns.length === 0) continue

    console.log(`[Seasonal Reminders] Tenant '${tenant.slug}': ${activeCampaigns.length} active campaigns`)

    for (const campaign of activeCampaigns) {
      let sent = 0
      let errors = 0

      try {
        // Build customer query based on target segment
        let customerQuery = client
          .from('customers')
          .select('id, first_name, phone_number, seasonal_reminder_tracker')
          .eq('tenant_id', tenant.id)
          .not('phone_number', 'is', null)

        // For segment-based targeting, we need to check job history
        if (campaign.target_segment !== 'all') {
          // Get customer IDs matching the segment via a subquery approach
          const segmentCustomerIds = await getSegmentCustomerIds(
            client,
            tenant.id,
            campaign.target_segment
          )

          if (segmentCustomerIds.length === 0) {
            console.log(`[Seasonal Reminders] No customers match segment '${campaign.target_segment}' for campaign '${campaign.name}'`)
            results.push({ tenant: tenant.slug, campaign: campaign.name, sent: 0, errors: 0 })
            continue
          }

          customerQuery = customerQuery.in('id', segmentCustomerIds)
        }

        const { data: customers, error: queryError } = await customerQuery.limit(BATCH_LIMIT * 2) // Fetch extra to account for dedup filtering

        if (queryError) {
          console.error(`[Seasonal Reminders] Query error for ${tenant.slug}/${campaign.name}:`, queryError)
          errors++
          results.push({ tenant: tenant.slug, campaign: campaign.name, sent, errors })
          continue
        }

        if (!customers || customers.length === 0) {
          results.push({ tenant: tenant.slug, campaign: campaign.name, sent: 0, errors: 0 })
          continue
        }

        // Filter out customers who already received this campaign
        const eligibleCustomers = customers.filter((c) => {
          const tracker = (c.seasonal_reminder_tracker || {}) as Record<string, string>
          return !tracker[campaign.id]
        }).slice(0, BATCH_LIMIT) // Apply batch limit after filtering

        console.log(`[Seasonal Reminders] Campaign '${campaign.name}': ${eligibleCustomers.length} eligible (${customers.length} total)`)

        for (const customer of eligibleCustomers) {
          try {
            const customerName = customer.first_name || 'there'
            const message = seasonalReminder(customerName, campaign.message)

            const smsResult = await sendSMS(tenant, customer.phone_number, message)

            if (!smsResult.success) {
              console.error(`[Seasonal Reminders] SMS failed for ${customer.id}:`, smsResult.error)
              errors++
              continue
            }

            // Save to messages table with seasonal_reminder source tag
            await client.from('messages').insert({
              tenant_id: tenant.id,
              customer_id: customer.id,
              phone_number: customer.phone_number,
              role: 'assistant',
              content: message,
              direction: 'outbound',
              message_type: 'sms',
              ai_generated: false,
              timestamp: new Date().toISOString(),
              source: 'seasonal_reminder',
              metadata: {
                campaign_id: campaign.id,
                campaign_name: campaign.name,
                target_segment: campaign.target_segment,
              },
            })

            // Update customer's seasonal_reminder_tracker
            const tracker = (customer.seasonal_reminder_tracker || {}) as Record<string, string>
            tracker[campaign.id] = new Date().toISOString()

            await client
              .from('customers')
              .update({ seasonal_reminder_tracker: tracker })
              .eq('id', customer.id)

            await logSystemEvent({
              source: 'cron',
              event_type: 'SEASONAL_REMINDER_SENT',
              message: `Seasonal reminder '${campaign.name}' sent to ${customerName}`,
              customer_id: customer.id,
              phone_number: customer.phone_number,
              metadata: {
                campaign_id: campaign.id,
                campaign_name: campaign.name,
                tenant_slug: tenant.slug,
                message_id: smsResult.messageId,
              },
            })

            sent++
            totalSent++
          } catch (err) {
            console.error(`[Seasonal Reminders] Error sending to ${customer.id}:`, err)
            errors++
            totalErrors++
          }
        }

        // Update campaign last_sent_at in workflow_config
        if (sent > 0) {
          const updatedCampaigns = [...campaigns]
          const idx = updatedCampaigns.findIndex((c: SeasonalCampaign) => c.id === campaign.id)
          if (idx >= 0) {
            updatedCampaigns[idx] = { ...updatedCampaigns[idx], last_sent_at: new Date().toISOString() }
            await client
              .from('tenants')
              .update({
                workflow_config: { ...tenant.workflow_config, seasonal_campaigns: updatedCampaigns },
              })
              .eq('id', tenant.id)
          }
        }
      } catch (campaignError) {
        console.error(`[Seasonal Reminders] Campaign error for ${campaign.name}:`, campaignError)
        errors++
        totalErrors++
      }

      results.push({ tenant: tenant.slug, campaign: campaign.name, sent, errors })
    }
  }

  console.log(`[Seasonal Reminders] Complete. Sent: ${totalSent}, Errors: ${totalErrors}`)

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    totalSent,
    totalErrors,
    results,
  })
}

/**
 * Get customer IDs matching a target segment based on their job history
 */
async function getSegmentCustomerIds(
  client: ReturnType<typeof getSupabaseClient>,
  tenantId: string,
  segment: SeasonalCampaign['target_segment']
): Promise<string[]> {
  const now = new Date()
  let cutoffDays: number

  switch (segment) {
    case 'inactive_30':
      cutoffDays = 30
      break
    case 'inactive_60':
      cutoffDays = 60
      break
    case 'inactive_90':
      cutoffDays = 90
      break
    case 'completed_customers':
      // Any customer with at least one completed job
      const { data: completedCustomers } = await client
        .from('jobs')
        .select('customer_id')
        .eq('tenant_id', tenantId)
        .eq('status', 'completed')
        .not('customer_id', 'is', null)

      if (!completedCustomers) return []
      return [...new Set(completedCustomers.map((j) => j.customer_id).filter(Boolean))]
    default:
      return []
  }

  // For inactive segments: find customers whose most recent completed job
  // is older than the cutoff, and who have no upcoming scheduled jobs
  const cutoffDate = new Date(now.getTime() - cutoffDays * 24 * 60 * 60 * 1000).toISOString()

  // Get customers with completed jobs older than cutoff
  const { data: oldJobs } = await client
    .from('jobs')
    .select('customer_id, completed_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'completed')
    .lt('completed_at', cutoffDate)
    .not('customer_id', 'is', null)

  if (!oldJobs || oldJobs.length === 0) return []

  const candidateIds = [...new Set(oldJobs.map((j) => j.customer_id).filter(Boolean))]

  // Exclude customers with recent or upcoming jobs
  const { data: recentJobs } = await client
    .from('jobs')
    .select('customer_id')
    .eq('tenant_id', tenantId)
    .in('status', ['scheduled', 'in_progress'])
    .in('customer_id', candidateIds)

  const excludeIds = new Set((recentJobs || []).map((j) => j.customer_id))
  return candidateIds.filter((id) => !excludeIds.has(id))
}

// POST method for compatibility
export async function POST(request: NextRequest) {
  return GET(request)
}
