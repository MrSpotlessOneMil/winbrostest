/**
 * HousecallPro API Client
 * Two-way sync: Create leads/jobs in HCP, update status
 *
 * API Docs: https://docs.housecallpro.com/
 */

import { getDefaultTenant, isHcpSyncEnabled, type Tenant } from './tenant'
import { maskPhone } from './phone-utils'

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
    // Requested address doesn't match any existing address — return undefined
    // so ensureCustomerAddressId creates the new address in HCP
    return undefined
  }

  // No specific address requested — return any existing address
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
 * Quick check if an HCP resource still exists (GET returns 200).
 * Used to detect stale IDs from resources deleted in the HCP dashboard.
 */
export async function verifyHCPResource(tenant: Tenant, endpoint: string): Promise<boolean> {
  const result = await hcpRequest<unknown>(tenant, endpoint)
  return result.success
}

/**
 * Make authenticated request to HousecallPro API
 */
async function hcpRequest<T>(
  tenant: Tenant,
  endpoint: string,
  options: HCPApiOptions = {}
): Promise<{ success: boolean; data?: T; error?: string }> {
  // Master kill switch: block ALL outbound HCP API calls when sync is disabled
  if (!isHcpSyncEnabled(tenant)) {
    console.log(`[HCP API] Sync disabled for tenant ${tenant.slug} — blocking ${options.method || 'GET'} ${endpoint}`)
    return { success: false, error: 'HCP sync is disabled for this tenant' }
  }

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
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)
      const response = await fetch(`${HCP_API_BASE}${endpoint}`, {
        method: options.method || 'GET',
        headers: attempt.headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      })
      clearTimeout(timeout)

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
  console.log(`[HCP API] Creating lead for ${maskPhone(leadData.phone)}`)

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

  // Push current name/email/address to HCP so stale data gets overwritten
  if (leadData.firstName || leadData.lastName || leadData.email || leadData.address) {
    await updateHCPCustomer(tenant, customerResult.customerId, {
      firstName: leadData.firstName,
      lastName: leadData.lastName,
      email: leadData.email,
      address: leadData.address,
    })
  }

  // Step 2: Create lead with customer_id AND name fields
  // HCP caches first_name/last_name on the lead at creation time,
  // so we must send them explicitly (not just rely on customer_id link).
  const leadBody: Record<string, unknown> = {
    customer_id: customerResult.customerId,
    notes: leadData.notes || `Source: ${leadData.source || 'API'}`,
    source: leadData.source || 'api',
  }
  if (leadData.firstName) leadBody.first_name = leadData.firstName
  if (leadData.lastName) leadBody.last_name = leadData.lastName
  if (leadData.email) leadBody.email = leadData.email
  if (leadData.phone) leadBody.mobile_number = leadData.phone
  // NOTE: Do NOT send address on leads — HCP expects address as a hash object
  // (not a flat string) and returns 422 "address must be a hash" if we send a string.
  // The address is already on the linked customer record.

  const result = await hcpRequest<HCPLead>(tenant, '/leads', {
    method: 'POST',
    body: leadBody,
  })

  if (result.success && result.data?.id) {
    console.log(`[HCP API] Lead created: ${result.data.id} (name: ${leadData.firstName} ${leadData.lastName})`)
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

    // Only use a customer if the phone number actually matches.
    // HCP's search API returns ALL customers when there's no match,
    // so we must verify the phone ourselves to avoid hijacking a random customer.
    const exactPhoneMatch = customers.find((customer) => {
      const phones = [customer.mobile_number, customer.home_number, customer.work_number]
      return phones.some((phone) => normalizePhoneForMatch(phone) === phoneDigits)
    })

    if (!exactPhoneMatch) return null

    const addressId = await ensureCustomerAddressId(
      tenant,
      exactPhoneMatch.id,
      exactPhoneMatch.addresses,
      customerData.address
    )

    console.log(`[HCP API] Found existing customer: ${exactPhoneMatch.id}`)
    return { success: true, customerId: exactPhoneMatch.id, addressId }
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
    console.warn(`[HCP API] Customer mobile search failed for ${maskPhone(customerData.phone)}: ${phoneSearchResult.error}`)
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
    console.warn(`[HCP API] Customer broad search failed for ${maskPhone(customerData.phone)}: ${broadSearchResult.error}`)
  }

  // Create new customer if search did not find one.
  console.log(`[HCP API] Creating customer for ${maskPhone(customerData.phone)}`)
  const body: Record<string, unknown> = {
    first_name: customerData.firstName || '',
    last_name: customerData.lastName || '',
    mobile_number: customerData.phone,
    email: customerData.email || undefined,
    notifications_enabled: customerData.notificationsEnabled ?? true,
    tags: customerData.tags?.length ? customerData.tags : ['osiris'],
    // Note: lead_source must be a pre-configured value in HCP. Don't send it
    // unless the tenant has a valid HCP lead source configured.
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

  const fallbackPut = async (
    payload: Record<string, unknown>,
    context: string
  ): Promise<boolean> => {
    const fallback = await hcpRequest<HCPJob>(tenant, `/jobs/${jobId}`, {
      method: 'PUT',
      body: payload,
    })

    if (fallback.success) {
      console.warn(`[HCP API] ${context} updated via PUT fallback for job ${jobId}`)
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
      const patched = await fallbackPut(
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
      const patched = await fallbackPut(
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
      const patched = await fallbackPut({ line_items: lineItemsCents }, 'line items')
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

  // NOTE: HCP does not support PUT or PATCH on /jobs/{id} (returns 404).
  // notes, address, tags, description are already included in the initial
  // POST /jobs body by createHCPJob, so no separate metadata update is needed.

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
 * Update a lead in HousecallPro (name, email, notes).
 * HCP caches first_name/last_name on the lead record at creation time,
 * so updating the linked customer does NOT update the lead's display name.
 * Call this after any customer name change to keep the lead in sync.
 */
export async function updateHCPLead(
  tenant: Tenant,
  leadId: string,
  updates: {
    firstName?: string
    lastName?: string
    email?: string
    phone?: string
    address?: string
    notes?: string
  }
): Promise<{ success: boolean; error?: string }> {
  const body: Record<string, unknown> = {}
  if (updates.firstName !== undefined) body.first_name = updates.firstName
  if (updates.lastName !== undefined) body.last_name = updates.lastName
  if (updates.email !== undefined) body.email = updates.email
  if (updates.phone !== undefined) body.mobile_number = updates.phone
  if (updates.address !== undefined) body.address = updates.address
  if (updates.notes !== undefined) body.notes = updates.notes

  if (Object.keys(body).length === 0) {
    return { success: true }
  }

  console.log(`[HCP API] Updating lead ${leadId} with: ${JSON.stringify(body)}`)

  let result = await hcpRequest<HCPLead>(tenant, `/leads/${leadId}`, {
    method: 'PATCH',
    body,
  })

  // HCP may not support PATCH on leads for name fields (returns 404) — try PUT fallback
  if (!result.success) {
    console.warn(`[HCP API] PATCH lead ${leadId} failed (${result.error?.substring(0, 80)}), trying PUT`)
    result = await hcpRequest<HCPLead>(tenant, `/leads/${leadId}`, {
      method: 'PUT',
      body,
    })
  }

  if (result.success) {
    console.log(`[HCP API] Lead ${leadId} updated: first_name=${result.data?.first_name}, last_name=${result.data?.last_name}`)
    return { success: true }
  }

  console.warn(`[HCP API] Could not update lead ${leadId} (PATCH+PUT both failed): ${result.error?.substring(0, 120)}`)
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
  const body: Record<string, unknown> = {}
  if (updates.firstName !== undefined) body.first_name = updates.firstName
  if (updates.lastName !== undefined) body.last_name = updates.lastName
  if (updates.email !== undefined) body.email = updates.email
  if (updates.phone !== undefined) body.mobile_number = updates.phone

  if (Object.keys(body).length === 0 && !updates.address) {
    console.log(`[HCP API] No fields to update for customer ${hcpCustomerId}`)
    return { success: true }
  }

  console.log(`[HCP API] Updating customer ${hcpCustomerId} with: ${JSON.stringify(body)}`)

  // Use PATCH first (partial update) — PUT replaces the entire resource and silently
  // drops fields not included, so sending only { first_name } via PUT wipes last_name etc.
  let result = await hcpRequest<HCPCustomer>(tenant, `/customers/${hcpCustomerId}`, {
    method: 'PATCH',
    body,
  })

  if (!result.success) {
    console.warn(`[HCP API] PATCH failed for customer ${hcpCustomerId}, trying PUT: ${result.error}`)
    result = await hcpRequest<HCPCustomer>(tenant, `/customers/${hcpCustomerId}`, {
      method: 'PUT',
      body,
    })
  }

  if (!result.success) {
    console.error(`[HCP API] Failed to update customer ${hcpCustomerId}: ${result.error}`)
    return { success: false, error: result.error }
  }

  // Log what HCP returned to verify the update took effect
  if (result.data) {
    console.log(`[HCP API] Customer ${hcpCustomerId} after update: first_name=${result.data.first_name}, last_name=${result.data.last_name}`)
  } else {
    console.log(`[HCP API] Customer ${hcpCustomerId} update returned empty body — re-fetching to verify`)
    const verify = await hcpRequest<HCPCustomer>(tenant, `/customers/${hcpCustomerId}`)
    if (verify.success && verify.data) {
      console.log(`[HCP API] Customer ${hcpCustomerId} verified: first_name=${verify.data.first_name}, last_name=${verify.data.last_name}`)
    }
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
  if (!existingTenant) {
    console.error('[HCP API] createLeadInHCP called without tenant — aborting to prevent cross-tenant bleed')
    return { success: false, error: 'No tenant provided' }
  }
  const tenant = existingTenant
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
  tenant: Tenant,
  jobId: string,
  hcpJobId?: string
): Promise<{ success: boolean; error?: string }> {
  if (!hcpJobId) {
    console.log(`[HCP API] No HCP job ID for job ${jobId}, skipping sync`)
    return { success: true }
  }

  return completeHCPJob(tenant, hcpJobId)
}

// =====================================================================
// CUSTOMER BRAIN — Pull all HCP data for AI context
// =====================================================================

export type HCPCustomerStage =
  | 'active_plan'       // Has scheduled/recurring job → NEVER retarget
  | 'estimate_pending'  // Open estimate → follow up on estimate instead
  | 'recently_completed'// Job completed in last 30 days → don't retarget yet
  | 'lapsed'           // Last job 30-90 days ago → OK to retarget
  | 'dormant'          // Last job 90+ days ago → OK to retarget
  | 'new_lead'         // No jobs/estimates → OK to retarget
  | 'declined'         // Estimate declined → soft retarget only

export interface HCPCustomerBrain {
  stage: HCPCustomerStage
  stageDetail: string
  customerName: string | null
  address: string | null
  totalJobs: number
  totalSpent: number
  lastServiceDate: string | null
  lastServiceType: string | null
  lastServicePrice: number | null
  upcomingJobs: Array<{ date: string; service: string; price: number }>
  openEstimates: Array<{ status: string; amount: number; sentAt: string | null }>
  paymentHistory: string // "always on time", "has outstanding balance", etc.
  notes: string | null
}

/**
 * Pull all available HCP data for a customer and classify their lifecycle stage.
 * Used to build the CUSTOMER BRAIN section of the AI prompt and gate retargeting.
 */
export async function getCustomerHCPBrain(
  tenant: Tenant,
  hcpCustomerId: string
): Promise<HCPCustomerBrain | null> {
  if (!tenant.housecall_pro_api_key) return null

  try {
    // Pull customer details
    const customerResult = await hcpRequest<Record<string, unknown>>(tenant, `/customers/${hcpCustomerId}`)
    const customer = customerResult.data

    // Pull all jobs for this customer
    const jobsResult = await hcpRequest<{ jobs?: Array<Record<string, unknown>> }>(
      tenant, '/jobs', { params: { customer_id: hcpCustomerId } }
    )
    const jobs = jobsResult.data?.jobs || []

    // Pull estimates
    const estimatesResult = await hcpRequest<{ estimates?: Array<Record<string, unknown>> }>(
      tenant, '/estimates', { params: { customer_id: hcpCustomerId } }
    )
    const estimates = estimatesResult.data?.estimates || []

    // Classify jobs
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

    const completedJobs = jobs.filter((j: Record<string, unknown>) => {
      const status = String(j.work_status || j.status || '')
      return ['complete', 'completed'].includes(status)
    })

    const scheduledJobs = jobs.filter((j: Record<string, unknown>) => {
      const status = String(j.work_status || j.status || '')
      return ['scheduled', 'dispatched', 'in_progress'].includes(status)
    })

    const upcomingJobs = scheduledJobs.map((j: Record<string, unknown>) => ({
      date: String(j.scheduled_start || (j.schedule as Record<string, unknown>)?.scheduled_start || ''),
      service: String(j.line_items?.[0]?.name || 'Service'),
      price: Number(j.total_amount || 0),
    }))

    const openEstimates = estimates
      .filter((e: Record<string, unknown>) => ['draft', 'sent'].includes(String(e.status)))
      .map((e: Record<string, unknown>) => ({
        status: String(e.status),
        amount: Number(e.total_amount || 0),
        sentAt: e.sent_at ? String(e.sent_at) : null,
      }))

    // Calculate totals
    const totalSpent = completedJobs.reduce((sum: number, j: Record<string, unknown>) => sum + Number(j.total_amount || 0), 0)

    // Find last completed job
    const sortedCompleted = completedJobs.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const dateA = new Date(String(a.updated_at || a.created_at || 0)).getTime()
      const dateB = new Date(String(b.updated_at || b.created_at || 0)).getTime()
      return dateB - dateA
    })
    const lastJob = sortedCompleted[0]
    const lastJobDate = lastJob ? new Date(String(lastJob.updated_at || lastJob.created_at)) : null

    // Determine stage
    let stage: HCPCustomerStage = 'new_lead'
    let stageDetail = 'No job history in HCP'

    if (scheduledJobs.length > 0) {
      stage = 'active_plan'
      stageDetail = `${scheduledJobs.length} scheduled job(s) — next: ${upcomingJobs[0]?.date || 'TBD'}`
    } else if (openEstimates.length > 0) {
      stage = 'estimate_pending'
      stageDetail = `${openEstimates.length} open estimate(s) — $${openEstimates[0]?.amount || 0}`
    } else if (estimates.some((e: Record<string, unknown>) => e.status === 'declined')) {
      stage = 'declined'
      stageDetail = 'Estimate was declined'
    } else if (lastJobDate && lastJobDate > thirtyDaysAgo) {
      stage = 'recently_completed'
      stageDetail = `Last job ${Math.round((now.getTime() - lastJobDate.getTime()) / (24 * 60 * 60 * 1000))} days ago`
    } else if (lastJobDate && lastJobDate > ninetyDaysAgo) {
      stage = 'lapsed'
      stageDetail = `Last job ${Math.round((now.getTime() - lastJobDate.getTime()) / (24 * 60 * 60 * 1000))} days ago`
    } else if (lastJobDate) {
      stage = 'dormant'
      stageDetail = `Last job ${Math.round((now.getTime() - lastJobDate.getTime()) / (24 * 60 * 60 * 1000))} days ago`
    }

    // Payment history assessment
    const hasOutstanding = jobs.some((j: Record<string, unknown>) => Number(j.outstanding_balance || 0) > 0)
    const paymentHistory = hasOutstanding ? 'has outstanding balance' : completedJobs.length > 0 ? 'always pays on time' : 'no payment history'

    // Address
    const addresses = (customer as Record<string, unknown>)?.addresses as Array<Record<string, unknown>> | undefined
    const serviceAddr = addresses?.find((a: Record<string, unknown>) => a.type === 'service') || addresses?.[0]
    const address = serviceAddr
      ? `${serviceAddr.street || ''}${serviceAddr.city ? `, ${serviceAddr.city}` : ''}${serviceAddr.state ? ` ${serviceAddr.state}` : ''} ${serviceAddr.zip || ''}`.trim()
      : null

    const customerName = customer
      ? `${(customer as Record<string, unknown>).first_name || ''} ${(customer as Record<string, unknown>).last_name || ''}`.trim() || null
      : null

    return {
      stage,
      stageDetail,
      customerName,
      address,
      totalJobs: completedJobs.length,
      totalSpent,
      lastServiceDate: lastJob ? String(lastJob.updated_at || lastJob.created_at) : null,
      lastServiceType: lastJob ? String((lastJob.line_items as Array<Record<string, unknown>>)?.[0]?.name || 'Service') : null,
      lastServicePrice: lastJob ? Number(lastJob.total_amount || 0) : null,
      upcomingJobs,
      openEstimates,
      paymentHistory,
      notes: customer ? String((customer as Record<string, unknown>).notes || '') || null : null,
    }
  } catch (err) {
    console.error(`[HCP Brain] Failed to load customer brain for ${hcpCustomerId}:`, err)
    return null
  }
}

/**
 * Quick check: should this customer be retargeted?
 * Returns false if they're active, have a pending estimate, or were recently serviced.
 */
export function shouldRetargetCustomer(brain: HCPCustomerBrain): boolean {
  return !['active_plan', 'estimate_pending', 'recently_completed'].includes(brain.stage)
}

/**
 * Format HCP brain data as a prompt section for the AI.
 */
export function formatHCPBrainForPrompt(brain: HCPCustomerBrain): string {
  const lines: string[] = ['CUSTOMER BRAIN (from HousecallPro):']

  if (brain.customerName) lines.push(`Name: ${brain.customerName}`)
  if (brain.address) lines.push(`Address on file: ${brain.address}`)

  lines.push(`Stage: ${brain.stage} (${brain.stageDetail})`)

  if (brain.totalJobs > 0) {
    lines.push(`History: ${brain.totalJobs} completed job${brain.totalJobs > 1 ? 's' : ''}, $${brain.totalSpent} total`)
  }
  if (brain.lastServiceDate) {
    const daysAgo = Math.round((Date.now() - new Date(brain.lastServiceDate).getTime()) / (24 * 60 * 60 * 1000))
    lines.push(`Last service: ${brain.lastServiceType} ($${brain.lastServicePrice}) — ${daysAgo} days ago`)
  }
  if (brain.upcomingJobs.length > 0) {
    lines.push(`Upcoming: ${brain.upcomingJobs.map(j => `${j.service} on ${j.date}`).join(', ')}`)
  }
  if (brain.openEstimates.length > 0) {
    lines.push(`Open estimates: ${brain.openEstimates.map(e => `$${e.amount} (${e.status})`).join(', ')}`)
  }
  lines.push(`Payment: ${brain.paymentHistory}`)
  if (brain.notes) lines.push(`Notes: ${brain.notes}`)

  // Stage-based guidance for the AI
  switch (brain.stage) {
    case 'active_plan':
      lines.push('\n→ This customer is ALREADY BOOKED. Do NOT try to sell them. Just be helpful with their existing service.')
      break
    case 'estimate_pending':
      lines.push('\n→ They have an open estimate. Ask if they had a chance to review it. Gently follow up.')
      break
    case 'recently_completed':
      lines.push('\n→ Recently serviced. Be warm, ask how everything went. Don\'t push a new booking yet.')
      break
    case 'lapsed':
      lines.push('\n→ Haven\'t booked in a while. Be warm, casually reference their last service. They might be ready to rebook.')
      break
    case 'dormant':
      lines.push('\n→ Long time since last service. Re-engage warmly. They may need a reminder of how great it was.')
      break
    case 'declined':
      lines.push('\n→ They declined an estimate. Be respectful, ask if circumstances changed. No hard sell.')
      break
  }

  return lines.join('\n')
}
