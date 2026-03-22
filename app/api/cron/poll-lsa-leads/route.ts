import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { scheduleLeadFollowUp } from '@/lib/scheduler'
import { logSystemEvent } from '@/lib/system-events'
import { getTenantBySlug } from '@/lib/tenant'

// route-check:no-vercel-cron

/**
 * Cron: Poll Google LSA API for new leads
 * Runs every 15 minutes. Fetches leads from the last 2 days,
 * deduplicates against already-ingested leads, and creates new ones.
 *
 * Only processes leads for tenants with LSA config in workflow_config.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const clientId = process.env.GOOGLE_LSA_CLIENT_ID
  const clientSecret = process.env.GOOGLE_LSA_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_LSA_REFRESH_TOKEN
  const managerCid = process.env.GOOGLE_LSA_MANAGER_CID

  if (!clientId || !clientSecret || !refreshToken || !managerCid) {
    return NextResponse.json({ success: false, error: 'LSA API not configured' })
  }

  try {
    // Get fresh access token
    const accessToken = await getAccessToken(clientId, clientSecret, refreshToken)
    if (!accessToken) {
      return NextResponse.json({ success: false, error: 'Failed to get access token' })
    }

    // Fetch leads from last 2 days
    const now = new Date()
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

    const leads = await fetchLSALeads(accessToken, managerCid, twoDaysAgo, now)
    if (!leads.length) {
      return NextResponse.json({ success: true, processed: 0, message: 'No new LSA leads' })
    }

    // Also fetch account reports for metrics
    const accountReport = await fetchAccountReport(accessToken, managerCid, twoDaysAgo, now)

    const client = getSupabaseServiceClient()

    // Map LSA account IDs to tenants
    // For now, all leads go to spotless-scrubbers since that's the only LSA account
    const tenant = await getTenantBySlug('spotless-scrubbers')
    if (!tenant) {
      return NextResponse.json({ success: false, error: 'Spotless Scrubbers tenant not found' })
    }

    let ingested = 0
    let skipped = 0

    for (const lead of leads) {
      // Dedup by LSA lead ID
      const { data: existing } = await client
        .from('leads')
        .select('id')
        .eq('source_id', `lsa-${lead.leadId}`)
        .eq('tenant_id', tenant.id)
        .limit(1)
        .maybeSingle()

      if (existing) {
        skipped++
        continue
      }

      // Extract contact info based on lead type
      let phone = ''
      let customerName = ''
      let email = ''
      const jobType = lead.leadCategory || ''

      if (lead.leadType === 'PHONE_CALL' && lead.phoneLead) {
        phone = normalizePhoneNumber(lead.phoneLead.consumerPhoneNumber || '') || ''
      } else if (lead.leadType === 'MESSAGE' && lead.messageLead) {
        phone = normalizePhoneNumber(lead.messageLead.consumerPhoneNumber || '') || ''
        customerName = lead.messageLead.customerName || ''
      } else if (lead.leadType === 'BOOKING' && lead.bookingLead) {
        phone = normalizePhoneNumber(lead.bookingLead.consumerPhoneNumber || '') || ''
        customerName = lead.bookingLead.customerName || ''
        email = lead.bookingLead.consumerEmail || ''
      }

      if (!phone) {
        console.log(`[LSA] Lead ${lead.leadId} has no phone — skipping`)
        skipped++
        continue
      }

      const firstName = customerName.split(' ')[0] || ''
      const lastName = customerName.split(' ').slice(1).join(' ') || ''

      // Upsert customer
      const { data: customer } = await client
        .from('customers')
        .upsert(
          {
            phone_number: phone,
            tenant_id: tenant.id,
            first_name: firstName || null,
            last_name: lastName || null,
            email: email || null,
            lead_source: 'google_lsa',
          },
          { onConflict: 'tenant_id,phone_number' }
        )
        .select('id')
        .single()

      // Create lead
      const { data: newLead, error: leadError } = await client
        .from('leads')
        .insert({
          tenant_id: tenant.id,
          source_id: `lsa-${lead.leadId}`,
          phone_number: phone,
          customer_id: customer?.id ?? null,
          first_name: firstName || null,
          last_name: lastName || null,
          email: email || null,
          source: 'google_lsa',
          status: 'new',
          form_data: {
            lsa_lead_id: lead.leadId,
            lsa_lead_type: lead.leadType,
            lsa_category: lead.leadCategory,
            lsa_geo: lead.geo,
            lsa_charged: lead.chargeStatus,
            lsa_created_at: lead.leadCreationTimestamp,
            job_type: jobType,
            lsa_account_id: lead.accountId,
          },
          followup_stage: 0,
          followup_started_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (leadError) {
        console.error(`[LSA] Error creating lead ${lead.leadId}:`, leadError.message)
        continue
      }

      // For phone calls, VAPI/Sarah already handled the call — don't schedule SMS follow-up
      // For message leads, schedule follow-up
      if (lead.leadType === 'MESSAGE' && newLead?.id) {
        const leadName = customerName || 'Customer'
        await scheduleLeadFollowUp(tenant.id, String(newLead.id), phone, leadName)
      }

      await logSystemEvent({
        tenant_id: tenant.id,
        source: 'google_lsa',
        event_type: 'LSA_LEAD_RECEIVED',
        message: `New LSA ${lead.leadType} lead: ${customerName || phone}`,
        phone_number: phone,
        metadata: {
          lead_id: newLead?.id,
          lsa_lead_id: lead.leadId,
          lead_type: lead.leadType,
          category: lead.leadCategory,
          charged: lead.chargeStatus,
        },
      })

      ingested++
    }

    // Store account metrics for dashboard
    if (accountReport) {
      await logSystemEvent({
        tenant_id: tenant.id,
        source: 'google_lsa',
        event_type: 'LSA_METRICS_SNAPSHOT',
        message: `LSA metrics: ${accountReport.currentPeriodChargedLeads || 0} charged leads, $${accountReport.currentPeriodTotalCost || 0} spend`,
        metadata: {
          ...accountReport,
          snapshot_at: new Date().toISOString(),
        },
      })
    }

    console.log(`[LSA] Processed ${leads.length} leads: ${ingested} ingested, ${skipped} skipped`)
    return NextResponse.json({ success: true, total: leads.length, ingested, skipped })

  } catch (error: any) {
    console.error('[LSA] Cron error:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

// ── Helpers ──

async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `refresh_token=${encodeURIComponent(refreshToken)}&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=refresh_token`,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) return null
    const data = await res.json()
    return data.access_token || null
  } catch {
    clearTimeout(timeout)
    return null
  }
}

async function fetchLSALeads(accessToken: string, managerCid: string, startDate: Date, endDate: Date): Promise<any[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const url = `https://localservices.googleapis.com/v1/detailedLeadReports:search?query=manager_customer_id:${managerCid}&startDate.year=${startDate.getFullYear()}&startDate.month=${startDate.getMonth() + 1}&startDate.day=${startDate.getDate()}&endDate.year=${endDate.getFullYear()}&endDate.month=${endDate.getMonth() + 1}&endDate.day=${endDate.getDate()}&pageSize=100`

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      console.error('[LSA] API error:', res.status, await res.text())
      return []
    }

    const data = await res.json()
    return data.detailedLeadReports || []
  } catch {
    clearTimeout(timeout)
    return []
  }
}

async function fetchAccountReport(accessToken: string, managerCid: string, startDate: Date, endDate: Date): Promise<any | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const url = `https://localservices.googleapis.com/v1/accountReports:search?query=manager_customer_id:${managerCid}&startDate.year=${startDate.getFullYear()}&startDate.month=${startDate.getMonth() + 1}&startDate.day=${startDate.getDate()}&endDate.year=${endDate.getFullYear()}&endDate.month=${endDate.getMonth() + 1}&endDate.day=${endDate.getDate()}`

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) return null
    const data = await res.json()
    return data.accountReports?.[0] || null
  } catch {
    clearTimeout(timeout)
    return null
  }
}
