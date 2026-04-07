/**
 * GET /api/actions/insights-v2
 *
 * Real P&L insights powered by Stripe (actual collected revenue),
 * cleaner pay, expenses, lead source economics with ROI.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getStripeClientForTenant } from '@/lib/stripe-client'
import type Stripe from 'stripe'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const supabase = getSupabaseServiceClient()
  const now = new Date()
  const yearStart = `${now.getFullYear()}-01-01`
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)

  // Chart range: week (7d), month (30d), year (365d)
  const chartRange = request.nextUrl.searchParams.get('chart_range') || 'month'
  const chartDays = chartRange === 'week' ? 7 : chartRange === 'year' ? 365 : 30
  const chartStart = new Date(now.getTime() - chartDays * 24 * 60 * 60 * 1000)

  // Trailing 12-month window
  const trailing12Start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1)

  // ── Stripe Revenue (source of truth) ──
  // Pull all succeeded charges from Stripe for the trailing 12 months
  let allCharges: Stripe.Charge[] = []
  let stripeError = false
  if (tenant.stripe_secret_key) {
    try {
      const stripe = getStripeClientForTenant(tenant.stripe_secret_key)
      const sinceTs = Math.floor(trailing12Start.getTime() / 1000)
      let hasMore = true
      let startingAfter: string | undefined
      while (hasMore) {
        const params: Stripe.ChargeListParams = {
          limit: 100,
          created: { gte: sinceTs },
        }
        if (startingAfter) params.starting_after = startingAfter
        const batch = await stripe.charges.list(params)
        const succeeded = batch.data.filter(c => c.status === 'succeeded')
        allCharges.push(...succeeded)
        hasMore = batch.has_more
        if (batch.data.length > 0) {
          startingAfter = batch.data[batch.data.length - 1].id
        } else {
          hasMore = false
        }
      }
    } catch {
      stripeError = true
    }
  }

  // Bucket Stripe charges by period (used if Stripe is active)
  const yearStartTs = new Date(`${yearStart}T00:00:00Z`).getTime() / 1000
  const monthStartTs = new Date(`${monthStart}T00:00:00Z`).getTime() / 1000
  const monthEndTs = new Date(`${monthEnd}T23:59:59Z`).getTime() / 1000
  const chartStartTs = Math.floor(chartStart.getTime() / 1000)

  const monthCharges = allCharges.filter(c => c.created >= monthStartTs && c.created <= monthEndTs)
  const yearCharges = allCharges.filter(c => c.created >= yearStartTs)

  // ── DB Queries (jobs for fallback revenue, recurring detection, leads, expenses) ──
  const trailing12StartStr = trailing12Start.toISOString().slice(0, 10)
  const [monthJobsRes, yearJobsRes, trailing12JobsRes, recurringJobsRes, chartJobsRes, expensesRes, leadsRes, retargetingRes] = await Promise.all([
    // Monthly completed jobs (fallback revenue)
    supabase.from('jobs')
      .select('id, price, customer_id, completed_at, date')
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')
      .or(`and(completed_at.gte.${monthStart}T00:00:00Z,completed_at.lte.${monthEnd}T23:59:59Z),and(completed_at.is.null,date.gte.${monthStart},date.lte.${monthEnd})`)
      .not('price', 'is', null),

    // YTD completed jobs (recurring detection + fallback + lead economics)
    supabase.from('jobs')
      .select('id, price, customer_id, completed_at, date, phone_number')
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')
      .or(`and(completed_at.gte.${yearStart}T00:00:00Z),and(completed_at.is.null,date.gte.${yearStart})`)
      .not('price', 'is', null),

    // Trailing 12-month completed jobs (fallback)
    supabase.from('jobs')
      .select('id, price, customer_id, completed_at, date')
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')
      .or(`and(completed_at.gte.${trailing12StartStr}T00:00:00Z),and(completed_at.is.null,date.gte.${trailing12StartStr})`)
      .not('price', 'is', null),

    // Recurring jobs — completed only
    supabase.from('jobs')
      .select('id, price, frequency, customer_id')
      .eq('tenant_id', tenant.id)
      .not('frequency', 'eq', 'one-time')
      .not('frequency', 'is', null)
      .eq('status', 'completed')
      .not('price', 'is', null),

    // Chart jobs (fallback for chart when no Stripe)
    supabase.from('jobs')
      .select('id, price, completed_at, service_type, phone_number, address')
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')
      .gte('completed_at', `${chartStart.toISOString().slice(0, 10)}T00:00:00Z`)
      .not('price', 'is', null)
      .order('completed_at', { ascending: true }),

    // Expenses this month
    supabase.from('expenses')
      .select('id, category, amount, date')
      .eq('tenant_id', tenant.id)
      .gte('date', monthStart),

    // Leads this year
    supabase.from('leads')
      .select('id, source, status, phone_number, created_at')
      .eq('tenant_id', tenant.id)
      .gte('created_at', `${yearStart}T00:00:00Z`),

    // Retargeting stats
    supabase.from('customers')
      .select('id, retargeting_sequence, retargeting_step, retargeting_stopped_reason, lifecycle_stage')
      .eq('tenant_id', tenant.id)
      .not('retargeting_sequence', 'is', null),
  ])

  const monthJobs = monthJobsRes.data || []
  const yearJobs = yearJobsRes.data || []
  const trailing12Jobs = trailing12JobsRes.data || []
  const recurringJobs = recurringJobsRes.data || []
  const chartJobs = chartJobsRes.data || []
  const expenses = expensesRes.data || []
  const leads = leadsRes.data || []
  const retargetingCustomers = retargetingRes.data || []

  // ── Revenue Source: Stripe if it has YTD charges, otherwise job prices ──
  const useStripe = !stripeError && yearCharges.length > 0
  const revenueSource = useStripe ? 'stripe' as const : 'jobs' as const

  let monthlyRevenue: number
  let annualRevenue: number
  let trailing12Revenue: number

  if (useStripe) {
    monthlyRevenue = monthCharges.reduce((sum, c) => sum + c.amount, 0) / 100
    annualRevenue = yearCharges.reduce((sum, c) => sum + c.amount, 0) / 100
    trailing12Revenue = allCharges.reduce((sum, c) => sum + c.amount, 0) / 100
  } else {
    monthlyRevenue = monthJobs.reduce((sum, j) => sum + Number(j.price), 0)
    annualRevenue = yearJobs.reduce((sum, j) => sum + Number(j.price), 0)
    trailing12Revenue = trailing12Jobs.reduce((sum, j) => sum + Number(j.price), 0)
  }

  // Build daily chart — Stripe charges if available, otherwise job completions
  const dailyMap: Record<string, { revenue: number; count: number }> = {}
  if (useStripe) {
    const chartCharges = allCharges.filter(c => c.created >= chartStartTs)
    for (const c of chartCharges) {
      const day = new Date(c.created * 1000).toISOString().slice(0, 10)
      if (!dailyMap[day]) dailyMap[day] = { revenue: 0, count: 0 }
      dailyMap[day].revenue += c.amount / 100
      dailyMap[day].count++
    }
  } else {
    for (const j of chartJobs) {
      if (!j.completed_at) continue
      const day = new Date(j.completed_at).toISOString().slice(0, 10)
      if (!dailyMap[day]) dailyMap[day] = { revenue: 0, count: 0 }
      dailyMap[day].revenue += Number(j.price)
      dailyMap[day].count++
    }
  }

  const dailyChart: { date: string; label: string; revenue: number; jobs: number; job_details: never[] }[] = []
  const labelFmt = chartRange === 'year'
    ? { month: 'short' as const }
    : { month: 'short' as const, day: 'numeric' as const }
  for (let i = 0; i < chartDays; i++) {
    const d = new Date(now.getTime() - (chartDays - 1 - i) * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    const label = d.toLocaleDateString('en-US', labelFmt)
    const entry = dailyMap[key]
    dailyChart.push({
      date: key,
      label,
      revenue: entry?.revenue || 0,
      jobs: entry?.count || 0,
      job_details: [],
    })
  }

  // ── Recurring Detection ──
  const yearCustomerJobCounts: Record<string, number> = {}
  for (const j of yearJobs) {
    if (j.customer_id) {
      yearCustomerJobCounts[j.customer_id] = (yearCustomerJobCounts[j.customer_id] || 0) + 1
    }
  }
  const repeatCustomerIds = new Set(
    Object.entries(yearCustomerJobCounts)
      .filter(([, count]) => count >= 2)
      .map(([id]) => id)
  )
  const recurringCustomerIds = new Set(
    recurringJobs.filter(j => j.customer_id).map(j => String(j.customer_id))
      .concat(Array.from(repeatCustomerIds))
  )
  const recurringClientCount = recurringCustomerIds.size

  // Estimate recurring share from job data (apply ratio to Stripe revenue)
  const yearJobTotal = yearJobs.reduce((sum, j) => sum + Number(j.price), 0)
  const yearRecurringTotal = yearJobs
    .filter(j => j.customer_id && recurringCustomerIds.has(String(j.customer_id)))
    .reduce((sum, j) => sum + Number(j.price), 0)
  const recurringPct = yearJobTotal > 0 ? yearRecurringTotal / yearJobTotal : 0

  const monthlyRecurring = Math.round(monthlyRevenue * recurringPct)
  const monthlyOneTime = monthlyRevenue - monthlyRecurring
  const annualRecurring = Math.round(annualRevenue * recurringPct)
  const annualOneTime = annualRevenue - annualRecurring

  // ── Profit & Loss ──
  const cleanerPayPct = tenant.workflow_config?.cleaner_pay_percentage || 0
  const cleanerPay = monthlyRevenue * (cleanerPayPct / 100)
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const adSpend = expenses.filter(e => e.category.startsWith('ad_spend')).reduce((sum, e) => sum + Number(e.amount), 0)
  const profitMargin = monthlyRevenue - cleanerPay - totalExpenses

  // ── Lead Source Economics (still job-based — Stripe doesn't track lead source) ──
  const leadPhones = [...new Set(leads.map(l => l.phone_number).filter(Boolean))]
  let jobsByPhone: Record<string, { revenue: number; count: number }> = {}

  if (leadPhones.length > 0) {
    const { data: leadJobs } = await supabase
      .from('jobs')
      .select('phone_number, price')
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')
      .gte('completed_at', `${yearStart}T00:00:00Z`)
      .in('phone_number', leadPhones)
      .not('price', 'is', null)

    for (const j of (leadJobs || [])) {
      const phone = j.phone_number || ''
      if (!jobsByPhone[phone]) jobsByPhone[phone] = { revenue: 0, count: 0 }
      jobsByPhone[phone].revenue += Number(j.price)
      jobsByPhone[phone].count++
    }
  }

  const expenseByCategory: Record<string, number> = {}
  for (const e of expenses) {
    expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + Number(e.amount)
  }

  const sourceMap: Record<string, { leads: number; booked: number; revenue: number; cost: number }> = {}
  for (const lead of leads) {
    const src = lead.source || 'unknown'
    if (!sourceMap[src]) sourceMap[src] = { leads: 0, booked: 0, revenue: 0, cost: 0 }
    sourceMap[src].leads++
    if (lead.status === 'booked') sourceMap[src].booked++
    if (lead.phone_number && jobsByPhone[lead.phone_number]) {
      sourceMap[src].revenue += jobsByPhone[lead.phone_number].revenue
    }
  }

  const categoryToSource: Record<string, string> = {
    ad_spend_meta: 'meta',
    ad_spend_google: 'google',
    ad_spend_google_lsa: 'google_lsa',
    ad_spend_thumbtack: 'thumbtack',
    ad_spend_angi: 'angi',
  }
  for (const [cat, src] of Object.entries(categoryToSource)) {
    if (expenseByCategory[cat] && sourceMap[src]) {
      sourceMap[src].cost = expenseByCategory[cat]
    }
  }

  const leadSources = Object.entries(sourceMap)
    .map(([source, data]) => ({
      source,
      ...data,
      conversionRate: data.leads > 0 ? Math.round((data.booked / data.leads) * 100) : 0,
      roi: data.cost > 0 ? Math.round(((data.revenue - data.cost) / data.cost) * 100) : null,
      profit: data.revenue - data.cost,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  // Retargeting stats
  const activeSequences = retargetingCustomers.filter((c: any) => !c.retargeting_stopped_reason).length
  const converted = retargetingCustomers.filter((c: any) => c.retargeting_stopped_reason === 'converted').length
  const completed = retargetingCustomers.filter((c: any) => c.retargeting_stopped_reason === 'completed').length
  const totalRetargeted = retargetingCustomers.length

  return NextResponse.json({
    revenue: {
      monthly: monthlyRevenue,
      monthly_recurring: monthlyRecurring,
      monthly_one_time: monthlyOneTime,
      annual: annualRevenue,
      annual_recurring: annualRecurring,
      annual_one_time: annualOneTime,
      trailing_12_annual: trailing12Revenue,
      recurring_client_count: recurringClientCount,
      source: revenueSource,
    },
    pnl: {
      revenue: monthlyRevenue,
      cleaner_pay: cleanerPay,
      cleaner_pay_pct: cleanerPayPct,
      ad_spend: adSpend,
      other_expenses: totalExpenses - adSpend,
      total_expenses: totalExpenses,
      profit: profitMargin,
      margin_pct: monthlyRevenue > 0 ? Math.round((profitMargin / monthlyRevenue) * 100) : 0,
    },
    lead_sources: leadSources,
    chart: dailyChart,
    chart_range: chartRange,
    retargeting: {
      active_sequences: activeSequences,
      converted: converted,
      completed: completed,
      total_retargeted: totalRetargeted,
      conversion_rate: totalRetargeted > 0 ? Math.round((converted / totalRetargeted) * 100) : 0,
    },
    month_name: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  })
}
