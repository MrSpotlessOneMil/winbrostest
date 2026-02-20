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
    const response = await fetch(`${HCP_API_BASE}${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
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
): Promise<{ success: boolean; leadId?: string; error?: string }> {
  console.log(`[HCP API] Creating lead for ${leadData.phone}`)

  const result = await hcpRequest<HCPLead>(tenant, '/leads', {
    method: 'POST',
    body: {
      first_name: leadData.firstName || '',
      last_name: leadData.lastName || '',
      mobile_number: leadData.phone,
      email: leadData.email || undefined,
      address: leadData.address || undefined,
      notes: leadData.notes || `Source: ${leadData.source || 'API'}`,
      source: leadData.source || 'api',
    },
  })

  if (result.success && result.data?.id) {
    console.log(`[HCP API] Lead created: ${result.data.id}`)
    return { success: true, leadId: result.data.id }
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
  // First, try to find existing customer by phone
  const searchResult = await hcpRequest<{ customers: HCPCustomer[] }>(
    tenant,
    `/customers?mobile_number=${encodeURIComponent(customerData.phone)}`
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
      first_name: customerData.firstName || '',
      last_name: customerData.lastName || '',
      mobile_number: customerData.phone,
      email: customerData.email || undefined,
      address: customerData.address || undefined,
    },
  })

  if (createResult.success && createResult.data?.id) {
    console.log(`[HCP API] Customer created: ${createResult.data.id}`)
    return { success: true, customerId: createResult.data.id }
  }

  return { success: false, error: createResult.error }
}

/**
 * Always create a new customer in HCP (skip phone search).
 * Used for VAPI calls where each caller is a new person.
 */
export async function createHCPCustomerAlways(
  tenant: Tenant,
  customerData: {
    firstName?: string
    lastName?: string
    phone: string
    email?: string
    address?: string
  }
): Promise<{ success: boolean; customerId?: string; error?: string }> {
  console.log(`[HCP API] Creating new customer: ${customerData.firstName || ''} ${customerData.lastName || ''} (${customerData.phone}) addr=${customerData.address || 'none'}`)
  const body: Record<string, unknown> = {
    first_name: customerData.firstName || '',
    last_name: customerData.lastName || '',
    mobile_number: customerData.phone,
    email: customerData.email || undefined,
  }
  // HCP expects addresses as an array of objects
  if (customerData.address) {
    body.addresses = [{ street: customerData.address, type: 'service' }]
  }
  const createResult = await hcpRequest<HCPCustomer>(tenant, '/customers', {
    method: 'POST',
    body,
  })

  if (createResult.success && createResult.data?.id) {
    console.log(`[HCP API] New customer created: ${createResult.data.id} (${customerData.firstName} ${customerData.lastName})`)
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

  // Build scheduled_start in ISO format
  let scheduledStart: string | undefined
  if (jobData.scheduledDate) {
    let timeStr = '09:00:00'
    if (jobData.scheduledTime) {
      // Convert "10 AM", "2:30 PM", "14:00" etc to HH:MM:SS
      const raw = jobData.scheduledTime.trim()
      const match12 = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)$/i)
      const match24 = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
      if (match12) {
        let h = parseInt(match12[1])
        const m = match12[2] ? parseInt(match12[2]) : 0
        const ampm = match12[3].toUpperCase()
        if (ampm === 'PM' && h < 12) h += 12
        if (ampm === 'AM' && h === 12) h = 0
        timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
      } else if (match24) {
        timeStr = `${String(parseInt(match24[1])).padStart(2, '0')}:${match24[2]}:00`
      }
    }
    // HCP requires timezone offset for proper scheduling
    scheduledStart = `${jobData.scheduledDate}T${timeStr}-08:00`
  }

  // Build a scheduled_end (default 2 hours after start)
  let scheduledEnd: string | undefined
  if (scheduledStart && jobData.scheduledDate) {
    const startDate = new Date(scheduledStart)
    const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000)
    scheduledEnd = endDate.toISOString()
  }

  console.log(`[HCP API] Job scheduled_start=${scheduledStart}, scheduled_end=${scheduledEnd}, address=${jobData.address}`)

  const result = await hcpRequest<HCPJob>(tenant, '/jobs', {
    method: 'POST',
    body: {
      customer_id: jobData.customerId,
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
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
 * Convenience wrapper that gets the default tenant
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
  }
): Promise<{ success: boolean; leadId?: string; error?: string }> {
  const tenant = await getDefaultTenant()
  if (!tenant) {
    return { success: false, error: 'No tenant configured' }
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
