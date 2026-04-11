/**
 * Sync OpenPhone Contacts Cron
 *
 * Runs every 5 minutes. For each tenant with an OpenPhone API key,
 * syncs any customers missing from OpenPhone (openphone_synced_at IS NULL).
 * Processes up to 200 per tenant per run to stay within execution limits.
 *
 * Endpoint: GET /api/cron/sync-openphone-contacts
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getAllActiveTenants } from '@/lib/tenant'
import { syncContactToOpenPhone } from '@/lib/openphone'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'

export const maxDuration = 120

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const supabase = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()
  const BATCH_SIZE = 200

  const results: Record<string, { total: number; created: number; skipped: number; failed: number }> = {}

  for (const tenant of tenants) {
    if (!tenant.openphone_api_key) continue

    const { data: customers, error } = await supabase
      .from('customers')
      .select('id, first_name, last_name, phone_number, email')
      .eq('tenant_id', tenant.id)
      .is('openphone_synced_at', null)
      .not('phone_number', 'is', null)
      .order('id', { ascending: true })
      .limit(BATCH_SIZE)

    if (error || !customers?.length) continue

    let created = 0
    let skipped = 0
    let failed = 0

    for (const customer of customers) {
      const result = await syncContactToOpenPhone(tenant, customer)

      if (result.success) {
        if (result.skipped) skipped++
        else created++

        await supabase
          .from('customers')
          .update({ openphone_synced_at: new Date().toISOString() })
          .eq('id', customer.id)
      } else {
        failed++
        console.error(`[${tenant.slug}] OpenPhone sync failed for customer ${customer.id}: ${result.error}`)
        // Mark as synced anyway if it's a permanent error (bad phone number, etc.)
        // so we don't retry forever. 409 (duplicate) is already handled as success.
        if (result.error?.includes('400') || result.error?.includes('422')) {
          await supabase
            .from('customers')
            .update({ openphone_synced_at: new Date().toISOString() })
            .eq('id', customer.id)
        }
      }

      // Stay under OpenPhone 10 RPS rate limit
      await new Promise(r => setTimeout(r, 125))
    }

    results[tenant.slug] = { total: customers.length, created, skipped, failed }
    console.log(`[${tenant.slug}] OpenPhone contact sync: ${created} created, ${skipped} skipped, ${failed} failed out of ${customers.length}`)
  }

  return NextResponse.json({ success: true, results })
}
