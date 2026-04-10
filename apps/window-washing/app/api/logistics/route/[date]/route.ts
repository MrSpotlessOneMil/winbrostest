import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getAuthTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)
  if (!tenant) {
    return NextResponse.json({ success: false, error: 'No tenant configured' }, { status: 500 })
  }

  const { date } = await params

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ success: false, error: 'Invalid date format (expected YYYY-MM-DD)' }, { status: 400 })
  }

  try {
    const client = getSupabaseServiceClient()

    // Get jobs for the date with team and customer info
    const { data: jobs, error } = await client
      .from('jobs')
      .select('id, address, date, scheduled_at, service_type, price, hours, team_id, status, phone_number, notes, customers ( first_name, last_name, phone_number ), cleaner_assignments ( cleaner_id, status, cleaners ( name, telegram_id ) )')
      .eq('tenant_id', tenant.id)
      .eq('date', date)
      .neq('status', 'cancelled')
      .order('scheduled_at', { ascending: true })

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // Get teams info
    const { data: teams } = await client
      .from('teams')
      .select('id, name')
      .eq('tenant_id', tenant.id)
      .eq('active', true)

    const teamMap = new Map((teams || []).map((t: any) => [t.id, t.name]))

    // Group jobs by team
    const routes: Record<string, any[]> = {}
    const unassigned: any[] = []

    for (const job of jobs || []) {
      const customer = Array.isArray(job.customers) ? job.customers[0] : job.customers
      const assignments = Array.isArray(job.cleaner_assignments) ? job.cleaner_assignments : []
      const primaryAssignment = assignments.find((a: any) => a?.status === 'confirmed') || assignments[0]
      const cleanerData = primaryAssignment?.cleaners
      const cleaner = Array.isArray(cleanerData) ? cleanerData[0] : cleanerData

      const formatted = {
        id: job.id,
        address: job.address,
        scheduled_at: job.scheduled_at,
        service_type: job.service_type,
        price: job.price,
        hours: job.hours,
        status: job.status,
        customer_name: [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || undefined,
        customer_phone: customer?.phone_number || job.phone_number,
        cleaner_name: cleaner?.name,
        notes: job.notes,
      }

      if (job.team_id) {
        const teamKey = String(job.team_id)
        if (!routes[teamKey]) routes[teamKey] = []
        routes[teamKey].push(formatted)
      } else {
        unassigned.push(formatted)
      }
    }

    // Format as route objects
    const routeList = Object.entries(routes).map(([teamId, teamJobs]) => ({
      team_id: Number(teamId),
      team_name: teamMap.get(Number(teamId)) || `Team ${teamId}`,
      jobs: teamJobs,
      total_jobs: teamJobs.length,
      total_revenue: teamJobs.reduce((sum: number, j: any) => sum + (j.price || 0), 0),
    }))

    return NextResponse.json({
      success: true,
      data: {
        date,
        routes: routeList,
        unassigned_jobs: unassigned,
        total_jobs: (jobs || []).length,
        total_teams: routeList.length,
      },
    })
  } catch (error) {
    console.error('[Logistics] Route query error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load routes' },
      { status: 500 }
    )
  }
}
