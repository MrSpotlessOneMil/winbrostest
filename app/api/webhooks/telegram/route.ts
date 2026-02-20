import { NextRequest, NextResponse } from "next/server"
import type { ApiResponse, Tip, Upsell } from "@/lib/types"
import {
  getSupabaseServiceClient,
  getJobById,
  getCustomerByPhone,
  getCleanerById,
  getCleanerAssignmentById,
  updateCleanerAssignment,
  updateJob,
} from "@/lib/supabase"
import { answerCallbackQuery, sendTelegramMessage, logTelegramMessage } from "@/lib/telegram"
import { assignNextAvailableCleaner } from "@/lib/cleaner-assignment"
import { sendSMS } from "@/lib/openphone"
import { cleanerAssigned, noCleanersAvailable } from "@/lib/sms-templates"
import { logSystemEvent } from "@/lib/system-events"
import { getDefaultTenant } from "@/lib/tenant"
import { geocodeAddress } from "@/lib/google-maps"
import { distributeTip } from "@/lib/tips"
import { recordReviewReceived } from "@/lib/crew-performance"
import Anthropic from "@anthropic-ai/sdk"

/**
 * Webhook handler for Telegram bot messages and callback queries
 *
 * Handles:
 * - NEW CLEANER ONBOARDING - Cleaners can register via Telegram
 * - Team job confirmations
 * - Tip reports
 * - Upsell reports
 * - Team availability updates
 * - Cleaner accept/decline callbacks from inline keyboard buttons
 * - TEAM LEAD COMMANDS - /team, /leaderboard, /briefing
 *
 * Callback Data Formats:
 * - accept:{jobId}:{assignmentId} - Cleaner accepts job assignment
 * - decline:{jobId}:{assignmentId} - Cleaner declines job assignment
 */

// Day code constants for availability
const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
const DAY_LABELS: Record<string, string> = {
  MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday',
  FR: 'Friday', SA: 'Saturday', SU: 'Sunday'
}

/**
 * Parse a natural-language days input into day codes.
 * Handles: "mon-fri", "weekdays", "every day", "mon, wed, fri", etc.
 */
function parseDaysInput(text: string): string[] | null {
  const lower = text.toLowerCase().trim()

  if (/every\s*day|all\s*days|any\s*day|7\s*days/i.test(lower)) {
    return [...DAY_CODES]
  }
  if (/weekdays|mon\s*-\s*fri|monday\s*-\s*friday|m\s*-\s*f/i.test(lower)) {
    return ['MO', 'TU', 'WE', 'TH', 'FR']
  }
  if (/weekends?/i.test(lower)) {
    return ['SA', 'SU']
  }

  // Handle ranges like "mon-sat", "tue-fri"
  const rangeMatch = lower.match(/^(mon|tue|wed|thu|fri|sat|sun)\w*\s*[-–to]+\s*(mon|tue|wed|thu|fri|sat|sun)\w*$/i)
  if (rangeMatch) {
    const dayOrder = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
    const codeOrder = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
    const startIdx = dayOrder.findIndex(d => rangeMatch[1].toLowerCase().startsWith(d))
    const endIdx = dayOrder.findIndex(d => rangeMatch[2].toLowerCase().startsWith(d))
    if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
      return codeOrder.slice(startIdx, endIdx + 1)
    }
  }

  // Handle comma/space-separated days like "mon, wed, fri"
  const dayMap: Record<string, string> = {
    mon: 'MO', monday: 'MO', mo: 'MO',
    tue: 'TU', tuesday: 'TU', tu: 'TU', tues: 'TU',
    wed: 'WE', wednesday: 'WE', we: 'WE',
    thu: 'TH', thursday: 'TH', th: 'TH', thur: 'TH', thurs: 'TH',
    fri: 'FR', friday: 'FR', fr: 'FR',
    sat: 'SA', saturday: 'SA', sa: 'SA',
    sun: 'SU', sunday: 'SU', su: 'SU',
  }

  const tokens = lower.split(/[\s,&+]+/).filter(Boolean)
  const days: string[] = []
  for (const token of tokens) {
    const code = dayMap[token]
    if (code && !days.includes(code)) days.push(code)
  }

  if (days.length > 0) {
    days.sort((a, b) => DAY_CODES.indexOf(a as any) - DAY_CODES.indexOf(b as any))
    return days
  }
  return null
}

/**
 * Parse a time string like "8am", "8:00 AM", "17:00", "5pm" into "HH:MM" 24hr format.
 */
function parseTimeInput(text: string): string | null {
  const lower = text.toLowerCase().trim()
  const match = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!match) return null

  let hours = parseInt(match[1])
  const minutes = match[2] ? parseInt(match[2]) : 0
  const period = match[3]

  if (period === 'pm' && hours < 12) hours += 12
  if (period === 'am' && hours === 12) hours = 0
  if (!period && hours <= 12 && hours >= 1) return null // Ambiguous without am/pm
  if (hours > 23 || minutes > 59) return null

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/**
 * Parse a time range like "8am-5pm", "8:00 AM - 5:00 PM", "9am to 5pm"
 */
function parseTimeRange(text: string): [string, string] | null {
  const rangeMatch = text.match(/^(.+?)[\s]*[-–to]+[\s]*(.+)$/i)
  if (rangeMatch) {
    const start = parseTimeInput(rangeMatch[1].trim())
    const end = parseTimeInput(rangeMatch[2].trim())
    if (start && end) return [start, end]
  }
  return null
}

/** Format "HH:MM" to "8:00 AM" style */
function formatTime12h(time24: string): string {
  const [h, m] = time24.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// Onboarding state helpers - stored in Supabase system_events for serverless compatibility
interface OnboardingState {
  step: 'name' | 'phone' | 'address' | 'days' | 'hours' | 'confirm'
  data: {
    name?: string
    phone?: string
    home_address?: string
    availableDays?: string[]
    startTime?: string
    endTime?: string
  }
  startedAt: number
}

async function getOnboardingState(chatId: string): Promise<OnboardingState | null> {
  const client = getSupabaseServiceClient()
  const { data } = await client
    .from('system_events')
    .select('metadata')
    .eq('event_type', 'TELEGRAM_ONBOARDING')
    .eq('source', 'telegram')
    .eq('metadata->>chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data?.metadata) return null
  const meta = data.metadata as Record<string, unknown>
  const state = meta.onboarding_state as OnboardingState | undefined
  if (!state) return null
  // Timeout: 30 minutes
  if (Date.now() - state.startedAt > 30 * 60 * 1000) {
    await deleteOnboardingState(chatId)
    return null
  }
  return state
}

async function setOnboardingState(chatId: string, state: OnboardingState): Promise<void> {
  const client = getSupabaseServiceClient()
  // Delete any existing onboarding state for this chat
  await client
    .from('system_events')
    .delete()
    .eq('event_type', 'TELEGRAM_ONBOARDING')
    .eq('source', 'telegram')
    .eq('metadata->>chat_id', chatId)
  // Insert new state
  await client.from('system_events').insert({
    event_type: 'TELEGRAM_ONBOARDING',
    source: 'telegram',
    message: `Onboarding step: ${state.step}`,
    metadata: { chat_id: chatId, onboarding_state: state },
    created_at: new Date().toISOString(),
  })
}

async function deleteOnboardingState(chatId: string): Promise<void> {
  const client = getSupabaseServiceClient()
  await client
    .from('system_events')
    .delete()
    .eq('event_type', 'TELEGRAM_ONBOARDING')
    .eq('source', 'telegram')
    .eq('metadata->>chat_id', chatId)
}

interface TelegramMessage {
  message_id: number
  from: {
    id: number
    username?: string
    first_name: string
  }
  chat: {
    id: number
    type: string
  }
  text?: string
  date: number
}

interface TelegramCallbackQuery {
  id: string
  from: {
    id: number
    username?: string
    first_name: string
  }
  message?: TelegramMessage
  chat_instance: string
  data?: string
}

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

// Regex patterns for parsing team messages
const TIP_PATTERN = /tip\s+(?:accepted\s+)?job\s+(\d+)\s*[-–]\s*\$?(\d+(?:\.\d{2})?)/i
const UPSELL_PATTERN = /upsold?\s+job\s+(\d+)\s*[-–]\s*(.+)/i
const CONFIRM_PATTERN = /confirm\s+job\s+(\d+)/i
const REVIEW_PATTERN = /^(?:review|google\s+review)\s+job\s+(\d+)$/i

// Patterns for new cleaner onboarding (handles smart quotes, curly apostrophes, etc.)
const JOIN_PATTERNS = [
  /^(join|register|sign\s*up)/i,
  /^new\s+cleaner/i,
  /i[''`"']m\s+a\s+(new\s+)?cleaner/i,
  /i\s+am\s+a\s+(new\s+)?cleaner/i,
  /^i\s+want\s+to\s+(join|work|clean)/i,
  /^(onboard|enroll)/i,
  /new\s+(here|employee|hire|team\s*member)/i,
  /how\s+(do\s+i|can\s+i|to)\s+(join|register|sign\s*up)/i,
]

// Phone number validation
const PHONE_PATTERN = /^[\d\s\-\(\)\+]{10,}$/

// Owner/ops Telegram chat ID for escalations
const OWNER_TELEGRAM_CHAT_ID = process.env.OWNER_TELEGRAM_CHAT_ID
const OWNER_PHONE = process.env.OWNER_PHONE

/**
 * Handle callback queries from inline keyboard buttons
 * Supports accept/decline callbacks for cleaner job assignments
 */
async function handleCallbackQuery(callbackQuery: TelegramCallbackQuery): Promise<NextResponse> {
  const { id: callbackQueryId, from, data: callbackData, message } = callbackQuery
  const telegramUserId = from.id.toString()
  const chatId = message?.chat.id.toString() || telegramUserId

  console.log(`[OSIRIS] Callback query from ${from.username || from.first_name}: ${callbackData}`)

  if (!callbackData) {
    await answerCallbackQuery(callbackQueryId, "Invalid callback data")
    return NextResponse.json({ success: true, action: "invalid_callback" })
  }

  // Parse callback data format: action:jobId:assignmentId
  const parts = callbackData.split(":")
  if (parts.length < 3) {
    await answerCallbackQuery(callbackQueryId, "Invalid callback format")
    return NextResponse.json({ success: true, action: "invalid_callback_format" })
  }

  const [action, jobId, assignmentId] = parts

  // Handle accept callback
  if (action === "accept") {
    return await handleAcceptCallback(callbackQueryId, chatId, telegramUserId, jobId, assignmentId)
  }

  // Handle decline callback
  if (action === "decline") {
    return await handleDeclineCallback(callbackQueryId, chatId, telegramUserId, jobId, assignmentId)
  }

  // Unknown action
  await answerCallbackQuery(callbackQueryId, "Unknown action")
  return NextResponse.json({ success: true, action: "unknown_callback_action" })
}

/**
 * Handle cleaner accepting a job assignment
 */
async function handleAcceptCallback(
  callbackQueryId: string,
  chatId: string,
  telegramUserId: string,
  jobId: string,
  assignmentId: string
): Promise<NextResponse> {
  try {
    // 1. Answer the callback query immediately
    await answerCallbackQuery(callbackQueryId, "Processing your acceptance...")

    // 2. Fetch the assignment and validate
    const assignment = await getCleanerAssignmentById(assignmentId)
    if (!assignment) {
      await sendTelegramMessage(chatId, "Sorry, this assignment could not be found.")
      return NextResponse.json({ success: false, error: "Assignment not found" })
    }

    // Check if assignment is still pending
    if (assignment.status !== "pending") {
      await sendTelegramMessage(chatId, `This job has already been ${assignment.status}.`)
      return NextResponse.json({ success: true, action: "assignment_already_processed" })
    }

    // 3. Fetch the job
    const job = await getJobById(jobId)
    if (!job) {
      await sendTelegramMessage(chatId, "Sorry, this job could not be found.")
      return NextResponse.json({ success: false, error: "Job not found" })
    }

    // 4. Update assignment status to 'confirmed'
    const updatedAssignment = await updateCleanerAssignment(assignmentId, "confirmed")
    if (!updatedAssignment) {
      await sendTelegramMessage(chatId, "Failed to update assignment. Please try again.")
      return NextResponse.json({ success: false, error: "Failed to update assignment" })
    }

    // 5. Update job status to assigned + cleaner_confirmed
    await updateJob(jobId, { cleaner_confirmed: true, status: 'assigned' } as Record<string, unknown>)

    // 6. Get customer info and send notification SMS
    let customerNotified = false
    if (job.phone_number) {
      const customer = await getCustomerByPhone(job.phone_number)
      const cleaner = await getCleanerById(assignment.cleaner_id)

      if (customer && cleaner) {
        const dateStr = job.date
          ? new Date(job.date + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })
          : "your scheduled date"

        const timeStr = job.scheduled_at || "your scheduled time"
        const cleanerPhone = cleaner.phone || "our office number"

        const smsMessage = cleanerAssigned(
          customer.first_name || "there",
          cleaner.name,
          cleanerPhone,
          dateStr,
          timeStr
        )

        const smsResult = await sendSMS(job.phone_number, smsMessage)
        customerNotified = smsResult.success

        // 7. Update job.customer_notified = true
        if (customerNotified) {
          await updateJob(jobId, { customer_notified: true } as Record<string, unknown>)

          // Log the outbound message to the database
          const tenant = await getDefaultTenant()
          if (tenant) {
            const client = getSupabaseServiceClient()
            client.from("messages").insert({
              tenant_id: tenant.id,
              customer_id: customer.id || null,
              phone_number: job.phone_number,
              role: "assistant",
              content: smsMessage,
              direction: "outbound",
              message_type: "sms",
              ai_generated: false,
              source: "cleaner_assigned",
              job_id: Number(jobId),
              timestamp: new Date().toISOString(),
            }).then(({ error: logErr }) => {
              if (logErr) console.error("[Telegram] Failed to log cleaner-assigned SMS:", logErr)
            })
          }
        }
      }
    }

    // 8. Send confirmation message to cleaner
    const confirmationMessage = `
<b>Job Accepted!</b>

You have been assigned to this job. The customer has been notified.

Please make sure to:
- Arrive on time
- Bring all necessary supplies
- Contact us if you have any issues

Thank you!
`.trim()

    await sendTelegramMessage(chatId, confirmationMessage)

    // 9. Log system event
    await logSystemEvent({
      source: "telegram",
      event_type: "CLEANER_ACCEPTED",
      message: `Cleaner accepted job ${jobId} via Telegram callback`,
      job_id: jobId,
      cleaner_id: assignment.cleaner_id,
      phone_number: job.phone_number,
      metadata: {
        assignment_id: assignmentId,
        telegram_user_id: telegramUserId,
        customer_notified: customerNotified,
      },
    })

    console.log(`[OSIRIS] Cleaner accepted job ${jobId}, assignment ${assignmentId}`)

    return NextResponse.json({
      success: true,
      action: "cleaner_accepted",
      job_id: jobId,
      assignment_id: assignmentId,
    })
  } catch (error) {
    console.error("[OSIRIS] Error handling accept callback:", error)
    await sendTelegramMessage(chatId, "An error occurred. Please try again or contact support.")
    return NextResponse.json({ success: false, error: "Accept callback processing failed" }, { status: 500 })
  }
}

/**
 * Handle cleaner declining a job assignment
 */
async function handleDeclineCallback(
  callbackQueryId: string,
  chatId: string,
  telegramUserId: string,
  jobId: string,
  assignmentId: string
): Promise<NextResponse> {
  try {
    // 1. Answer the callback query immediately
    await answerCallbackQuery(callbackQueryId, "Processing your response...")

    // 2. Fetch the assignment and validate
    const assignment = await getCleanerAssignmentById(assignmentId)
    if (!assignment) {
      await sendTelegramMessage(chatId, "Sorry, this assignment could not be found.")
      return NextResponse.json({ success: false, error: "Assignment not found" })
    }

    // Check if assignment is still pending
    if (assignment.status !== "pending") {
      await sendTelegramMessage(chatId, `This job has already been ${assignment.status}.`)
      return NextResponse.json({ success: true, action: "assignment_already_processed" })
    }

    // 3. Fetch the job
    const job = await getJobById(jobId)
    if (!job) {
      await sendTelegramMessage(chatId, "Sorry, this job could not be found.")
      return NextResponse.json({ success: false, error: "Job not found" })
    }

    // 4. Update assignment status to 'declined'
    const updatedAssignment = await updateCleanerAssignment(assignmentId, "declined")
    if (!updatedAssignment) {
      await sendTelegramMessage(chatId, "Failed to update assignment. Please try again.")
      return NextResponse.json({ success: false, error: "Failed to update assignment" })
    }

    // 5. Send acknowledgment to cleaner
    await sendTelegramMessage(chatId, "No problem! We'll find another cleaner for this job.")

    // 6. Try to assign next available cleaner (excluding the declined cleaner)
    const assignResult = await assignNextAvailableCleaner(jobId, [assignment.cleaner_id])

    // 7. If exhausted (no more cleaners available)
    if (!assignResult.success && assignResult.exhausted) {
      // Send SMS to customer
      if (job.phone_number) {
        const customer = await getCustomerByPhone(job.phone_number)
        const dateStr = job.date
          ? new Date(job.date + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })
          : "your requested date"

        const smsMessage = noCleanersAvailable(customer?.first_name || "there", dateStr)
        await sendSMS(job.phone_number, smsMessage)
      }

      // Send escalation to owner - try Telegram first, fall back to SMS
      const escalationText = `URGENT: No Cleaners Available\n\nJob ID: ${jobId}\nDate: ${job.date || "N/A"}\nTime: ${job.scheduled_at || "N/A"}\nAddress: ${job.address || "N/A"}\nCustomer Phone: ${job.phone_number || "N/A"}\n\nAll available cleaners have declined. Manual assignment required.`

      if (OWNER_TELEGRAM_CHAT_ID) {
        const escalationMessage = `
<b>URGENT: No Cleaners Available</b>

Job ID: ${jobId}
Date: ${job.date || "N/A"}
Time: ${job.scheduled_at || "N/A"}
Address: ${job.address || "N/A"}
Customer Phone: ${job.phone_number || "N/A"}

All available cleaners have declined or are unavailable. Manual assignment required.
`.trim()

        await sendTelegramMessage(OWNER_TELEGRAM_CHAT_ID, escalationMessage)
      } else if (OWNER_PHONE) {
        // Fallback: send SMS to owner phone
        await sendSMS(OWNER_PHONE, escalationText)
        console.log("[OSIRIS] Escalation sent via SMS to owner (no Telegram chat ID configured)")
      } else {
        console.error("[OSIRIS] No escalation channel configured - set OWNER_TELEGRAM_CHAT_ID or OWNER_PHONE")
      }

      // Log escalation event
      await logSystemEvent({
        source: "telegram",
        event_type: "OWNER_ACTION_REQUIRED",
        message: `No cleaners available for job ${jobId} - all declined or unavailable`,
        job_id: jobId,
        phone_number: job.phone_number,
        metadata: {
          reason: "cleaner_assignment_exhausted",
          last_declined_cleaner_id: assignment.cleaner_id,
        },
      })
    }

    // 8. Log system event for decline
    await logSystemEvent({
      source: "telegram",
      event_type: "CLEANER_DECLINED",
      message: `Cleaner declined job ${jobId} via Telegram callback`,
      job_id: jobId,
      cleaner_id: assignment.cleaner_id,
      phone_number: job.phone_number,
      metadata: {
        assignment_id: assignmentId,
        telegram_user_id: telegramUserId,
        next_cleaner_assigned: assignResult.success,
        exhausted: assignResult.exhausted || false,
      },
    })

    console.log(`[OSIRIS] Cleaner declined job ${jobId}, assignment ${assignmentId}, exhausted: ${assignResult.exhausted}`)

    return NextResponse.json({
      success: true,
      action: "cleaner_declined",
      job_id: jobId,
      assignment_id: assignmentId,
      next_cleaner_assigned: assignResult.success,
      exhausted: assignResult.exhausted,
    })
  } catch (error) {
    console.error("[OSIRIS] Error handling decline callback:", error)
    await sendTelegramMessage(chatId, "An error occurred. Please try again or contact support.")
    return NextResponse.json({ success: false, error: "Decline callback processing failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const update: TelegramUpdate = await request.json()

    // Handle callback queries from inline keyboard buttons
    if (update.callback_query) {
      return await handleCallbackQuery(update.callback_query)
    }

    if (!update.message?.text) {
      return NextResponse.json({ success: true })
    }

    const { text, from, chat } = update.message
    const telegramUserId = from.id.toString()
    const chatId = chat.id.toString()

    console.log(`[OSIRIS] Telegram message from ${from.username || from.first_name} (telegram_id=${telegramUserId}, chat_id=${chatId}): "${text}"`)

    // Log inbound message to DB (fire-and-forget)
    logTelegramMessage({
      telegramChatId: chatId,
      direction: 'inbound',
      content: text,
      source: 'telegram_webhook',
      messageId: update.message.message_id,
    }).catch(() => {})

    // Handle /start command - different response based on context
    if (text.toLowerCase() === "/start") {
      await sendTelegramMessage(
        chatId,
        `<b>Welcome to the Cleaning Team Bot!</b>

<b>For New Cleaners:</b>
Send "join" or "I'm a new cleaner" to register.

<b>For Existing Cleaners:</b>
• Report tips: "tip job 123 - $20"
• Report upsells: "upsell job 123 - deep clean"
• Accept/decline jobs via buttons

<b>For Team Leads:</b>
• /team - View your team
• /leaderboard - View performance
• /briefing - Get daily briefing

<b>Your Chat ID:</b> <code>${chatId}</code>`
      )
      return NextResponse.json({ success: true, action: "start_sent", chat_id: chatId })
    }

    // Handle /myid command
    if (text.toLowerCase() === "/myid") {
      await sendTelegramMessage(
        chatId,
        `Your Telegram Chat ID is: <code>${chatId}</code>\n\nProvide this to your manager to complete your registration.`
      )
      return NextResponse.json({ success: true, action: "chat_id_sent", chat_id: chatId })
    }

    const client = getSupabaseServiceClient()

    // Check if user is in onboarding flow (stored in DB, not memory)
    const onboardingState = await getOnboardingState(chatId)
    if (onboardingState) {
      return await handleOnboardingStep(chatId, telegramUserId, from, text, onboardingState)
    }

    // Check if this is a new cleaner trying to join
    const isJoinRequest = JOIN_PATTERNS.some(pattern => pattern.test(text))
    if (isJoinRequest) {
      // Check if they're already registered (only active, non-deleted cleaners)
      // Use .limit(1) — same telegram_id can exist across multiple tenants
      const { data: existingCleanerRows } = await client
        .from("cleaners")
        .select("id, name")
        .eq("telegram_id", telegramUserId)
        .eq("active", true)
        .is("deleted_at", null)
        .limit(1)
      const existingCleaner = existingCleanerRows?.[0] || null

      if (existingCleaner) {
        await sendTelegramMessage(
          chatId,
          `<b>You're already registered!</b>\n\nHi ${existingCleaner.name}, you're already in our system. You'll receive job notifications here.\n\nNeed help? Contact your team lead.`
        )
        return NextResponse.json({ success: true, action: "already_registered" })
      }

      // Start onboarding flow (persisted to DB for serverless)
      await setOnboardingState(chatId, {
        step: 'name',
        data: {},
        startedAt: Date.now()
      })

      await sendTelegramMessage(
        chatId,
        `<b>Welcome to the team!</b> 🎉\n\nLet's get you set up. I'll need a few details.\n\n<b>Step 1/5:</b> What's your full name?`
      )
      return NextResponse.json({ success: true, action: "onboarding_started" })
    }

    // Best-effort lookup: map telegram user to cleaner by telegram_id
    // Use .limit(1) instead of .maybeSingle() because the same telegram_id
    // can exist across multiple tenants, and maybeSingle() errors on >1 row
    const { data: cleanerRows, error: cleanerLookupError } = await client
      .from("cleaners")
      .select("id,name,active,is_team_lead,phone,email")
      .eq("telegram_id", telegramUserId)
      .eq("active", true)
      .limit(1)
    const cleaner = cleanerRows?.[0] || null

    if (cleanerLookupError) {
      console.error(`[OSIRIS] Cleaner lookup FAILED for telegram_id=${telegramUserId}:`, cleanerLookupError)
    } else if (cleaner) {
      console.log(`[OSIRIS] Cleaner found: id=${cleaner.id}, name=${cleaner.name}, active=${cleaner.active}`)
    } else {
      console.log(`[OSIRIS] No cleaner found for telegram_id=${telegramUserId} — user is NOT registered`)
    }

    let teamId: number | null = null
    if (cleaner?.id != null) {
      const { data: tm } = await client
        .from("team_members")
        .select("team_id, role, is_active")
        .eq("cleaner_id", cleaner.id)
        .eq("is_active", true)
        .maybeSingle()
      if (tm?.team_id != null) teamId = Number(tm.team_id)
    }

    // Handle team lead commands
    if (text.toLowerCase() === "/team" && cleaner?.is_team_lead) {
      return await handleTeamCommand(chatId, cleaner, client)
    }

    if (text.toLowerCase() === "/leaderboard" && cleaner?.is_team_lead) {
      return await handleLeaderboardCommand(chatId, cleaner, client)
    }

    if (text.toLowerCase() === "/briefing" && cleaner?.is_team_lead) {
      return await handleBriefingCommand(chatId, cleaner, client)
    }

    // Parse review confirmation from team leads: "review job 123"
    const reviewMatch = text.match(REVIEW_PATTERN)
    if (reviewMatch) {
      if (!cleaner?.is_team_lead) {
        await sendTelegramMessage(chatId, `Review confirmation is only available to team leads.`)
        return NextResponse.json({ success: true, action: "not_team_lead" })
      }

      const reviewJobId = Number(reviewMatch[1])
      const { data: reviewJob } = await client
        .from("jobs")
        .select("id, phone_number, team_id")
        .eq("id", reviewJobId)
        .single()

      if (!reviewJob?.phone_number) {
        await sendTelegramMessage(chatId, `❌ Job #${reviewJobId} not found or has no customer phone. Check the job ID and try again.`)
        return NextResponse.json({ success: false, error: "Job not found" })
      }

      const reviewResult = await recordReviewReceived(reviewJob.phone_number, 5)

      if (!reviewResult.success) {
        // No attribution found — still record directly
        await sendTelegramMessage(chatId, `⚠️ Review logged for Job #${reviewJobId}, but no follow-up attribution was found for this customer. The $10 credit may need to be applied manually.`)
        return NextResponse.json({ success: true, action: "review_logged_no_attribution" })
      }

      const bonusDollars = reviewResult.bonusCents ? (reviewResult.bonusCents / 100).toFixed(2) : "10.00"
      await sendTelegramMessage(chatId, `✅ Review confirmed for Job #${reviewJobId} — $${bonusDollars} credit added to the crew leaderboard.`)

      console.log(`[OSIRIS] Review confirmed by team lead for job ${reviewJobId}`)
      return NextResponse.json({ success: true, action: "review_confirmed", job_id: reviewJobId })
    }

    // Non-team lead trying team lead commands
    if (["/team", "/leaderboard", "/briefing"].includes(text.toLowerCase()) && !cleaner?.is_team_lead) {
      await sendTelegramMessage(
        chatId,
        `This command is only available to team leads. Contact your manager if you believe this is an error.`
      )
      return NextResponse.json({ success: true, action: "not_team_lead" })
    }

    // Parse tip report
    const tipMatch = text.match(TIP_PATTERN)
    if (tipMatch) {
      const [, jobId, amount] = tipMatch
      const numericJobId = Number(jobId)
      const tipAmount = parseFloat(amount)

      if (!Number.isFinite(numericJobId) || !Number.isFinite(tipAmount)) {
        await sendTelegramMessage(chatId, `Invalid tip format. Use: tip job 123 - $20`)
        return NextResponse.json({ success: false, error: "Invalid tip format" })
      }

      // Distribute tip equally among assigned cleaners
      const result = await distributeTip(
        numericJobId,
        tipAmount,
        teamId ?? null,
        "telegram",
        `telegram_chat_id=${chat.id}`
      )

      if (!result.success) {
        console.error("[OSIRIS] Failed to distribute tip:", result.error)
        return NextResponse.json({ success: false, error: "Failed to store tip" }, { status: 500 })
      }

      console.log(`[OSIRIS] Tip distributed: Job ${jobId}, Amount $${amount}, Split ${result.splitCount} way(s)`)

      const splitNote = result.splitCount > 1
        ? ` (split $${result.amountEach.toFixed(2)} each among ${result.splitCount} cleaners)`
        : ''

      await sendTelegramMessage(
        chatId,
        `<b>Tip Recorded!</b>\n\nJob #${jobId}: $${amount}${splitNote}\n\nThank you for reporting this tip.`
      )

      return NextResponse.json({ success: true, action: "tip_recorded", data: { job_id: jobId, amount: tipAmount, split_count: result.splitCount } })
    }

    // Parse upsell report
    const upsellMatch = text.match(UPSELL_PATTERN)
    if (upsellMatch) {
      const [, jobId, upsellType] = upsellMatch

      const numericJobId = Number(jobId)
      const { data: upsellRow, error: upsellErr } = await client.from("upsells").insert({
        job_id: Number.isFinite(numericJobId) ? numericJobId : null,
        team_id: teamId,
        cleaner_id: cleaner?.id ?? null,
        upsell_type: upsellType.trim(),
        value: 0,
        reported_via: "telegram",
        notes: `telegram_chat_id=${chat.id}`,
      }).select("*").single()
      if (upsellErr) {
        console.error("[OSIRIS] Failed to insert upsell:", upsellErr)
        return NextResponse.json({ success: false, error: "Failed to store upsell" }, { status: 500 })
      }

      const upsell: Partial<Upsell> = {
        job_id: `job-${jobId}`,
        upsell_type: upsellType.trim(),
        reported_via: "telegram",
        created_at: new Date().toISOString(),
      }

      console.log(`[OSIRIS] Upsell recorded: Job ${jobId}, Type: ${upsellType}`)

      // Send confirmation back to chat
      await sendTelegramMessage(
        chatId,
        `<b>Upsell Recorded!</b>\n\nJob #${jobId}: ${upsellType.trim()}\n\nGreat work on the upsell!`
      )

      return NextResponse.json({ success: true, action: "upsell_recorded", data: { ...upsell, db_id: upsellRow.id } })
    }

    // Parse job confirmation
    const confirmMatch = text.match(CONFIRM_PATTERN)
    if (confirmMatch) {
      const [, jobId] = confirmMatch

      // Mark job assigned to this cleaner's team (if we can resolve it)
      const numericJobId = Number(jobId)
      if (teamId != null && Number.isFinite(numericJobId)) {
        const { error: jobErr } = await client
          .from("jobs")
          .update({ team_id: teamId })
          .eq("id", numericJobId)
        if (jobErr) {
          console.error("[OSIRIS] Failed to assign team to job:", jobErr)
        }
      }

      console.log(`[OSIRIS] Job ${jobId} confirmed by team`)

      return NextResponse.json({ success: true, action: "job_confirmed", job_id: jobId })
    }

    // Unknown message format - use AI to provide helpful response
    console.log(`[OSIRIS] Unrecognized message — routing to AI. cleanerId=${cleaner?.id || 'NULL'}, cleanerName=${cleaner?.name || 'UNKNOWN'}, text="${text}"`)

    const aiResponse = await generateAIResponse(text, cleaner?.name || from.first_name, !!cleaner?.is_team_lead, cleaner?.id || null)
    console.log(`[OSIRIS] AI response generated: "${aiResponse.substring(0, 200)}"`)
    await sendTelegramMessage(chatId, aiResponse)

    return NextResponse.json({ success: true, action: "ai_response" })

  } catch (error) {
    console.error("[OSIRIS] Telegram webhook error:", error)
    return NextResponse.json(
      { success: false, error: "Webhook processing failed" },
      { status: 500 }
    )
  }
}

/**
 * Handle onboarding flow steps
 */
async function handleOnboardingStep(
  chatId: string,
  telegramUserId: string,
  from: { first_name: string; username?: string },
  text: string,
  state: OnboardingState
): Promise<NextResponse> {
  const client = getSupabaseServiceClient()

  // Handle cancel
  if (text.toLowerCase() === "cancel" || text.toLowerCase() === "/cancel") {
    await deleteOnboardingState(chatId)
    await sendTelegramMessage(
      chatId,
      `Registration cancelled. Send "join" anytime to start again.`
    )
    return NextResponse.json({ success: true, action: "onboarding_cancelled" })
  }

  switch (state.step) {
    case 'name':
      // Validate name (at least 2 characters, letters and spaces only)
      if (text.length < 2 || !/^[a-zA-Z\s]+$/.test(text)) {
        await sendTelegramMessage(
          chatId,
          `Please enter a valid name (letters only, at least 2 characters).`
        )
        return NextResponse.json({ success: true, action: "invalid_name" })
      }

      state.data.name = text.trim()
      state.step = 'phone'
      await setOnboardingState(chatId, state)

      await sendTelegramMessage(
        chatId,
        `<b>Step 2/5:</b> What's your phone number?\n\n(Format: 123-456-7890 or similar)`
      )
      return NextResponse.json({ success: true, action: "name_collected" })

    case 'phone':
      // Validate phone
      const cleanPhone = text.replace(/[\s\-\(\)]/g, '')
      if (!PHONE_PATTERN.test(text) || cleanPhone.length < 10) {
        await sendTelegramMessage(
          chatId,
          `Please enter a valid phone number (at least 10 digits).`
        )
        return NextResponse.json({ success: true, action: "invalid_phone" })
      }

      state.data.phone = cleanPhone.startsWith('+') ? cleanPhone : `+1${cleanPhone}`
      state.step = 'address'
      await setOnboardingState(chatId, state)

      await sendTelegramMessage(
        chatId,
        `<b>Step 3/5:</b> What's your home address?\n\nThis is where you'll be starting your day from. We use it to plan efficient routes.\n\n(e.g., "123 Main St, Cedar Rapids, IA 52401")`
      )
      return NextResponse.json({ success: true, action: "phone_collected" })

    case 'address':
      // Validate address has some substance
      if (text.trim().length < 5) {
        await sendTelegramMessage(
          chatId,
          `Please enter a valid street address (e.g., "123 Main St, Cedar Rapids, IA 52401").`
        )
        return NextResponse.json({ success: true, action: "invalid_address" })
      }

      state.data.home_address = text.trim()
      state.step = 'days'
      await setOnboardingState(chatId, state)

      await sendTelegramMessage(
        chatId,
        `<b>Step 4/5:</b> Which days are you available to work?\n\n` +
        `Examples:\n` +
        `• "Weekdays" (Mon-Fri)\n` +
        `• "Mon-Sat"\n` +
        `• "Mon, Wed, Fri"\n` +
        `• "Every day"`
      )
      return NextResponse.json({ success: true, action: "address_collected" })

    case 'days': {
      const parsedDays = parseDaysInput(text)
      if (!parsedDays || parsedDays.length === 0) {
        await sendTelegramMessage(
          chatId,
          `I couldn't understand that. Please enter your available days.\n\n` +
          `Examples: "Weekdays", "Mon-Fri", "Mon, Wed, Fri", "Every day"`
        )
        return NextResponse.json({ success: true, action: "invalid_days" })
      }

      state.data.availableDays = parsedDays
      state.step = 'hours'
      await setOnboardingState(chatId, state)

      const daysList = parsedDays.map(d => DAY_LABELS[d]).join(', ')
      await sendTelegramMessage(
        chatId,
        `Got it: <b>${daysList}</b>\n\n` +
        `<b>Step 5/5:</b> What hours are you available on those days?\n\n` +
        `Examples:\n` +
        `• "8am-5pm"\n` +
        `• "9:00am-6:00pm"\n` +
        `• "7am-3pm"`
      )
      return NextResponse.json({ success: true, action: "days_collected" })
    }

    case 'hours': {
      const timeRange = parseTimeRange(text)
      if (!timeRange) {
        await sendTelegramMessage(
          chatId,
          `I couldn't understand that time range. Please enter your hours like:\n\n` +
          `• "8am-5pm"\n` +
          `• "9:00am-6:00pm"\n` +
          `• "7am-3pm"`
        )
        return NextResponse.json({ success: true, action: "invalid_hours" })
      }

      state.data.startTime = timeRange[0]
      state.data.endTime = timeRange[1]
      state.step = 'confirm'
      await setOnboardingState(chatId, state)

      const daysList = (state.data.availableDays || []).map(d => DAY_LABELS[d]).join(', ')
      await sendTelegramMessage(
        chatId,
        `<b>Please confirm your details:</b>\n\n` +
        `Name: ${state.data.name}\n` +
        `Phone: ${state.data.phone}\n` +
        `Home Address: ${state.data.home_address}\n` +
        `Available Days: ${daysList}\n` +
        `Hours: ${formatTime12h(state.data.startTime!)} - ${formatTime12h(state.data.endTime!)}\n\n` +
        `Type <b>YES</b> to confirm or <b>NO</b> to start over.`
      )
      return NextResponse.json({ success: true, action: "hours_collected" })
    }

    case 'confirm':
      if (text.toLowerCase() === 'yes' || text.toLowerCase() === 'y') {
        // Get default tenant
        const tenant = await getDefaultTenant()
        if (!tenant) {
          await sendTelegramMessage(chatId, `Registration error. Please contact support.`)
          await deleteOnboardingState(chatId)
          return NextResponse.json({ success: false, error: "No tenant configured" })
        }

        // Geocode the home address for route optimization
        let homeLat: number | null = null
        let homeLng: number | null = null
        let formattedAddress: string | null = state.data.home_address || null

        if (state.data.home_address) {
          const geo = await geocodeAddress(state.data.home_address)
          if (geo) {
            homeLat = geo.lat
            homeLng = geo.lng
            formattedAddress = geo.formattedAddress
          } else {
            console.warn(`[OSIRIS] Could not geocode address: ${state.data.home_address}`)
          }
        }

        // Build structured availability object
        const availabilityData = (state.data.availableDays && state.data.startTime && state.data.endTime)
          ? {
              rules: [{
                days: state.data.availableDays,
                start: state.data.startTime,
                end: state.data.endTime,
              }],
            }
          : null

        // Create cleaner record
        const { data: newCleaner, error: insertError } = await client
          .from("cleaners")
          .insert({
            tenant_id: tenant.id,
            name: state.data.name,
            phone: state.data.phone,
            telegram_id: telegramUserId,
            telegram_username: from.username || null,
            home_address: formattedAddress,
            home_lat: homeLat,
            home_lng: homeLng,
            availability: availabilityData,
            active: true,
            is_team_lead: false
          })
          .select("id, name")
          .single()

        if (insertError) {
          console.error("[OSIRIS] Error creating cleaner:", insertError)
          await sendTelegramMessage(
            chatId,
            `There was an error registering you. Please try again or contact support.`
          )
          await deleteOnboardingState(chatId)
          return NextResponse.json({ success: false, error: "Failed to create cleaner" })
        }

        // Add cleaner to a team so they show up in the teams tab
        // Find the first active team for this tenant, or create a default one
        let { data: existingTeam } = await client
          .from("teams")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("active", true)
          .limit(1)
          .maybeSingle()

        if (!existingTeam) {
          const { data: newTeam } = await client
            .from("teams")
            .insert({ tenant_id: tenant.id, name: "Crew 1", active: true })
            .select("id")
            .single()
          existingTeam = newTeam
        }

        if (existingTeam) {
          const { error: tmError } = await client
            .from("team_members")
            .insert({
              tenant_id: tenant.id,
              team_id: existingTeam.id,
              cleaner_id: newCleaner.id,
              role: "member",
              is_active: true,
            })
          if (tmError) {
            console.error("[OSIRIS] Failed to add cleaner to team:", tmError)
          } else {
            console.log(`[OSIRIS] Cleaner ${newCleaner.id} added to team ${existingTeam.id}`)
          }
        }

        // Backfill onboarding messages with the cleaner's phone so they show up in teams tab
        await client
          .from("messages")
          .update({ phone_number: state.data.phone })
          .eq("metadata->>telegram_chat_id", chatId)
          .is("phone_number", null)

        await deleteOnboardingState(chatId)

        await sendTelegramMessage(
          chatId,
          `<b>Welcome aboard, ${state.data.name}!</b> 🎉\n\n` +
          `You're now registered and will receive job notifications here.\n\n` +
          `<b>Quick tips:</b>\n` +
          `• You'll get notified here when you're assigned a job\n` +
          `• Report tips: "tip job 123 - $20"\n` +
          `• Report upsells: "upsell job 123 - deep clean"\n\n` +
          `Questions? Reply here and a team lead will help.`
        )

        // Log the event
        await logSystemEvent({
          source: "telegram",
          event_type: "CLEANER_BROADCAST",
          message: `New cleaner registered via Telegram: ${state.data.name}`,
          cleaner_id: newCleaner.id,
          phone_number: state.data.phone,
          metadata: {
            telegram_id: telegramUserId,
            registration_method: "telegram_onboarding"
          }
        })

        return NextResponse.json({ success: true, action: "cleaner_registered", cleaner_id: newCleaner.id })
      } else if (text.toLowerCase() === 'no' || text.toLowerCase() === 'n') {
        // Start over
        await setOnboardingState(chatId, {
          step: 'name',
          data: {},
          startedAt: Date.now()
        })

        await sendTelegramMessage(
          chatId,
          `No problem, let's start over.\n\n<b>Step 1/5:</b> What's your full name?`
        )
        return NextResponse.json({ success: true, action: "onboarding_restart" })
      } else {
        await sendTelegramMessage(
          chatId,
          `Please type <b>YES</b> to confirm or <b>NO</b> to start over.`
        )
        return NextResponse.json({ success: true, action: "invalid_confirmation" })
      }

    default:
      await deleteOnboardingState(chatId)
      return NextResponse.json({ success: true, action: "invalid_state" })
  }
}

/**
 * Handle /team command for team leads
 */
async function handleTeamCommand(
  chatId: string,
  cleaner: { id: string; name: string; is_team_lead?: boolean },
  client: ReturnType<typeof getSupabaseServiceClient>
): Promise<NextResponse> {
  // Get all cleaners (team members)
  const { data: teamMembers, error } = await client
    .from("cleaners")
    .select("id, name, phone, is_team_lead, active, telegram_id")
    .eq("active", true)
    .order("is_team_lead", { ascending: false })
    .order("name")

  if (error || !teamMembers) {
    await sendTelegramMessage(chatId, `Error fetching team data. Please try again.`)
    return NextResponse.json({ success: false, error: "Failed to fetch team" })
  }

  const teamList = teamMembers.map((m, i) => {
    const leadBadge = m.is_team_lead ? " ⭐" : ""
    const telegramStatus = m.telegram_id ? "✅" : "❌"
    return `${i + 1}. ${m.name}${leadBadge}\n   📱 ${m.phone || 'No phone'}\n   Telegram: ${telegramStatus}`
  }).join("\n\n")

  await sendTelegramMessage(
    chatId,
    `<b>Your Team (${teamMembers.length} members)</b>\n\n${teamList}\n\n⭐ = Team Lead\n✅ = Telegram connected`
  )

  return NextResponse.json({ success: true, action: "team_list_sent" })
}

/**
 * Handle /leaderboard command for team leads
 */
async function handleLeaderboardCommand(
  chatId: string,
  cleaner: { id: string; name: string },
  client: ReturnType<typeof getSupabaseServiceClient>
): Promise<NextResponse> {
  // Get job completion stats for the past 30 days
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const { data: assignments, error } = await client
    .from("cleaner_assignments")
    .select(`
      cleaner_id,
      status,
      cleaners!inner(name)
    `)
    .gte("created_at", thirtyDaysAgo.toISOString())
    .eq("status", "confirmed")

  if (error) {
    await sendTelegramMessage(chatId, `Error fetching leaderboard. Please try again.`)
    return NextResponse.json({ success: false, error: "Failed to fetch leaderboard" })
  }

  // Count jobs per cleaner
  const jobCounts = new Map<string, { name: string; count: number }>()
  for (const a of assignments || []) {
    const cleanerData = a.cleaners as unknown as { name: string }
    const existing = jobCounts.get(a.cleaner_id) || { name: cleanerData?.name || 'Unknown', count: 0 }
    existing.count++
    jobCounts.set(a.cleaner_id, existing)
  }

  // Sort by count descending
  const sorted = Array.from(jobCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)

  if (sorted.length === 0) {
    await sendTelegramMessage(
      chatId,
      `<b>Leaderboard (Last 30 Days)</b>\n\nNo completed jobs in the last 30 days.`
    )
    return NextResponse.json({ success: true, action: "leaderboard_empty" })
  }

  const medals = ["🥇", "🥈", "🥉"]
  const leaderboard = sorted.map(([, data], i) => {
    const medal = medals[i] || `${i + 1}.`
    return `${medal} ${data.name} - ${data.count} jobs`
  }).join("\n")

  await sendTelegramMessage(
    chatId,
    `<b>🏆 Leaderboard (Last 30 Days)</b>\n\n${leaderboard}`
  )

  return NextResponse.json({ success: true, action: "leaderboard_sent" })
}

/**
 * Handle /briefing command for team leads
 */
async function handleBriefingCommand(
  chatId: string,
  cleaner: { id: string; name: string },
  client: ReturnType<typeof getSupabaseServiceClient>
): Promise<NextResponse> {
  const today = new Date().toISOString().split('T')[0]

  // Get today's jobs
  const { data: todaysJobs, error: jobsError } = await client
    .from("jobs")
    .select(`
      id,
      date,
      scheduled_at,
      address,
      status,
      cleaner_assignments(
        cleaner_id,
        status,
        cleaners(name)
      )
    `)
    .eq("date", today)
    .order("scheduled_at")

  if (jobsError) {
    await sendTelegramMessage(chatId, `Error fetching briefing. Please try again.`)
    return NextResponse.json({ success: false, error: "Failed to fetch briefing" })
  }

  // Get pending jobs needing assignment
  const { data: pendingJobs } = await client
    .from("jobs")
    .select("id, date, address")
    .gte("date", today)
    .is("cleaner_confirmed", null)
    .limit(5)

  // Build briefing message
  let briefing = `<b>📋 Daily Briefing for ${cleaner.name}</b>\n\n`
  briefing += `<b>Date:</b> ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}\n\n`

  // Today's jobs summary
  briefing += `<b>Today's Jobs (${todaysJobs?.length || 0}):</b>\n`
  if (todaysJobs && todaysJobs.length > 0) {
    for (const job of todaysJobs) {
      const assignment = job.cleaner_assignments?.[0] as unknown as { cleaners?: { name: string }; status?: string }
      const cleanerName = assignment?.cleaners?.name || 'Unassigned'
      const status = job.status || 'scheduled'
      briefing += `• ${job.scheduled_at || 'TBD'} - ${cleanerName} (${status})\n`
    }
  } else {
    briefing += `No jobs scheduled for today.\n`
  }

  // Pending assignments
  if (pendingJobs && pendingJobs.length > 0) {
    briefing += `\n<b>⚠️ Needs Assignment (${pendingJobs.length}):</b>\n`
    for (const job of pendingJobs) {
      briefing += `• Job #${job.id} on ${job.date}\n`
    }
  }

  // Quick stats
  const { count: weekJobs } = await client
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .gte("date", today)
    .lte("date", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])

  briefing += `\n<b>📊 This Week:</b> ${weekJobs || 0} jobs scheduled`

  await sendTelegramMessage(chatId, briefing)

  return NextResponse.json({ success: true, action: "briefing_sent" })
}

/**
 * Generate AI response for unrecognized messages
 * Looks up the cleaner's upcoming jobs so it can answer questions about their schedule
 */
async function generateAIResponse(
  userMessage: string,
  userName: string,
  isTeamLead: boolean,
  cleanerId: string | null
): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  console.log(`[OSIRIS] generateAIResponse called — cleanerId=${cleanerId || 'NULL'}, userName=${userName}, isTeamLead=${isTeamLead}`)

  // Fallback if no API key
  if (!anthropicKey) {
    console.log(`[OSIRIS] No ANTHROPIC_API_KEY set — returning fallback response`)
    return getDefaultFallbackResponse(isTeamLead)
  }

  try {
    // Look up the cleaner's upcoming jobs if we know who they are
    let jobContext = ""
    if (cleanerId) {
      const supabase = getSupabaseServiceClient()
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

      // Get job IDs assigned to this cleaner
      const { data: assignments } = await supabase
        .from("cleaner_assignments")
        .select("job_id")
        .eq("cleaner_id", cleanerId)
        .in("status", ["confirmed", "pending"])

      const jobIds = (assignments || []).map((a: any) => a.job_id).filter(Boolean)
      console.log(`[OSIRIS] Cleaner ${cleanerId} has ${jobIds.length} assignment(s) with status confirmed/pending. jobIds=${JSON.stringify(jobIds)}`)

      if (jobIds.length > 0) {
        // Fetch actual job details
        const { data: jobs } = await supabase
          .from("jobs")
          .select("id, date, scheduled_at, address, service_type, notes, status, phone_number")
          .in("id", jobIds)
          .gte("date", today)
          .order("date", { ascending: true })
          .limit(10)

        console.log(`[OSIRIS] Jobs query returned ${jobs?.length || 0} upcoming jobs for cleaner ${cleanerId} (today=${today})`)

        if (jobs && jobs.length > 0) {
          const jobLines = jobs.map((j: any) => {
            const dateStr = j.date || 'TBD'
            const timeStr = j.scheduled_at || 'TBD'
            const addr = j.address || 'Address not set'
            const service = j.service_type || 'Cleaning'
            return `- ${dateStr} at ${timeStr}: ${service} at ${addr} (Job #${j.id}, Status: ${j.status || 'scheduled'})`
          })

          jobContext = `\n\nTHIS CLEANER'S UPCOMING JOBS:\n${jobLines.join('\n')}\n\nUse this job info to answer questions about their schedule, addresses, times, etc. If they ask about "my cleaning" or "my job", refer to the closest upcoming job.`
        } else {
          jobContext = `\n\nThis cleaner has NO upcoming jobs assigned to them right now. Tell them directly that they have no upcoming jobs currently scheduled. If they think this is wrong, suggest they contact their team lead or supervisor.`
        }
      } else {
        jobContext = `\n\nThis cleaner has NO upcoming jobs assigned to them right now. Tell them directly that they have no upcoming jobs currently scheduled. If they think this is wrong, suggest they contact their team lead or supervisor.`
      }
    } else {
      jobContext = `\n\nIMPORTANT: This user is NOT registered as a cleaner in our system. You do NOT have access to any job data for them. Tell them to send "join" to register as a cleaner so they can receive job assignments and view their schedule.`
    }

    const client = new Anthropic({ apiKey: anthropicKey })

    const teamLeadCommands = isTeamLead
      ? `
- /team - View your team members
- /leaderboard - See job completion rankings
- /briefing - Get your daily briefing`
      : ""

    const systemPrompt = `You are a helpful assistant for a cleaning company's Telegram bot. You can answer questions about upcoming jobs and direct users to the right commands.

Available commands:
- "tip job [number] - $[amount]" - Report a tip
- "upsell job [number] - [description]" - Report an upsell
- /start - See all commands
- /myid - Get Telegram chat ID${teamLeadCommands}

The user's name is ${userName}.${isTeamLead ? " They are a team lead." : ""}${jobContext}

Respond in a friendly, concise way (2-4 sentences max). If they're asking about their schedule or job details, give them the info directly from the job data above. Use simple language. Don't use markdown formatting - use plain text only.`

    console.log(`[OSIRIS] Job context status: ${cleanerId ? (jobContext.includes('UPCOMING JOBS') ? 'HAS_JOBS' : jobContext.includes('NO upcoming') ? 'NO_JOBS' : 'NOT_REGISTERED') : 'NO_CLEANER_ID'}`)

    const response = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
      system: systemPrompt,
    })

    const textContent = response.content.find((block) => block.type === "text")
    if (textContent?.type === "text" && textContent.text) {
      return textContent.text.trim()
    }

    return getDefaultFallbackResponse(isTeamLead)
  } catch (error) {
    console.error("[OSIRIS] AI response error:", error)
    return getDefaultFallbackResponse(isTeamLead)
  }
}

/**
 * Default fallback when AI is unavailable
 */
function getDefaultFallbackResponse(isTeamLead: boolean): string {
  const teamLeadPart = isTeamLead
    ? "\n\nTeam lead commands: /team, /leaderboard, /briefing"
    : ""

  return `I didn't quite understand that. Here's what I can help with:

• New cleaner? Send "join" to register
• Report a tip: "tip job 123 - $20"
• Report an upsell: "upsell job 123 - deep clean"
• Need help? Send /start${teamLeadPart}`
}
