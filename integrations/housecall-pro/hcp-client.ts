/**
 * Housecall Pro API Client
 *
 * Handles authentication and API calls to Housecall Pro.
 */

import { HCP_API_CONFIG, HCP_ENDPOINTS } from './constants'
import type {
  HCPJob,
  HCPCustomer,
  HCPApiResult,
  CreateHCPJobInput,
  UpdateHCPJobInput,
  HCPEmployee,
} from './types'

// Get API headers
function getHeaders(): HeadersInit {
  const apiKey = process.env.HOUSECALL_PRO_API_KEY
  if (!apiKey) {
    throw new Error('HOUSECALL_PRO_API_KEY not configured')
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

// Get company ID
function getCompanyId(): string {
  const companyId = process.env.HOUSECALL_PRO_COMPANY_ID
  if (!companyId) {
    throw new Error('HOUSECALL_PRO_COMPANY_ID not configured')
  }
  return companyId
}

// Build full API URL
function buildUrl(endpoint: string, queryParams?: Record<string, string>): string {
  const url = new URL(
    `${HCP_API_CONFIG.BASE_URL}/${HCP_API_CONFIG.API_VERSION}${endpoint}`
  )

  if (queryParams) {
    Object.entries(queryParams).forEach(([key, value]) => {
      url.searchParams.append(key, value)
    })
  }

  return url.toString()
}

// Generic API fetch with retry logic
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
  queryParams?: Record<string, string>
): Promise<HCPApiResult<T>> {
  const url = buildUrl(endpoint, queryParams)

  for (let attempt = 0; attempt < HCP_API_CONFIG.MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...getHeaders(),
          ...(options.headers || {}),
        },
      })

      if (response.status === 429) {
        // Rate limited, wait and retry
        await new Promise((resolve) =>
          setTimeout(resolve, HCP_API_CONFIG.RETRY_DELAY_MS * (attempt + 1))
        )
        continue
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error('HCP API error:', response.status, errorText)
        return {
          success: false,
          error: `HCP API error: ${response.status} - ${errorText}`,
        }
      }

      const data = await response.json()
      return { success: true, data }
    } catch (error) {
      if (attempt === HCP_API_CONFIG.MAX_RETRIES - 1) {
        console.error('HCP API fetch error:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
      await new Promise((resolve) =>
        setTimeout(resolve, HCP_API_CONFIG.RETRY_DELAY_MS)
      )
    }
  }

  return { success: false, error: 'Max retries exceeded' }
}

// =====================
// JOB OPERATIONS
// =====================

/**
 * Get a job by ID
 */
export async function getJob(jobId: string): Promise<HCPApiResult<HCPJob>> {
  return apiFetch<HCPJob>(HCP_ENDPOINTS.JOB_BY_ID(jobId), { method: 'GET' })
}

/**
 * List jobs with optional filters
 */
export async function listJobs(filters?: {
  status?: string
  customer_id?: string
  scheduled_start_min?: string
  scheduled_start_max?: string
  page?: number
  per_page?: number
}): Promise<HCPApiResult<{ jobs: HCPJob[]; total: number }>> {
  const queryParams: Record<string, string> = {}

  if (filters?.status) queryParams.status = filters.status
  if (filters?.customer_id) queryParams.customer_id = filters.customer_id
  if (filters?.scheduled_start_min)
    queryParams.scheduled_start_min = filters.scheduled_start_min
  if (filters?.scheduled_start_max)
    queryParams.scheduled_start_max = filters.scheduled_start_max
  if (filters?.page) queryParams.page = filters.page.toString()
  if (filters?.per_page) queryParams.per_page = filters.per_page.toString()

  return apiFetch<{ jobs: HCPJob[]; total: number }>(
    HCP_ENDPOINTS.JOBS,
    { method: 'GET' },
    queryParams
  )
}

/**
 * Create a new job
 */
export async function createJob(
  input: CreateHCPJobInput
): Promise<HCPApiResult<HCPJob>> {
  return apiFetch<HCPJob>(HCP_ENDPOINTS.JOBS, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/**
 * Update an existing job
 */
export async function updateJob(
  jobId: string,
  input: UpdateHCPJobInput
): Promise<HCPApiResult<HCPJob>> {
  return apiFetch<HCPJob>(HCP_ENDPOINTS.JOB_BY_ID(jobId), {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

/**
 * Cancel a job
 */
export async function cancelJob(jobId: string): Promise<HCPApiResult<HCPJob>> {
  return updateJob(jobId, { work_status: 'canceled' })
}

/**
 * Mark job as completed
 */
export async function completeJob(jobId: string): Promise<HCPApiResult<HCPJob>> {
  return updateJob(jobId, { work_status: 'completed' })
}

// =====================
// CUSTOMER OPERATIONS
// =====================

/**
 * Get a customer by ID
 */
export async function getCustomer(
  customerId: string
): Promise<HCPApiResult<HCPCustomer>> {
  return apiFetch<HCPCustomer>(HCP_ENDPOINTS.CUSTOMER_BY_ID(customerId), {
    method: 'GET',
  })
}

/**
 * Search customers by phone or email
 */
export async function searchCustomers(query: {
  phone?: string
  email?: string
}): Promise<HCPApiResult<{ customers: HCPCustomer[] }>> {
  const queryParams: Record<string, string> = {}
  if (query.phone) queryParams.phone = query.phone
  if (query.email) queryParams.email = query.email

  return apiFetch<{ customers: HCPCustomer[] }>(
    HCP_ENDPOINTS.CUSTOMER_SEARCH,
    { method: 'GET' },
    queryParams
  )
}

/**
 * Create a new customer
 */
export async function createCustomer(input: {
  first_name: string
  last_name: string
  email?: string
  phone_numbers?: Array<{ type: string; number: string }>
  addresses?: Array<{
    street: string
    city: string
    state: string
    zip: string
  }>
  notes?: string
  tags?: string[]
}): Promise<HCPApiResult<HCPCustomer>> {
  return apiFetch<HCPCustomer>(HCP_ENDPOINTS.CUSTOMERS, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/**
 * Update a customer
 */
export async function updateCustomer(
  customerId: string,
  input: Partial<{
    first_name: string
    last_name: string
    email: string
    phone_numbers: Array<{ type: string; number: string }>
    notes: string
    tags: string[]
  }>
): Promise<HCPApiResult<HCPCustomer>> {
  return apiFetch<HCPCustomer>(HCP_ENDPOINTS.CUSTOMER_BY_ID(customerId), {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

// =====================
// EMPLOYEE OPERATIONS
// =====================

/**
 * List all employees (crew members)
 */
export async function listEmployees(): Promise<
  HCPApiResult<{ employees: HCPEmployee[] }>
> {
  return apiFetch<{ employees: HCPEmployee[] }>(HCP_ENDPOINTS.EMPLOYEES, {
    method: 'GET',
  })
}

/**
 * Get employee by ID
 */
export async function getEmployee(
  employeeId: string
): Promise<HCPApiResult<HCPEmployee>> {
  return apiFetch<HCPEmployee>(HCP_ENDPOINTS.EMPLOYEE_BY_ID(employeeId), {
    method: 'GET',
  })
}

// =====================
// UTILITY FUNCTIONS
// =====================

/**
 * Validate webhook signature
 */
export function validateWebhookSignature(
  payload: string,
  signature: string
): boolean {
  const secret = process.env.HOUSECALL_PRO_WEBHOOK_SECRET
  if (!secret) {
    console.warn('HOUSECALL_PRO_WEBHOOK_SECRET not configured, skipping validation')
    return true // Allow in development
  }

  // HCP uses HMAC-SHA256 for webhook signatures
  const crypto = require('crypto')
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )
}

/**
 * Get jobs for a specific date
 */
export async function getJobsForDate(
  date: string
): Promise<HCPApiResult<{ jobs: HCPJob[] }>> {
  const startOfDay = `${date}T00:00:00Z`
  const endOfDay = `${date}T23:59:59Z`

  return listJobs({
    scheduled_start_min: startOfDay,
    scheduled_start_max: endOfDay,
  }) as Promise<HCPApiResult<{ jobs: HCPJob[] }>>
}

/**
 * Get upcoming jobs for the next N days
 */
export async function getUpcomingJobs(
  days: number = 7
): Promise<HCPApiResult<{ jobs: HCPJob[] }>> {
  const today = new Date()
  const futureDate = new Date(today)
  futureDate.setDate(futureDate.getDate() + days)

  return listJobs({
    scheduled_start_min: today.toISOString(),
    scheduled_start_max: futureDate.toISOString(),
    status: 'scheduled',
  }) as Promise<HCPApiResult<{ jobs: HCPJob[] }>>
}

