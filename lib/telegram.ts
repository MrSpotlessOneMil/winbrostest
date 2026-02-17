/**
 * Telegram Bot Integration - Cleaner notifications
 * Multi-tenant version - supports both old (env var) and new (tenant) calling patterns
 */

import type { Tenant } from './tenant'
import { getDefaultTenant } from './tenant'

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot'

/**
 * Log a Telegram message (inbound or outbound) to the messages table.
 * Uses dynamic import to avoid circular dependency with supabase.ts.
 * Fire-and-forget — never throws.
 */
export async function logTelegramMessage(opts: {
  telegramChatId: string
  direction: 'inbound' | 'outbound'
  content: string
  source: string
  messageId?: number
}) {
  try {
    const { getSupabaseServiceClient } = await import('./supabase')
    const { getDefaultTenant: getTenant } = await import('./tenant')
    const tenant = await getTenant()
    if (!tenant) return

    const client = getSupabaseServiceClient()

    // Look up the cleaner's phone by telegram_id
    const { data: cleaner } = await client
      .from('cleaners')
      .select('phone')
      .eq('tenant_id', tenant.id)
      .eq('telegram_id', opts.telegramChatId)
      .limit(1)
      .single()

    // Normalize phone to E.164 for consistent querying
    const { toE164 } = await import('./phone-utils')
    const rawPhone = cleaner?.phone || null
    const phone = rawPhone ? toE164(rawPhone) || rawPhone : null

    await client.from('messages').insert({
      tenant_id: tenant.id,
      phone_number: phone,
      direction: opts.direction,
      message_type: 'sms',
      content: opts.content,
      role: opts.direction === 'inbound' ? 'client' : 'assistant',
      ai_generated: false,
      status: 'sent',
      source: opts.source,
      timestamp: new Date().toISOString(),
      metadata: {
        telegram_chat_id: opts.telegramChatId,
        telegram_message_id: opts.messageId,
        channel: 'telegram',
      },
    })
  } catch (err) {
    console.error('[telegram] Failed to log message:', err)
  }
}

// Simplified types that don't depend on supabase.ts to avoid circular imports
interface CleanerInfo {
  telegram_id?: string | null
  name: string
  phone?: string | null
}

interface JobInfo {
  id?: string | number
  date?: string | null
  scheduled_at?: string | null
  address?: string | null
  service_type?: string | null
  notes?: string | null
  bedrooms?: number | null
  bathrooms?: number | null
  square_footage?: number | null
  hours?: number | null
}

interface CustomerInfo {
  first_name?: string | null
  last_name?: string | null
  address?: string | null
  bedrooms?: number | null
  bathrooms?: number | null
  square_footage?: number | null
}

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
 * Get bot token from tenant, string, or environment variable
 * Priority: passed tenant > default tenant DB value (admin credentials page) > env var
 */
async function getBotToken(tenantOrToken?: Tenant | string | null): Promise<string | null> {
  if (typeof tenantOrToken === 'string') {
    return tenantOrToken
  }
  if (tenantOrToken && typeof tenantOrToken === 'object' && 'telegram_bot_token' in tenantOrToken) {
    return tenantOrToken.telegram_bot_token
  }
  // Check default tenant DB value first (admin credentials page)
  const tenant = await getDefaultTenant()
  if (tenant?.telegram_bot_token) {
    return tenant.telegram_bot_token
  }
  // Fall back to env var only if DB value is empty
  return process.env.TELEGRAM_BOT_TOKEN || null
}

/**
 * Send a message via Telegram bot
 * Backwards compatible - can be called with (chatId, text) or (tenant, chatId, text)
 */
export async function sendTelegramMessage(
  tenantOrChatId: Tenant | string,
  chatIdOrText: string,
  textOrParseMode?: string | 'HTML' | 'Markdown',
  parseModeOrMarkup?: 'HTML' | 'Markdown' | InlineKeyboardMarkup,
  replyMarkup?: InlineKeyboardMarkup
): Promise<SendMessageResult> {
  let botToken: string | null
  let chatId: string
  let text: string
  let parseMode: 'HTML' | 'Markdown' = 'HTML'
  let markup: InlineKeyboardMarkup | undefined

  // Detect calling pattern
  if (typeof tenantOrChatId === 'object' && 'telegram_bot_token' in tenantOrChatId) {
    // New pattern: sendTelegramMessage(tenant, chatId, text, parseMode?, replyMarkup?)
    botToken = tenantOrChatId.telegram_bot_token
    chatId = chatIdOrText
    text = textOrParseMode || ''
    parseMode = (parseModeOrMarkup as 'HTML' | 'Markdown') || 'HTML'
    markup = replyMarkup
  } else {
    // Old pattern: sendTelegramMessage(chatId, text, parseMode?, replyMarkup?)
    // Or: sendTelegramMessage(botToken, chatId, text, parseMode?, replyMarkup?)
    const firstArg = tenantOrChatId as string

    // Check if first arg looks like a bot token (contains ':')
    if (firstArg.includes(':')) {
      // Pattern: sendTelegramMessage(botToken, chatId, text, parseMode?, replyMarkup?)
      botToken = firstArg
      chatId = chatIdOrText
      text = textOrParseMode || ''
      parseMode = (parseModeOrMarkup as 'HTML' | 'Markdown') || 'HTML'
      markup = replyMarkup
    } else {
      // Pattern: sendTelegramMessage(chatId, text, parseMode?, replyMarkup?)
      botToken = await getBotToken(null)
      chatId = firstArg
      text = chatIdOrText
      parseMode = (textOrParseMode as 'HTML' | 'Markdown') || 'HTML'
      markup = parseModeOrMarkup as InlineKeyboardMarkup | undefined
    }
  }

  if (!botToken) {
    console.error('Telegram bot token not configured')
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

    if (markup) {
      payload.reply_markup = markup
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

    // Log outbound message to DB (fire-and-forget)
    logTelegramMessage({
      telegramChatId: chatId,
      direction: 'outbound',
      content: text,
      source: 'telegram_bot',
      messageId: data.result?.message_id,
    }).catch(() => {})

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
 * Backwards compatible
 */
export async function answerCallbackQuery(
  callbackQueryIdOrTenant: string | Tenant,
  textOrCallbackQueryId?: string,
  textIfTenant?: string
): Promise<boolean> {
  let botToken: string | null
  let callbackQueryId: string
  let text: string | undefined

  if (typeof callbackQueryIdOrTenant === 'object' && 'telegram_bot_token' in callbackQueryIdOrTenant) {
    // New pattern: answerCallbackQuery(tenant, callbackQueryId, text?)
    botToken = callbackQueryIdOrTenant.telegram_bot_token
    callbackQueryId = textOrCallbackQueryId || ''
    text = textIfTenant
  } else {
    // Old pattern: answerCallbackQuery(callbackQueryId, text?)
    botToken = await getBotToken(null)
    callbackQueryId = callbackQueryIdOrTenant as string
    text = textOrCallbackQueryId
  }

  if (!botToken) {
    console.error('Telegram bot token not configured')
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
 * Backwards compatible
 */
export async function editMessageReplyMarkup(
  chatIdOrTenant: string | Tenant,
  chatIdOrMessageId: string | number,
  messageIdIfTenant?: number
): Promise<boolean> {
  let botToken: string | null
  let chatId: string
  let messageId: number

  if (typeof chatIdOrTenant === 'object' && 'telegram_bot_token' in chatIdOrTenant) {
    botToken = chatIdOrTenant.telegram_bot_token
    chatId = chatIdOrMessageId as string
    messageId = messageIdIfTenant!
  } else {
    botToken = await getBotToken(null)
    chatId = chatIdOrTenant as string
    messageId = chatIdOrMessageId as number
  }

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
 * Backwards compatible - tenant is optional
 */
export async function notifyCleanerAssignment(
  cleanerOrTenant: CleanerInfo | Tenant,
  jobOrCleaner: JobInfo | CleanerInfo,
  customerOrJob?: CustomerInfo | JobInfo | null,
  assignmentIdOrCustomer?: string | CustomerInfo | null,
  maybeAssignmentId?: string
): Promise<SendMessageResult> {
  let tenant: Tenant | null
  let cleaner: CleanerInfo
  let job: JobInfo
  let customer: CustomerInfo | null | undefined
  let assignmentId: string | undefined

  // Detect calling pattern
  if ('telegram_bot_token' in cleanerOrTenant) {
    // New pattern: notifyCleanerAssignment(tenant, cleaner, job, customer?, assignmentId?)
    tenant = cleanerOrTenant as Tenant
    cleaner = jobOrCleaner as CleanerInfo
    job = customerOrJob as JobInfo
    customer = assignmentIdOrCustomer as CustomerInfo | null | undefined
    assignmentId = maybeAssignmentId
  } else {
    // Old pattern: notifyCleanerAssignment(cleaner, job, customer?, assignmentId?)
    tenant = await getDefaultTenant()
    cleaner = cleanerOrTenant as CleanerInfo
    job = jobOrCleaner as JobInfo
    customer = customerOrJob as CustomerInfo | null | undefined
    assignmentId = assignmentIdOrCustomer as string | undefined
  }

  if (!tenant) {
    return { success: false, error: 'No tenant configured' }
  }
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
  const bedrooms = customer?.bedrooms ?? job.bedrooms ?? 'N/A'
  const bathrooms = customer?.bathrooms ?? job.bathrooms ?? 'N/A'
  const squareFootage = customer?.square_footage ?? job.square_footage ?? 'N/A'
  const duration = job.hours ? `${job.hours} hours` : 'TBD'

  const safeNotes = formatCleanerNotes(job.notes)
  const businessName = tenant.business_name_short || tenant.name

  const message = `
<b>New Job Available - ${businessName}!</b>

Date: ${dateStr}, ${timeStr}
Bedrooms: ${bedrooms}
Bathrooms: ${bathrooms}
Square Footage: ${squareFootage}
Duration: ${duration}
Notes: ${safeNotes || 'None'}

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

  return await sendTelegramMessage(tenant, cleaner.telegram_id, message, 'HTML', inlineKeyboard)
}

/**
 * Notify cleaner they've been awarded the job
 */
export async function notifyCleanerAwarded(
  tenant: Tenant,
  cleaner: CleanerInfo,
  job: JobInfo,
  customer?: CustomerInfo | null
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
  const bedrooms = customer?.bedrooms ?? job.bedrooms ?? 'N/A'
  const bathrooms = customer?.bathrooms ?? job.bathrooms ?? 'N/A'
  const squareFootage = customer?.square_footage ?? job.square_footage ?? 'N/A'
  const duration = job.hours ? `${job.hours} hours` : 'TBD'

  const serviceType = job.service_type ? humanizeText(job.service_type) : 'Standard cleaning'

  const message = `
<b>Job Awarded to You!</b>

Date: ${dateStr}, ${timeStr}
Bedrooms: ${bedrooms}
Bathrooms: ${bathrooms}
Square Footage: ${squareFootage}
Duration: ${duration}

Address: ${job.address || customer?.address || 'See details'}
Customer: ${customer?.first_name || 'Customer'}
Service: ${serviceType}

This job is now confirmed on your schedule. Please arrive on time!
`.trim()

  return await sendTelegramMessage(tenant, cleaner.telegram_id, message)
}

/**
 * Notify cleaner they were not selected for the job
 */
export async function notifyCleanerNotSelected(
  tenant: Tenant,
  cleaner: CleanerInfo,
  job: JobInfo
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

  return await sendTelegramMessage(tenant, cleaner.telegram_id, message)
}

/**
 * Send urgent follow-up to unresponsive cleaners
 * Backwards compatible - can be called with:
 * - (cleaner, job) - old pattern
 * - (tenant, cleaner, job) - new pattern
 */
export async function sendUrgentFollowUp(
  tenantOrCleaner: Tenant | CleanerInfo,
  cleanerOrJob: CleanerInfo | JobInfo,
  jobOrUndefined?: JobInfo
): Promise<SendMessageResult> {
  // Detect if called with tenant or without (backwards compat)
  let tenant: Tenant | null
  let cleaner: CleanerInfo
  let job: JobInfo

  if ('slug' in tenantOrCleaner) {
    // New calling pattern: (tenant, cleaner, job)
    tenant = tenantOrCleaner as Tenant
    cleaner = cleanerOrJob as CleanerInfo
    job = jobOrUndefined as JobInfo
  } else {
    // Old calling pattern: (cleaner, job)
    tenant = null
    cleaner = tenantOrCleaner as CleanerInfo
    job = cleanerOrJob as JobInfo
  }

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

  // Call sendTelegramMessage - use old pattern if no tenant
  if (tenant) {
    return await sendTelegramMessage(tenant, cleaner.telegram_id, message)
  } else {
    return await sendTelegramMessage(cleaner.telegram_id, message)
  }
}

/**
 * Send daily schedule to a cleaner
 * Backwards compatible - can be called with:
 * - (cleaner, jobs) - old pattern
 * - (tenant, cleaner, jobs) - new pattern
 */
export async function sendDailySchedule(
  tenantOrCleaner: Tenant | CleanerInfo,
  cleanerOrJobs: CleanerInfo | Array<JobInfo & { customer?: CustomerInfo | null }>,
  jobsOrUndefined?: Array<JobInfo & { customer?: CustomerInfo | null }>
): Promise<SendMessageResult> {
  // Detect if called with tenant or without (backwards compat)
  let tenant: Tenant | null
  let cleaner: CleanerInfo
  let jobs: Array<JobInfo & { customer?: CustomerInfo | null }>

  if ('slug' in tenantOrCleaner) {
    // New calling pattern: (tenant, cleaner, jobs)
    tenant = tenantOrCleaner as Tenant
    cleaner = cleanerOrJobs as CleanerInfo
    jobs = jobsOrUndefined || []
  } else {
    // Old calling pattern: (cleaner, jobs)
    tenant = null
    cleaner = tenantOrCleaner as CleanerInfo
    jobs = cleanerOrJobs as Array<JobInfo & { customer?: CustomerInfo | null }>
  }

  if (!cleaner.telegram_id) {
    return { success: false, error: 'Cleaner has no Telegram ID configured' }
  }

  if (jobs.length === 0) {
    const message = `
<b>Good morning, ${cleaner.name}!</b>

You have no jobs scheduled for today. Enjoy your day off!
`.trim()

    if (tenant) {
      return await sendTelegramMessage(tenant, cleaner.telegram_id, message)
    } else {
      return await sendTelegramMessage(cleaner.telegram_id, message)
    }
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
    const serviceType = job.service_type ? humanizeText(job.service_type) : 'Standard cleaning'
    const isWindowCleaning = tenant?.slug === 'winbros'

    // WinBros doesn't need bedrooms/bathrooms — it's a window cleaning company
    const propertyLine = isWindowCleaning
      ? ''
      : `- ${job.customer?.bedrooms ?? job.bedrooms ?? '?'}BR / ${job.customer?.bathrooms ?? job.bathrooms ?? '?'}BA\n`

    return `
<b>${index + 1}. ${time}</b>
- ${address}
- ${customerName}
${propertyLine}${serviceType}
${safeNotes ? `- ${safeNotes}` : ''}
`.trim()
  }).join('\n\n')

  const message = `
<b>Good morning, ${cleaner.name}!</b>

Here's your schedule for today (${jobs.length} job${jobs.length > 1 ? 's' : ''}):

${jobsList}

Have a great day!
`.trim()

  if (tenant) {
    return await sendTelegramMessage(tenant, cleaner.telegram_id, message)
  } else {
    return await sendTelegramMessage(cleaner.telegram_id, message)
  }
}

/**
 * Send a job reminder notification to a cleaner
 * Backwards compatible - can be called with:
 * - (cleaner, job, customer, reminderType) - old pattern
 * - (tenant, cleaner, job, customer, reminderType) - new pattern
 */
export async function sendJobReminder(
  tenantOrCleaner: Tenant | CleanerInfo,
  cleanerOrJob: CleanerInfo | JobInfo,
  jobOrCustomer: JobInfo | CustomerInfo | undefined,
  customerOrType: CustomerInfo | undefined | 'one_hour_before' | 'job_start',
  reminderTypeOrUndefined?: 'one_hour_before' | 'job_start'
): Promise<SendMessageResult> {
  // Detect if called with tenant or without (backwards compat)
  let tenant: Tenant | null
  let cleaner: CleanerInfo
  let job: JobInfo
  let customer: CustomerInfo | undefined
  let reminderType: 'one_hour_before' | 'job_start'

  if ('slug' in tenantOrCleaner) {
    // New calling pattern: (tenant, cleaner, job, customer, reminderType)
    tenant = tenantOrCleaner as Tenant
    cleaner = cleanerOrJob as CleanerInfo
    job = jobOrCustomer as JobInfo
    customer = customerOrType as CustomerInfo | undefined
    reminderType = reminderTypeOrUndefined || 'job_start'
  } else {
    // Old calling pattern: (cleaner, job, customer, reminderType)
    tenant = null
    cleaner = tenantOrCleaner as CleanerInfo
    job = cleanerOrJob as JobInfo
    customer = jobOrCustomer as CustomerInfo | undefined
    reminderType = (customerOrType as 'one_hour_before' | 'job_start') || 'job_start'
  }

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
<b>Reminder: Job starting in 1 hour</b>

${dateStr} at ${timeStr}
${address}
${customerName}

Get ready to head out soon!
`.trim()
  } else {
    message = `
<b>Job Starting Now!</b>

${dateStr} at ${timeStr}
${address}
${customerName}

Time to start the job. Good luck!
`.trim()
  }

  if (tenant) {
    return await sendTelegramMessage(tenant, cleaner.telegram_id, message)
  } else {
    return await sendTelegramMessage(cleaner.telegram_id, message)
  }
}

/**
 * Notify cleaner of a job cancellation
 * Backwards compatible - can be called with:
 * - (cleaner, job) - old pattern
 * - (tenant, cleaner, job) - new pattern
 */
export async function notifyJobCancellation(
  tenantOrCleaner: Tenant | CleanerInfo,
  cleanerOrJob: CleanerInfo | JobInfo,
  jobOrUndefined?: JobInfo
): Promise<SendMessageResult> {
  // Detect if called with tenant or without (backwards compat)
  let tenant: Tenant | null
  let cleaner: CleanerInfo
  let job: JobInfo

  if ('slug' in tenantOrCleaner) {
    // New calling pattern: (tenant, cleaner, job)
    tenant = tenantOrCleaner as Tenant
    cleaner = cleanerOrJob as CleanerInfo
    job = jobOrUndefined as JobInfo
  } else {
    // Old calling pattern: (cleaner, job)
    tenant = null
    cleaner = tenantOrCleaner as CleanerInfo
    job = cleanerOrJob as JobInfo
  }

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

  if (tenant) {
    return await sendTelegramMessage(tenant, cleaner.telegram_id, message)
  } else {
    return await sendTelegramMessage(cleaner.telegram_id, message)
  }
}

/**
 * Notify cleaner of a schedule change
 * Backwards compatible - can be called with:
 * - (cleaner, job, oldDate, oldTime) - old pattern
 * - (tenant, cleaner, job, oldDate, oldTime) - new pattern
 */
export async function notifyScheduleChange(
  tenantOrCleaner: Tenant | CleanerInfo,
  cleanerOrJob: CleanerInfo | JobInfo,
  jobOrOldDate: JobInfo | string,
  oldDateOrOldTime?: string,
  oldTimeOrUndefined?: string
): Promise<SendMessageResult> {
  // Detect if called with tenant or without (backwards compat)
  let tenant: Tenant | null
  let cleaner: CleanerInfo
  let job: JobInfo
  let oldDate: string
  let oldTime: string

  if ('slug' in tenantOrCleaner) {
    // New calling pattern: (tenant, cleaner, job, oldDate, oldTime)
    tenant = tenantOrCleaner as Tenant
    cleaner = cleanerOrJob as CleanerInfo
    job = jobOrOldDate as JobInfo
    oldDate = oldDateOrOldTime || ''
    oldTime = oldTimeOrUndefined || ''
  } else {
    // Old calling pattern: (cleaner, job, oldDate, oldTime)
    tenant = null
    cleaner = tenantOrCleaner as CleanerInfo
    job = cleanerOrJob as JobInfo
    oldDate = (jobOrOldDate as string) || ''
    oldTime = oldDateOrOldTime || ''
  }

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

  if (tenant) {
    return await sendTelegramMessage(tenant, cleaner.telegram_id, message)
  } else {
    return await sendTelegramMessage(cleaner.telegram_id, message)
  }
}

export type JobChange = {
  field: 'address' | 'bedrooms' | 'bathrooms' | 'square_footage' | 'date' | 'scheduled_at' | 'notes'
  oldValue: string | number | null
  newValue: string | number | null
}

/**
 * Notify cleaner of job details changes
 * Backwards compatible - can be called with:
 * - (cleaner, job, changes) - old pattern
 * - (tenant, cleaner, job, changes) - new pattern
 */
export async function notifyJobDetailsChange(
  tenantOrCleaner: Tenant | CleanerInfo,
  cleanerOrJob: CleanerInfo | JobInfo,
  jobOrChanges: JobInfo | JobChange[],
  changesOrUndefined?: JobChange[]
): Promise<SendMessageResult> {
  // Detect if called with tenant or without (backwards compat)
  // A Tenant has 'slug', a CleanerInfo doesn't
  let tenant: Tenant | null
  let cleaner: CleanerInfo
  let job: JobInfo
  let changes: JobChange[]

  if ('slug' in tenantOrCleaner) {
    // New calling pattern: (tenant, cleaner, job, changes)
    tenant = tenantOrCleaner as Tenant
    cleaner = cleanerOrJob as CleanerInfo
    job = jobOrChanges as JobInfo
    changes = changesOrUndefined || []
  } else {
    // Old calling pattern: (cleaner, job, changes)
    tenant = null
    cleaner = tenantOrCleaner as CleanerInfo
    job = cleanerOrJob as JobInfo
    changes = (jobOrChanges as JobChange[]) || []
  }

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
      return `- ${capitalizedField}: ${oldDateStr} -> ${newDateStr}`
    }

    if (change.field === 'scheduled_at') {
      const oldTime = formatCleanerTime(String(change.oldValue || ''))
      const newTime = formatCleanerTime(String(change.newValue || ''))
      return `- Time: ${oldTime} -> ${newTime}`
    }

    if (change.field === 'address') {
      return `- ${capitalizedField} changed to: ${change.newValue || 'N/A'}`
    }

    return `- ${capitalizedField}: ${change.oldValue || 'N/A'} -> ${change.newValue || 'N/A'}`
  })

  const message = `
<b>Job Update</b>

Your job on ${jobDateStr} has been updated:

${changeLines.join('\n')}

Please review the updated details.
`.trim()

  // Call sendTelegramMessage - use old pattern if no tenant
  if (tenant) {
    return await sendTelegramMessage(tenant, cleaner.telegram_id, message)
  } else {
    // Backwards compatible: call with just chatId, text
    return await sendTelegramMessage(cleaner.telegram_id, message)
  }
}

/**
 * Request cleaner confirmation for a reschedule
 */
export async function requestRescheduleConfirmation(
  tenant: Tenant,
  cleaner: CleanerInfo,
  job: JobInfo,
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

  return await sendTelegramMessage(tenant, cleaner.telegram_id, message, 'HTML', inlineKeyboard)
}

// Helper functions

function formatCleanerNotes(notes?: string | null): string {
  if (!notes) return ''

  const lines = notes
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const cleaned: string[] = []

  for (const line of lines) {
    const lower = line.toLowerCase()
    // Skip internal/payment related notes
    if (
      lower.startsWith('hours:') ||
      lower.startsWith('pay:') ||
      lower.startsWith('payment:') ||
      lower.startsWith('override:') ||
      lower.includes('invoice_url') ||
      lower.includes('@')  // Skip emails
    ) {
      continue
    }

    cleaned.push(humanizeText(line))
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
