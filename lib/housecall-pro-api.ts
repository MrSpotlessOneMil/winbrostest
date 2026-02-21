/**
 * HousecallPro API Client
 * Two-way sync: Create leads/jobs in HCP, update status
 *
 * API Docs: https://docs.housecallpro.com/
 */

import { getDefaultTenant, type Tenant } from './tenant'

const HCP_API_BASE = 'https://api.housecallpro.com'
const DEFAULT_TIMEZONE_OFFSET = '-06:00' // Central Time (WinBros is in Illinois)
const DEFAULT_DURATION_HOURS = 2
const DEFAULT_ARRIVAL_WINDOW_MINUTES = 60

const US_STATE_NAMES: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
}

function normalizeStateToAbbrev(state: string): string | undefined {
  const trimmed = state.trim()
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase()
  return US_STATE_NAMES[trimmed.toLowerCase()] || undefined
}

interface HCPApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
}

interface HCPAddress {
  id?: string
  type?: string
  street?: string
  street_line_2?: string
  city?: string
  state?: string
  zip?: string
  country?: string
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
  schedule?: {
    scheduled_start?: string
    scheduled_end?: string
  }
  address?: HCPAddress | string
  description?: string
  total_amount?: number
  status?: string
}

interface HCPEmployee {
  id: string
  first_name?: string
  last_name?: string
  email?: string
  mobile_number?: string
  phone?: string
}

interface HCPCustomer {
  id: string
  first_name?: string
  last_name?: string
  email?: string
  mobile_number?: string
  home_number?: string
  work_number?: string
  addresses?: HCPAddress[]
}

function extractJobId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined

  const record = data as Record<string, unknown>
  if (typeof record.id === 'string' && record.id) return record.id

  const nestedJob = record.job
  if (nestedJob && typeof nestedJob === 'object') {
    const jobId = (nestedJob as Record<string, unknown>).id
    if (typeof jobId === 'string' && jobId) return jobId
  }

  const nestedData = record.data
  if (nestedData && typeof nestedData === 'object') {
    const dataId = (nestedData as Record<string, unknown>).id
    if (typeof dataId === 'string' && dataId) return dataId
  }

  return undefined
}

function toHcpMoneyCents(value?: number | null): number | undefined {
  if (value === null || value === undefined) return undefined
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return undefined
  return Math.round(numeric * 100)
}

function toHcpLineItems(
  lineItems?: Array<{
    name: string
    quantity: number
    unit_price: number
    description?: string
  }>
): Array<{
  name: string
  quantity: number
  unit_price: number
  description?: string
}> | undefined {
  if (!lineItems?.length) return undefined
  return lineItems.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unit_price: toHcpMoneyCents(item.unit_price) ?? 0,
    description: item.description,
  }))
}

function normalizePhoneForMatch(value: string | null | undefined): string {
  return (value || '').replace(/\D+/g, '').slice(-10)
}

function normalizeAddressForMatch(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseTimeToHHMMSS(raw?: string): string {
  if (!raw) return '09:00:00'
  const trimmed = raw.trim()
  const match12 = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i)
  if (match12) {
    let hour = parseInt(match12[1], 10)
    const minutes = match12[2] ? parseInt(match12[2], 10) : 0
    const ampm = match12[3].toUpperCase()
    if (ampm === 'PM' && hour < 12) hour += 12
    if (ampm === 'AM' && hour === 12) hour = 0
    return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
  }

  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (match24) {
    const hour = parseInt(match24[1], 10)
    const minutes = parseInt(match24[2], 10)
    const seconds = match24[3] ? parseInt(match24[3], 10) : 0
    return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return '09:00:00'
}

function buildScheduleWindow(
  scheduledDate?: string,
  scheduledTime?: string,
  durationHours?: number
): { scheduledStart?: string; scheduledEnd?: string } {
  if (!scheduledDate) return {}

  const timeStr = parseTimeToHHMMSS(scheduledTime)
  const scheduledStart = `${scheduledDate}T${timeStr}${DEFAULT_TIMEZONE_OFFSET}`

  const startDate = new Date(scheduledStart)
  if (Number.isNaN(startDate.getTime())) {
    return { scheduledStart }
  }

  const normalizedDuration = Number.isFinite(durationHours) && (durationHours as number) > 0
    ? Number(durationHours)
    : DEFAULT_DURATION_HOURS
  const scheduledEnd = new Date(startDate.getTime() + normalizedDuration * 60 * 60 * 1000).toISOString()
  return { scheduledStart, scheduledEnd }
}

function extractCustomers(data: unknown): HCPCustomer[] {
  if (Array.isArray(data)) return data as HCPCustomer[]
  if (!data || typeof data !== 'object') return []

  const record = data as Record<string, unknown>
  if (Array.isArray(record.customers)) return record.customers as HCPCustomer[]

  if (record.data && typeof record.data === 'object') {
    const nested = record.data as Record<string, unknown>
    if (Array.isArray(nested.customers)) return nested.customers as HCPCustomer[]
  }

  return []
}

function extractEmployees(data: unknown): HCPEmployee[] {
  if (Array.isArray(data)) return data as HCPEmployee[]
  if (!data || typeof data !== 'object') return []

  const record = data as Record<string, unknown>
  if (Array.isArray(record.employees)) return record.employees as HCPEmployee[]
  if (Array.isArray(record.data)) return record.data as HCPEmployee[]

  if (record.data && typeof record.data === 'object') {
    const nested = record.data as Record<string, unknown>
    if (Array.isArray(nested.employees)) return nested.employees as HCPEmployee[]
  }

  return []
}

function splitStreetLine(street: string): { mainStreet: string; line2?: string } {
  const aptMatch = street.match(/^(.+?)\s*[,#]\s*((?:apt|suite|ste|unit|#)\s*.+)$/i)
  if (aptMatch) return { mainStreet: aptMatch[1].trim(), line2: aptMatch[2].trim() }
  return { mainStreet: street }
}

function buildAddressCreatePayload(address?: string): Record<string, string> | undefined {
  const raw = (address || '').trim()
  if (!raw) return undefined

  const normalized = raw.replace(/\s+/g, ' ')
  const parts = normalized.split(',').map(p => p.trim()).filter(Boolean)

  // Strategy 1: 3+ comma-separated parts — "street, city, STATE ZIP" or "street, city, State ZIP"
  if (parts.length >= 3) {
    const street = parts.slice(0, parts.length - 2).join(', ')
    const city = parts[parts.length - 2]
    const stateZipPart = parts[parts.length - 1]

    const zipMatch = stateZipPart.match(/(\d{5}(?:-\d{4})?)$/)
    const zip = zipMatch?.[1]
    const stateRaw = zip ? stateZipPart.replace(zip, '').trim() : stateZipPart.trim()
    const state = normalizeStateToAbbrev(stateRaw)

    if (state && city) {
      const { mainStreet, line2 } = splitStreetLine(street)
      const result: Record<string, string> = { street: mainStreet, city, state, country: 'US' }
      if (line2) result.street_line_2 = line2
      if (zip) result.zip = zip
      return result
    }
  }

  // Strategy 2: 2-part — "street, city STATE ZIP"
  if (parts.length === 2) {
    const street = parts[0]
    const cityStateZip = parts[1]
    // Match "Springfield IL 62701" or "Springfield Illinois 62701"
    const match = cityStateZip.match(/^(.+?)\s+([A-Za-z]{2,}(?:\s+[A-Za-z]+)?)\s+(\d{5}(?:-\d{4})?)$/)
    if (match) {
      const state = normalizeStateToAbbrev(match[2])
      if (state) {
        const { mainStreet, line2 } = splitStreetLine(street)
        const result: Record<string, string> = { street: mainStreet, city: match[1].trim(), state, zip: match[3], country: 'US' }
        if (line2) result.street_line_2 = line2
        return result
      }
    }
  }

  // Fallback: return street-only so address still gets created
  return { street: raw, country: 'US' }
}

function pickCustomerAddressId(
  addresses: HCPAddress[] | undefined,
  requestedAddress?: string
): string | undefined {
  if (!addresses?.length) return undefined

  const requestedNormalized = normalizeAddressForMatch(requestedAddress)
  if (requestedNormalized) {
    for (const addr of addresses) {
      if (!addr.id) continue
      const assembled = [
        addr.street,
        addr.street_line_2,
        addr.city,
        addr.state,
        addr.zip,
      ].filter(Boolean).join(' ')

      const assembledNormalized = normalizeAddressForMatch(assembled)
      if (!assembledNormalized) continue
      if (
        assembledNormalized.includes(requestedNormalized) ||
        requestedNormalized.includes(assembledNormalized)
      ) {
        return addr.id
      }
    }
  }

  const serviceAddress = addresses.find((a) => a.id && String(a.type || '').toLowerCase() === 'service')
  if (serviceAddress?.id) return serviceAddress.id

  return addresses.find((a) => a.id)?.id
}

function buildCustomerCreateAddresses(address?: string): Array<Record<string, string>> | undefined {
  const raw = (address || '').trim()
  if (!raw) return undefined

  const parsed = buildAddressCreatePayload(raw)
  if (parsed) return [{ ...parsed, type: 'service' }]
  return [{ street: raw, type: 'service' }]
}

async function ensureCustomerAddressId(
  tenant: Tenant,
  customerId: string,
  existingAddresses: HCPAddress[] | undefined,
  requestedAddress?: string
): Promise<string | undefined> {
  const existingId = pickCustomerAddressId(existingAddresses, requestedAddress)
  if (existingId) return existingId

  const parsedAddress = buildAddressCreatePayload(requestedAddress)
  if (!parsedAddress) return undefined

  const createAddressResult = await hcpRequest<HCPAddress>(
    tenant,
    `/customers/${customerId}/addresses`,
    {
      method: 'POST',
      body: parsedAddress,
    }
  )

  if (createAddressResult.success && createAddressResult.data?.id) {
    return createAddressResult.data.id
  }

  console.warn(
    `[HCP API] Could not create address on customer ${customerId}: ${createAddressResult.error || 'no id returned'}`
  )
  return undefined
}

function normalizeHcpApiKey(value: string): string {
  return value
    .trim()
    .replace(/^(token|bearer)\s+/i, '')
    .trim()
}

function normalizeOptionalHeader(value?: string | null): string | undefined {
  const normalized = (value || '').trim()
  return normalized || undefined
}

type HcpAuthHeaderCandidate = {
  label: string
  value: string
}

function buildAuthHeaderCandidates(
  storedApiKey: string,
  normalizedApiKey: string
): HcpAuthHeaderCandidate[] {
  const candidates: HcpAuthHeaderCandidate[] = []
  const seen = new Set<string>()

  const addCandidate = (label: string, value: string | undefined) => {
    const headerValue = (value || '').trim()
    if (!headerValue) return
    const dedupeKey = headerValue.toLowerCase()
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    candidates.push({ label, value: headerValue })
  }

  addCandidate('Token', `Token ${normalizedApiKey}`)
  addCandidate('Bearer', `Bearer ${normalizedApiKey}`)

  const rawTrimmed = storedApiKey.trim()
  if (/^(token|bearer)\s+/i.test(rawTrimmed)) {
    addCandidate('StoredPrefix', rawTrimmed)
  }

  return candidates
}

type HcpRequestAttempt = {
  label: string
  headers: Record<string, string>
}

function buildHcpRequestAttempts(
  authCandidates: HcpAuthHeaderCandidate[],
  companyId?: string
): HcpRequestAttempt[] {
  const attempts: HcpRequestAttempt[] = []

  // Try without X-Company-Id first (HCP rejects it for many accounts),
  // then fall back to with Company-Id in case it's required.
  for (const auth of authCandidates) {
    attempts.push({
      label: auth.label,
      headers: {
        Authorization: auth.value,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    })
  }

  if (companyId) {
    for (const auth of authCandidates) {
      attempts.push({
        label: `${auth.label}+Company`,
        headers: {
          Authorization: auth.value,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Company-Id': companyId,
        },
      })
    }
  }

  return attempts
}

/**
 * Make authenticated request to HousecallPro API
 */
async function hcpRequest<T>(
  tenant: Tenant,
  endpoint: string,
  options: HCPApiOptions = {}
): Promise<{ success: boolean; data?: T; error?: string }> {
  const storedApiKey = normalizeOptionalHeader(tenant.housecall_pro_api_key)
  if (!storedApiKey) {
    console.error(`[HCP API] No API key configured for tenant ${tenant.slug}`)
    return { success: false, error: 'HousecallPro API key not configured' }
  }

  const normalizedApiKey = normalizeHcpApiKey(storedApiKey)
  if (!normalizedApiKey) {
    console.error(`[HCP API] Invalid API key format for tenant ${tenant.slug}`)
    return { success: false, error: 'HousecallPro API key is invalid/empty' }
  }

  const authCandidates = buildAuthHeaderCandidates(storedApiKey, normalizedApiKey)
  const companyId = normalizeOptionalHeader(tenant.housecall_pro_company_id)
  const attempts = buildHcpRequestAttempts(authCandidates, companyId)

  console.log(`[HCP API] ${options.method || 'GET'} ${endpoint}`, options.body ? { bodyKeys: Object.keys(options.body) } : '')

  let lastHttpError: { status: number; text: string; label: string } | null = null
  let lastFetchError: string | null = null

  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index]

    try {
      const response = await fetch(`${HCP_API_BASE}${endpoint}`, {
        method: options.method || 'GET',
        headers: attempt.headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      })

      const responseText = await response.text()
      if (response.ok) {
        if (index > 0) {
          console.warn(
            `[HCP API] Request recovered via auth fallback (${attempt.label}) for ${endpoint}`
          )
        }

        if (!responseText.trim()) {
          return { success: true }
        }

        try {
          const data = JSON.parse(responseText) as T
          return { success: true, data }
        } catch {
          console.warn(`[HCP API] Non-JSON success response from ${endpoint}`)
          return { success: true }
        }
      }

      lastHttpError = { status: response.status, text: responseText, label: attempt.label }

      const canRetryAuth =
        (response.status === 401 || response.status === 403) &&
        index < attempts.length - 1

      if (canRetryAuth) {
        console.warn(
          `[HCP API] Auth retry ${response.status} using ${attempt.label} for ${endpoint}`
        )
        continue
      }

      console.error(`[HCP API] Error ${response.status}: ${responseText}`)
      return {
        success: false,
        error: `HCP API error: ${response.status} - ${responseText || 'No response body'}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      lastFetchError = message
      const canRetry = index < attempts.length - 1
      if (canRetry) {
        console.warn(`[HCP API] Network/auth retry using ${attempt.label} for ${endpoint}: ${message}`)
        continue
      }
    }
  }

  if (lastHttpError) {
    console.error(
      `[HCP API] Error ${lastHttpError.status} after auth attempts (last=${lastHttpError.label}): ${lastHttpError.text}`
    )
    return {
      success: false,
      error: `HCP API error: ${lastHttpError.status} - ${lastHttpError.text || 'No response body'}`,
    }
  }

  console.error(`[HCP API] Request failed after auth attempts: ${lastFetchError || 'Unknown error'}`)
  return { success: false, error: lastFetchError || 'Unknown error' }
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
    tags?: string[]
    leadSource?: string
    notificationsEnabled?: boolean
    company?: string
  }
): Promise<{ success: boolean; customerId?: string; addressId?: string; error?: string }> {
  const phoneDigits = normalizePhoneForMatch(customerData.phone)
  const searchTerm = phoneDigits || customerData.phone

  const selectExistingCustomer = async (
    customers: HCPCustomer[]
  ): Promise<{ success: boolean; customerId?: string; addressId?: string } | null> => {
    if (!customers.length) return null

    const exactPhoneMatch = customers.find((customer) => {
      const phones = [customer.mobile_number, customer.home_number, customer.work_number]
      return phones.some((phone) => normalizePhoneForMatch(phone) === phoneDigits)
    })

    const existing = exactPhoneMatch || customers[0]
    const addressId = await ensureCustomerAddressId(
      tenant,
      existing.id,
      existing.addresses,
      customerData.address
    )

    console.log(`[HCP API] Found existing customer: ${existing.id}`)
    return { success: true, customerId: existing.id, addressId }
  }

  // First try explicit mobile_number filter.
  const phoneSearchResult = await hcpRequest<{ customers?: HCPCustomer[] } | HCPCustomer[]>(
    tenant,
    `/customers?mobile_number=${encodeURIComponent(customerData.phone)}&page=1&page_size=25`
  )
  if (phoneSearchResult.success) {
    const phoneMatches = extractCustomers(phoneSearchResult.data)
    const found = await selectExistingCustomer(phoneMatches)
    if (found) return found
  } else {
    console.warn(`[HCP API] Customer mobile search failed for ${customerData.phone}: ${phoneSearchResult.error}`)
  }

  // Then broad q search (covers name/email/phone/address).
  const broadSearchResult = await hcpRequest<{ customers?: HCPCustomer[] } | HCPCustomer[]>(
    tenant,
    `/customers?q=${encodeURIComponent(searchTerm)}&page=1&page_size=25`
  )
  if (broadSearchResult.success) {
    const broadMatches = extractCustomers(broadSearchResult.data)
    const found = await selectExistingCustomer(broadMatches)
    if (found) return found
  } else {
    console.warn(`[HCP API] Customer broad search failed for ${customerData.phone}: ${broadSearchResult.error}`)
  }

  // Create new customer if search did not find one.
  console.log(`[HCP API] Creating customer for ${customerData.phone}`)
  const body: Record<string, unknown> = {
    first_name: customerData.firstName || '',
    last_name: customerData.lastName || '',
    mobile_number: customerData.phone,
    email: customerData.email || undefined,
    notifications_enabled: customerData.notificationsEnabled ?? true,
    tags: customerData.tags?.length ? customerData.tags : ['osiris'],
    lead_source: customerData.leadSource || 'osiris',
    company: customerData.company || undefined,
  }

  const customerAddresses = buildCustomerCreateAddresses(customerData.address)
  if (customerAddresses?.length) {
    body.addresses = customerAddresses
  }

  const createResult = await hcpRequest<HCPCustomer>(tenant, '/customers', {
    method: 'POST',
    body,
  })

  if (createResult.success && createResult.data?.id) {
    const addressId = await ensureCustomerAddressId(
      tenant,
      createResult.data.id,
      createResult.data.addresses,
      customerData.address
    )

    console.log(`[HCP API] Customer created: ${createResult.data.id}`)
    return { success: true, customerId: createResult.data.id, addressId }
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
    tags?: string[]
    leadSource?: string
    notificationsEnabled?: boolean
    company?: string
  }
): Promise<{ success: boolean; customerId?: string; addressId?: string; error?: string }> {
  console.log(
    `[HCP API] Creating new customer: ${customerData.firstName || ''} ${customerData.lastName || ''} (${customerData.phone})`
  )

  const body: Record<string, unknown> = {
    first_name: customerData.firstName || '',
    last_name: customerData.lastName || '',
    mobile_number: customerData.phone,
    email: customerData.email || undefined,
    notifications_enabled: customerData.notificationsEnabled ?? true,
    tags: customerData.tags?.length ? customerData.tags : ['osiris'],
    lead_source: customerData.leadSource || 'osiris',
    company: customerData.company || undefined,
  }

  const customerAddresses = buildCustomerCreateAddresses(customerData.address)
  if (customerAddresses?.length) {
    body.addresses = customerAddresses
  }

  const createResult = await hcpRequest<HCPCustomer>(tenant, '/customers', {
    method: 'POST',
    body,
  })

  if (createResult.success && createResult.data?.id) {
    const addressId = await ensureCustomerAddressId(
      tenant,
      createResult.data.id,
      createResult.data.addresses,
      customerData.address
    )

    console.log(`[HCP API] New customer created: ${createResult.data.id}`)
    return { success: true, customerId: createResult.data.id, addressId }
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
  const totalCents = toHcpMoneyCents(jobData.price)

  // HCP's lead conversion endpoint.
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
        total: totalCents,
        notes: jobData.notes || undefined,
      },
    }
  )

  const convertedJobId = extractJobId(result.data?.job || result.data)
  if (result.success && convertedJobId) {
    console.log(`[HCP API] Lead converted to job: ${convertedJobId}`)
    return {
      success: true,
      jobId: convertedJobId,
      customerId: result.data?.customer?.id,
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
    addressId?: string
    scheduledDate?: string
    scheduledTime?: string
    address?: string
    serviceType?: string
    price?: number
    notes?: string
    lineItems?: Array<{
      name: string
      quantity: number
      unit_price: number
      description?: string
    }>
    assignedEmployeeIds?: string[]
    durationHours?: number
    tags?: string[]
    description?: string
    leadSource?: string
  }
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  console.log(`[HCP API] Creating job for customer ${jobData.customerId}`)

  const { scheduledStart, scheduledEnd } = buildScheduleWindow(
    jobData.scheduledDate,
    jobData.scheduledTime,
    jobData.durationHours
  )
  const totalCents = toHcpMoneyCents(jobData.price)
  let lineItemsCents = toHcpLineItems(jobData.lineItems)

  if ((!lineItemsCents || lineItemsCents.length === 0) && totalCents !== undefined) {
    lineItemsCents = [{
      name: jobData.serviceType || 'Cleaning Service',
      quantity: 1,
      unit_price: totalCents,
      description: jobData.address || undefined,
    }]
  }

  const notesParts = [
    jobData.serviceType ? `Service: ${jobData.serviceType}` : '',
    jobData.notes || '',
  ].filter(Boolean)
  const notes = notesParts.join('\n')

  const assignedEmployeeIds = jobData.assignedEmployeeIds?.length ? jobData.assignedEmployeeIds : undefined
  const tags = jobData.tags?.length ? jobData.tags : ['osiris']
  const description = jobData.description || jobData.serviceType || 'Cleaning Service'

  // Build a single unified payload with flat schedule fields.
  // NOTE: lead_source is NOT sent — HCP rejects custom values (only accepts their predefined list).
  // Schedule fields sent here for best-effort but HCP may ignore them;
  // the post-create updateHCPJob() call applies them via PUT /jobs/{id}/schedule.
  const jobBody: Record<string, unknown> = {
    customer_id: jobData.customerId,
    scheduled_start: scheduledStart || undefined,
    scheduled_end: scheduledEnd || undefined,
    notes: notes || undefined,
    line_items: lineItemsCents,
    assigned_employee_ids: assignedEmployeeIds,
    tags,
    description,
  }

  // Use address_id if available, fall back to raw address string
  if (jobData.addressId) {
    jobBody.address_id = jobData.addressId
  } else if (jobData.address) {
    jobBody.address = jobData.address
  }

  const createResult = await hcpRequest<HCPJob | { job?: { id?: string } }>(
    tenant,
    '/jobs',
    { method: 'POST', body: jobBody }
  )

  if (createResult.success) {
    const jobId = extractJobId(createResult.data)
    if (jobId) {
      console.log(`[HCP API] Job created: ${jobId}`)
      return { success: true, jobId }
    }
  }

  // Fallback: retry without address_id if it was present (in case HCP rejected it)
  if (jobData.addressId) {
    console.warn(`[HCP API] Create with address_id failed (${createResult.error}), retrying with address string`)
    delete jobBody.address_id
    if (jobData.address) jobBody.address = jobData.address

    const fallbackResult = await hcpRequest<HCPJob | { job?: { id?: string } }>(
      tenant,
      '/jobs',
      { method: 'POST', body: jobBody }
    )

    if (fallbackResult.success) {
      const jobId = extractJobId(fallbackResult.data)
      if (jobId) {
        console.log(`[HCP API] Job created (address string fallback): ${jobId}`)
        return { success: true, jobId }
      }
    }

    return { success: false, error: fallbackResult.error || createResult.error }
  }

  return { success: false, error: createResult.error }
}

/**
 * Update an existing HCP job with latest scheduling/details/assignment.
 * Uses documented schedule/dispatch/line_item endpoints first, then falls back
 * to PATCH /jobs/{id} when needed.
 */
export async function updateHCPJob(
  tenant: Tenant,
  jobId: string,
  jobData: {
    scheduledDate?: string
    scheduledTime?: string
    address?: string
    serviceType?: string
    price?: number
    notes?: string
    lineItems?: Array<{
      name: string
      quantity: number
      unit_price: number
      description?: string
    }>
    assignedEmployeeIds?: string[]
    durationHours?: number
    tags?: string[]
    description?: string
  }
): Promise<{ success: boolean; error?: string }> {
  const { scheduledStart, scheduledEnd } = buildScheduleWindow(
    jobData.scheduledDate,
    jobData.scheduledTime,
    jobData.durationHours
  )
  const totalCents = toHcpMoneyCents(jobData.price)
  let lineItemsCents = toHcpLineItems(jobData.lineItems)

  if ((!lineItemsCents || lineItemsCents.length === 0) && totalCents !== undefined) {
    lineItemsCents = [{
      name: jobData.serviceType || 'Cleaning Service',
      quantity: 1,
      unit_price: totalCents,
      description: jobData.address || undefined,
    }]
  }

  const normalizedAssignmentIds = Array.isArray(jobData.assignedEmployeeIds)
    ? jobData.assignedEmployeeIds.filter(Boolean)
    : undefined
  const dispatchedEmployees = normalizedAssignmentIds?.map((employeeId) => ({ employee_id: employeeId }))

  const criticalErrors: string[] = []

  const fallbackPatch = async (
    payload: Record<string, unknown>,
    context: string
  ): Promise<boolean> => {
    const fallback = await hcpRequest<HCPJob>(tenant, `/jobs/${jobId}`, {
      method: 'PATCH',
      body: payload,
    })

    if (fallback.success) {
      console.warn(`[HCP API] ${context} updated via PATCH fallback for job ${jobId}`)
      return true
    }

    console.error(`[HCP API] ${context} update failed for job ${jobId}: ${fallback.error}`)
    return false
  }

  if (scheduledStart) {
    const scheduleBody: Record<string, unknown> = {
      start_time: scheduledStart,
      end_time: scheduledEnd || scheduledStart,
      arrival_window_in_minutes: DEFAULT_ARRIVAL_WINDOW_MINUTES,
      notify: false,
      notify_pro: false,
    }

    if (Array.isArray(dispatchedEmployees)) {
      scheduleBody.dispatched_employees = dispatchedEmployees
    }

    const scheduleResult = await hcpRequest<Record<string, unknown>>(tenant, `/jobs/${jobId}/schedule`, {
      method: 'PUT',
      body: scheduleBody,
    })

    if (!scheduleResult.success) {
      const patched = await fallbackPatch(
        {
          scheduled_start: scheduledStart,
          scheduled_end: scheduledEnd || scheduledStart,
        },
        'schedule'
      )
      if (!patched) {
        criticalErrors.push(`schedule: ${scheduleResult.error}`)
      }
    }
  }

  if (normalizedAssignmentIds !== undefined) {
    const dispatchResult = await hcpRequest<Record<string, unknown>>(tenant, `/jobs/${jobId}/dispatch`, {
      method: 'PUT',
      body: {
        dispatched_employees: dispatchedEmployees || [],
      },
    })

    if (!dispatchResult.success) {
      const patched = await fallbackPatch(
        { assigned_employee_ids: normalizedAssignmentIds },
        'dispatch'
      )
      if (!patched) {
        criticalErrors.push(`dispatch: ${dispatchResult.error}`)
      }
    }
  }

  if (lineItemsCents?.length) {
    const lineItemsResult = await hcpRequest<Record<string, unknown>>(
      tenant,
      `/jobs/${jobId}/line_items/bulk_update`,
      {
        method: 'PUT',
        body: {
          line_items: lineItemsCents,
          append_line_items: false,
        },
      }
    )

    if (!lineItemsResult.success) {
      const patched = await fallbackPatch({ line_items: lineItemsCents }, 'line items')
      if (!patched) {
        criticalErrors.push(`line_items: ${lineItemsResult.error}`)
      }
    }
  }

  const notesParts = [
    jobData.serviceType ? `Service: ${jobData.serviceType}` : '',
    jobData.notes || '',
  ].filter(Boolean)
  const notes = notesParts.join('\n')

  if (notes || jobData.address || jobData.tags || jobData.description) {
    const patchBody: Record<string, unknown> = {
      notes: notes || undefined,
      address: jobData.address || undefined,
    }
    if (jobData.tags?.length) patchBody.tags = jobData.tags
    if (jobData.description) patchBody.description = jobData.description

    const metadataPatch = await hcpRequest<HCPJob>(tenant, `/jobs/${jobId}`, {
      method: 'PATCH',
      body: patchBody,
    })

    if (!metadataPatch.success) {
      console.warn(`[HCP API] Metadata PATCH failed for job ${jobId}: ${metadataPatch.error}`)
    }
  }

  if (criticalErrors.length > 0) {
    return { success: false, error: criticalErrors.join(' | ') }
  }

  return { success: true }
}

/**
 * List HCP employees for assignment mapping.
 */
export async function listHCPEmployees(
  tenant: Tenant
): Promise<{ success: boolean; employees?: HCPEmployee[]; error?: string }> {
  const result = await hcpRequest<{ employees?: HCPEmployee[] } | HCPEmployee[]>(
    tenant,
    '/employees'
  )

  if (!result.success) {
    return { success: false, error: result.error }
  }

  const employees = extractEmployees(result.data)
  return { success: true, employees }
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
 * Update an existing customer in HousecallPro (name, email, address, etc.)
 * Used when customer corrects their info via SMS or other channels.
 */
export async function updateHCPCustomer(
  tenant: Tenant,
  hcpCustomerId: string,
  updates: {
    firstName?: string
    lastName?: string
    email?: string
    phone?: string
    address?: string
  }
): Promise<{ success: boolean; error?: string }> {
  console.log(`[HCP API] Updating customer ${hcpCustomerId}`)

  const body: Record<string, unknown> = {}
  if (updates.firstName !== undefined) body.first_name = updates.firstName
  if (updates.lastName !== undefined) body.last_name = updates.lastName
  if (updates.email !== undefined) body.email = updates.email
  if (updates.phone !== undefined) body.mobile_number = updates.phone

  if (Object.keys(body).length === 0 && !updates.address) {
    return { success: true } // Nothing to update
  }

  const result = await hcpRequest<HCPCustomer>(tenant, `/customers/${hcpCustomerId}`, {
    method: 'PUT',
    body,
  })

  if (!result.success) {
    console.error(`[HCP API] Failed to update customer ${hcpCustomerId}: ${result.error}`)
    return { success: false, error: result.error }
  }

  // If address provided, ensure it exists on the customer
  if (updates.address) {
    await ensureCustomerAddressId(tenant, hcpCustomerId, result.data?.addresses, updates.address)
  }

  console.log(`[HCP API] Customer ${hcpCustomerId} updated`)
  return { success: true }
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
