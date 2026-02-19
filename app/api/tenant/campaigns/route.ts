/**
 * Tenant Campaigns API
 *
 * Allows authenticated tenants to manage their own seasonal campaigns
 * and lifecycle messaging settings without needing admin access.
 *
 * Each tenant can only read/write their own data.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthTenant } from '@/lib/auth'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** GET - fetch current tenant's campaign settings */
export async function GET(request: NextRequest) {
  const tenant = await getAuthTenant(request)
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    success: true,
    data: {
      seasonal_reminders_enabled: tenant.workflow_config.seasonal_reminders_enabled ?? false,
      frequency_nudge_enabled: tenant.workflow_config.frequency_nudge_enabled ?? false,
      frequency_nudge_days: tenant.workflow_config.frequency_nudge_days ?? 21,
      review_only_followup_enabled: tenant.workflow_config.review_only_followup_enabled ?? false,
      seasonal_campaigns: tenant.workflow_config.seasonal_campaigns ?? [],
    },
  })
}

/** PATCH - update campaign settings for the authenticated tenant */
export async function PATCH(request: NextRequest) {
  const tenant = await getAuthTenant(request)
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const client = getAdminClient()

  // Only allow updating lifecycle messaging fields - nothing else
  const allowedFields = [
    'seasonal_reminders_enabled',
    'frequency_nudge_enabled',
    'frequency_nudge_days',
    'review_only_followup_enabled',
    'seasonal_campaigns',
  ] as const

  const updates: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field]
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const newConfig = { ...tenant.workflow_config, ...updates }

  const { error } = await client
    .from('tenants')
    .update({ workflow_config: newConfig, updated_at: new Date().toISOString() })
    .eq('id', tenant.id)

  if (error) {
    console.error('[Tenant Campaigns API] Update failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
