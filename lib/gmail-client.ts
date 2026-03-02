import nodemailer from 'nodemailer'
import type { Job, Customer } from './supabase'

/** Format E.164 phone like (319) 261-9670 */
function formatPhoneForDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (national.length === 10) {
    return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
  }
  return phone
}

/**
 * Resolve Gmail credentials: tenant-specific first, then env var fallback.
 * Tenant object needs gmail_user + gmail_app_password columns.
 */
function getGmailCreds(tenant?: { gmail_user?: string | null; gmail_app_password?: string | null }) {
  // Tenant-specific creds take priority
  if (tenant?.gmail_user && tenant?.gmail_app_password) {
    return { user: tenant.gmail_user, pass: tenant.gmail_app_password }
  }
  // Fallback to global env vars
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (user && pass) return { user, pass }
  return null
}

function createTransporter(creds: { user: string; pass: string }) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: creds.user, pass: creds.pass },
  })
}

interface ConfirmationEmailParams {
  customer: Customer
  job: Job
  waveInvoiceUrl?: string
  stripeDepositUrl: string
  cleanerName?: string
  tenant?: { gmail_user?: string | null; gmail_app_password?: string | null; business_name_short?: string | null; name?: string | null; openphone_phone_number?: string | null; owner_phone?: string | null }
}

export async function sendConfirmationEmail(params: ConfirmationEmailParams): Promise<{
  success: boolean
  error?: string
}> {
  const creds = getGmailCreds(params.tenant)
  if (!creds) {
    console.error('Gmail credentials not configured')
    return { success: false, error: 'Gmail credentials not configured' }
  }

  const transporter = createTransporter(creds)
  const { customer, job, waveInvoiceUrl, stripeDepositUrl, cleanerName } = params

  if (!customer.email) {
    return { success: false, error: 'Customer email is required' }
  }

  // Format date with day of week
  const jobDate = job.date ? new Date(job.date + 'T12:00:00') : null
  const dateStr = jobDate
    ? jobDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      })
    : 'TBD'

  const timeStr = job.scheduled_at || 'TBD'

  // Build service description for the email
  let serviceDescriptionHtml = ''
  try {
    const { buildStaticCleaningDescription, buildPropertyLine } = await import('./invoices')
    const desc = buildStaticCleaningDescription(job, customer)
    if (desc) {
      serviceDescriptionHtml = `<h3>What's Included:</h3><pre style="font-family: inherit; white-space: pre-wrap;">${desc}</pre>`
    }
  } catch {
    // invoices module not available, skip
  }

  // Conditionally build invoice/payment section
  const paymentSection = waveInvoiceUrl
    ? `<p>To secure your booking, we've attached your invoice below. Please pay the 50% deposit to lock in your date. You can use the link sent below for debit/credit card payments.</p>
       <p><strong>Invoice Link:</strong> <a href="${waveInvoiceUrl}">${waveInvoiceUrl}</a></p>
       <p><strong>Credit/Debit Payment Info:</strong><br>
       Stripe Link: <a href="${stripeDepositUrl}">${stripeDepositUrl}</a></p>`
    : `<p>To secure your booking, please pay the 50% deposit to lock in your date:</p>
       <p><strong>Pay Deposit:</strong> <a href="${stripeDepositUrl}">${stripeDepositUrl}</a></p>`

  const businessName = params.tenant?.name || params.tenant?.business_name_short || 'Our Team'
  // Use the customer-facing phone number (OpenPhone) for email signature, fall back to owner phone
  const contactPhone = params.tenant?.openphone_phone_number || params.tenant?.owner_phone || null
  const formattedPhone = contactPhone ? formatPhoneForDisplay(contactPhone) : null
  const signatureLine = formattedPhone ? `${businessName}: ${formattedPhone}` : businessName

  // Build email HTML
  const htmlBody = `
    <p>Congrats ${customer.first_name || 'there'}, we can confirm for ${dateStr} at ${timeStr}</p>

    <p>We're excited to get started and make your space feel refreshed and spotless. Your ${job.service_type || 'Cleaning'} is scheduled for ${job.address || customer.address || '[Address]'}. Our professional ${cleanerName ? `cleaner, ${cleanerName}` : 'team'}, will be arriving ready to work. Please allow an arrival window of 1 hour to account for any unforeseen circumstances.</p>

    ${serviceDescriptionHtml}

    ${paymentSection}

    <p>On the day of your cleaning, our professional team members will be arriving ready to work. We'll give you a 30 to 60-minute heads-up before finishing so we can do a final walkthrough together and make sure you're 100% happy with the results.</p>

    <p>We're looking forward to giving you a 5-star experience!</p>

    <p>Let me know if you have any questions — I'll be in touch every step of the way.</p>

    <p>Warm regards,<br>
    ${signatureLine}</p>
  `.trim()

  const fromName = params.tenant?.business_name_short || params.tenant?.name || undefined
  const from = fromName
    ? `"${fromName}" <${creds.user}>`
    : creds.user

  try {
    await transporter.sendMail({
      from,
      to: customer.email,
      subject: `Booking Confirmed - ${job.service_type || 'Cleaning'} on ${dateStr}`,
      html: htmlBody,
    })

    console.log(`Confirmation email sent to ${customer.email} from ${creds.user}`)
    return { success: true }
  } catch (error) {
    console.error('Gmail send error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Send a threaded reply email with proper threading headers.
 * Keeps the conversation in the same Gmail thread.
 */
export async function sendReplyEmail(params: {
  to: string
  subject: string
  body: string        // plain text body (converted to HTML paragraphs)
  fromName?: string
  inReplyTo?: string  // Message-ID of the email being replied to
  references?: string[] // Reference chain for threading
  tenant?: { gmail_user?: string | null; gmail_app_password?: string | null }
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const creds = getGmailCreds(params.tenant)
  if (!creds) {
    return { success: false, error: 'Gmail credentials not configured' }
  }

  const transporter = createTransporter(creds)

  const htmlBody = params.body
    .split('\n')
    .map(line => `<p>${line || '&nbsp;'}</p>`)
    .join('\n')

  const from = params.fromName
    ? `"${params.fromName}" <${creds.user}>`
    : creds.user

  // Build threading headers
  const headers: Record<string, string> = {}
  if (params.inReplyTo) {
    headers['In-Reply-To'] = params.inReplyTo
  }
  if (params.references && params.references.length > 0) {
    headers['References'] = params.references.join(' ')
  }

  try {
    const info = await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html: htmlBody,
      headers,
    })

    const messageId = info.messageId || ''
    console.log(`[Email Bot] Reply sent to ${params.to}, Message-ID: ${messageId}`)
    return { success: true, messageId }
  } catch (error) {
    console.error('[Email Bot] Send reply error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Send a custom email with plain text body (wrapped in simple HTML).
 * Checks tenant Gmail creds first, falls back to env vars.
 */
export async function sendCustomEmail(params: {
  to: string
  subject: string
  body: string
  fromName?: string
  tenant?: { gmail_user?: string | null; gmail_app_password?: string | null }
}): Promise<{ success: boolean; error?: string }> {
  const creds = getGmailCreds(params.tenant)
  if (!creds) {
    console.error('Gmail credentials not configured')
    return { success: false, error: 'Gmail credentials not configured' }
  }

  const transporter = createTransporter(creds)

  const htmlBody = params.body
    .split('\n')
    .map(line => `<p>${line || '&nbsp;'}</p>`)
    .join('\n')

  const from = params.fromName
    ? `"${params.fromName}" <${creds.user}>`
    : creds.user

  try {
    await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html: htmlBody,
    })

    console.log(`Custom email sent to ${params.to} from ${creds.user}: "${params.subject}"`)
    return { success: true }
  } catch (error) {
    console.error('Gmail send error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
