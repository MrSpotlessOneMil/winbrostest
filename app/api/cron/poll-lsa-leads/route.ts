import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { scheduleLeadFollowUp } from '@/lib/scheduler'
import { logSystemEvent } from '@/lib/system-events'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'

// route-check:no-vercel-cron

/**
 * Cron: Poll Google LSA API for new leads (multi-tenant)
 * Runs every 15 minutes. For each tenant with use_google_lsa enabled,
 * fetches leads from the last 2 days, deduplicates, and creates new ones.
 *
 * Credentials resolve per-tenant with env var fallback:
 * - tenant.google_lsa_client_id || GOOGLE_LSA_CLIENT_ID
 * - tenant.google_lsa_client_secret || GOOGLE_LSA_CLIENT_SECRET
 * - tenant.google_lsa_refresh_token || GOOGLE_LSA_REFRESH_TOKEN
 * - tenant.google_lsa_account_id || GOOGLE_LSA_MANAGER_CID
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  try {
    // Get all tenants with LSA enabled
    const allTenants = await getAllActiveTenants()
    const lsaTenants = allTenants.filter(t =>
      t.workflow_config?.use_google_lsa === true
    )

    if (!lsaTenants.length) {
      return NextResponse.json({ success: true, message: 'No LSA-enabled tenants' })
    }

    const now = new Date()
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
    const client = getSupabaseServiceClient()

    const results: Record<string, { ingested: number; skipped: number; total: number }> = {}

    for (const tenant of lsaTenants) {
      // Resolve credentials with env var fallback
      const clientId = tenant.google_lsa_client_id || process.env.GOOGLE_LSA_CLIENT_ID
      const clientSecret = tenant.google_lsa_client_secret || process.env.GOOGLE_LSA_CLIENT_SECRET
      const refreshToken = tenant.google_lsa_refresh_token || process.env.GOOGLE_LSA_REFRESH_TOKEN
      const managerCid = tenant.google_lsa_account_id || process.env.GOOGLE_LSA_MANAGER_CID

      if (!clientId || !clientSecret || !refreshToken || !managerCid) {
        console.log(`[LSA] Tenant ${tenant.slug} missing LSA credentials — skipping`)
        continue
      }

      // Get fresh access token for this tenant
      const accessToken = await getAccessToken(clientId, clientSecret, refreshToken)
      if (!accessToken) {
        console.error(`[LSA] Failed to get access token for ${tenant.slug}`)
        continue
      }

      // Fetch leads for this tenant's account
      const leads = await fetchLSALeads(accessToken, managerCid, twoDaysAgo, now)
      if (!leads.length) {
        results[tenant.slug] = { ingested: 0, skipped: 0, total: 0 }
        continue
      }

      // Fetch account metrics
      const accountReport = await fetchAccountReport(accessToken, managerCid, twoDaysAgo, now)

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
          console.log(`[LSA] Lead ${lead.leadId} has no phone — skipping (${tenant.slug})`)
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
          console.error(`[LSA] Error creating lead ${lead.leadId} for ${tenant.slug}:`, leadError.message)
          continue
        }

        // For phone calls, VAPI already created a lead with source='phone' — find it and update source to google_lsa
        if (lead.leadType === 'PHONE_CALL') {
          const lsaCreatedAt = lead.leadCreationTimestamp ? new Date(lead.leadCreationTimestamp) : new Date()
          const matchWindow = new Date(lsaCreatedAt.getTime() - 5 * 60 * 1000).toISOString()
          const matchWindowEnd = new Date(lsaCreatedAt.getTime() + 5 * 60 * 1000).toISOString()

          const { data: vapiLead } = await client
            .from('leads')
            .select('id, source')
            .eq('phone_number', phone)
            .eq('tenant_id', tenant.id)
            .eq('source', 'phone')
            .gte('created_at', matchWindow)
            .lte('created_at', matchWindowEnd)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (vapiLead) {
            await client.from('leads').update({ source: 'google_lsa' }).eq('id', vapiLead.id)
            await client.from('customers').update({ lead_source: 'google_lsa' }).eq('phone_number', phone).eq('tenant_id', tenant.id)
            console.log(`[LSA] Updated existing VAPI lead ${vapiLead.id} source to google_lsa (${tenant.slug})`)
          } else {
            await client.from('customers').update({ lead_source: 'google_lsa' }).eq('phone_number', phone).eq('tenant_id', tenant.id)
          }
        }

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

      results[tenant.slug] = { ingested, skipped, total: leads.length }
      console.log(`[LSA] ${tenant.slug}: ${leads.length} leads — ${ingested} ingested, ${skipped} skipped`)
    }

    return NextResponse.json({ success: true, results })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[LSA] Cron error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
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
