/**
 * Meta Ads Daily Monitor
 *
 * Runs daily at 9 AM PT (16:00 UTC).
 * Checks lead flow from Meta campaigns, calculates funnel metrics,
 * and sends Dominic a daily SMS performance summary.
 *
 * Tracks: leads, bookings, conversion rate, CPL trends.
 * Sends to: 424-275-5847 (Dominic's personal)
 *
 * Endpoint: GET /api/cron/meta-ads-monitor
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getTenantBySlug } from '@/lib/tenant'
import { sendSMS } from '@/lib/openphone'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DOMINIC_PHONE = '+14242755847'
const SPOTLESS_SLUG = 'spotless-scrubbers'

// Campaign display names
const CAMPAIGN_NAMES: Record<string, string> = {
  '149-deep-clean': '$149 Deep',
  '99-3hr-clean': '$99 3hr',
  '99-deep-clean': '$99 Deep (old)',
  'book-now': 'Book Now',
  'airbnb-turnover': 'Airbnb',
}

interface CampaignStats {
  campaign: string
  last24h: number
  total: number
  booked: number
  qualified: number
  lost: number
  conversionRate: number
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const client = getSupabaseServiceClient()
  const tenant = await getTenantBySlug(SPOTLESS_SLUG)

  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  try {
    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    // Get ALL meta/website leads for Spotless
    const { data: allLeads } = await client
      .from('leads')
      .select('id, status, source, created_at, form_data')
      .eq('tenant_id', tenant.id)
      .eq('source', 'website')
      .order('created_at', { ascending: false })

    if (!allLeads || allLeads.length === 0) {
      // No meta leads yet — send a "no data" message only on Mondays
      const dayOfWeek = now.getDay()
      if (dayOfWeek === 1) {
        await sendSMS(tenant, DOMINIC_PHONE,
          `[Meta Ads Daily] No website/Meta leads yet. Campaigns may still be in learning phase. Check Ads Manager for delivery status.`,
          { source: 'meta_ads_monitor' }
        )
      }
      return NextResponse.json({ status: 'no_leads', message: 'No meta leads found' })
    }

    // Group by utm_campaign
    const campaignMap = new Map<string, {
      total: number
      last24h: number
      booked: number
      qualified: number
      lost: number
      newLeads: number
    }>()

    for (const lead of allLeads) {
      const formData = lead.form_data as Record<string, unknown> | null
      const campaign = (formData?.utm_campaign as string) || 'unknown'

      if (!campaignMap.has(campaign)) {
        campaignMap.set(campaign, { total: 0, last24h: 0, booked: 0, qualified: 0, lost: 0, newLeads: 0 })
      }

      const stats = campaignMap.get(campaign)!
      stats.total++

      if (new Date(lead.created_at) >= yesterday) {
        stats.last24h++
      }

      switch (lead.status) {
        case 'booked': stats.booked++; break
        case 'qualified': stats.qualified++; break
        case 'lost': stats.lost++; break
        case 'new': stats.newLeads++; break
      }
    }

    // Build the stats array
    const campaignStats: CampaignStats[] = []
    Array.from(campaignMap.entries()).forEach(([campaign, stats]) => {
      campaignStats.push({
        campaign,
        last24h: stats.last24h,
        total: stats.total,
        booked: stats.booked,
        qualified: stats.qualified,
        lost: stats.lost,
        conversionRate: stats.total > 0 ? (stats.booked / stats.total) * 100 : 0,
      })
    })

    // Sort by total leads descending
    campaignStats.sort((a, b) => b.total - a.total)

    // Count jobs created from quotes (meta-sourced)
    const { count: metaJobs } = await client
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .not('quote_id', 'is', null)
      .gte('created_at', '2026-04-13')

    // Build SMS message
    const totalLeads = allLeads.length
    const totalLast24h = campaignStats.reduce((s, c) => s + c.last24h, 0)
    const totalBooked = campaignStats.reduce((s, c) => s + c.booked, 0)
    const totalQualified = campaignStats.reduce((s, c) => s + c.qualified, 0)
    const overallConversion = totalLeads > 0 ? ((totalBooked / totalLeads) * 100).toFixed(0) : '0'

    let sms = `[Meta Ads Daily Report]\n`
    sms += `Last 24h: ${totalLast24h} new leads\n`
    sms += `All-time: ${totalLeads} leads | ${totalBooked} booked (${overallConversion}%) | ${totalQualified} in pipeline\n\n`

    for (const cs of campaignStats) {
      const name = CAMPAIGN_NAMES[cs.campaign] || cs.campaign
      const conv = cs.total > 0 ? `${((cs.booked / cs.total) * 100).toFixed(0)}%` : '-'
      sms += `${name}: ${cs.last24h} new / ${cs.total} total / ${cs.booked} booked (${conv})\n`
    }

    if (metaJobs && metaJobs > 0) {
      sms += `\nJobs from Meta: ${metaJobs}`
    }

    // Add alerts
    const alerts: string[] = []

    // Alert: no leads in 48 hours
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000)
    const recentLeads = allLeads.filter(l => new Date(l.created_at) >= twoDaysAgo)
    if (recentLeads.length === 0) {
      alerts.push('NO leads in 48 hours - check if ads are running!')
    }

    // Alert: high loss rate
    const totalLost = campaignStats.reduce((s, c) => s + c.lost, 0)
    if (totalLeads > 5 && (totalLost / totalLeads) > 0.5) {
      alerts.push(`High loss rate: ${((totalLost / totalLeads) * 100).toFixed(0)}% of leads lost`)
    }

    // Alert: $99 campaign getting leads (should be paused)
    const ninety9Stats = campaignStats.find(c => c.campaign === '99-3hr-clean')
    if (ninety9Stats && ninety9Stats.last24h > 0) {
      alerts.push('$99 campaign is getting leads - was it turned back on?')
    }

    if (alerts.length > 0) {
      sms += `\nALERTS:\n${alerts.map(a => `- ${a}`).join('\n')}`
    }

    // Send SMS — bypassFilters because this is an owner notification, not a customer text
    const smsResult = await sendSMS(tenant, DOMINIC_PHONE, sms, {
      source: 'meta_ads_monitor',
      bypassFilters: true,
    })

    // Log the report
    console.log('[Meta Ads Monitor] Daily report sent:', {
      totalLeads,
      totalLast24h,
      totalBooked,
      campaigns: campaignStats.length,
      smsSent: smsResult.success,
    })

    return NextResponse.json({
      status: 'ok',
      report: {
        totalLeads,
        totalLast24h,
        totalBooked,
        totalQualified,
        overallConversion: `${overallConversion}%`,
        campaigns: campaignStats,
        alerts,
        smsSent: smsResult.success,
      },
    })
  } catch (error) {
    console.error('[Meta Ads Monitor] Error:', error)
    return NextResponse.json({ error: 'Monitor failed' }, { status: 500 })
  }
}
