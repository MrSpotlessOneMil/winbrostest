import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { verifyCronAuth } from '@/lib/cron-auth'

// route-check:no-vercel-cron

/**
 * Admin Audit — Returns overview of scheduled tasks, retargeting sequences,
 * paused customers, and SMS volume for system health review.
 *
 * Auth: CRON_SECRET bearer token (same as cron routes)
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const client = getSupabaseServiceClient()

  // 1. Pending/processing scheduled tasks by type and tenant
  const { data: taskSummary } = await client.rpc('audit_scheduled_tasks').select('*')

  // Fallback: direct query if RPC doesn't exist
  let tasks = taskSummary
  if (!tasks) {
    const { data } = await client
      .from('scheduled_tasks')
      .select('tenant_id, task_type, status, scheduled_for')
      .in('status', ['pending', 'processing'])
      .order('scheduled_for', { ascending: true })
      .limit(500)
    tasks = data
  }

  // Aggregate tasks by tenant + type
  const tasksByTenant: Record<string, Record<string, number>> = {}
  let totalPending = 0
  for (const t of (tasks || [])) {
    const key = t.tenant_id || 'unknown'
    if (!tasksByTenant[key]) tasksByTenant[key] = {}
    tasksByTenant[key][t.task_type] = (tasksByTenant[key][t.task_type] || 0) + 1
    totalPending++
  }

  // 2. Customers with auto_response_paused = true (ghosted)
  const { data: pausedCustomers } = await client
    .from('customers')
    .select('id, phone_number, first_name, tenant_id, manual_takeover_at, auto_response_paused')
    .eq('auto_response_paused', true)
    .order('manual_takeover_at', { ascending: false })
    .limit(50)

  // 3. Active retargeting sequences (leads with followup in progress)
  const { data: activeRetargeting } = await client
    .from('leads')
    .select('id, phone_number, first_name, tenant_id, status, followup_stage, followup_started_at, created_at')
    .gt('followup_stage', 0)
    .in('status', ['new', 'contacted'])
    .order('followup_started_at', { ascending: false })
    .limit(100)

  // 4. SMS volume last 24h by tenant
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recentSms } = await client
    .from('messages')
    .select('tenant_id, direction, ai_generated, source')
    .eq('direction', 'outbound')
    .gte('created_at', dayAgo)
    .limit(1000)

  const smsByTenant: Record<string, { total: number; ai: number; sources: Record<string, number> }> = {}
  for (const m of (recentSms || [])) {
    const key = m.tenant_id || 'unknown'
    if (!smsByTenant[key]) smsByTenant[key] = { total: 0, ai: 0, sources: {} }
    smsByTenant[key].total++
    if (m.ai_generated) smsByTenant[key].ai++
    const src = m.source || 'unknown'
    smsByTenant[key].sources[src] = (smsByTenant[key].sources[src] || 0) + 1
  }

  // 5. Stale retargeting: leads in sequences that haven't responded in 30+ days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: staleRetargeting } = await client
    .from('leads')
    .select('id, phone_number, first_name, tenant_id, followup_stage, followup_started_at, last_contact_at')
    .gt('followup_stage', 0)
    .in('status', ['new', 'contacted'])
    .lt('followup_started_at', thirtyDaysAgo)
    .limit(200)

  // 6. WinBros retargeting check (should be empty)
  const { data: winbrosTenant } = await client
    .from('tenants')
    .select('id')
    .eq('slug', 'winbros')
    .single()

  let winbrosRetargeting: any[] = []
  if (winbrosTenant) {
    const { data } = await client
      .from('scheduled_tasks')
      .select('id, task_type, status, scheduled_for')
      .eq('tenant_id', winbrosTenant.id)
      .eq('task_type', 'retargeting')
      .in('status', ['pending', 'processing'])
      .limit(10)
    winbrosRetargeting = data || []
  }

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    summary: {
      totalPendingTasks: totalPending,
      pausedCustomers: pausedCustomers?.length || 0,
      activeRetargetingLeads: activeRetargeting?.length || 0,
      staleRetargetingLeads: staleRetargeting?.length || 0,
      winbrosRetargetingTasks: winbrosRetargeting.length,
      smsLast24h: Object.values(smsByTenant).reduce((sum, t) => sum + t.total, 0),
    },
    tasksByTenant,
    pausedCustomers: pausedCustomers?.map(c => ({
      id: c.id,
      phone: c.phone_number?.slice(-4),
      name: c.first_name,
      tenant: c.tenant_id,
      pausedAt: c.manual_takeover_at,
    })),
    activeRetargeting: activeRetargeting?.map(l => ({
      id: l.id,
      phone: l.phone_number?.slice(-4),
      name: l.first_name,
      tenant: l.tenant_id,
      stage: l.followup_stage,
      startedAt: l.followup_started_at,
      status: l.status,
    })),
    staleRetargeting: staleRetargeting?.map(l => ({
      id: l.id,
      phone: l.phone_number?.slice(-4),
      name: l.first_name,
      tenant: l.tenant_id,
      stage: l.followup_stage,
      startedAt: l.followup_started_at,
      lastContact: l.last_contact_at,
    })),
    winbrosRetargeting,
    smsByTenant,
  })
}
