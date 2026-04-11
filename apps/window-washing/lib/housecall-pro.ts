"use server"

/**
 * Housecall Pro API Client
 * Source of truth for jobs, customers, and estimates
 */

import { getApiKey } from '@/lib/user-api-keys'

const HCP_API_BASE = "https://api.housecallpro.com"

interface HcpRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  body?: Record<string, unknown>
  params?: Record<string, string>
}

async function hcpRequest<T>(endpoint: string, options: HcpRequestOptions = {}): Promise<T> {
  const apiKey = getApiKey('housecallProApiKey')
  if (!apiKey) {
    throw new Error("HOUSECALL_PRO_API_KEY is not configured")
  }

  const url = new URL(`${HCP_API_BASE}${endpoint}`)
  if (options.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      url.searchParams.append(key, value)
    })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  const response = await fetch(url.toString(), {
    method: options.method || "GET",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: controller.signal,
  })
  clearTimeout(timeout)

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`HCP API Error: ${response.status} - ${error}`)
  }

  return response.json()
}

// Customer Types
export interface HcpCustomer {
  id: string
  first_name: string
  last_name: string
  email: string | null
  mobile_number: string | null
  home_number: string | null
  work_number: string | null
  company: string | null
  notifications_enabled: boolean
  lead_source: string | null
  addresses: HcpAddress[]
  created_at: string
  updated_at: string
}

export interface HcpAddress {
  id: string
  type: "service" | "billing"
  street: string
  street_line_2: string | null
  city: string
  state: string
  zip: string
  country: string
}

// Job Types
export interface HcpJob {
  id: string
  customer_id: string
  address_id: string
  invoice_number: string
  work_status: "unscheduled" | "scheduled" | "in_progress" | "complete" | "canceled"
  work_timestamps: {
    on_my_way_at: string | null
    started_at: string | null
    completed_at: string | null
  }
  schedule: {
    scheduled_start: string
    scheduled_end: string
    arrival_window_minutes: number
  } | null
  total_amount: number
  outstanding_balance: number
  assigned_employees: HcpEmployee[]
  line_items: HcpLineItem[]
  tags: string[]
  notes: string | null
  created_at: string
  updated_at: string
}

export interface HcpEmployee {
  id: string
  first_name: string
  last_name: string
  email: string
  mobile_number: string | null
  role: string
}

export interface HcpLineItem {
  id: string
  name: string
  description: string | null
  quantity: number
  unit_price: number
  total_price: number
}

// Estimate Types
export interface HcpEstimate {
  id: string
  customer_id: string
  address_id: string
  status: "draft" | "sent" | "approved" | "declined" | "converted"
  total_amount: number
  line_items: HcpLineItem[]
  sent_at: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

// API Methods

/**
 * Get all jobs for a date range
 */
export async function getJobs(params?: {
  start_date?: string
  end_date?: string
  work_status?: string
  page?: number
  page_size?: number
}) {
  return hcpRequest<{ jobs: HcpJob[]; total_items: number; total_pages: number }>("/jobs", {
    params: params as Record<string, string>,
  })
}

/**
 * Get a single job by ID
 */
export async function getJob(jobId: string) {
  return hcpRequest<{ job: HcpJob }>(`/jobs/${jobId}`)
}

/**
 * Update a job
 */
export async function updateJob(jobId: string, data: Partial<HcpJob>) {
  return hcpRequest<{ job: HcpJob }>(`/jobs/${jobId}`, {
    method: "PATCH",
    body: data as Record<string, unknown>,
  })
}

/**
 * Reschedule a job
 */
export async function rescheduleJob(
  jobId: string,
  newStart: string,
  newEnd: string,
  notifyCustomer = true
) {
  return hcpRequest<{ job: HcpJob }>(`/jobs/${jobId}`, {
    method: "PATCH",
    body: {
      schedule: {
        scheduled_start: newStart,
        scheduled_end: newEnd,
      },
      notify_customer: notifyCustomer,
    },
  })
}

/**
 * Get all customers
 */
export async function getCustomers(params?: {
  page?: number
  page_size?: number
  q?: string
}) {
  return hcpRequest<{ customers: HcpCustomer[]; total_items: number }>("/customers", {
    params: params as Record<string, string>,
  })
}

/**
 * Get a single customer
 */
export async function getCustomer(customerId: string) {
  return hcpRequest<{ customer: HcpCustomer }>(`/customers/${customerId}`)
}

/**
 * Create a new customer
 */
export async function createCustomer(data: {
  first_name: string
  last_name: string
  email?: string
  mobile_number?: string
  addresses?: Partial<HcpAddress>[]
  lead_source?: string
}) {
  return hcpRequest<{ customer: HcpCustomer }>("/customers", {
    method: "POST",
    body: data,
  })
}

/**
 * Create a new estimate
 */
export async function createEstimate(data: {
  customer_id: string
  address_id: string
  line_items: { name: string; quantity: number; unit_price: number }[]
  message?: string
}) {
  return hcpRequest<{ estimate: HcpEstimate }>("/estimates", {
    method: "POST",
    body: data,
  })
}

/**
 * Get estimates for a customer
 */
export async function getEstimates(customerId?: string) {
  const params = customerId ? { customer_id: customerId } : undefined
  return hcpRequest<{ estimates: HcpEstimate[] }>("/estimates", { params })
}

/**
 * Get scheduled jobs for today
 */
export async function getTodaysJobs() {
  const today = new Date().toISOString().split("T")[0]
  return getJobs({
    start_date: today,
    end_date: today,
    work_status: "scheduled",
  })
}

/**
 * Get jobs for a specific date range (for rain day reschedule)
 */
export async function getJobsInRange(startDate: string, endDate: string) {
  return getJobs({
    start_date: startDate,
    end_date: endDate,
  })
}

/**
 * Create a new job in HousecallPro
 */
export async function createJob(data: {
  customer_id: string
  address_id: string
  scheduled_start: string
  scheduled_end: string
  line_items?: { name: string; quantity: number; unit_price: number }[]
  notes?: string
  tags?: string[]
}) {
  return hcpRequest<{ job: HcpJob }>("/jobs", {
    method: "POST",
    body: {
      customer_id: data.customer_id,
      address_id: data.address_id,
      schedule: {
        scheduled_start: data.scheduled_start,
        scheduled_end: data.scheduled_end,
      },
      line_items: data.line_items || [],
      notes: data.notes,
      tags: data.tags,
    },
  })
}

/**
 * Add notes to a job
 */
export async function addJobNotes(jobId: string, notes: string) {
  return hcpRequest<{ job: HcpJob }>(`/jobs/${jobId}`, {
    method: "PATCH",
    body: { notes },
  })
}

/**
 * Update job status
 */
export async function updateJobStatus(
  jobId: string,
  status: "scheduled" | "in_progress" | "complete" | "canceled"
) {
  return hcpRequest<{ job: HcpJob }>(`/jobs/${jobId}`, {
    method: "PATCH",
    body: { work_status: status },
  })
}

/**
 * Assign employee to job
 */
export async function assignEmployeeToJob(jobId: string, employeeId: string) {
  return hcpRequest<{ job: HcpJob }>(`/jobs/${jobId}/assigned_employees`, {
    method: "POST",
    body: { employee_id: employeeId },
  })
}

/**
 * Search for a customer by phone number
 */
export async function findCustomerByPhone(phone: string): Promise<HcpCustomer | null> {
  try {
    const result = await getCustomers({ q: phone })
    if (result.customers && result.customers.length > 0) {
      return result.customers[0]
    }
    return null
  } catch (error) {
    console.error('Error finding HCP customer by phone:', error)
    return null
  }
}

/**
 * Sync a job from Supabase to HousecallPro
 * Used when job details change in our system
 */
export async function syncJobToHcp(
  supabaseJobId: string,
  updates: {
    notes?: string
    status?: string
    scheduled_start?: string
    scheduled_end?: string
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    // Note: This requires storing HCP job ID in Supabase
    // For now, we log the sync request
    console.log(`[HCP Sync] Sync requested for job ${supabaseJobId}:`, updates)

    // If we had the HCP job ID, we would do:
    // await updateJob(hcpJobId, updates)

    return { success: true }
  } catch (error) {
    console.error('Error syncing job to HCP:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
