import nodemailer from 'nodemailer'
import type { Job, Customer } from './supabase'

interface ConfirmationEmailParams {
  customer: Customer
  job: Job
  waveInvoiceUrl?: string
  stripeDepositUrl: string
  cleanerName?: string
}

export async function sendConfirmationEmail(params: ConfirmationEmailParams): Promise<{
  success: boolean
  error?: string
}> {
  const gmailUser = process.env.GMAIL_USER
  const gmailPassword = process.env.GMAIL_APP_PASSWORD

  if (!gmailUser || !gmailPassword) {
    console.error('Gmail credentials not configured')
    return {
      success: false,
      error: 'Gmail credentials not configured'
    }
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailPassword,
    },
  })

  const { customer, job, waveInvoiceUrl, stripeDepositUrl, cleanerName } = params

  if (!customer.email) {
    return {
      success: false,
      error: 'Customer email is required'
    }
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

  // Build email HTML
  const htmlBody = `
    <p>Congrats ${customer.first_name || 'there'}, we can confirm for ${dateStr} at ${timeStr}</p>

    <p>We're excited to get started and make your space feel refreshed and spotless. Your ${job.service_type || 'Cleaning'} is scheduled for ${job.address || customer.address || '[Address]'}. Our professional ${cleanerName ? `cleaner, ${cleanerName}` : 'team'}, will be arriving ready to work. Please allow an arrival window of 1 hour to account for any unforeseen circumstances.</p>

    <p>To secure your booking, we've attached your invoice below. Please pay the 50% deposit to lock in your date. You can use the link sent below for debit/credit card payments.</p>

    ${waveInvoiceUrl ? `<p><strong>Invoice Link:</strong> <a href="${waveInvoiceUrl}">${waveInvoiceUrl}</a></p>` : ''}

    <p><strong>Credit/Debit Payment Info:</strong><br>
    Stripe Link: <a href="${stripeDepositUrl}">${stripeDepositUrl}</a></p>

    <p>On the day of your cleaning, our professional team members will be arriving ready to work. We'll give you a 30 to 60-minute heads-up before finishing so we can do a final walkthrough together and make sure you're 100% happy with the results.</p>

    <p>We're looking forward to giving you a 5-star experience!</p>

    <p>Let me know if you have any questions — I'll be in touch every step of the way.</p>

    <p>Warm regards,<br>
    Dominic: (424) 677-1146</p>
  `.trim()

  try {
    await transporter.sendMail({
      from: gmailUser,
      to: customer.email,
      subject: `Booking Confirmed - ${job.service_type || 'Cleaning'} on ${dateStr}`,
      html: htmlBody,
    })

    console.log(`Confirmation email sent to ${customer.email}`)
    return { success: true }
  } catch (error) {
    console.error('Gmail send error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
