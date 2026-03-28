/**
 * GET /api/actions/insights-v2
 *
 * Real P&L insights: revenue (monthly/annual/recurring/projected),
 * cleaner pay, expenses, lead source economics with ROI.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const supabase = getSupabaseServiceClient()
  const now = new Date()
  const yearStart = `${now.getFullYear()}-01-01`
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()

  // Chart range: week (7d), month (30d), year (365d)
  const chartRange = request.nextUrl.searchParams.get('chart_range') || 'month'
  const chartDays = chartRange === 'week' ? 7 : chartRange === 'year' ? 365 : 30
  const chartStart = new Date(now.getTime() - chartDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // ── Revenue Queries ──
  const [monthJobsRes, yearJobsRes, recurringJobsRes, expensesRes, leadsRes, chartJobsRes] = await Promise.all([
    // Monthly completed jobs
    supabase.from('jobs')
      .select('id, price, frequency, customer_id')
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')
      .gte('completed_at', `${monthStart}T00:00:00Z`)
      .not('price', 'is', null),

    // Annual completed jobs
    supabase.from('jobs')
      .select('id, price, frequency, customer_id')
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')
      .gte('completed_at', `${yearStart}T00:00:00Z`)
      .not('price', 'is', null),

    // Active recurring jobs (for projection)
    supabase.from('jobs')
      .select('id, price, frequency, customer_id')
      .eq('tenant_id', tenant.id)
      .not('frequency', 'eq', 'one-time')
      .not('frequency', 'is', null)
      .in('status', ['scheduled', 'in_progress', 'completed'])
      .not('price', 'is', null),

    // Expenses this month
    supabase.from('expenses')
      .select('id, category, amount, date')
      .eq('tenant_id', tenant.id)
      .gte('date', monthStart),

    // Leads this month with source (for lead source economics)
    supabase.from('leads')
      .select('id, source, status, phone_number, created_at')
      .eq('tenant_id', tenant.id)
      .gte('created_at', `${yearStart}T00:00:00Z`),

    // Chart jobs: daily data points for revenue graph
    supabase.from('jobs')
      .select('id, price, completed_at, service_type, phone_number, frequency, address')
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')
      .gte('completed_at', `${chartStart}T00:00:00Z`)
      .not('price', 'is', null)
      .order('completed_at', { ascending: true }),
  ])

  const monthJobs = monthJobsRes.data || []
  const yearJobs = yearJobsRes.data || []
  const recurringJobs = recurringJobsRes.data || []
  const expenses = expensesRes.data || []
  const leads = leadsRes.data || []
  const chartJobs = chartJobsRes.data || []

  // ── Revenue Calculations ──
  const monthlyRevenue = monthJobs.reduce((sum, j) => sum + Number(j.price), 0)
  const annualRevenue = yearJobs.reduce((sum, j) => sum + Number(j.price), 0)

  const monthlyRecurring = monthJobs.filter(j => j.frequency && j.frequency !== 'one-time').reduce((sum, j) => sum + Number(j.price), 0)
  const monthlyOneTime = monthlyRevenue - monthlyRecurring
  const annualRecurring = yearJobs.filter(j => j.frequency && j.frequency !== 'one-time').reduce((sum, j) => sum + Number(j.price), 0)
  const annualOneTime = annualRevenue - annualRecurring

  // Count unique recurring customers
  const recurringCustomerIds = new Set(recurringJobs.filter(j => j.customer_id).map(j => j.customer_id))
  const recurringClientCount = recurringCustomerIds.size

  // Projected annual: recurring monthly × 12 + one-time YTD
  const projectedAnnual = (monthlyRecurring * 12) + annualOneTime

  // ── Profit & Loss ──
  const cleanerPayPct = tenant.workflow_config?.cleaner_pay_percentage || 0
  const cleanerPay = monthlyRevenue * (cleanerPayPct / 100)
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const adSpend = expenses.filter(e => e.category.startsWith('ad_spend')).reduce((sum, e) => sum + Number(e.amount), 0)
  const profitMargin = monthlyRevenue - cleanerPay - totalExpenses

  // ── Lead Source Economics ──
  // Get jobs linked to leads via customer phone
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

  // Aggregate expenses by category for cost-per-source
  const expenseByCategory: Record<string, number> = {}
  for (const e of expenses) {
    expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + Number(e.amount)
  }

  // Build lead source table
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

  // Map expense categories to lead sources
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

  // Build DAILY revenue chart data (Stripe-style spikes)
  const dailyMap: Record<string, { revenue: number; jobs: { id: number; price: number; service_type: string | null; phone_number: string | null; address: string | null }[] }> = {}
  for (const j of chartJobs) {
    if (!j.completed_at) continue
    const day = new Date(j.completed_at).toISOString().slice(0, 10)
    if (!dailyMap[day]) dailyMap[day] = { revenue: 0, jobs: [] }
    dailyMap[day].revenue += Number(j.price)
    dailyMap[day].jobs.push({ id: j.id, price: Number(j.price), service_type: j.service_type, phone_number: j.phone_number, address: j.address })
  }
  // Fill in every day in the range (zeros for days with no jobs)
  const dailyChart: { date: string; label: string; revenue: number; jobs: number; job_details: { id: number; price: number; service_type: string | null; phone_number: string | null; address: string | null }[] }[] = []
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
      jobs: entry?.jobs.length || 0,
      job_details: entry?.jobs || [],
    })
  }

  return NextResponse.json({
    revenue: {
      monthly: monthlyRevenue,
      monthly_recurring: monthlyRecurring,
      monthly_one_time: monthlyOneTime,
      annual: annualRevenue,
      annual_recurring: annualRecurring,
      annual_one_time: annualOneTime,
      projected_annual: projectedAnnual,
      recurring_client_count: recurringClientCount,
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
    month_name: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  })
}
