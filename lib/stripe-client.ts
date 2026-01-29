/**
 * Stripe Integration - Invoice creation and payment handling
 */

import Stripe from 'stripe'
import { Job, Customer } from './supabase'
import { toE164 } from './phone-utils'
import { getClientConfig } from './client-config'
import {
  PRICING_TABLE,
  type PricingRow,
  type PricingTier,
  type AddOnKey,
  getAddOnDefinition,
  getAddOnLabel,
  getAddOnsFromNotes,
  getOverridesFromNotes,
} from './pricing-config'

// Initialize Stripe client
function getStripeClient(): Stripe {
  const rawKey = process.env.STRIPE_SECRET_KEY
  const secretKey = rawKey ? rawKey.replace(/[\r\n]/g, '').trim() : ''

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY not configured')
  }

  return new Stripe(secretKey, {
    apiVersion: '2025-02-24.acacia',
  })
}

function getClientDomain(): string {
  const domain = getClientConfig().domain
  return domain.endsWith('/') ? domain.slice(0, -1) : domain
}

type StripePaymentType = 'DEPOSIT' | 'ADDON' | 'FINAL'

function resolveStripeTestChargeCents(): number | null {
  if (process.env.ENABLE_STRIPE_TEST_CHARGES !== 'true') {
    return null
  }

  const raw = process.env.STRIPE_TEST_CHARGE_CENTS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn('ENABLE_STRIPE_TEST_CHARGES is true but STRIPE_TEST_CHARGE_CENTS is invalid; using default.')
    return null
  }

  return Math.round(parsed)
}

export function resolveStripeChargeCents(
  defaultCents: number,
  paymentType: StripePaymentType
): { amountCents: number; testChargeCents?: number } {
  const testChargeCents = resolveStripeTestChargeCents()
  if (!testChargeCents) {
    return { amountCents: defaultCents }
  }

  console.warn(`[Stripe] Test charge override active (${paymentType}): ${testChargeCents} cents`)
  return { amountCents: testChargeCents, testChargeCents }
}

/**
 * Create a Stripe customer
 */
export async function createStripeCustomer(
  customer: Partial<Customer>
): Promise<Stripe.Customer> {
  try {
    const stripe = getStripeClient()

    const normalizedPhone = toE164(customer.phone_number)
    const stripeCustomer = await stripe.customers.create({
      email: customer.email,
      phone: normalizedPhone || undefined,
      name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || undefined,
      address: customer.address
        ? {
            line1: customer.address,
            country: 'US',
          }
        : undefined,
      metadata: {
        supabase_customer_id: customer.id || '',
        phone_number: customer.phone_number || '',
      },
    })

    console.log(`Created Stripe customer: ${stripeCustomer.id}`)
    return stripeCustomer
  } catch (error) {
    console.error('Error creating Stripe customer:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Stripe customer create failed: ${message}`)
  }
}

/**
 * Find or create a Stripe customer by email
 */
export async function findOrCreateStripeCustomer(
  customer: Partial<Customer>
): Promise<Stripe.Customer> {
  if (!customer.email) {
    throw new Error('Cannot create Stripe customer without email')
  }

  try {
    const stripe = getStripeClient()

    // Search for existing customer by email
    const existingCustomers = await stripe.customers.list({
      email: customer.email,
      limit: 1,
    })

    if (existingCustomers.data.length > 0) {
      console.log(`Found existing Stripe customer: ${existingCustomers.data[0].id}`)
      return existingCustomers.data[0]
    }

    // Create new customer
    return await createStripeCustomer(customer)
  } catch (error) {
    console.error('Error finding/creating Stripe customer:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Stripe customer lookup failed: ${message}`)
  }
}

/**
 * Create and send an invoice for a job
 */
export async function createAndSendInvoice(
  job: Job,
  customer: Customer
): Promise<{ success: boolean; invoiceId?: string; error?: string }> {
  if (!customer.email) {
    return { success: false, error: 'Customer email required for invoice' }
  }

  if (!job.price || job.price <= 0) {
    return { success: false, error: 'Invalid job price' }
  }

  try {
    const stripe = getStripeClient()
    const domain = getClientDomain()

    // Find or create Stripe customer
    const stripeCustomer = await findOrCreateStripeCustomer(customer)

    // Create invoice
    const invoice = await stripe.invoices.create({
      customer: stripeCustomer.id,
      collection_method: 'send_invoice',
      days_until_due: 7,
      metadata: {
        job_id: job.id || '',
        phone_number: job.phone_number,
        service_type: job.service_type || '',
      },
    })

    // Add line item for the cleaning service
    const description = buildInvoiceDescription(job)
    await stripe.invoiceItems.create({
      customer: stripeCustomer.id,
      invoice: invoice.id,
      amount: Math.round(job.price * 100), // Convert to cents
      currency: 'usd',
      description,
    })

    // Finalize and send the invoice
    const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id)
    await stripe.invoices.sendInvoice(finalizedInvoice.id)

    console.log(`Invoice ${finalizedInvoice.id} sent to ${customer.email}`)

    return {
      success: true,
      invoiceId: finalizedInvoice.id,
    }
  } catch (error) {
    console.error('Error creating invoice:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Build invoice description from job details
 */
function buildInvoiceDescription(job: Job): string {
  const parts = [job.service_type || 'Cleaning Service']

  if (job.date) {
    const dateObj = new Date(job.date)
    const formattedDate = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    parts.push(`on ${formattedDate}`)
  }

  if (job.scheduled_at) {
    parts.push(`at ${job.scheduled_at}`)
  }

  return parts.join(' ')
}

/**
 * Validate Stripe webhook signature
 */
export function validateStripeWebhook(
  payload: string,
  signature: string | null
): Stripe.Event | null {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.warn('STRIPE_WEBHOOK_SECRET not configured - parsing without validation')
    try {
      return JSON.parse(payload) as Stripe.Event
    } catch {
      return null
    }
  }

  if (!signature) {
    console.error('No Stripe signature provided')
    return null
  }

  try {
    const stripe = getStripeClient()
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret)
  } catch (error) {
    console.error('Stripe webhook validation failed:', error)
    return null
  }
}

/**
 * Get invoice details from Stripe
 */
export async function getInvoice(invoiceId: string): Promise<Stripe.Invoice | null> {
  try {
    const stripe = getStripeClient()
    return await stripe.invoices.retrieve(invoiceId)
  } catch (error) {
    console.error('Error fetching invoice:', error)
    return null
  }
}

/**
 * Create a setup intent checkout session for card on file
 * Sent after deposit payment succeeds
 */
export async function createCardOnFileLink(
  customer: Customer,
  jobId: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  if (!customer.email) {
    return { success: false, error: 'Customer email required' }
  }

  try {
    const stripe = getStripeClient()
    const domain = getClientDomain()

    // Find or create Stripe customer
    const stripeCustomer = await findOrCreateStripeCustomer(customer)

    // Create checkout session in setup mode (card on file)
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomer.id,
      mode: 'setup',
      payment_method_types: ['card'],
      success_url: domain,
      cancel_url: domain,
      metadata: {
        job_id: jobId,
        phone_number: customer.phone_number,
        purpose: 'card_on_file',
      },
    })

    console.log(`Created card-on-file session: ${session.id}`)

    return {
      success: true,
      url: session.url || undefined,
    }
  } catch (error) {
    console.error('Error creating card-on-file session:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Create a deposit payment link (50% + 3% fee)
 * Per PRD: Deposit amount = (price * 1.03) / 2
 */
export async function createDepositPaymentLink(
  customer: Customer,
  job: Job
): Promise<{ success: boolean; url?: string; amount?: number; error?: string }> {
  if (!customer.email) {
    return { success: false, error: 'Customer email required' }
  }

  if (!job.price || job.price <= 0) {
    return { success: false, error: 'Invalid job price' }
  }

  try {
    const stripe = getStripeClient()
    const domain = getClientDomain()

    // Find or create Stripe customer
    const stripeCustomer = await findOrCreateStripeCustomer(customer)

    // Calculate deposit: 50% + 3% fee
    const defaultDepositAmount = Math.round((job.price / 2) * 1.03 * 100) // In cents
    const { amountCents: depositAmountCents, testChargeCents } = resolveStripeChargeCents(
      defaultDepositAmount,
      'DEPOSIT'
    )
    const depositAmount = depositAmountCents / 100

    // Create checkout session for deposit
    const metadata: Record<string, string> = {
      job_id: job.id || '',
      phone_number: job.phone_number,
      payment_type: 'DEPOSIT',
    }
    if (testChargeCents) {
      metadata.test_charge_cents = String(testChargeCents)
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomer.id,
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${job.service_type || 'Cleaning'} - DEPOSIT`,
              description: `50% deposit for ${job.service_type || 'cleaning'} service`,
            },
            unit_amount: depositAmountCents,
          },
          quantity: 1,
        },
      ],
      success_url: domain,
      cancel_url: domain,
      metadata,
    })

    console.log(`Created deposit session: ${session.id} for $${depositAmount.toFixed(2)}`)

    return {
      success: true,
      url: session.url || undefined,
      amount: depositAmount,
    }
  } catch (error) {
    console.error('Error creating deposit session:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Create an add-on payment link for after-the-fact upgrades
 */
export async function createAddOnPaymentLink(
  customer: Customer,
  job: Job,
  addOnAmount: number,
  addOns: AddOnKey[]
): Promise<{ success: boolean; url?: string; amount?: number; error?: string }> {
  if (!customer.email) {
    return { success: false, error: 'Customer email required' }
  }

  if (!addOnAmount || addOnAmount <= 0) {
    return { success: false, error: 'Invalid add-on amount' }
  }

  try {
    const stripe = getStripeClient()
    const domain = getClientDomain()
    const stripeCustomer = await findOrCreateStripeCustomer(customer)

    const defaultAmountWithFee = Math.round(addOnAmount * 1.03 * 100)
    const { amountCents: addOnAmountCents, testChargeCents } = resolveStripeChargeCents(
      defaultAmountWithFee,
      'ADDON'
    )
    const amountWithFee = addOnAmountCents / 100
    const label = addOns.length > 0
      ? addOns.map(addOn => getAddOnLabel(addOn)).join(', ')
      : 'Add-ons'

    const metadata: Record<string, string> = {
      job_id: job.id || '',
      phone_number: job.phone_number,
      payment_type: 'ADDON',
      add_on_amount: addOnAmount.toFixed(2),
      add_on_keys: addOns.join(','),
    }
    if (testChargeCents) {
      metadata.test_charge_cents = String(testChargeCents)
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomer.id,
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${job.service_type || 'Cleaning'} - Add-ons`,
              description: label,
            },
            unit_amount: addOnAmountCents,
          },
          quantity: 1,
        },
      ],
      success_url: domain,
      cancel_url: domain,
      metadata,
    })

    console.log(`Created add-on session: ${session.id} for $${amountWithFee.toFixed(2)}`)

    return {
      success: true,
      url: session.url || undefined,
      amount: amountWithFee,
    }
  } catch (error) {
    console.error('Error creating add-on session:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export type JobPricingEstimate = {
  basePrice: number
  addOnPrice: number
  totalPrice: number
  pricingAdjustmentPct: number
  pricingAdjustmentAmount: number
  baseHours: number
  addOnHours: number
  totalHours: number
  cleaners: number
  hoursPerCleaner: number
  cleanerPay: number
  addOns: AddOnKey[]
}

/**
 * Calculate price based on job details
 * Uses the Spotless pricing sheet for Standard/Deep cleanings,
 * with window adders applied afterward.
 */
export function calculateJobPrice(
  job: Partial<Job>,
  customer?: { bedrooms?: number; bathrooms?: number; square_footage?: number }
): number {
  return calculateJobEstimate(job, customer).totalPrice
}

export function calculateJobEstimate(
  job: Partial<Job>,
  customer?: { bedrooms?: number; bathrooms?: number; square_footage?: number }
): JobPricingEstimate {
  const basePrices: Record<string, number> = {
    'Standard cleaning': 150,
    'Deep cleaning': 250,
    'Move in/out': 300,
    'Move-in/out': 300,
    'Move in': 300,
    'Move out': 300,
  }

  const serviceTier = normalizeServiceTier(job.service_type)
  const pricingTier = serviceTier === 'move' ? 'deep' : serviceTier

  const overrides = getOverridesFromNotes(job.notes)
  const bedrooms = normalizeCount(
    overrides.bedrooms ??
      customer?.bedrooms ??
      (job as Record<string, unknown>).bedrooms
  )
  const bathrooms = normalizeBathroomCount(
    overrides.bathrooms ??
      customer?.bathrooms ??
      (job as Record<string, unknown>).bathrooms
  )
  const squareFootage = normalizeCount(
    overrides.squareFootage ??
      customer?.square_footage ??
      (job as Record<string, unknown>).square_footage ??
      (job as Record<string, unknown>).squareFootage
  )

  const baseRow = pricingTier && bedrooms && bathrooms
    ? getPricingRow(pricingTier, bedrooms, bathrooms, squareFootage)
    : null

  const fallbackBase = basePrices[job.service_type || 'Standard cleaning'] ?? 150
  const basePrice = baseRow?.price ?? fallbackBase
  const baseHours = baseRow?.labor_hours ?? 0
  const cleaners = baseRow?.cleaners ?? 1
  const baseHoursPerCleaner = baseRow?.hours_per_cleaner ?? (cleaners ? baseHours / cleaners : baseHours)

  const clientRate = baseHours > 0 ? basePrice / baseHours : 0
  const addOns = getAddOnsFromNotes(job.notes)

  let addOnHours = 0
  let addOnPrice = 0

  for (const addOnKey of addOns) {
    const def = getAddOnDefinition(addOnKey)
    if (!def) continue
    if (serviceTier && def.included_in?.includes(serviceTier)) {
      continue
    }

    const hours = def.minutes / 60
    addOnHours += hours

    if (typeof def.flat_price === 'number') {
      addOnPrice += def.flat_price
    } else {
      const multiplier = def.price_multiplier ?? 1
      addOnPrice += clientRate * hours * multiplier
    }
  }

  const totalHours = baseHours + addOnHours
  const hoursPerCleaner = cleaners ? totalHours / cleaners : totalHours
  const config = getClientConfig()
  const pricingAdjustmentPct = resolvePricingAdjustmentPct(job, config)
  const pricingAdjustmentAmount = roundCurrency((basePrice + addOnPrice) * (pricingAdjustmentPct / 100))
  const totalPrice = roundCurrency(basePrice + addOnPrice + pricingAdjustmentAmount)

  return {
    basePrice: roundCurrency(basePrice),
    addOnPrice: roundCurrency(addOnPrice),
    totalPrice,
    pricingAdjustmentPct,
    pricingAdjustmentAmount,
    baseHours: roundHours(baseHours),
    addOnHours: roundHours(addOnHours),
    totalHours: roundHours(totalHours),
    cleaners,
    hoursPerCleaner: roundHours(hoursPerCleaner || baseHoursPerCleaner),
    cleanerPay: roundCurrency(totalHours * config.cleanerHourlyRate),
    addOns,
  }
}

function normalizeServiceTier(serviceType?: string | null): PricingTier {
  if (!serviceType) return 'standard'
  const lower = serviceType.toLowerCase()
  if (lower.includes('deep')) return 'deep'
  if (lower.includes('standard')) return 'standard'
  if (lower.includes('move')) return 'move'
  return 'standard'
}

function normalizeCount(value: unknown): number | null {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.round(num)
}

function normalizeBathroomCount(value: unknown): number | null {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.round(num * 2) / 2
}

function getPricingRow(
  tier: 'standard' | 'deep',
  bedrooms: number,
  bathrooms: number,
  squareFootage: number | null
): PricingRow | null {
  const rows = PRICING_TABLE[tier].filter(
    row => row.bedrooms === bedrooms && row.bathrooms === bathrooms
  )

  if (!rows.length) return null

  const sorted = [...rows].sort((a, b) => a.max_sq_ft - b.max_sq_ft)
  if (squareFootage && squareFootage > 0) {
    return sorted.find(row => row.max_sq_ft >= squareFootage) || sorted[sorted.length - 1]
  }

  return sorted[sorted.length - 1]
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100
}

function resolvePricingAdjustmentPct(job: Partial<Job>, config: ReturnType<typeof getClientConfig>): number {
  if (!config.features.dynamicPricing) {
    return 0
  }

  const raw = typeof job.pricing_adjustment_pct === 'number'
    ? job.pricing_adjustment_pct
    : Number(job.pricing_adjustment_pct)

  if (!Number.isFinite(raw)) {
    return 0
  }

  const maxDiscount = Number(process.env.DYNAMIC_PRICING_MAX_DISCOUNT_PCT || '10')
  const maxMarkup = Number(process.env.DYNAMIC_PRICING_MAX_MARKUP_PCT || '8')
  const min = Number.isFinite(maxDiscount) ? -Math.abs(maxDiscount) : -10
  const max = Number.isFinite(maxMarkup) ? Math.abs(maxMarkup) : 8

  return Math.min(Math.max(raw, min), max)
}

/**
 * Calculate deposit amount (50% + 3% processing fee)
 */
export function calculateDeposit(totalPrice: number): number {
  const halfPrice = totalPrice / 2
  const withFee = halfPrice * 1.03
  return Math.round(withFee * 100) / 100 // Round to cents
}

/**
 * Calculate final payment amount (remaining 50% + 3% processing fee)
 */
export function calculateFinalPayment(totalPrice: number): number {
  const halfPrice = totalPrice / 2
  const withFee = halfPrice * 1.03
  return Math.round(withFee * 100) / 100 // Round to cents
}
