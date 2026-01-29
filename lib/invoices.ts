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

export async function createInvoice(job: Job, customer: Customer): Promise<InvoiceResult> {
  const waveConfig = getWaveConfig()

  if (!waveConfig) {
    const error = 'Wave invoice is not configured. Set WAVE_API_TOKEN, WAVE_BUSINESS_ID, and WAVE_INCOME_ACCOUNT_ID.'
    console.error(error)
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
    console.error('Wave invoice failed:', message)
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

function buildStaticCleaningDescription(job: Job, customer: Customer): string {
  const tier = resolveCleaningTier(job.service_type)
  const propertyLine = buildPropertyLine(job, customer)

  if (tier === 'deep') {
    const lines = [
      'Deep Cleaning',
      '',
      '(Detailed top-to-bottom cleaning for neglected or first-time jobs)',
    ]
    if (propertyLine) {
      lines.push(propertyLine, '')
    }
    lines.push(
      'General Areas & Bedrooms',
      '',
      'Dust all surfaces, baseboards, shelves, and light fixtures',
      'Vacuum and mop floors',
      'Empty trash bins and replace liners',
      'Clean mirrors and glass surfaces',
      'Wipe light switches, door handles, and high-touch areas',
      '',
      'Kitchen',
      '',
      'Wipe countertops and backsplash',
      'Clean exterior of appliances (fridge, oven, microwave, dishwasher)',
      'Clean sink and polish faucet',
      'Wipe cabinet exteriors and handles',
      'Sweep and mop floors',
      '',
      'Bathrooms',
      '',
      'Scrub and sanitize toilet, sink, and shower/tub',
      'Wipe mirrors and glass',
      'Clean countertops and fixtures',
      'Mop floors and empty trash',
      'Hand-wipe all baseboards, doors, and door frames',
      'Clean vents, switch plates, and ceiling fans',
      'Remove grime from walls, corners, and light fixtures',
      'Scrub tile grout and soap scum buildup',
      'Clean interior of microwave, oven, and refrigerator',
      'Vacuum under furniture and cushions',
      'Spot-clean interior windows and window tracks'
    )
    return lines.join('\n')
  }

  if (tier === 'move') {
    const lines = [
      'Move-In / Move-Out Cleaning',
      '',
      '(Full vacancy cleaning to prepare property for new tenants or sale)',
    ]
    if (propertyLine) {
      lines.push(propertyLine, '')
    }
    lines.push(
      'General Areas & Bedrooms',
      '',
      'Dust all surfaces, baseboards, shelves, and light fixtures',
      'Vacuum and mop floors',
      'Empty trash bins and replace liners',
      'Clean mirrors and glass surfaces',
      'Wipe light switches, door handles, and high-touch areas',
      '',
      'Kitchen',
      '',
      'Wipe countertops and backsplash',
      'Clean exterior of appliances (fridge, oven, microwave, dishwasher)',
      'Clean sink and polish faucet',
      'Wipe cabinet exteriors and handles',
      'Sweep and mop floors',
      '',
      'Bathrooms',
      '',
      'Scrub and sanitize toilet, sink, and shower/tub',
      'Wipe mirrors and glass',
      'Clean countertops and fixtures',
      'Mop floors and empty trash',
      'Clean inside all cabinets, drawers, and closets',
      'Clean inside oven, refrigerator, and dishwasher',
      'Wipe down all doors, trim, and interior windows thoroughly',
      'Dust and clean blinds',
      'Remove all trash and debris left behind',
      'Final walk-through for property readiness'
    )
    return lines.join('\n')
  }

  const lines = [
    'Standard Cleaning',
    '',
    '(Maintenance-level service for homes or offices)',
  ]
  if (propertyLine) {
    lines.push(propertyLine, '')
  }
  lines.push(
    'General Areas & Bedrooms',
    '',
    'Dust all surfaces, shelves, and light fixtures',
    'Vacuum and mop floors',
    'Empty trash bins and replace liners',
    'Clean mirrors and glass surfaces',
    'Wipe light switches, door handles, and high-touch areas',
    '',
    'Kitchen',
    '',
    'Wipe countertops and backsplash',
    'Clean exterior of appliances (fridge, oven, microwave, dishwasher)',
    'Clean sink and polish faucet',
    'Wipe cabinet exteriors and handles',
    'Sweep and mop floors',
    '',
    'Bathrooms',
    '',
    'Scrub and sanitize toilet, sink, and shower/tub',
    'Wipe mirrors and glass',
    'Clean countertops and fixtures',
    'Mop floors and empty trash'
  )
  return lines.join('\n')
}

function buildPropertyLine(job: Job, customer: Customer): string | null {
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
