import { NextRequest, NextResponse } from "next/server"
import type { ApiResponse, Tip, Upsell } from "@/lib/types"
import {
  getSupabaseClient,
  getJobById,
  getCustomerByPhone,
  getCleanerById,
  getCleanerAssignmentById,
  updateCleanerAssignment,
  updateJob,
} from "@/lib/supabase"
import { answerCallbackQuery, sendTelegramMessage } from "@/lib/telegram"
import { assignNextAvailableCleaner } from "@/lib/cleaner-assignment"
import { sendSMS } from "@/lib/openphone"
import { cleanerAssigned, noCleanersAvailable } from "@/lib/sms-templates"
import { logSystemEvent } from "@/lib/system-events"
import { getDefaultTenant } from "@/lib/tenant"

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

// Onboarding state machine - stored in memory (consider Redis for production scale)
const onboardingStates = new Map<string, {
  step: 'name' | 'phone' | 'availability' | 'confirm'
  data: { name?: string; phone?: string; availability?: string }
  startedAt: number
}>()

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

// Patterns for new cleaner onboarding
const JOIN_PATTERNS = [
  /^(hi|hello|hey|join|register|sign\s*up|new\s+cleaner|i('m| am) a (new )?cleaner)/i,
  /^i\s+want\s+to\s+(join|work|clean)/i,
  /^(start|begin|onboard)/i,
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

    // 5. Update job.cleaner_confirmed = true
    await updateJob(jobId, { cleaner_confirmed: true } as Record<string, unknown>)

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

    console.log(`[OSIRIS] Telegram message from ${from.username || from.first_name}: ${text}`)

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

    const client = getSupabaseClient()

    // Check if user is in onboarding flow
    const onboardingState = onboardingStates.get(chatId)
    if (onboardingState) {
      return await handleOnboardingStep(chatId, telegramUserId, from, text, onboardingState)
    }

    // Check if this is a new cleaner trying to join
    const isJoinRequest = JOIN_PATTERNS.some(pattern => pattern.test(text))
    if (isJoinRequest) {
      // Check if they're already registered
      const { data: existingCleaner } = await client
        .from("cleaners")
        .select("id, name")
        .eq("telegram_id", telegramUserId)
        .maybeSingle()

      if (existingCleaner) {
        await sendTelegramMessage(
          chatId,
          `<b>You're already registered!</b>\n\nHi ${existingCleaner.name}, you're already in our system. You'll receive job notifications here.\n\nNeed help? Contact your team lead.`
        )
        return NextResponse.json({ success: true, action: "already_registered" })
      }

      // Start onboarding flow
      onboardingStates.set(chatId, {
        step: 'name',
        data: {},
        startedAt: Date.now()
      })

      await sendTelegramMessage(
        chatId,
        `<b>Welcome to the team!</b> 🎉\n\nLet's get you set up. I'll need a few details.\n\n<b>Step 1/3:</b> What's your full name?`
      )
      return NextResponse.json({ success: true, action: "onboarding_started" })
    }

    // Best-effort lookup: map telegram user to cleaner by telegram_id
    const { data: cleaner } = await client
      .from("cleaners")
      .select("id,name,active,is_team_lead,phone,email")
      .eq("telegram_id", telegramUserId)
      .maybeSingle()

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
      
      // Store tip in Supabase
      const numericJobId = Number(jobId)
      const tipAmount = parseFloat(amount)
      const { data: tipRow, error: tipErr } = await client.from("tips").insert({
        job_id: Number.isFinite(numericJobId) ? numericJobId : null,
        team_id: teamId,
        cleaner_id: cleaner?.id ?? null,
        amount: Number.isFinite(tipAmount) ? tipAmount : 0,
        reported_via: "telegram",
        notes: `telegram_chat_id=${chat.id}`,
      }).select("*").single()
      if (tipErr) {
        console.error("[OSIRIS] Failed to insert tip:", tipErr)
        return NextResponse.json({ success: false, error: "Failed to store tip" }, { status: 500 })
      }
      
      const tip: Partial<Tip> = {
        job_id: `job-${jobId}`,
        amount: parseFloat(amount),
        reported_via: "telegram",
        created_at: new Date().toISOString(),
      }

      console.log(`[OSIRIS] Tip recorded: Job ${jobId}, Amount $${amount}`)

      // Send confirmation back to chat
      await sendTelegramMessage(
        chatId,
        `<b>Tip Recorded!</b>\n\nJob #${jobId}: $${amount}\n\nThank you for reporting this tip.`
      )

      return NextResponse.json({ success: true, action: "tip_recorded", data: { ...tip, db_id: tipRow.id } })
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

    // Unknown message format
    console.log(`[OSIRIS] Unrecognized message format: ${text}`)
    return NextResponse.json({ success: true, action: "no_action" })

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
  state: { step: string; data: { name?: string; phone?: string; availability?: string }; startedAt: number }
): Promise<NextResponse> {
  const client = getSupabaseClient()

  // Timeout check - 30 minutes
  if (Date.now() - state.startedAt > 30 * 60 * 1000) {
    onboardingStates.delete(chatId)
    await sendTelegramMessage(
      chatId,
      `Your registration session has expired. Send "join" to start again.`
    )
    return NextResponse.json({ success: true, action: "onboarding_expired" })
  }

  // Handle cancel
  if (text.toLowerCase() === "cancel" || text.toLowerCase() === "/cancel") {
    onboardingStates.delete(chatId)
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
      onboardingStates.set(chatId, state as typeof state & { step: 'phone' })

      await sendTelegramMessage(
        chatId,
        `<b>Step 2/3:</b> What's your phone number?\n\n(Format: 123-456-7890 or similar)`
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
      state.step = 'availability'
      onboardingStates.set(chatId, state as typeof state & { step: 'availability' })

      await sendTelegramMessage(
        chatId,
        `<b>Step 3/3:</b> What's your general availability?\n\n(e.g., "Weekdays 9am-5pm" or "Mon-Fri anytime")`
      )
      return NextResponse.json({ success: true, action: "phone_collected" })

    case 'availability':
      state.data.availability = text.trim()
      state.step = 'confirm'
      onboardingStates.set(chatId, state as typeof state & { step: 'confirm' })

      await sendTelegramMessage(
        chatId,
        `<b>Please confirm your details:</b>\n\n` +
        `Name: ${state.data.name}\n` +
        `Phone: ${state.data.phone}\n` +
        `Availability: ${state.data.availability}\n\n` +
        `Type <b>YES</b> to confirm or <b>NO</b> to start over.`
      )
      return NextResponse.json({ success: true, action: "availability_collected" })

    case 'confirm':
      if (text.toLowerCase() === 'yes' || text.toLowerCase() === 'y') {
        // Get default tenant
        const tenant = await getDefaultTenant()
        if (!tenant) {
          await sendTelegramMessage(chatId, `Registration error. Please contact support.`)
          onboardingStates.delete(chatId)
          return NextResponse.json({ success: false, error: "No tenant configured" })
        }

        // Create cleaner record
        const { data: newCleaner, error: insertError } = await client
          .from("cleaners")
          .insert({
            tenant_id: tenant.id,
            name: state.data.name,
            phone: state.data.phone,
            telegram_id: telegramUserId,
            telegram_username: from.username || null,
            active: true,
            is_team_lead: false,
            availability: { general: state.data.availability }
          })
          .select("id, name")
          .single()

        if (insertError) {
          console.error("[OSIRIS] Error creating cleaner:", insertError)
          await sendTelegramMessage(
            chatId,
            `There was an error registering you. Please try again or contact support.`
          )
          onboardingStates.delete(chatId)
          return NextResponse.json({ success: false, error: "Failed to create cleaner" })
        }

        onboardingStates.delete(chatId)

        await sendTelegramMessage(
          chatId,
          `<b>Welcome aboard, ${state.data.name}!</b> 🎉\n\n` +
          `You're now registered and will receive job notifications here.\n\n` +
          `<b>Quick tips:</b>\n` +
          `• When you get a job, tap "Available" or "Not Available"\n` +
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
        onboardingStates.set(chatId, {
          step: 'name',
          data: {},
          startedAt: Date.now()
        })

        await sendTelegramMessage(
          chatId,
          `No problem, let's start over.\n\n<b>Step 1/3:</b> What's your full name?`
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
      onboardingStates.delete(chatId)
      return NextResponse.json({ success: true, action: "invalid_state" })
  }
}

/**
 * Handle /team command for team leads
 */
async function handleTeamCommand(
  chatId: string,
  cleaner: { id: string; name: string; is_team_lead?: boolean },
  client: ReturnType<typeof getSupabaseClient>
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
  client: ReturnType<typeof getSupabaseClient>
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
  client: ReturnType<typeof getSupabaseClient>
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
