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

/**
 * Webhook handler for Telegram bot messages and callback queries
 *
 * Handles:
 * - Team job confirmations
 * - Tip reports
 * - Upsell reports
 * - Team availability updates
 * - Cleaner accept/decline callbacks from inline keyboard buttons
 *
 * Callback Data Formats:
 * - accept:{jobId}:{assignmentId} - Cleaner accepts job assignment
 * - decline:{jobId}:{assignmentId} - Cleaner declines job assignment
 */

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

    // Handle /start or /myid command - reply with the chat ID
    if (text.toLowerCase() === "/start" || text.toLowerCase() === "/myid") {
      await sendTelegramMessage(
        chatId,
        `Your Telegram Chat ID is: <code>${chatId}</code>\n\nCopy this and add it to your environment variables as OWNER_TELEGRAM_CHAT_ID to receive escalation notifications.`
      )
      return NextResponse.json({ success: true, action: "chat_id_sent", chat_id: chatId })
    }

    const client = getSupabaseClient()

    // Best-effort lookup: map telegram user to cleaner by telegram_id
    const { data: cleaner } = await client
      .from("cleaners")
      .select("id,name,active")
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
