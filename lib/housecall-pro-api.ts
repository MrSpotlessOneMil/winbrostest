/**
 * HousecallPro API Client
 * Two-way sync: Create leads/jobs in HCP, update status
 *
 * API Docs: https://docs.housecallpro.com/
 */

import { getDefaultTenant, type Tenant } from './tenant'

const HCP_API_BASE = 'https://api.housecallpro.com'

interface HCPApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
}

interface HCPLead {
  id: string
  first_name?: string
  last_name?: string
  email?: string
  mobile_number?: string
  address?: string
  notes?: string
  source?: string
}

interface HCPJob {
  id: string
  customer_id?: string
  scheduled_start?: string
  scheduled_end?: string
  address?: string
  description?: string
  total?: number
  status?: string
}

interface HCPCustomer {
  id: string
  first_name?: string
  last_name?: string
  email?: string
  mobile_number?: string
  address?: string
}

/**
 * Make authenticated request to HousecallPro API
 */
async function hcpRequest<T>(
  tenant: Tenant,
  endpoint: string,
  options: HCPApiOptions = {}
): Promise<{ success: boolean; data?: T; error?: string }> {
  const apiKey = tenant.housecall_pro_api_key

  if (!apiKey) {
    console.error(`[HCP API] No API key configured for tenant ${tenant.slug}`)
    return { success: false, error: 'HousecallPro API key not configured' }
  }

  try {
    const headers: Record<string, string> = {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
    }

    // Add company ID header if available
    if (tenant.housecall_pro_company_id) {
      headers['X-Company-ID'] = tenant.housecall_pro_company_id
    }

    const response = await fetch(`${HCP_API_BASE}${endpoint}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[HCP API] Error ${response.status}: ${errorText}`)
      return { success: false, error: `HCP API error: ${response.status} - ${errorText}` }
    }

    const data = await response.json()
    return { success: true, data }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[HCP API] Request failed:`, error)
    return { success: false, error: message }
  }
}

/**
 * Create a lead in HousecallPro
 *
 * HCP's /leads endpoint requires a customer_id for an existing customer.
 * This function first finds or creates the customer, then creates the lead.
 */
export async function createHCPLead(
  tenant: Tenant,
  leadData: {
    firstName?: string
    lastName?: string
    phone: string
    email?: string
    address?: string
    notes?: string
    source?: string
  }
): Promise<{ success: boolean; leadId?: string; customerId?: string; error?: string }> {
  console.log(`[HCP API] Creating lead for ${leadData.phone}`)

  // Step 1: Find or create customer in HCP (required for lead creation)
  const customerResult = await findOrCreateHCPCustomer(tenant, {
    firstName: leadData.firstName,
    lastName: leadData.lastName,
    phone: leadData.phone,
    email: leadData.email,
    address: leadData.address,
  })

  if (!customerResult.success || !customerResult.customerId) {
    console.error(`[HCP API] Failed to find/create customer for lead: ${customerResult.error}`)
    return { success: false, error: `Customer creation failed: ${customerResult.error}` }
  }

  console.log(`[HCP API] Using customer ${customerResult.customerId} for lead`)

  // Step 2: Create lead with customer_id
  const result = await hcpRequest<HCPLead>(tenant, '/leads', {
    method: 'POST',
    body: {
      customer_id: customerResult.customerId,
      notes: leadData.notes || `Source: ${leadData.source || 'API'}`,
      source: leadData.source || 'api',
    },
  })

  if (result.success && result.data?.id) {
    console.log(`[HCP API] Lead created: ${result.data.id}`)
    return { success: true, leadId: result.data.id, customerId: customerResult.customerId }
  }

  return { success: false, error: result.error }
}

/**
 * Create or find a customer in HousecallPro
 */
export async function findOrCreateHCPCustomer(
  tenant: Tenant,
  customerData: {
    firstName?: string
    lastName?: string
    phone: string
    email?: string
    address?: string
  }
): Promise<{ success: boolean; customerId?: string; error?: string }> {
  // First, try to find existing customer by phone (use ?q= general search)
  const searchResult = await hcpRequest<{ customers: HCPCustomer[] }>(
    tenant,
    `/customers?q=${encodeURIComponent(customerData.phone)}`
  )

  if (searchResult.success && searchResult.data?.customers?.length) {
    const existing = searchResult.data.customers[0]
    console.log(`[HCP API] Found existing customer: ${existing.id}`)
    return { success: true, customerId: existing.id }
  }

  // Create new customer
  console.log(`[HCP API] Creating customer for ${customerData.phone}`)
  const createResult = await hcpRequest<HCPCustomer>(tenant, '/customers', {
    method: 'POST',
    body: {
      first_name: customerData.firstName || 'Unknown',
      last_name: customerData.lastName || '',
      email: customerData.email || undefined,
      mobile_number: customerData.phone,
      phone_numbers: [{ type: 'mobile', number: customerData.phone }],
      notifications_enabled: true,
      lead_source: 'api',
    },
  })

  if (createResult.success && createResult.data?.id) {
    console.log(`[HCP API] Customer created: ${createResult.data.id}`)
    return { success: true, customerId: createResult.data.id }
  }

  return { success: false, error: createResult.error }
}

/**
 * Convert a lead to a job in HousecallPro
 * This is typically done when deposit is paid
 */
export async function convertHCPLeadToJob(
  tenant: Tenant,
  leadId: string,
  jobData: {
    scheduledDate?: string
    scheduledTime?: string
    address?: string
    serviceType?: string
    price?: number
    notes?: string
  }
): Promise<{ success: boolean; jobId?: string; customerId?: string; error?: string }> {
  console.log(`[HCP API] Converting lead ${leadId} to job`)

  // HCP's lead conversion endpoint
  const result = await hcpRequest<{ job: HCPJob; customer: HCPCustomer }>(
    tenant,
    `/leads/${leadId}/convert`,
    {
      method: 'POST',
      body: {
        scheduled_start: jobData.scheduledDate && jobData.scheduledTime
          ? `${jobData.scheduledDate}T${jobData.scheduledTime}`
          : undefined,
        address: jobData.address || undefined,
        description: jobData.serviceType || 'Cleaning Service',
        total: jobData.price || undefined,
        notes: jobData.notes || undefined,
      },
    }
  )

  if (result.success && result.data?.job?.id) {
    console.log(`[HCP API] Lead converted to job: ${result.data.job.id}`)
    return {
      success: true,
      jobId: result.data.job.id,
      customerId: result.data.customer?.id,
    }
  }

  return { success: false, error: result.error }
}

/**
 * Create a job directly in HousecallPro (without lead conversion)
 */
export async function createHCPJob(
  tenant: Tenant,
  jobData: {
    customerId: string
    scheduledDate?: string
    scheduledTime?: string
    address?: string
    serviceType?: string
    price?: number
    notes?: string
  }
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  console.log(`[HCP API] Creating job for customer ${jobData.customerId}`)

  const result = await hcpRequest<HCPJob>(tenant, '/jobs', {
    method: 'POST',
    body: {
      customer_id: jobData.customerId,
      scheduled_start: jobData.scheduledDate && jobData.scheduledTime
        ? `${jobData.scheduledDate}T${jobData.scheduledTime}`
        : undefined,
      address: jobData.address || undefined,
      description: jobData.serviceType || 'Cleaning Service',
      total: jobData.price || undefined,
      notes: jobData.notes || undefined,
    },
  })

  if (result.success && result.data?.id) {
    console.log(`[HCP API] Job created: ${result.data.id}`)
    return { success: true, jobId: result.data.id }
  }

  return { success: false, error: result.error }
}

/**
 * Mark a job as completed in HousecallPro
 */
export async function completeHCPJob(
  tenant: Tenant,
  jobId: string
): Promise<{ success: boolean; error?: string }> {
  console.log(`[HCP API] Marking job ${jobId} as completed`)

  const result = await hcpRequest<HCPJob>(tenant, `/jobs/${jobId}`, {
    method: 'PATCH',
    body: {
      status: 'completed',
    },
  })

  if (result.success) {
    console.log(`[HCP API] Job ${jobId} marked completed`)
    return { success: true }
  }

  return { success: false, error: result.error }
}

/**
 * Update lead status in HousecallPro
 */
export async function updateHCPLeadStatus(
  tenant: Tenant,
  leadId: string,
  status: 'new' | 'contacted' | 'qualified' | 'won' | 'lost'
): Promise<{ success: boolean; error?: string }> {
  console.log(`[HCP API] Updating lead ${leadId} status to ${status}`)

  const result = await hcpRequest<HCPLead>(tenant, `/leads/${leadId}`, {
    method: 'PATCH',
    body: { status },
  })

  if (result.success) {
    console.log(`[HCP API] Lead ${leadId} status updated to ${status}`)
    return { success: true }
  }

  return { success: false, error: result.error }
}

/**
 * Convenience wrapper — uses provided tenant or falls back to default
 */
export async function createLeadInHCP(
  leadData: {
    firstName?: string
    lastName?: string
    phone: string
    email?: string
    address?: string
    notes?: string
    source?: string
  },
  existingTenant?: Tenant | null
): Promise<{ success: boolean; leadId?: string; customerId?: string; error?: string }> {
  const tenant = existingTenant || await getDefaultTenant()
  if (!tenant) {
    return { success: false, error: 'No tenant configured' }
  }

  if (!tenant.housecall_pro_api_key) {
    console.log(`[HCP API] No HCP API key for tenant ${tenant.slug}, skipping lead sync`)
    return { success: true } // Not an error — HCP integration just not configured
  }

  return createHCPLead(tenant, leadData)
}

/**
 * Convenience wrapper for job completion
 */
export async function markJobCompleteInHCP(
  jobId: string,
  hcpJobId?: string
): Promise<{ success: boolean; error?: string }> {
  if (!hcpJobId) {
    // If no HCP job ID, we can't sync
    console.log(`[HCP API] No HCP job ID for job ${jobId}, skipping sync`)
    return { success: true }
  }

  const tenant = await getDefaultTenant()
  if (!tenant) {
    return { success: false, error: 'No tenant configured' }
  }
  return completeHCPJob(tenant, hcpJobId)
}
