import OpenAI from 'openai'
import type { Job, Customer } from './supabase'
import { getClientConfig } from './client-config'
import { extractJsonObject, safeJsonParse } from './json-utils'

export type InvoiceProvider = 'wave' | 'stripe'

export type InvoiceResult = {
  success: boolean
  provider?: InvoiceProvider
  invoiceId?: string
  invoiceUrl?: string
  emailSent?: boolean
  emailError?: string
  error?: string
}

type WaveConfig = {
  token: string
  businessId: string
  incomeAccountId: string
}

const WAVE_API_URL = 'https://gql.waveapps.com/graphql/public'

/**
 * Create an invoice for a job using the appropriate provider.
 *
 * Multi-tenant routing:
 *   - tenant.use_stripe && !tenant.use_wave → Stripe invoice (via tenant's stripe_secret_key)
 *   - tenant.use_wave → Wave invoice (via tenant's wave credentials or env vars)
 *   - No tenant provided → legacy fallback to Wave env vars
 */
export async function createInvoice(
  job: Job,
  customer: Customer,
  tenant?: { workflow_config?: any; stripe_secret_key?: string; wave_api_token?: string; wave_business_id?: string; wave_income_account_id?: string } | null,
  membershipInfo?: { discount: number; planName: string }
): Promise<InvoiceResult> {
  const wc = tenant?.workflow_config

  // Route to Stripe invoicing when tenant explicitly uses Stripe (not Wave)
  if (wc?.use_stripe && !wc?.use_wave && tenant?.stripe_secret_key) {
    try {
      const { createAndSendInvoice } = await import('./stripe-client')
      const result = await createAndSendInvoice(job, customer, tenant.stripe_secret_key, membershipInfo)
      return {
        success: result.success,
        provider: 'stripe',
        invoiceId: result.invoiceId,
        invoiceUrl: result.invoiceUrl,
        error: result.error,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Stripe error'
      console.error('[Invoice] Stripe invoice failed:', message)
      return { success: false, provider: 'stripe', error: message }
    }
  }

  // Wave invoicing — prefer tenant-specific credentials, fall back to env vars
  const waveConfig = tenant?.wave_api_token
    ? (tenant.wave_business_id && tenant.wave_income_account_id
      ? {
          token: tenant.wave_api_token.replace(/[\r\n]/g, '').trim().replace(/^Bearer\s+/i, ''),
          businessId: tenant.wave_business_id,
          incomeAccountId: tenant.wave_income_account_id,
        }
      : null)
    : getWaveConfig()

  if (!waveConfig) {
    const error = 'No invoicing provider configured. Enable Stripe or Wave in workflow settings.'
    console.error('[Invoice]', error)
    return { success: false, error }
  }

  try {
    const waveResult = await createWaveInvoice(waveConfig, job, customer)
    if (waveResult.success) {
      return { ...waveResult, provider: 'wave' }
    }
    return { ...waveResult, provider: 'wave', success: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Wave error'
    console.error('[Invoice] Wave invoice failed:', message)
    return { success: false, error: message }
  }
}

function getWaveConfig(): WaveConfig | null {
  const tokenRaw =
    process.env.WAVE_API_TOKEN ||
    process.env.WAVE_ACCESS_TOKEN ||
    process.env.WAVE_TOKEN
  const businessId = process.env.WAVE_BUSINESS_ID
  const incomeAccountId = process.env.WAVE_INCOME_ACCOUNT_ID

  if (!tokenRaw || !businessId || !incomeAccountId) {
    return null
  }

  const token = tokenRaw.replace(/[\r\n]/g, '').trim().replace(/^Bearer\s+/i, '')
  if (!token) {
    return null
  }

  return { token, businessId, incomeAccountId }
}

async function waveRequest<T>(
  config: WaveConfig,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const response = await fetch(WAVE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  const payload = await response.json().catch(() => null) as {
    data?: T
    errors?: Array<{ message?: string }>
  } | null

  if (!response.ok) {
    const errorText = payload?.errors?.[0]?.message || response.statusText
    throw new Error(`Wave API error: ${response.status} ${errorText}`)
  }

  if (!payload?.data) {
    const errorText = payload?.errors?.[0]?.message || 'Missing Wave response data'
    throw new Error(`Wave API error: ${errorText}`)
  }

  return payload.data
}

async function createWaveInvoice(
  config: WaveConfig,
  job: Job,
  customer: Customer
): Promise<InvoiceResult> {
  if (!customer.email) {
    return { success: false, error: 'Customer email required for Wave invoice' }
  }

  if (!job.price || job.price <= 0) {
    return { success: false, error: 'Invalid job price' }
  }

  const customerId = await createWaveCustomer(config, job, customer)
  const productId = await createWaveProduct(config, job, customer)
  const invoice = await createWaveInvoiceRecord(config, customerId, productId)

  return {
    success: true,
    invoiceId: invoice.id,
    invoiceUrl: invoice.viewUrl,
  }
}

async function createWaveCustomer(
  config: WaveConfig,
  job: Job,
  customer: Customer
): Promise<string> {
  const fullName = buildCustomerName(customer, job)

  const query = `
    mutation CreateCustomer($input: CustomerCreateInput!) {
      customerCreate(input: $input) {
        didSucceed
        inputErrors { code message path }
        customer { id name }
      }
    }
  `

  const variables = {
    input: {
      businessId: config.businessId,
      name: fullName,
      email: customer.email,
    },
  }

  const data = await waveRequest<{
    customerCreate: {
      didSucceed: boolean
      inputErrors: Array<{ message?: string }>
      customer?: { id: string }
    }
  }>(config, query, variables)

  if (!data.customerCreate.didSucceed || !data.customerCreate.customer?.id) {
    const message = data.customerCreate.inputErrors?.[0]?.message || 'Customer create failed'
    throw new Error(message)
  }

  return data.customerCreate.customer.id
}

async function createWaveProduct(
  config: WaveConfig,
  job: Job,
  customer: Customer
): Promise<string> {
  const description = await buildWaveDescription(job, customer)

  const query = `
    mutation CreateProduct($input: ProductCreateInput!) {
      productCreate(input: $input) {
        didSucceed
        inputErrors { code message path }
        product { id name description unitPrice }
      }
    }
  `

  const variables = {
    input: {
      businessId: config.businessId,
      name: `Cleaning Service - ${buildCustomerFirstNameOnly(customer, job)}`,
      description,
      unitPrice: job.price,
      incomeAccountId: config.incomeAccountId,
    },
  }

  const data = await waveRequest<{
    productCreate: {
      didSucceed: boolean
      inputErrors: Array<{ message?: string }>
      product?: { id: string }
    }
  }>(config, query, variables)

  if (!data.productCreate.didSucceed || !data.productCreate.product?.id) {
    const message = data.productCreate.inputErrors?.[0]?.message || 'Product create failed'
    throw new Error(message)
  }

  return data.productCreate.product.id
}

async function createWaveInvoiceRecord(
  config: WaveConfig,
  customerId: string,
  productId: string
): Promise<{ id: string; viewUrl?: string }> {
  const query = `
    mutation CreateInvoice($input: InvoiceCreateInput!) {
      invoiceCreate(input: $input) {
        didSucceed
        inputErrors { code message path }
        invoice { id viewUrl }
      }
    }
  `

  const variables = {
    input: {
      businessId: config.businessId,
      customerId,
      items: [
        { productId, quantity: 1 },
      ],
    },
  }

  const data = await waveRequest<{
    invoiceCreate: {
      didSucceed: boolean
      inputErrors: Array<{ message?: string }>
      invoice?: { id: string; viewUrl?: string }
    }
  }>(config, query, variables)

  if (!data.invoiceCreate.didSucceed || !data.invoiceCreate.invoice?.id) {
    const message = data.invoiceCreate.inputErrors?.[0]?.message || 'Invoice create failed'
    throw new Error(message)
  }

  return data.invoiceCreate.invoice
}

async function sendWaveInvoiceEmail(
  config: WaveConfig,
  invoiceId: string,
  email: string
): Promise<{ success: boolean; error?: string }> {
  const query = `
    mutation SendInvoice($input: InvoiceSendInput!) {
      invoiceSend(input: $input) {
        didSucceed
        inputErrors { message }
      }
    }
  `

  const variables = {
    input: {
      invoiceId,
      to: [email],
      subject: 'Your Cleaning Invoice',
      message: 'Thanks for choosing us! Your invoice is ready. Please reach out if you have any questions.',
    },
  }

  try {
    const data = await waveRequest<{
      invoiceSend: {
        didSucceed: boolean
        inputErrors?: Array<{ message?: string }>
      }
    }>(config, query, variables)

    if (!data.invoiceSend.didSucceed) {
      const message = data.invoiceSend.inputErrors?.[0]?.message || 'Wave invoice send failed'
      return { success: false, error: message }
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Wave invoice send error' }
  }
}

function buildCustomerName(customer: Customer, job: Job): string {
  const name = `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
  if (name) {
    return name
  }
  if (customer.email) {
    return customer.email
  }
  const config = getClientConfig()
  return job.phone_number || `${config.businessNameShort} Customer`
}

/**
 * Returns only the customer's first name for invoice product names.
 * Last names are often transcribed incorrectly from phone calls.
 */
function buildCustomerFirstNameOnly(customer: Customer, job: Job): string {
  if (customer.first_name) {
    return customer.first_name
  }
  if (customer.email) {
    return customer.email
  }
  const config = getClientConfig()
  return job.phone_number || `${config.businessNameShort} Customer`
}

async function buildWaveDescription(job: Job, customer: Customer): Promise<string> {
  const notes = await buildInvoiceNotes(job, customer)
  const summaryLines = buildInvoiceSummaryLines(job, customer)
  const staticDescription = buildStaticCleaningDescription(job, customer)

  const blocks: string[] = []

  if (notes.length > 0) {
    blocks.push(['Notes:', ...notes.map((note) => `- ${note}`)].join('\n'))
  }

  if (summaryLines.length > 0) {
    blocks.push(summaryLines.join('\n'))
  }

  if (staticDescription) {
    blocks.push(staticDescription)
  }

  blocks.push('Guarantee: If anything is missed, we will return within 24 hours to make it right.')

  return blocks.join('\n\n')
}

function buildInvoiceSummaryLines(job: Job, customer: Customer): string[] {
  const lines: string[] = []
  const serviceLabel = job.service_type || 'Cleaning Service'
  lines.push(`Service: ${serviceLabel}`)

  if (job.date) {
    lines.push(`Date: ${job.date}`)
  }

  if (job.scheduled_at) {
    lines.push(`Time: ${job.scheduled_at}`)
  }

  if (customer.address) {
    lines.push(`Address: ${customer.address}`)
  }

  return lines
}

export function buildStaticCleaningDescription(job: Job, customer: Customer): string {
  const tier = resolveCleaningTier(job.service_type)
  const propertyLine = buildPropertyLine(job, customer)

  if (tier === 'deep') {
    const lines = [
      'Deep Cleaning',
      '',
      '(Comprehensive top-to-bottom cleaning — recommended for first-time clients, move-ready prep, or homes that need extra attention)',
    ]
    if (propertyLine) {
      lines.push(propertyLine, '')
    }
    lines.push(
      '--- All Living Areas, Hallways & Bedrooms ---',
      '',
      'Dust and wipe all surfaces including shelves, mantels, windowsills, and decorative items',
      'Hand-wipe all baseboards, door frames, and crown molding',
      'Dust and clean ceiling fans, light fixtures, and lamp shades',
      'Vacuum all carpeted areas including edges and corners',
      'Mop and sanitize all hard floors (tile, hardwood, laminate, vinyl)',
      'Vacuum under furniture and along baseboards',
      'Vacuum upholstered furniture and cushions',
      'Clean all mirrors and glass surfaces streak-free',
      'Wipe and sanitize all light switches, door handles, and high-touch surfaces',
      'Dust air vents, return registers, and accessible ductwork covers',
      'Empty all trash bins and replace liners',
      'Spot-clean walls, scuff marks, and fingerprints',
      'Spot-clean interior windows and window tracks',
      'Organize and tidy visible surfaces',
      '',
      '--- Kitchen ---',
      '',
      'Clean and sanitize all countertops and backsplash',
      'Clean exterior of all appliances (refrigerator, oven, microwave, dishwasher)',
      'Clean interior of microwave (remove food splatter and grease)',
      'Clean interior of oven (degrease racks and interior walls)',
      'Clean interior of refrigerator (wipe shelves, drawers, and door seals)',
      'Deep clean sink basin, faucet, and handles — polish to shine',
      'Wipe down all cabinet fronts, handles, and hardware',
      'Clean range hood and exhaust fan exterior',
      'Degrease stovetop, burners, and drip pans',
      'Sweep and mop floors including under movable appliances',
      'Clean and sanitize garbage disposal area',
      'Wipe down small appliance exteriors (toaster, coffee maker, etc.)',
      '',
      '--- Bathrooms ---',
      '',
      'Scrub and sanitize toilet inside and out (bowl, base, seat, lid, tank exterior)',
      'Deep clean shower/tub — remove soap scum, hard water stains, and mildew',
      'Scrub tile grout lines and caulking',
      'Clean and polish all fixtures, faucets, and shower heads',
      'Clean and sanitize sink basin and vanity countertop',
      'Clean all mirrors and glass streak-free',
      'Wipe down cabinet fronts, handles, and shelving',
      'Clean and sanitize towel bars, toilet paper holders, and hooks',
      'Hand-wipe all baseboards, doors, and door frames',
      'Clean exhaust fan cover and light fixtures',
      'Sweep and mop floors including behind toilet and in corners',
      'Empty trash and replace liners',
      '',
      '--- Laundry Area (if accessible) ---',
      '',
      'Wipe down exterior of washer and dryer',
      'Clean lint trap area and surrounding surfaces',
      'Sweep and mop laundry room floor',
    )
    return lines.join('\n')
  }

  if (tier === 'move') {
    const lines = [
      'Move-In / Move-Out Cleaning',
      '',
      '(Complete vacancy cleaning to prepare the property for new occupants or final inspection)',
    ]
    if (propertyLine) {
      lines.push(propertyLine, '')
    }
    lines.push(
      '--- All Rooms, Hallways & Closets ---',
      '',
      'Dust and wipe all surfaces including shelves, windowsills, and ledges',
      'Hand-wipe all baseboards, door frames, crown molding, and trim',
      'Dust and clean ceiling fans, light fixtures, and recessed lighting',
      'Vacuum all carpeted areas including edges, corners, and closets',
      'Mop and sanitize all hard floors (tile, hardwood, laminate, vinyl)',
      'Clean all mirrors and glass surfaces streak-free',
      'Wipe and sanitize all light switches, outlet covers, and door handles',
      'Dust air vents, return registers, and ductwork covers',
      'Clean interior of all closets — wipe shelves, rods, and baseboards',
      'Spot-clean walls, scuff marks, and fingerprints throughout',
      'Clean interior windows, window tracks, and window ledges',
      'Dust and clean blinds and window treatments',
      'Remove all trash and debris left behind',
      '',
      '--- Kitchen ---',
      '',
      'Clean and sanitize all countertops and backsplash',
      'Clean exterior and interior of all major appliances:',
      '  - Refrigerator (shelves, drawers, door seals, exterior)',
      '  - Oven/range (interior walls, racks, stovetop, burners, drip pans)',
      '  - Microwave (interior and exterior)',
      '  - Dishwasher (interior racks, door, and gasket)',
      'Deep clean sink basin, faucet, and garbage disposal area',
      'Wipe down all cabinet fronts, interiors, handles, and hardware',
      'Clean inside all drawers and shelving',
      'Clean range hood, exhaust fan, and filter',
      'Sweep and mop floors including under and behind appliances',
      '',
      '--- Bathrooms ---',
      '',
      'Scrub and sanitize toilet inside and out (bowl, base, seat, lid, tank)',
      'Deep clean shower/tub — remove soap scum, hard water stains, and mildew',
      'Scrub tile grout lines and recaulk areas if needed',
      'Clean and polish all fixtures, faucets, and shower heads',
      'Clean and sanitize sink basin, vanity, and countertop',
      'Clean all mirrors and glass streak-free',
      'Wipe down all cabinets inside and out, handles, and shelving',
      'Clean and sanitize towel bars, hooks, and toilet paper holders',
      'Hand-wipe baseboards, doors, door frames, and trim',
      'Clean exhaust fan cover and light fixtures',
      'Sweep and mop floors including behind toilet and in all corners',
      '',
      '--- Laundry Area ---',
      '',
      'Wipe down exterior of washer and dryer',
      'Clean lint trap area and surrounding surfaces',
      'Wipe down shelving and cabinets',
      'Sweep and mop floor',
      '',
      '--- Final Walkthrough ---',
      '',
      'Full property walk-through to ensure every room meets move-out standards',
    )
    return lines.join('\n')
  }

  // Standard cleaning
  const lines = [
    'Standard Cleaning',
    '',
    '(Professional maintenance cleaning to keep your home fresh and comfortable)',
  ]
  if (propertyLine) {
    lines.push(propertyLine, '')
  }
  lines.push(
    '--- All Living Areas, Hallways & Bedrooms ---',
    '',
    'Dust and wipe all accessible surfaces including shelves, mantels, and windowsills',
    'Dust ceiling fans and light fixtures (within safe reach)',
    'Vacuum all carpeted areas including edges and corners',
    'Mop and sanitize all hard floors (tile, hardwood, laminate, vinyl)',
    'Clean all mirrors and glass surfaces streak-free',
    'Wipe and sanitize light switches, door handles, and high-touch surfaces',
    'Dust air vents and return registers',
    'Empty all trash bins and replace liners',
    'Make beds and straighten pillows (linens must be on the bed)',
    'General tidying of visible surfaces',
    '',
    '--- Kitchen ---',
    '',
    'Clean and sanitize all countertops and backsplash',
    'Clean exterior of all appliances (refrigerator, oven, microwave, dishwasher)',
    'Clean and degrease stovetop, burners, and drip pans',
    'Deep clean sink basin, faucet, and handles — polish to shine',
    'Wipe down all cabinet fronts and handles',
    'Clean range hood exterior',
    'Wipe down small appliance exteriors (toaster, coffee maker, etc.)',
    'Sweep and mop floors',
    'Empty trash and replace liner',
    '',
    '--- Bathrooms ---',
    '',
    'Scrub and sanitize toilet inside and out (bowl, base, seat, lid, tank exterior)',
    'Clean shower/tub — remove soap scum and surface buildup',
    'Clean and polish all fixtures, faucets, and shower heads',
    'Clean and sanitize sink basin and vanity countertop',
    'Clean all mirrors and glass streak-free',
    'Wipe down cabinet fronts and handles',
    'Clean and sanitize towel bars, toilet paper holders, and hooks',
    'Wipe baseboards around toilet and tub',
    'Sweep and mop floors',
    'Empty trash and replace liner',
    '',
    '--- Additional Details ---',
    '',
    'All cleaning products and equipment provided by our team',
    'Pet-friendly and eco-conscious products available upon request',
    'Please secure valuables and clear clutter from surfaces for best results',
  )
  return lines.join('\n')
}

export function buildPropertyLine(job: Job, customer: Customer): string | null {
  const bedrooms = resolveNumber(customer.bedrooms, job.bedrooms)
  const bathrooms = resolveNumber(customer.bathrooms, job.bathrooms)
  const squareFootage = resolveNumber(customer.square_footage, job.square_footage)
  const parts: string[] = []

  if (bedrooms !== null) {
    parts.push(`${bedrooms} bed`)
  }
  if (bathrooms !== null) {
    parts.push(`${bathrooms} bath`)
  }
  if (squareFootage !== null) {
    parts.push(`${squareFootage} sq ft`)
  }

  return parts.length > 0 ? `Property details: ${parts.join(', ')}` : null
}

function resolveCleaningTier(serviceType?: string | null): 'standard' | 'deep' | 'move' {
  const normalized = (serviceType || '').toLowerCase()
  if (normalized.includes('deep')) return 'deep'
  if (normalized.includes('move')) return 'move'
  return 'standard'
}

function resolveNumber(primary?: number | null, fallback?: number | null): number | null {
  if (typeof primary === 'number' && Number.isFinite(primary)) {
    return primary
  }
  if (typeof fallback === 'number' && Number.isFinite(fallback)) {
    return fallback
  }
  return null
}

async function buildInvoiceNotes(job: Job, customer: Customer): Promise<string[]> {
  const fallback = buildFallbackNotes(job, customer)
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return fallback
  }

  const model = process.env.OPENAI_INVOICE_NOTES_MODEL || 'gpt-4o-mini'
  const client = new OpenAI({ apiKey })
  const context = buildInvoiceNoteContext(job, customer)

  try {
    const response = await client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: [
            'You write friendly, upbeat notes TO the customer for their cleaning invoice.',
            'These notes appear on the invoice the customer sees.',
            'Return only JSON: {"notes": ["note 1", "note 2"]}.',
            'Rules:',
            '- Output 0 to 3 short notes (max 120 characters each).',
            '- Write in natural, human-sounding sentences directly addressing the customer.',
            '- Be warm, congratulatory, and excited to serve them.',
            '- Example: "Congratulations on the pregnancy! We\'ll take extra good care of you."',
            '- Example: "We can\'t wait to clean your beautiful 2-bed home!"',
            '- Use only details from the provided context.',
            '- Focus on special occasions, life events, or unique requests.',
            '- Do not repeat service type, date, time, address, or bed/bath counts.',
            '- Never include internal metrics like HOURS, PAY, cleaner pay, or payment tags.',
            '- Never include instructions for cleaners - only friendly messages to the customer.',
            '- If nothing useful exists, return {"notes": []}.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: context,
        },
      ],
    })

    const jsonText = response.choices[0]?.message?.content || '{}'
    const candidate = extractJsonObject(jsonText)
    const parsed = safeJsonParse<{ notes?: unknown }>(candidate)
    const rawNotes = parsed.value?.notes
    const normalized = normalizeNotes(rawNotes)
    return normalized.length > 0 ? normalized : fallback
  } catch (error) {
    console.error('Invoice notes LLM error:', error)
    return fallback
  }
}

function buildInvoiceNoteContext(job: Job, customer: Customer): string {
  const transcript = trimContext(sanitizeInvoiceNoteText(customer.texting_transcript || ''))
  const notes = trimContext(sanitizeInvoiceNoteText(job.notes || ''))

  return [
    'Context for invoice notes:',
    `Service type: ${job.service_type || 'Unknown'}`,
    `Bedrooms: ${customer.bedrooms ?? job.bedrooms ?? 'Unknown'}`,
    `Bathrooms: ${customer.bathrooms ?? job.bathrooms ?? 'Unknown'}`,
    `Square footage: ${customer.square_footage ?? job.square_footage ?? 'Unknown'}`,
    '',
    `Customer notes: ${notes || 'None'}`,
    '',
    `Recent texts: ${transcript || 'None'}`,
  ].join('\n')
}

function trimContext(value: string, maxChars = 1200): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (trimmed.length <= maxChars) {
    return trimmed
  }
  return trimmed.slice(trimmed.length - maxChars)
}

function sanitizeInvoiceNoteText(value: string): string {
  if (!value) return ''
  const lines = value.split('\n')
  const cleanedLines = lines
    .map((line) => {
      let cleaned = line
      cleaned = cleaned.replace(/\bINVOICE_URL:\s*\S+/gi, '')
      cleaned = cleaned.replace(/\b(?:HOURS|PAY|PAYMENT):\s*[a-z_]+=[^\s]+/gi, '')
      cleaned = cleaned.replace(/\b(?:HOURS|PAY|PAYMENT):\s*/gi, '')
      cleaned = cleaned.replace(/\s+/g, ' ').trim()
      cleaned = cleaned.replace(/\s+([,.])/g, '$1')
      return cleaned
    })
    .filter(Boolean)

  return cleanedLines.join('\n')
}

function normalizeNotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const cleaned = raw
    .map((note) => (typeof note === 'string' ? sanitizeInvoiceNoteText(note) : ''))
    .map((note) => note.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((note) => note.replace(/\s+/g, ' ').slice(0, 120))

  return cleaned.slice(0, 3)
}

function buildFallbackNotes(job: Job, customer: Customer): string[] {
  const notes: string[] = []
  const rawNotes = sanitizeInvoiceNoteText(job.notes || '').trim()
  if (rawNotes) {
    notes.push(rawNotes.replace(/\s+/g, ' ').slice(0, 120))
  }

  const transcript = sanitizeInvoiceNoteText(customer.texting_transcript || '').trim()
  if (notes.length === 0 && transcript) {
    notes.push(transcript.replace(/\s+/g, ' ').slice(0, 120))
  }

  return notes.slice(0, 2)
}
