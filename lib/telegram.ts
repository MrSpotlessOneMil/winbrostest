/**
 * Telegram Bot Integration - Cleaner notifications
 */

import { Cleaner, Job, Customer } from './supabase'
import { getAddOnLabel, getOverridesFromNotes, getEstimateFromNotes } from './pricing-config'
import type { AddOnKey } from './pricing-config'
import { getClientConfig } from './client-config'

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot'

interface SendMessageResult {
  success: boolean
  messageId?: number
  error?: string
}

interface InlineKeyboardButton {
  text: string
  callback_data: string
}

interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][]
}

/**
 * Send a message via Telegram bot
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'Markdown' = 'HTML',
  replyMarkup?: InlineKeyboardMarkup
): Promise<SendMessageResult> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken) {
    console.error('TELEGRAM_BOT_TOKEN not configured')
    return { success: false, error: 'Telegram bot token not configured' }
  }

  if (!chatId) {
    return { success: false, error: 'Chat ID required' }
  }

  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    }

    if (replyMarkup) {
      payload.reply_markup = replyMarkup
    }

    const response = await fetch(`${TELEGRAM_API_BASE}${botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (!data.ok) {
      console.error('Telegram API error:', data)
      return { success: false, error: data.description || 'Telegram API error' }
    }

    return {
      success: true,
      messageId: data.result?.message_id,
    }
  } catch (error) {
    console.error('Error sending Telegram message:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Answer a callback query (acknowledge button press)
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken) {
    console.error('TELEGRAM_BOT_TOKEN not configured')
    return false
  }

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text || 'Response received!',
      }),
    })

    const data = await response.json()
    return data.ok === true
  } catch (error) {
    console.error('Error answering callback query:', error)
    return false
  }
}

/**
 * Edit a message to remove inline keyboard after response
 */
export async function editMessageReplyMarkup(
  chatId: string,
  messageId: number
): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken) return false

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}${botToken}/editMessageReplyMarkup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      }),
    })

    const data = await response.json()
    return data.ok === true
  } catch (error) {
    console.error('Error editing message:', error)
    return false
  }
}

/**
 * Notify a cleaner about a new job assignment request
 * Sends message with inline keyboard for accept/decline
 */
export async function notifyCleanerAssignment(
  cleaner: Cleaner,
  job: Job,
  customer?: Partial<Customer>,
  assignmentId?: string
): Promise<SendMessageResult> {
  if (!cleaner.telegram_id) {
    return { success: false, error: 'Cleaner has no Telegram ID configured' }
  }

  const dateStr = job.date
    ? new Date(job.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : 'TBD'

  const timeStr = formatCleanerTime(job.scheduled_at)
  const overrides = getOverridesFromNotes(job.notes)
  const bedrooms = overrides.bedrooms ?? customer?.bedrooms ?? job.bedrooms ?? 'N/A'
  const bathrooms = overrides.bathrooms ?? customer?.bathrooms ?? job.bathrooms ?? 'N/A'
  const squareFootage = customer?.square_footage ?? job.square_footage ?? 'N/A'
  const duration = job.hours ? `${job.hours} hours` : 'TBD'

  // Calculate cleaner pay ($25 per hour × total hours)
  const estimate = getEstimateFromNotes(job.notes)
  const config = getClientConfig()
  let cleanerPay = 'TBD'
  if (estimate.cleanerPay) {
    cleanerPay = estimate.cleanerPay.toFixed(2)
  } else if (estimate.totalHours) {
    cleanerPay = (estimate.totalHours * config.cleanerHourlyRate).toFixed(2)
  }

  const safeNotes = formatCleanerNotes(job.notes)
  const message = `
<b>New Job Available!</b>

Date: ${dateStr}, ${timeStr}
Bedrooms: ${bedrooms}
Bathrooms: ${bathrooms}
Square Footage: ${squareFootage}
Duration: ${duration}
Notes: ${safeNotes || 'None'}
Pay: $${cleanerPay}

Address: ${job.address || customer?.address || 'See details'}
Customer: ${customer?.first_name || 'Customer'}

Reply with 1 (Available) or 2 (Not Available)
`.trim()

  // Build callback data with job and assignment IDs
  const jobId = job.id || 'unknown'
  const asnId = assignmentId || 'unknown'

  const inlineKeyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        { text: '1 - Available', callback_data: `accept:${jobId}:${asnId}` },
        { text: '2 - Not Available', callback_data: `decline:${jobId}:${asnId}` },
      ],
    ],
  }

  return await sendTelegramMessage(cleaner.telegram_id, message, 'HTML', inlineKeyboard)
}

/**
 * Notify cleaner they've been awarded the job
 */
export async function notifyCleanerAwarded(
  cleaner: Cleaner,
  job: Job,
  customer?: Partial<Customer>
): Promise<SendMessageResult> {
  if (!cleaner.telegram_id) {
    return { success: false, error: 'Cleaner has no Telegram ID configured' }
  }

  const dateStr = job.date
    ? new Date(job.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : 'TBD'

  const timeStr = formatCleanerTime(job.scheduled_at)
  const overrides = getOverridesFromNotes(job.notes)
  const bedrooms = overrides.bedrooms ?? customer?.bedrooms ?? job.bedrooms ?? 'N/A'
  const bathrooms = overrides.bathrooms ?? customer?.bathrooms ?? job.bathrooms ?? 'N/A'
  const squareFootage = customer?.square_footage ?? job.square_footage ?? 'N/A'
  const duration = job.hours ? `${job.hours} hours` : 'TBD'

  // Calculate cleaner pay ($25 per hour × total hours)
  const estimate = getEstimateFromNotes(job.notes)
  const config = getClientConfig()
  let cleanerPay = 'TBD'
  if (estimate.cleanerPay) {
    cleanerPay = estimate.cleanerPay.toFixed(2)
  } else if (estimate.totalHours) {
    cleanerPay = (estimate.totalHours * config.cleanerHourlyRate).toFixed(2)
  }

  const serviceType = job.service_type ? humanizeText(job.service_type) : 'Standard cleaning'

  const message = `
<b>Job Awarded to You!</b>

Date: ${dateStr}, ${timeStr}
Bedrooms: ${bedrooms}
Bathrooms: ${bathrooms}
Square Footage: ${squareFootage}
Duration: ${duration}
Pay: $${cleanerPay}

Address: ${job.address || customer?.address || 'See details'}
Customer: ${customer?.first_name || 'Customer'}
Service: ${serviceType}

This job is now confirmed on your schedule. Please arrive on time!
`.trim()

  return await sendTelegramMessage(cleaner.telegram_id, message)
}

/**
 * Notify cleaner they were not selected for the job
 */
export async function notifyCleanerNotSelected(
  cleaner: Cleaner,
  job: Job
): Promise<SendMessageResult> {
  if (!cleaner.telegram_id) {
    return { success: false, error: 'Cleaner has no Telegram ID configured' }
  }

  const dateStr = job.date
    ? new Date(job.date).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : 'the scheduled date'

  const message = `
<b>Job Update</b>

The job on ${dateStr} has been assigned to another cleaner. Thank you for your availability!
`.trim()

  return await sendTelegramMessage(cleaner.telegram_id, message)
}

/**
 * Send urgent follow-up to unresponsive cleaners
 */
export async function sendUrgentFollowUp(
  cleaner: Cleaner,
  job: Job
): Promise<SendMessageResult> {
  if (!cleaner.telegram_id) {
    return { success: false, error: 'Cleaner has no Telegram ID configured' }
  }

  const dateStr = job.date
    ? new Date(job.date).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : 'TBD'

  const message = `
<b>URGENT: Response Needed!</b>

We still need a response for the job on <b>${dateStr}</b>.

Please reply ASAP - the customer is waiting!
`.trim()

  return await sendTelegramMessage(cleaner.telegram_id, message)
}

/**
 * Send daily schedule to a cleaner
 */
export async function sendDailySchedule(
  cleaner: Cleaner,
  jobs: Array<Job & { customer?: Partial<Customer> }>
): Promise<SendMessageResult> {
  if (!cleaner.telegram_id) {
    return { success: false, error: 'Cleaner has no Telegram ID configured' }
  }

  if (jobs.length === 0) {
    const message = `
<b>Good morning, ${cleaner.name}!</b>

You have no jobs scheduled for today. Enjoy your day off!
`.trim()

    return await sendTelegramMessage(cleaner.telegram_id, message)
  }

  // Sort jobs by scheduled time
  const sortedJobs = [...jobs].sort((a, b) => {
    const timeA = a.scheduled_at || '00:00'
    const timeB = b.scheduled_at || '00:00'
    return timeA.localeCompare(timeB)
  })

  const jobsList = sortedJobs.map((job, index) => {
    const time = formatCleanerTime(job.scheduled_at)
    const address = job.address || job.customer?.address || 'See details'
    const customerName = job.customer?.first_name || 'Customer'
    const safeNotes = formatCleanerNotes(job.notes)
    const overrides = getOverridesFromNotes(job.notes)
    const bedrooms = overrides.bedrooms ?? job.customer?.bedrooms ?? job.bedrooms ?? '?'
    const bathrooms = overrides.bathrooms ?? job.customer?.bathrooms ?? job.bathrooms ?? '?'
    const serviceType = job.service_type ? humanizeText(job.service_type) : 'Standard cleaning'

    return `
<b>${index + 1}. ${time}</b>
- ${address}
- ${customerName}
- ${bedrooms}BR / ${bathrooms}BA
${serviceType}
${safeNotes ? `- ${safeNotes}` : ''}
`.trim()
  }).join('\n\n')

  const message = `
<b>Good morning, ${cleaner.name}!</b>

Here's your schedule for today (${jobs.length} job${jobs.length > 1 ? 's' : ''}):

${jobsList}

Have a great day!
`.trim()

  return await sendTelegramMessage(cleaner.telegram_id, message)
}

/**
 * Send a job reminder notification to a cleaner
 * Used for 1-hour before and job start reminders
 */
export async function sendJobReminder(
  cleaner: Cleaner,
  job: Job,
  customer: Customer | undefined,
  reminderType: 'one_hour_before' | 'job_start'
): Promise<SendMessageResult> {
  if (!cleaner.telegram_id) {
    return { success: false, error: 'Cleaner has no Telegram ID configured' }
  }

  const timeStr = formatCleanerTime(job.scheduled_at)
  const dateStr = job.date
    ? new Date(job.date).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : 'TBD'

  const address = job.address || 'Address TBD'
  const customerName = customer
    ? [customer.first_name, customer.last_name].filter(Boolean).join(' ')
    : 'Customer'

  let message: string
  if (reminderType === 'one_hour_before') {
    message = `
<b>⏰ Reminder: Job starting in 1 hour</b>

📅 ${dateStr} at ${timeStr}
📍 ${address}
👤 ${customerName}

Get ready to head out soon!
`.trim()
  } else {
    message = `
<b>🚀 Job Starting Now!</b>

📅 ${dateStr} at ${timeStr}
📍 ${address}
👤 ${customerName}

Time to start the job. Good luck!
`.trim()
  }

  return await sendTelegramMessage(cleaner.telegram_id, message)
}

/**
 * Notify cleaner of a job cancellation
 */
export async function notifyJobCancellation(
  cleaner: Cleaner,
  job: Job
): Promise<SendMessageResult> {
  if (!cleaner.telegram_id) {
    return { success: false, error: 'Cleaner has no Telegram ID configured' }
  }

  const dateStr = job.date
    ? new Date(job.date).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : 'TBD'

  const message = `
<b>Job Cancelled</b>

The following job has been cancelled:

<b>Date:</b> ${dateStr}
<b>Time:</b> ${formatCleanerTime(job.scheduled_at)}
<b>Service:</b> ${job.service_type ? humanizeText(job.service_type) : 'Cleaning'}

Your schedule has been updated.
`.trim()

  return await sendTelegramMessage(cleaner.telegram_id, message)
}

/**
 * Notify cleaner of a schedule change
 */
export async function notifyScheduleChange(
  cleaner: Cleaner,
  job: Job,
  oldDate: string,
  oldTime: string
): Promise<SendMessageResult> {
  if (!cleaner.telegram_id) {
    return { success: false, error: 'Cleaner has no Telegram ID configured' }
  }

  const newDateStr = job.date
    ? new Date(job.date).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : 'TBD'

  const message = `
<b>Schedule Change</b>

A job has been rescheduled:

<b>Old:</b> ${oldDate} at ${formatCleanerTime(oldTime)}
<b>New:</b> ${newDateStr} at ${formatCleanerTime(job.scheduled_at)}

Please update your calendar!
`.trim()

  return await sendTelegramMessage(cleaner.telegram_id, message)
}

export type JobChange = {
  field: 'address' | 'bedrooms' | 'bathrooms' | 'square_footage' | 'date' | 'scheduled_at' | 'notes'
  oldValue: string | number | null
  newValue: string | number | null
}

/**
 * Notify cleaner of job details changes
 */
export async function notifyJobDetailsChange(
  cleaner: Cleaner,
  job: Job,
  changes: JobChange[]
): Promise<SendMessageResult> {
  if (!cleaner.telegram_id) {
    return { success: false, error: 'Cleaner has no Telegram ID configured' }
  }

  if (changes.length === 0) {
    return { success: false, error: 'No changes to notify' }
  }

  const jobDateStr = job.date
    ? new Date(job.date).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : 'TBD'

  const changeLines = changes.map(change => {
    const fieldName = change.field.replace(/_/g, ' ')
    const capitalizedField = fieldName.charAt(0).toUpperCase() + fieldName.slice(1)

    if (change.field === 'date') {
      const oldDateStr = change.oldValue
        ? new Date(String(change.oldValue)).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })
        : 'TBD'
      const newDateStr = change.newValue
        ? new Date(String(change.newValue)).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })
        : 'TBD'
      return `• ${capitalizedField}: ${oldDateStr} → ${newDateStr}`
    }

    if (change.field === 'scheduled_at') {
      const oldTime = formatCleanerTime(String(change.oldValue || ''))
      const newTime = formatCleanerTime(String(change.newValue || ''))
      return `• Time: ${oldTime} → ${newTime}`
    }

    if (change.field === 'address') {
      return `• ${capitalizedField} changed to: ${change.newValue || 'N/A'}`
    }

    return `• ${capitalizedField}: ${change.oldValue || 'N/A'} → ${change.newValue || 'N/A'}`
  })

  const message = `
🔔 <b>Job Update</b>

Your job on ${jobDateStr} has been updated:

${changeLines.join('\n')}

Please review the updated details.
`.trim()

  return await sendTelegramMessage(cleaner.telegram_id, message)
}

/**
 * Request cleaner confirmation for a reschedule
 */
export async function requestRescheduleConfirmation(
  cleaner: Cleaner,
  job: Job,
  oldDate: string,
  oldTime: string,
  assignmentId?: string
): Promise<SendMessageResult> {
  if (!cleaner.telegram_id) {
    return { success: false, error: 'Cleaner has no Telegram ID configured' }
  }

  const newDateStr = job.date
    ? new Date(job.date).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : 'TBD'

  const newTime = formatCleanerTime(job.scheduled_at)
  const jobId = job.id || 'unknown'
  const asnId = assignmentId || 'unknown'

  const message = `
<b>Schedule Change Request</b>

<b>Old:</b> ${oldDate} at ${formatCleanerTime(oldTime)}
<b>New:</b> ${newDateStr} at ${newTime}

Can you confirm this new time?
`.trim()

  const inlineKeyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        { text: 'Confirm', callback_data: `reschedule_accept:${jobId}:${asnId}` },
        { text: "Can't do it", callback_data: `reschedule_decline:${jobId}:${asnId}` },
      ],
    ],
  }

  return await sendTelegramMessage(cleaner.telegram_id, message, 'HTML', inlineKeyboard)
}

function redactContactInfo(value: string): string {
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  const phoneRegex = /\+?\d[\d\s().-]{6,}\d/g
  const urlRegex = /https?:\/\/\S+/gi
  const lines = value.split('\n')
  const filtered = lines.filter((line) => {
    const lower = line.toLowerCase()
    if (lower.includes('invoice_url') || lower.includes('invoice url')) {
      return false
    }
    return !urlRegex.test(line)
  })
  const joined = filtered.join('\n')
  return joined
    .replace(emailRegex, '[redacted]')
    .replace(phoneRegex, '[redacted]')
}

function formatCleanerNotes(notes?: string | null): string {
  if (!notes) return ''

  const redacted = redactContactInfo(notes)
  const lines = redacted
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const cleaned: string[] = []
  const addOns = new Set<string>()

  for (const line of lines) {
    const lower = line.toLowerCase()
    if (
      lower.startsWith('hours:') ||
      lower.startsWith('pay:') ||
      lower.startsWith('payment:') ||
      lower.startsWith('override:')
    ) {
      continue
    }

    if (lower.startsWith('add-on:') || lower.startsWith('add on:') || lower.startsWith('addon:')) {
      const rawKey = line.split(':')[1]?.trim()
      if (rawKey) {
        const normalizedKey = rawKey.toLowerCase().replace(/\s+/g, '_')
        addOns.add(humanizeText(getAddOnLabel(normalizedKey as AddOnKey)))
      }
      continue
    }

    cleaned.push(humanizeText(line))
  }

  if (addOns.size > 0) {
    cleaned.push(`Add-ons: ${Array.from(addOns).join(', ')}`)
  }

  return cleaned.join(' ')
}

function humanizeText(value: string): string {
  return value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

function formatCleanerTime(time?: string | null): string {
  if (!time) return 'TBD'
  const raw = time.trim()
  const tzMatch = raw.match(/\b(pst|pdt|pt)\b/i)
  const withoutTz = raw.replace(/\b(pst|pdt|pt)\b/i, '').trim()
  const match = withoutTz.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/i)
  if (!match) {
    return raw
  }

  let hour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  let period = match[3]?.toUpperCase()

  if (!period) {
    period = hour >= 12 ? 'PM' : 'AM'
    hour = hour % 12
    if (hour === 0) hour = 12
  }

  const minuteStr = String(minute).padStart(2, '0')
  const tzLabel = tzMatch ? ' PST' : ' PST'
  return `${hour}:${minuteStr} ${period}${tzLabel}`
}
