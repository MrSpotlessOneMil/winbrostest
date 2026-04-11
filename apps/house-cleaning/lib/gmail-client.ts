import nodemailer from 'nodemailer'
import { google } from 'googleapis'
import type { Job, Customer } from './supabase'

// ---------------------------------------------------------------------------
// Tenant type used by email functions
// ---------------------------------------------------------------------------

interface GmailTenant {
  gmail_user?: string | null
  gmail_app_password?: string | null
  gmail_service_account_json?: string | null
  gmail_impersonated_user?: string | null
  business_name_short?: string | null
  name?: string | null
  openphone_phone_number?: string | null
  owner_phone?: string | null
}

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

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
 * Check if tenant has Gmail Service Account credentials (domain-wide delegation).
 */
function hasServiceAccountCreds(tenant?: GmailTenant | null): boolean {
  return !!(tenant?.gmail_service_account_json && tenant?.gmail_impersonated_user)
}

/**
 * Resolve Gmail app-password credentials: tenant-specific first, then env var fallback.
 */
function getGmailCreds(tenant?: GmailTenant | null) {
  if (tenant?.gmail_user && tenant?.gmail_app_password) {
    return { user: tenant.gmail_user, pass: tenant.gmail_app_password }
  }
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

// ---------------------------------------------------------------------------
// Gmail API (Service Account) helpers
// ---------------------------------------------------------------------------

/**
 * Build an authenticated Gmail API client using a service account JSON key
 * with domain-wide delegation impersonating the given user.
 */
function getGmailApiClient(serviceAccountJson: string, impersonatedUser: string) {
  const key = JSON.parse(serviceAccountJson)
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'],
    subject: impersonatedUser,
  })
  return google.gmail({ version: 'v1', auth })
}

/**
 * Build a RFC 2822 MIME message and Base64url-encode it for the Gmail API.
 */
function buildRawEmail(params: {
  from: string
  to: string
  subject: string
  html: string
  inReplyTo?: string
  references?: string[]
}): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const lines: string[] = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]
  if (params.inReplyTo) lines.push(`In-Reply-To: ${params.inReplyTo}`)
  if (params.references && params.references.length > 0) lines.push(`References: ${params.references.join(' ')}`)

  lines.push('', `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: 7bit', '', params.html, '', `--${boundary}--`)

  const raw = lines.join('\r\n')
  return Buffer.from(raw).toString('base64url')
}

/**
 * Send an email via the Gmail API (service account path).
 */
async function sendViaGmailApi(
  tenant: GmailTenant,
  params: {
    to: string
    subject: string
    html: string
    fromName?: string
    inReplyTo?: string
    references?: string[]
    threadId?: string
  }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const gmail = getGmailApiClient(tenant.gmail_service_account_json!, tenant.gmail_impersonated_user!)
    const fromAddr = tenant.gmail_impersonated_user!
    const from = params.fromName ? `"${params.fromName}" <${fromAddr}>` : fromAddr

    const raw = buildRawEmail({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      inReplyTo: params.inReplyTo,
      references: params.references,
    })

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId: params.threadId || undefined },
    })

    const messageId = res.data.id || ''
    console.log(`[Gmail API] Email sent to ${params.to} from ${fromAddr}, ID: ${messageId}`)
    return { success: true, messageId }
  } catch (error) {
    console.error('[Gmail API] Send error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Gmail API error',
    }
  }
}

// ---------------------------------------------------------------------------
// Public email functions
// ---------------------------------------------------------------------------

interface ConfirmationEmailParams {
  customer: Customer
  job: Job
  waveInvoiceUrl?: string
  stripeDepositUrl: string
  cleanerName?: string
  tenant?: GmailTenant
  // Threading headers — keep confirmation in the same email thread
  inReplyTo?: string
  references?: string[]
  subjectOverride?: string
}

export async function sendConfirmationEmail(params: ConfirmationEmailParams): Promise<{
  success: boolean
  error?: string
}> {
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
    const { buildStaticCleaningDescription } = await import('./invoices')
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
  const contactPhone = params.tenant?.openphone_phone_number || params.tenant?.owner_phone || null
  const formattedPhone = contactPhone ? formatPhoneForDisplay(contactPhone) : null
  const signatureLine = formattedPhone ? `${businessName}: ${formattedPhone}` : businessName

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

  const subject = params.subjectOverride || `Booking Confirmed - ${job.service_type || 'Cleaning'} on ${dateStr}`

  // --- Service Account path ---
  if (hasServiceAccountCreds(params.tenant)) {
    return sendViaGmailApi(params.tenant!, {
      to: customer.email,
      subject,
      html: htmlBody,
      fromName: params.tenant?.business_name_short || params.tenant?.name || undefined,
      inReplyTo: params.inReplyTo,
      references: params.references,
    })
  }

  // --- App Password / SMTP path ---
  const creds = getGmailCreds(params.tenant)
  if (!creds) {
    console.error('Gmail credentials not configured')
    return { success: false, error: 'Gmail credentials not configured' }
  }

  const transporter = createTransporter(creds)
  const fromName = params.tenant?.business_name_short || params.tenant?.name || undefined
  const from = fromName ? `"${fromName}" <${creds.user}>` : creds.user

  try {
    await transporter.sendMail({
      from,
      to: customer.email,
      subject,
      html: htmlBody,
      ...(params.inReplyTo ? { inReplyTo: params.inReplyTo } : {}),
      ...(params.references && params.references.length > 0
        ? { references: params.references.join(' ') }
        : {}),
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
  threadId?: string   // Gmail API thread ID for same-thread replies
  tenant?: GmailTenant
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // Strip any markdown formatting that the AI might include
  const cleanedBody = params.body
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/`(.+?)`/g, '$1')

  // Convert plain text to clean HTML
  const htmlBody = cleanedBody
    .split(/\n{2,}/)
    .map(para => para.trim())
    .filter(Boolean)
    .map(para => `<p style="margin:0 0 12px 0">${para.replace(/\n/g, '<br>')}</p>`)
    .join('\n')

  // --- Service Account path ---
  if (hasServiceAccountCreds(params.tenant)) {
    return sendViaGmailApi(params.tenant!, {
      to: params.to,
      subject: params.subject,
      html: htmlBody,
      fromName: params.fromName,
      inReplyTo: params.inReplyTo,
      references: params.references,
      threadId: params.threadId,
    })
  }

  // --- App Password / SMTP path ---
  const creds = getGmailCreds(params.tenant)
  if (!creds) {
    return { success: false, error: 'Gmail credentials not configured' }
  }

  const transporter = createTransporter(creds)
  const from = params.fromName
    ? `"${params.fromName}" <${creds.user}>`
    : creds.user

  try {
    const info = await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html: htmlBody,
      ...(params.inReplyTo ? { inReplyTo: params.inReplyTo } : {}),
      ...(params.references && params.references.length > 0
        ? { references: params.references.join(' ') }
        : {}),
    })

    const messageId = info.messageId || ''
    console.log(`[Email Bot] Reply sent to ${params.to}, Message-ID: ${messageId}, In-Reply-To: ${params.inReplyTo || 'none'}, References: ${params.references?.length || 0} IDs, Subject: ${params.subject}`)
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
  tenant?: GmailTenant
}): Promise<{ success: boolean; error?: string }> {
  // Convert plain text to clean HTML
  const htmlBody = params.body
    .split(/\n{2,}/)
    .map(para => para.trim())
    .filter(Boolean)
    .map(para => `<p style="margin:0 0 12px 0">${para.replace(/\n/g, '<br>')}</p>`)
    .join('\n')

  // --- Service Account path ---
  if (hasServiceAccountCreds(params.tenant)) {
    return sendViaGmailApi(params.tenant!, {
      to: params.to,
      subject: params.subject,
      html: htmlBody,
      fromName: params.fromName,
    })
  }

  // --- App Password / SMTP path ---
  const creds = getGmailCreds(params.tenant)
  if (!creds) {
    console.error('Gmail credentials not configured')
    return { success: false, error: 'Gmail credentials not configured' }
  }

  const transporter = createTransporter(creds)
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

// ---------------------------------------------------------------------------
// Service account JSON sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize a service account JSON string before saving to DB.
 * Fixes double-escaped newlines in the private_key that happen when users
 * copy-paste from certain sources or the JSON gets stringified twice.
 */
export function sanitizeServiceAccountJson(raw: string): string {
  const trimmed = raw.trim()
  // Try parsing as-is first
  try {
    const parsed = JSON.parse(trimmed)
    // Check if private_key has literal \n (correct) vs \\n (double-escaped)
    if (parsed.private_key && typeof parsed.private_key === 'string') {
      // If the key doesn't contain actual newlines but has literal backslash-n, fix it
      if (!parsed.private_key.includes('\n') && parsed.private_key.includes('\\n')) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
        return JSON.stringify(parsed)
      }
    }
    return trimmed
  } catch {
    // If it doesn't parse, try fixing common issues
    try {
      // Sometimes the whole thing is double-escaped
      const fixed = trimmed.replace(/\\\\n/g, '\\n')
      JSON.parse(fixed) // validate
      return fixed
    } catch {
      // Return as-is — the connection test will catch the error
      return trimmed
    }
  }
}

// Re-export for use by gmail-imap.ts and other modules
export { getGmailApiClient, hasServiceAccountCreds }
export type { GmailTenant }
