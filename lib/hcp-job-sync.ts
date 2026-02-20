/**
 * Centralized HouseCall Pro job sync.
 * Call this after creating a job from ANY source (VAPI, SMS, Stripe, dashboard)
 * to mirror it into HCP. Skips gracefully if HCP is not configured for the tenant.
 */

import { createHCPJob } from './housecall-pro-api'
import { createHCPCustomerAlways } from './housecall-pro-api'
import { getSupabaseServiceClient } from './supabase'
import type { Tenant } from './tenant'

export async function syncNewJobToHCP(params: {
  tenant: Tenant
  jobId: number
  phone: string
  firstName?: string | null
  lastName?: string | null
  address?: string | null
  serviceType?: string | null
  scheduledDate?: string | null
  scheduledTime?: string | null
  price?: number | null
  notes?: string | null
}): Promise<void> {
  const { tenant, jobId, phone } = params

  if (!tenant.housecall_pro_api_key) {
    return
  }

  try {
    // Always create a new customer in HCP (callers are new people each time)
    const hcpCustomer = await createHCPCustomerAlways(tenant, {
      firstName: params.firstName || undefined,
      lastName: params.lastName || undefined,
      phone,
      address: params.address || undefined,
    })

    if (!hcpCustomer.success || !hcpCustomer.customerId) {
      console.error(`[HCP Sync] Failed to find/create HCP customer for job ${jobId}: ${hcpCustomer.error}`)
      return
    }

    // Create job in HCP
    const hcpJob = await createHCPJob(tenant, {
      customerId: hcpCustomer.customerId,
      scheduledDate: params.scheduledDate || undefined,
      scheduledTime: params.scheduledTime || undefined,
      address: params.address || undefined,
      serviceType: params.serviceType || undefined,
      price: params.price || undefined,
      notes: params.notes || undefined,
    })

    if (!hcpJob.success || !hcpJob.jobId) {
      console.error(`[HCP Sync] Failed to create HCP job for local job ${jobId}: ${hcpJob.error}`)
      return
    }

    // Store HCP job ID on local record (service client bypasses RLS)
    const client = getSupabaseServiceClient()
    const { error: updateErr } = await client
      .from('jobs')
      .update({ housecall_pro_job_id: hcpJob.jobId })
      .eq('id', jobId)

    if (updateErr) {
      console.error(`[HCP Sync] Job ${jobId} synced to HCP (${hcpJob.jobId}) but failed to store ID locally: ${updateErr.message}`)
    } else {
      console.log(`[HCP Sync] Job ${jobId} synced to HCP: ${hcpJob.jobId}`)
    }
  } catch (err) {
    console.error(`[HCP Sync] Unexpected error syncing job ${jobId} to HCP:`, err)
  }
}
