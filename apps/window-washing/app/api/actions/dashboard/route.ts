/**
 * GET /api/actions/dashboard
 *
 * Aggregated Command Center data:
 *   - Revenue: today, this week, this month
 *   - Active jobs today
 *   - Upcoming jobs this week
 *   - Service plans: count + ARR
 *   - Outstanding quotes in pipeline
 *   - Team utilization (crews working today)
 *   - Today's schedule preview (next 5 jobs)
 */

// route-check:no-vercel-cron

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(monday.getDate() + diff)
  return monday
}

function endOfWeek(d: Date): Date {
  const monday = startOfWeek(d)
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  return sunday
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function getAnnualMultiplier(planType: string): number {
  switch (planType) {
    case 'quarterly': return 4
    case 'triannual': case 'triannual_exterior': return 3
    case 'monthly': return 12
    case 'biannual': return 2
    default: return 1
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const client = getSupabaseServiceClient()
  const tenantId = tenant.id
  const now = new Date()
  const today = isoDate(now)
  const weekStart = isoDate(startOfWeek(now))
  const weekEnd = isoDate(endOfWeek(now))
  const monthStart = isoDate(startOfMonth(now))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)

  try {
    const [
      todayJobsRes,
      weekJobsRes,
      monthJobsRes,
      upcomingJobsRes,
      servicePlansRes,
      outstandingQuotesRes,
      crewDaysRes,
      cleanersRes,
      todayScheduleRes,
    ] = await Promise.all([
      // Today's completed jobs (revenue)
      client
        .from('jobs')
        .select('id, price, status, date, completed_at')
        .eq('tenant_id', tenantId)
        .eq('date', today)
        .neq('status', 'cancelled'),

      // This week's completed jobs (revenue)
      client
        .from('jobs')
        .select('id, price, status, date, completed_at')
        .eq('tenant_id', tenantId)
        .gte('date', weekStart)
        .lte('date', weekEnd)
        .eq('status', 'completed'),

      // This month's completed jobs (revenue)
      client
        .from('jobs')
        .select('id, price, status')
        .eq('tenant_id', tenantId)
        .gte('date', monthStart)
        .lte('date', today)
        .eq('status', 'completed'),

      // Upcoming jobs this week (not yet completed)
      client
        .from('jobs')
        .select('id, status, date')
        .eq('tenant_id', tenantId)
        .gte('date', today)
        .lte('date', weekEnd)
        .in('status', ['scheduled', 'confirmed', 'in_progress']),

      // Active service plans
      client
        .from('service_plans')
        .select('id, plan_type, plan_price, status')
        .eq('tenant_id', tenantId)
        .eq('status', 'active'),

      // Outstanding quotes (sent but not approved)
      client
        .from('quotes')
        .select('id, total_price, status')
        .eq('tenant_id', tenantId)
        .in('status', ['draft', 'sent', 'viewed']),

      // Crew days for today (team utilization)
      client
        .from('crew_days')
        .select('id, team_lead_id')
        .eq('tenant_id', tenantId)
        .eq('date', today),

      // All active cleaners
      client
        .from('cleaners')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('active', true),

      // Today's schedule preview (next jobs with details)
      client
        .from('jobs')
        .select('id, customer_name, address, scheduled_time, date, price, status, service_type, team_id')
        .eq('tenant_id', tenantId)
        .eq('date', today)
        .in('status', ['scheduled', 'confirmed', 'in_progress'])
        .order('scheduled_time', { ascending: true })
        .limit(6),
    ])

    // Revenue calculations
    const todayJobs = todayJobsRes.data || []
    const todayRevenue = todayJobs
      .filter(j => j.status === 'completed')
      .reduce((sum, j) => sum + Number(j.price || 0), 0)

    const activeJobsToday = todayJobs.filter(j =>
      ['scheduled', 'confirmed', 'in_progress'].includes(j.status || '')
    ).length

    const completedToday = todayJobs.filter(j => j.status === 'completed').length

    const weekRevenue = (weekJobsRes.data || [])
      .reduce((sum, j) => sum + Number(j.price || 0), 0)

    const monthRevenue = (monthJobsRes.data || [])
      .reduce((sum, j) => sum + Number(j.price || 0), 0)

    const upcomingJobsCount = (upcomingJobsRes.data || []).length

    // Service plans
    const activePlans = servicePlansRes.data || []
    const totalARR = activePlans.reduce((sum, p) => {
      const price = Number(p.plan_price || 0)
      const multiplier = getAnnualMultiplier(p.plan_type || '')
      return sum + (price * multiplier)
    }, 0)

    // Outstanding quotes
    const outstandingQuotes = outstandingQuotesRes.data || []
    const pipelineValue = outstandingQuotes.reduce(
      (sum, q) => sum + Number(q.total_price || 0), 0
    )

    // Team utilization
    const crewsWorking = (crewDaysRes.data || []).length
    const totalCrews = (cleanersRes.data || []).length

    // Schedule preview
    const schedulePreview = (todayScheduleRes.data || []).map(j => ({
      id: j.id,
      customer: j.customer_name || 'Unknown',
      address: j.address || '',
      time: j.scheduled_time || '',
      price: Number(j.price || 0),
      status: j.status,
      service: j.service_type || 'window_cleaning',
      team_id: j.team_id,
    }))

    return NextResponse.json({
      success: true,
      data: {
        revenue: {
          today: todayRevenue,
          week: weekRevenue,
          month: monthRevenue,
        },
        jobs: {
          activeToday: activeJobsToday,
          completedToday,
          upcomingThisWeek: upcomingJobsCount,
          totalToday: todayJobs.length,
        },
        servicePlans: {
          activeCount: activePlans.length,
          totalARR,
        },
        pipeline: {
          outstandingQuotes: outstandingQuotes.length,
          pipelineValue,
        },
        teamUtilization: {
          crewsWorking,
          totalCrews,
        },
        schedulePreview,
      },
    })
  } finally {
    clearTimeout(timeout)
  }
}
