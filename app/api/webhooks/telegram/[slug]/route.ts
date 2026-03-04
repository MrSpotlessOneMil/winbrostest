import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { getTenantBySlug, tenantUsesFeature } from "@/lib/tenant"
import {
  getSupabaseServiceClient,
  getJobById,
  getCustomerByPhone,
  getCleanerAssignmentById,
  updateJob,
} from "@/lib/supabase"
import { answerCallbackQuery, sendTelegramMessage, logTelegramMessage } from "@/lib/telegram"
import { assignNextAvailableCleaner } from "@/lib/cleaner-assignment"
import { sendSMS } from "@/lib/openphone"
import { cleanerAssigned, noCleanersAvailable } from "@/lib/sms-templates"
import { logSystemEvent } from "@/lib/system-events"
import { geocodeAddress } from "@/lib/google-maps"
import { executeCompleteJob } from "@/app/api/actions/complete-job/route"
import { distributeTip } from "@/lib/tips"
import { recordReviewReceived } from "@/lib/crew-performance"
import Anthropic from "@anthropic-ai/sdk"
import type { Tenant } from "@/lib/tenant"

/**
 * Slug-based Telegram webhook handler
 *
 * Routes Telegram updates to the correct tenant based on the URL slug.
 * This enables multi-tenant Telegram bots (e.g. /api/webhooks/telegram/cedar-rapids)
 * Each tenant has their own bot token stored in tenants.telegram_bot_token.
 *
 * Handles:
 * - Cleaner accept/decline callbacks from inline keyboard buttons
 * - New cleaner onboarding
 * - Tip / upsell / job confirm reports
 * - Schedule queries
 * - /start, /myid commands
 */

// Day code constants for availability
const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
const DAY_LABELS: Record<string, string> = {
  MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday',
  FR: 'Friday', SA: 'Saturday', SU: 'Sunday'
}

function parseDaysInput(text: string): string[] | null {
  const lower = text.toLowerCase().trim()
  if (/every\s*day|all\s*days|any\s*day|7\s*days/i.test(lower)) return [...DAY_CODES]
  if (/weekdays|mon\s*-\s*fri|monday\s*-\s*friday|m\s*-\s*f/i.test(lower)) return ['MO', 'TU', 'WE', 'TH', 'FR']
  if (/weekends?/i.test(lower)) return ['SA', 'SU']

  const rangeMatch = lower.match(/^(mon|tue|wed|thu|fri|sat|sun)\w*\s*[-–to]+\s*(mon|tue|wed|thu|fri|sat|sun)\w*$/i)
  if (rangeMatch) {
    const dayOrder = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
    const codeOrder = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
    const startIdx = dayOrder.findIndex(d => rangeMatch[1].toLowerCase().startsWith(d))
    const endIdx = dayOrder.findIndex(d => rangeMatch[2].toLowerCase().startsWith(d))
    if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) return codeOrder.slice(startIdx, endIdx + 1)
  }

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

function parseTimeInput(text: string): string | null {
  const lower = text.toLowerCase().trim()
  const match = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!match) return null
  let hours = parseInt(match[1])
  const minutes = match[2] ? parseInt(match[2]) : 0
  const period = match[3]
  if (period === 'pm' && hours < 12) hours += 12
  if (period === 'am' && hours === 12) hours = 0
  if (!period && hours <= 12 && hours >= 1) return null
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function parseTimeRange(text: string): [string, string] | null {
  const rangeMatch = text.match(/^(.+?)[\s]*[-–to]+[\s]*(.+)$/i)
  if (rangeMatch) {
    const start = parseTimeInput(rangeMatch[1].trim())
    const end = parseTimeInput(rangeMatch[2].trim())
    if (start && end) return [start, end]
  }
  return null
}

function formatTime12h(time24: string): string {
  const [h, m] = time24.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

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

async function getOnboardingState(chatId: string, tenantId: string): Promise<OnboardingState | null> {
  const client = getSupabaseServiceClient()
  const { data } = await client
    .from('system_events')
    .select('metadata')
    .eq('event_type', 'TELEGRAM_ONBOARDING')
    .eq('source', 'telegram')
    .eq('metadata->>chat_id', chatId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data?.metadata) return null
  const meta = data.metadata as Record<string, unknown>
  const state = meta.onboarding_state as OnboardingState | undefined
  if (!state) return null
  if (Date.now() - state.startedAt > 30 * 60 * 1000) {
    await deleteOnboardingState(chatId, tenantId)
    return null
  }
  return state
}

async function setOnboardingState(chatId: string, tenantId: string, state: OnboardingState): Promise<void> {
  const client = getSupabaseServiceClient()
  await client
    .from('system_events')
    .delete()
    .eq('event_type', 'TELEGRAM_ONBOARDING')
    .eq('source', 'telegram')
    .eq('metadata->>chat_id', chatId)
    .eq('tenant_id', tenantId)
  await client.from('system_events').insert({
    event_type: 'TELEGRAM_ONBOARDING',
    source: 'telegram',
    message: `Onboarding step: ${state.step}`,
    tenant_id: tenantId,
    metadata: { chat_id: chatId, onboarding_state: state },
    created_at: new Date().toISOString(),
  })
}

async function deleteOnboardingState(chatId: string, tenantId: string): Promise<void> {
  const client = getSupabaseServiceClient()
  await client
    .from('system_events')
    .delete()
    .eq('event_type', 'TELEGRAM_ONBOARDING')
    .eq('source', 'telegram')
    .eq('metadata->>chat_id', chatId)
    .eq('tenant_id', tenantId)
}

interface TelegramMessage {
  message_id: number
  from: { id: number; username?: string; first_name: string }
  chat: { id: number; type: string }
  text?: string
  date: number
}

interface TelegramCallbackQuery {
  id: string
  from: { id: number; username?: string; first_name: string }
  message?: TelegramMessage
  chat_instance: string
  data?: string
}

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

const TIP_PATTERN = /tip\s+(?:accepted\s+)?job\s+(\d+)\s*[-–]\s*\$?(\d+(?:\.\d{2})?)/i
const UPSELL_PATTERN = /upsold?\s+job\s+(\d+)\s*[-–]\s*(.+)/i
const CONFIRM_PATTERN = /confirm\s+job\s+(\d+)/i
const DONE_PATTERN = /^(?:done|finished|completed?|job\s+done|job\s+finished|job\s+completed?)\s+(?:job\s+)?#?(\d+)$/i
const REVIEW_PATTERN = /^(?:review|google\s+review)\s+job\s+(\d+)$/i
const SCHEDULE_PATTERN = /\b(schedule|my\s+jobs?|my\s+shift|my\s+work|today|tomorrow|this\s+week|upcoming\s+jobs?|when\s+(am\s+i|do\s+i\s+work)|what\s+(time|day)\s+(am\s+i|do\s+i))\b/i
const JOIN_PATTERNS = [
  /^(join|register|sign\s*up)/i,
  /^new\s+(cleaner|salesman|sales\s*man)/i,
  /i[''`"']m\s+a\s+(new\s+)?(cleaner|salesman|sales\s*man)/i,
  /i\s+am\s+a\s+(new\s+)?(cleaner|salesman|sales\s*man)/i,
  /^i\s+want\s+to\s+(join|work|clean|sell)/i,
  /^(onboard|enroll)/i,
  /new\s+(here|employee|hire|team\s*member)/i,
  /how\s+(do\s+i|can\s+i|to)\s+(join|register|sign\s*up)/i,
]
const PHONE_PATTERN = /^[\d\s\-\(\)\+]{10,}$/

/** Check if this tenant uses estimate/salesman flow (vs cleaning/technician) */
function isEstimateFlow(tenant: Tenant): boolean {
  return tenant.slug === 'winbros' || tenantUsesFeature(tenant, 'use_route_optimization')
}

/** Get the role label for this tenant's field staff */
function getRoleLabel(tenant: Tenant): string {
  return isEstimateFlow(tenant) ? 'salesman' : 'cleaner'
}

/** Send a Telegram message using the tenant's bot token */
async function sendMsg(chatId: string, text: string, tenant: Tenant): Promise<void> {
  await sendTelegramMessage(tenant, chatId, text)
}

async function handleCallbackQuery(
  callbackQuery: TelegramCallbackQuery,
  tenant: Tenant
): Promise<NextResponse> {
  const { id: callbackQueryId, from, data: callbackData, message } = callbackQuery
  const telegramUserId = from.id.toString()
  const chatId = message?.chat.id.toString() || telegramUserId

  if (!callbackData) {
    await answerCallbackQuery(tenant, callbackQueryId, "Invalid callback data")
    return NextResponse.json({ success: true })
  }

  const parts = callbackData.split(":")
  if (parts.length < 3) {
    await answerCallbackQuery(tenant, callbackQueryId, "Invalid callback format")
    return NextResponse.json({ success: true })
  }

  const [action, jobId, assignmentId] = parts

  if (action === "accept") {
    return handleAcceptCallback(callbackQueryId, chatId, telegramUserId, jobId, assignmentId, tenant)
  }
  if (action === "decline") {
    return handleDeclineCallback(callbackQueryId, chatId, telegramUserId, jobId, assignmentId, tenant)
  }

  await answerCallbackQuery(tenant, callbackQueryId, "Unknown action")
  return NextResponse.json({ success: true })
}

async function handleAcceptCallback(
  callbackQueryId: string,
  chatId: string,
  telegramUserId: string,
  jobId: string,
  assignmentId: string,
  tenant: Tenant
): Promise<NextResponse> {
  try {
    const client = getSupabaseServiceClient()
    await answerCallbackQuery(tenant, callbackQueryId, "Processing your acceptance...")

    // Atomic claim: UPDATE only if still pending (prevents TOCTOU race)
    const { data: claimed, error: claimErr } = await client
      .from('cleaner_assignments')
      .update({ status: 'confirmed', responded_at: new Date().toISOString() })
      .eq('id', assignmentId)
      .eq('status', 'pending')
      .eq('tenant_id', tenant.id)
      .select('*')
      .maybeSingle()

    if (claimErr || !claimed) {
      const existing = await getCleanerAssignmentById(assignmentId)
      const statusMsg = existing
        ? `This job has already been ${existing.status}.`
        : "Sorry, this assignment could not be found."
      await sendMsg(chatId, statusMsg, tenant)
      return NextResponse.json({ success: true, action: "assignment_already_processed" })
    }

    const assignment = claimed

    const job = await getJobById(jobId)
    if (!job || job.tenant_id !== tenant.id) {
      await sendMsg(chatId, "Sorry, this job could not be found.", tenant)
      return NextResponse.json({ success: false, error: "Job not found" })
    }

    await updateJob(jobId, { cleaner_confirmed: true, status: 'scheduled', cleaner_id: assignment.cleaner_id } as Record<string, unknown>, {}, client)

    // Sync lead status to "assigned" so dashboard pipeline updates
    await client
      .from("leads")
      .update({ status: "assigned" })
      .eq("converted_to_job_id", Number(jobId))

    // ──────────────────────────────────────────────────────────────────────
    // TENANT ISOLATION — MULTI-CLEANER BROADCAST LOGIC:
    // Cedar Rapids uses broadcast mode: ALL cleaners get notified, first to accept wins.
    // For multi-cleaner jobs (job.cleaners > 1), we keep accepting until all slots filled.
    // Only THEN do we cancel remaining pending assignments and notify the customer.
    // WinBros uses distance routing (handled in cleaner-assignment.ts), not this path.
    // Do NOT change this logic without testing both single and multi-cleaner flows.
    // ──────────────────────────────────────────────────────────────────────
    // Check how many cleaners this job needs vs how many have accepted
    const cleanersNeeded = (job as any).cleaners || 1
    const { data: confirmedAssignments } = await client
      .from("cleaner_assignments")
      .select("id, cleaner_id")
      .eq("job_id", Number(jobId))
      .in("status", ["accepted", "confirmed"])

    const confirmedCount = confirmedAssignments?.length || 0
    const allCleanersFilled = confirmedCount >= cleanersNeeded
    let customerNotified = false

    if (allCleanersFilled) {
      // All slots filled — cancel remaining pending assignments
      const { data: otherAssignments } = await client
        .from("cleaner_assignments")
        .select("id, cleaner_id")
        .eq("job_id", Number(jobId))
        .eq("status", "pending")
        .neq("id", Number(assignmentId))

      if (otherAssignments && otherAssignments.length > 0) {
        const otherIds = otherAssignments.map((a: any) => a.id)
        await client
          .from("cleaner_assignments")
          .update({ status: "cancelled", responded_at: new Date().toISOString() })
          .in("id", otherIds)

        // Notify other cleaners the job was taken
        for (const other of otherAssignments) {
          const { data: otherCleaner } = await client
            .from("cleaners")
            .select("telegram_id, name")
            .eq("id", other.cleaner_id)
            .single()
          if (otherCleaner?.telegram_id) {
            sendTelegramMessage(tenant, otherCleaner.telegram_id, `The job on ${job.date || 'TBD'} has been filled. Thanks for your interest!`).catch(() => {})
          }
        }

        console.log(`[Telegram/${tenant.slug}] Cancelled ${otherIds.length} other pending assignments for job ${jobId} (all ${cleanersNeeded} slots filled)`)
      }

      // Notify customer with all confirmed cleaner names
      if (job.phone_number) {
        const customer = await getCustomerByPhone(job.phone_number, client)

        if (customer) {
          // Get all confirmed cleaner names for this job
          const confirmedCleanerIds = (confirmedAssignments || []).map((a: any) => a.cleaner_id)
          const { data: confirmedCleaners } = await client
            .from("cleaners")
            .select("name")
            .in("id", confirmedCleanerIds)
          const cleanerNames = (confirmedCleaners || []).map((c: any) => c.name)
          const cleanerNamesStr = cleanerNames.length > 1
            ? cleanerNames.slice(0, -1).join(", ") + " and " + cleanerNames[cleanerNames.length - 1]
            : cleanerNames[0] || "your cleaner"

          const dateStr = job.date
            ? new Date(job.date + "T12:00:00").toLocaleDateString("en-US", {
                weekday: "long", month: "long", day: "numeric",
              })
            : "your scheduled date"
          const timeStr = job.scheduled_at || "your scheduled time"

          const smsMessage = cleanerAssigned(
            customer.first_name || "there",
            cleanerNamesStr,
            dateStr,
            timeStr
          )

          const smsResult = await sendSMS(tenant, job.phone_number, smsMessage)
          customerNotified = smsResult.success

          if (customerNotified) {
            await updateJob(jobId, { customer_notified: true } as Record<string, unknown>)
            const supabase = getSupabaseServiceClient()
            supabase.from("messages").insert({
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
              if (logErr) console.error(`[Telegram/${tenant.slug}] Failed to log cleaner-assigned SMS:`, logErr)
            })
          }
        }
      }
    } else {
      console.log(`[Telegram/${tenant.slug}] Job ${jobId}: ${confirmedCount}/${cleanersNeeded} cleaners filled — waiting for more`)
    }

    const slotsMsg = cleanersNeeded > 1 ? ` (${confirmedCount}/${cleanersNeeded} ${getRoleLabel(tenant)}s assigned)` : ''
    await sendMsg(chatId, `<b>Job Accepted!</b>${slotsMsg}\n\nYou have been assigned to this job.${allCleanersFilled ? ' The customer has been notified.' : ''}\n\nPlease make sure to:\n- Arrive on time\n- Bring all necessary supplies\n- Contact us if you have any issues\n\nWhen you finish the job, type <b>done job ${jobId}</b> to mark it complete.\n\nThank you!`, tenant)

    await logSystemEvent({
      source: "telegram",
      event_type: "CLEANER_ACCEPTED",
      message: `Cleaner accepted job ${jobId} via Telegram callback`,
      job_id: jobId,
      cleaner_id: assignment.cleaner_id,
      phone_number: job.phone_number,
      metadata: { assignment_id: assignmentId, telegram_user_id: telegramUserId, customer_notified: customerNotified },
    })

    return NextResponse.json({ success: true, action: "cleaner_accepted", job_id: jobId })
  } catch (error) {
    console.error(`[Telegram/${tenant.slug}] Error handling accept callback:`, error)
    await sendMsg(chatId, "An error occurred. Please try again or contact support.", tenant)
    return NextResponse.json({ success: false, error: "Accept callback processing failed" }, { status: 500 })
  }
}

async function handleDeclineCallback(
  callbackQueryId: string,
  chatId: string,
  telegramUserId: string,
  jobId: string,
  assignmentId: string,
  tenant: Tenant
): Promise<NextResponse> {
  try {
    await answerCallbackQuery(tenant, callbackQueryId, "Processing your response...")

    // Atomic claim: UPDATE only if still pending (prevents TOCTOU race)
    const client = getSupabaseServiceClient()
    const { data: claimed, error: claimErr } = await client
      .from('cleaner_assignments')
      .update({ status: 'declined', responded_at: new Date().toISOString() })
      .eq('id', assignmentId)
      .eq('status', 'pending')
      .eq('tenant_id', tenant.id)
      .select('*')
      .maybeSingle()

    if (claimErr || !claimed) {
      const existing = await getCleanerAssignmentById(assignmentId)
      const statusMsg = existing
        ? `This job has already been ${existing.status}.`
        : "Sorry, this assignment could not be found."
      await sendMsg(chatId, statusMsg, tenant)
      return NextResponse.json({ success: true, action: "assignment_already_processed" })
    }

    const assignment = claimed

    const job = await getJobById(jobId)
    if (!job || job.tenant_id !== tenant.id) {
      await sendMsg(chatId, "Sorry, this job could not be found.", tenant)
      return NextResponse.json({ success: false, error: "Job not found" })
    }
    await sendMsg(chatId, `No problem! We'll find another ${getRoleLabel(tenant)} for this job.`, tenant)

    // Check if this tenant uses broadcast mode
    const isBroadcast = tenantUsesFeature(tenant, 'use_broadcast_assignment')

    // In broadcast mode, check if there are still other pending assignments
    // Only escalate if ALL cleaners have declined (no pending left)
    let allDeclined = false
    let nextAssigned = false

    if (isBroadcast) {
      const { data: remainingPending } = await client
        .from("cleaner_assignments")
        .select("id")
        .eq("job_id", Number(jobId))
        .eq("status", "pending")

      if (!remainingPending || remainingPending.length === 0) {
        // All cleaners have declined or been cancelled — no one left
        allDeclined = true
      }
      // Otherwise, other cleaners still have pending assignments, do nothing
    } else {
      // Routing mode: cascade to next cleaner
      const assignResult = await assignNextAvailableCleaner(jobId, [assignment.cleaner_id])
      nextAssigned = assignResult.success
      allDeclined = !assignResult.success && (assignResult.exhausted || false)
    }

    if (allDeclined) {
      if (job.phone_number) {
        const customer = await getCustomerByPhone(job.phone_number)
        const dateStr = job.date
          ? new Date(job.date + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "long", month: "long", day: "numeric",
            })
          : "your requested date"
        await sendSMS(tenant, job.phone_number, noCleanersAvailable(customer?.first_name || "there", dateStr))
      }

      const ownerChatId = tenant.owner_telegram_chat_id
      if (ownerChatId) {
        await sendMsg(
          String(ownerChatId),
          `<b>URGENT: No ${getRoleLabel(tenant).charAt(0).toUpperCase() + getRoleLabel(tenant).slice(1)}s Available</b>\n\nJob ID: ${jobId}\nDate: ${job.date || "N/A"}\nTime: ${job.scheduled_at || "N/A"}\nAddress: ${job.address || "N/A"}\nCustomer Phone: ${job.phone_number || "N/A"}\n\nAll available ${getRoleLabel(tenant)}s have declined. Manual assignment required.`,
          tenant
        )
      }

      await logSystemEvent({
        source: "telegram",
        event_type: "OWNER_ACTION_REQUIRED",
        message: `No cleaners available for job ${jobId} - all declined or unavailable`,
        job_id: jobId,
        phone_number: job.phone_number,
        metadata: { reason: "cleaner_assignment_exhausted", last_declined_cleaner_id: assignment.cleaner_id, mode: isBroadcast ? 'broadcast' : 'routing' },
      })
    }

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
        next_cleaner_assigned: nextAssigned,
        all_declined: allDeclined,
        mode: isBroadcast ? 'broadcast' : 'routing',
      },
    })

    return NextResponse.json({ success: true, action: "cleaner_declined", job_id: jobId })
  } catch (error) {
    console.error(`[Telegram/${tenant.slug}] Error handling decline callback:`, error)
    await sendMsg(chatId, "An error occurred. Please try again or contact support.", tenant)
    return NextResponse.json({ success: false, error: "Decline callback processing failed" }, { status: 500 })
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  return NextResponse.json({
    status: "ok",
    service: `Telegram Webhook - ${slug}`,
    timestamp: new Date().toISOString(),
    message: "Webhook endpoint is active. POST your Telegram events here.",
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  // Look up the tenant by slug
  const tenant = await getTenantBySlug(slug)
  if (!tenant) {
    console.error(`[Telegram/${slug}] Tenant not found`)
    return NextResponse.json({ success: false, error: "Tenant not found" }, { status: 404 })
  }

  // Validate Telegram secret_token (set during setWebhook registration)
  if (tenant.telegram_webhook_secret) {
    const secretToken = request.headers.get("x-telegram-bot-api-secret-token")
    if (!secretToken) {
      console.error(`[Telegram/${slug}] Missing secret_token header`)
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    }
    const expected = Buffer.from(tenant.telegram_webhook_secret)
    const received = Buffer.from(secretToken)
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      console.error(`[Telegram/${slug}] Invalid secret_token`)
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    }
  }

  let update: TelegramUpdate
  try {
    update = await request.json()
  } catch (e) {
    console.error(`[Telegram/${slug}] Failed to parse JSON:`, e)
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  try {
    // Handle callback queries (accept/decline buttons)
    if (update.callback_query) {
      return await handleCallbackQuery(update.callback_query, tenant)
    }

    if (!update.message?.text) {
      return NextResponse.json({ success: true })
    }

    const { text, from, chat } = update.message
    const telegramUserId = from.id.toString()
    const chatId = chat.id.toString()

    console.log(`[Telegram/${slug}] Message from id=${telegramUserId}, length=${text?.length || 0}`)

    // Log inbound message
    logTelegramMessage({
      telegramChatId: chatId,
      direction: 'inbound',
      content: text,
      source: 'telegram_webhook',
      messageId: update.message.message_id,
      tenantId: tenant.id,
    }).catch(() => {})

    // /start command
    if (text.toLowerCase() === "/start") {
      const roleLabel = getRoleLabel(tenant)
      const roleCap = roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1)
      await sendMsg(
        chatId,
        `<b>Welcome to the ${tenant.business_name_short || tenant.name} Team Bot!</b>\n\n<b>For New ${roleCap}s:</b>\nSend "join" or "I'm a new ${roleLabel}" to register.\n\n<b>For Existing ${roleCap}s:</b>\n• Report tips: "tip job 123 - $20"\n• Report upsells: "upsell job 123 - deep clean"\n• Accept/decline jobs via buttons\n\n<b>Your Chat ID:</b> <code>${chatId}</code>`,
        tenant
      )
      return NextResponse.json({ success: true, action: "start_sent" })
    }

    // /myid command
    if (text.toLowerCase() === "/myid") {
      await sendMsg(
        chatId,
        `Your Telegram Chat ID is: <code>${chatId}</code>\n\nProvide this to your manager to complete your registration.`,
        tenant
      )
      return NextResponse.json({ success: true, action: "chat_id_sent", chat_id: chatId })
    }

    const client = getSupabaseServiceClient()

    // Check onboarding flow (tenant-scoped)
    const onboardingState = await getOnboardingState(chatId, tenant.id)
    if (onboardingState) {
      return await handleOnboardingStep(chatId, telegramUserId, from, text, onboardingState, tenant)
    }

    // Check for join request
    const isJoinRequest = JOIN_PATTERNS.some(pattern => pattern.test(text))
    if (isJoinRequest) {
      const { data: existingCleanerRows } = await client
        .from("cleaners")
        .select("id, name")
        .eq("telegram_id", telegramUserId)
        .eq("tenant_id", tenant.id)
        .eq("active", true)
        .is("deleted_at", null)
        .limit(1)
      const existingCleaner = existingCleanerRows?.[0] || null

      if (existingCleaner) {
        await sendMsg(chatId, `<b>You're already registered!</b>\n\nHi ${existingCleaner.name}, you're already in our system. You'll receive job notifications here.\n\nNeed help? Contact your team lead.`, tenant)
        return NextResponse.json({ success: true, action: "already_registered" })
      }

      await setOnboardingState(chatId, tenant.id, { step: 'name', data: {}, startedAt: Date.now() })
      await sendMsg(chatId, `<b>Welcome to the team!</b> 🎉\n\nLet's get you set up. I'll need a few details.\n\n<b>Step 1/5:</b> What's your full name?`, tenant)
      return NextResponse.json({ success: true, action: "onboarding_started" })
    }

    // Cleaner lookup by telegram_id + tenant
    const { data: cleanerRows } = await client
      .from("cleaners")
      .select("id,name,active,is_team_lead,phone,email")
      .eq("telegram_id", telegramUserId)
      .eq("tenant_id", tenant.id)
      .eq("active", true)
      .limit(1)
    const cleaner = cleanerRows?.[0] || null

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

    // Parse review confirmation (team leads only)
    const reviewMatch = text.match(REVIEW_PATTERN)
    if (reviewMatch) {
      if (!cleaner?.is_team_lead) {
        await sendMsg(chatId, `Review confirmation is only available to team leads.`, tenant)
        return NextResponse.json({ success: true })
      }
      const reviewJobId = Number(reviewMatch[1])
      const { data: reviewJob } = await client.from("jobs").select("id, phone_number").eq("id", reviewJobId).single()
      if (!reviewJob?.phone_number) {
        await sendMsg(chatId, `❌ Job #${reviewJobId} not found or has no customer phone.`, tenant)
        return NextResponse.json({ success: false })
      }
      const reviewResult = await recordReviewReceived(reviewJob.phone_number, 5)
      const bonusDollars = reviewResult.bonusCents ? (reviewResult.bonusCents / 100).toFixed(2) : "10.00"
      await sendMsg(chatId, `✅ Review confirmed for Job #${reviewJobId} — $${bonusDollars} credit added.`, tenant)
      return NextResponse.json({ success: true, action: "review_confirmed" })
    }

    // Parse tip report
    const tipMatch = text.match(TIP_PATTERN)
    if (tipMatch) {
      const [, jobId, amount] = tipMatch
      const numericJobId = Number(jobId)
      const tipAmount = parseFloat(amount)

      const result = await distributeTip(numericJobId, tipAmount, teamId ?? null, "telegram", `telegram_chat_id=${chat.id}`)
      if (!result.success) {
        return NextResponse.json({ success: false, error: "Failed to store tip" }, { status: 500 })
      }
      const splitNote = result.splitCount > 1 ? ` (split $${result.amountEach.toFixed(2)} each among ${result.splitCount} ${getRoleLabel(tenant)}s)` : ''
      await sendMsg(chatId, `<b>Tip Recorded!</b>\n\nJob #${jobId}: $${amount}${splitNote}\n\nThank you for reporting this tip.`, tenant)
      return NextResponse.json({ success: true, action: "tip_recorded" })
    }

    // Parse upsell report
    const upsellMatch = text.match(UPSELL_PATTERN)
    if (upsellMatch) {
      const [, jobId, upsellType] = upsellMatch
      const numericJobId = Number(jobId)
      await client.from("upsells").insert({
        job_id: Number.isFinite(numericJobId) ? numericJobId : null,
        team_id: teamId,
        cleaner_id: cleaner?.id ?? null,
        upsell_type: upsellType.trim(),
        value: 0,
        reported_via: "telegram",
        notes: `telegram_chat_id=${chat.id}`,
      })
      await sendMsg(chatId, `<b>Upsell Recorded!</b>\n\nJob #${jobId}: ${upsellType.trim()}\n\nGreat work on the upsell!`, tenant)
      return NextResponse.json({ success: true, action: "upsell_recorded" })
    }

    // Parse job confirmation
    const confirmMatch = text.match(CONFIRM_PATTERN)
    if (confirmMatch) {
      const [, jobId] = confirmMatch
      const numericJobId = Number(jobId)
      if (teamId != null && Number.isFinite(numericJobId)) {
        await client.from("jobs").update({ team_id: teamId }).eq("id", numericJobId)
      }
      return NextResponse.json({ success: true, action: "job_confirmed" })
    }

    // "done job 90" — cleaner marks job complete → final payment + review countdown
    const doneMatch = text.match(DONE_PATTERN)
    if (doneMatch) {
      const [, jobId] = doneMatch
      const numericJobId = Number(jobId)

      // Verify this cleaner is actually assigned to this job
      if (!cleaner?.id) {
        await sendMsg(chatId, `You're not registered as a ${getRoleLabel(tenant)}. Send "join" to register.`, tenant)
        return NextResponse.json({ success: true })
      }

      const { data: assignment } = await client
        .from("cleaner_assignments")
        .select("id, status")
        .eq("job_id", numericJobId)
        .eq("cleaner_id", cleaner.id)
        .in("status", ["confirmed", "pending"])
        .limit(1)
        .maybeSingle()

      if (!assignment) {
        await sendMsg(chatId, `You don't have an active assignment for Job #${jobId}. Check your job number and try again.`, tenant)
        return NextResponse.json({ success: true })
      }

      const job = await getJobById(String(numericJobId))
      if (!job) {
        await sendMsg(chatId, `Job #${jobId} not found.`, tenant)
        return NextResponse.json({ success: true })
      }

      if (job.status === "completed") {
        await sendMsg(chatId, `Job #${jobId} is already marked as completed.`, tenant)
        return NextResponse.json({ success: true })
      }

      // Update assignment status
      await client
        .from("cleaner_assignments")
        .update({ status: "completed", responded_at: new Date().toISOString() })
        .eq("id", assignment.id)

      // Set completed_at on the job
      await updateJob(String(numericJobId), {
        completed_at: new Date().toISOString(),
      } as Record<string, unknown>)

      // Execute complete job → sends final payment link + marks completed
      const completeResult = await executeCompleteJob(String(numericJobId))

      if (!completeResult.success) {
        // Even if final payment fails, still mark the job done
        await updateJob(String(numericJobId), { status: "completed" } as Record<string, unknown>)
      }

      // Sync lead status to "completed" so dashboard pipeline updates
      const serviceClient = getSupabaseServiceClient()
      await serviceClient
        .from("leads")
        .update({ status: "completed" })
        .eq("converted_to_job_id", numericJobId)

      // Send review request SMS immediately (don't wait for 2h cron)
      let reviewSent = false
      if (job.phone_number && tenantUsesFeature(tenant, 'use_review_request')) {
        const reviewCustomer = await getCustomerByPhone(job.phone_number)
        const customerName = reviewCustomer?.first_name || 'there'
        const reviewLink = tenant.google_review_link || 'https://g.page/review'
        const appDomain = (tenant.website_url || '').replace(/\/+$/, '')
        const tipLink = `${appDomain}/tip/${numericJobId}`
        const recurringDiscount = tenant.workflow_config?.monthly_followup_discount || '15%'

        const { postJobFollowup } = await import('@/lib/sms-templates')
        const reviewMsg = postJobFollowup(customerName, cleaner.name, reviewLink, tipLink, recurringDiscount)
        const reviewResult = await sendSMS(tenant, job.phone_number, reviewMsg)
        reviewSent = reviewResult.success

        if (!reviewSent) {
          console.error(`[Telegram/${tenant.slug}] Review SMS failed for job ${numericJobId}:`, JSON.stringify(reviewResult))
        }

        if (reviewSent) {
          // Mark followup_sent_at so the 2h cron doesn't double-send
          await updateJob(String(numericJobId), { followup_sent_at: new Date().toISOString() } as Record<string, unknown>)

          await logSystemEvent({
            source: 'telegram',
            event_type: 'POST_JOB_FOLLOWUP_SENT',
            message: `Immediate post-job follow-up sent for job ${numericJobId} (cleaner marked done)`,
            tenant_id: tenant.id,
            job_id: String(numericJobId),
            phone_number: job.phone_number,
            metadata: { triggered_by: 'telegram_done_command', cleaner_name: cleaner.name },
          })
        }
      }

      await sendMsg(chatId, `<b>Job #${jobId} complete!</b>\n\nGreat work, ${cleaner.name}! Thanks for getting it done.`, tenant)

      await logSystemEvent({
        source: "telegram",
        event_type: "JOB_COMPLETED",
        message: `Cleaner ${cleaner.name} marked job ${jobId} as complete via Telegram`,
        job_id: String(numericJobId),
        cleaner_id: cleaner.id,
        tenant_id: tenant.id,
        phone_number: job.phone_number,
        metadata: {
          telegram_user_id: telegramUserId,
          assignment_id: assignment.id,
          final_payment_sent: !!completeResult.paymentUrl,
          review_sent: reviewSent,
          completed_via: "telegram_done_command",
        },
      })

      return NextResponse.json({ success: true, action: "job_completed", job_id: jobId })
    }

    // Schedule query
    if (SCHEDULE_PATTERN.test(text)) {
      const scheduleMsg = await buildScheduleResponse(text, cleaner?.id || null, cleaner?.name || from.first_name, tenant.id, getRoleLabel(tenant))
      await sendMsg(chatId, scheduleMsg, tenant)
      return NextResponse.json({ success: true, action: "schedule_response" })
    }

    // AI-powered assistant (handles info updates, job questions, general chat)
    const aiResult = await handleCleanerAI(text, cleaner, chatId, telegramUserId, from.first_name, tenant)
    await sendMsg(chatId, aiResult.response, tenant)
    return NextResponse.json({ success: true, action: aiResult.action || "ai_response" })

  } catch (error) {
    console.error(`[Telegram/${slug}] Webhook error:`, error)
    return NextResponse.json({ success: false, error: "Webhook processing failed" }, { status: 500 })
  }
}

async function handleOnboardingStep(
  chatId: string,
  telegramUserId: string,
  from: { first_name: string; username?: string },
  text: string,
  state: OnboardingState,
  tenant: Tenant
): Promise<NextResponse> {
  const client = getSupabaseServiceClient()

  if (text.toLowerCase() === "cancel" || text.toLowerCase() === "/cancel") {
    await deleteOnboardingState(chatId, tenant.id)
    await sendMsg(chatId, `Registration cancelled. Send "join" anytime to start again.`, tenant)
    return NextResponse.json({ success: true, action: "onboarding_cancelled" })
  }

  switch (state.step) {
    case 'name':
      if (text.length < 2 || !/^[a-zA-Z\s]+$/.test(text)) {
        await sendMsg(chatId, `Please enter a valid name (letters only, at least 2 characters).`, tenant)
        return NextResponse.json({ success: true })
      }
      state.data.name = text.trim()
      state.step = 'phone'
      await setOnboardingState(chatId, tenant.id, state)
      await sendMsg(chatId, `<b>Step 2/5:</b> What's your phone number?\n\n(Format: 123-456-7890 or similar)`, tenant)
      return NextResponse.json({ success: true, action: "name_collected" })

    case 'phone': {
      const cleanPhone = text.replace(/[\s\-\(\)]/g, '')
      if (!PHONE_PATTERN.test(text) || cleanPhone.length < 10) {
        await sendMsg(chatId, `Please enter a valid phone number (at least 10 digits).`, tenant)
        return NextResponse.json({ success: true })
      }
      state.data.phone = cleanPhone.startsWith('+') ? cleanPhone : `+1${cleanPhone}`
      state.step = 'address'
      await setOnboardingState(chatId, tenant.id, state)
      await sendMsg(chatId, `<b>Step 3/5:</b> What's your home address?\n\nWe use it to plan efficient routes.\n\n(e.g., "123 Main St, Cedar Rapids, IA 52401")`, tenant)
      return NextResponse.json({ success: true, action: "phone_collected" })
    }

    case 'address':
      if (text.trim().length < 5) {
        await sendMsg(chatId, `Please enter a valid street address.`, tenant)
        return NextResponse.json({ success: true })
      }
      state.data.home_address = text.trim()
      state.step = 'days'
      await setOnboardingState(chatId, tenant.id, state)
      await sendMsg(chatId, `<b>Step 4/5:</b> Which days are you available to work?\n\nExamples:\n• "Weekdays" (Mon-Fri)\n• "Mon-Sat"\n• "Mon, Wed, Fri"\n• "Every day"`, tenant)
      return NextResponse.json({ success: true, action: "address_collected" })

    case 'days': {
      const parsedDays = parseDaysInput(text)
      if (!parsedDays || parsedDays.length === 0) {
        await sendMsg(chatId, `I couldn't understand that. Examples: "Weekdays", "Mon-Fri", "Mon, Wed, Fri"`, tenant)
        return NextResponse.json({ success: true })
      }
      state.data.availableDays = parsedDays
      state.step = 'hours'
      await setOnboardingState(chatId, tenant.id, state)
      const daysList = parsedDays.map(d => DAY_LABELS[d]).join(', ')
      await sendMsg(chatId, `Got it: <b>${daysList}</b>\n\n<b>Step 5/5:</b> What hours are you available on those days?\n\nExamples:\n• "8am-5pm"\n• "9:00am-6:00pm"`, tenant)
      return NextResponse.json({ success: true, action: "days_collected" })
    }

    case 'hours': {
      const timeRange = parseTimeRange(text)
      if (!timeRange) {
        await sendMsg(chatId, `I couldn't understand that. Please enter your hours like "8am-5pm" or "9:00am-6:00pm"`, tenant)
        return NextResponse.json({ success: true })
      }
      state.data.startTime = timeRange[0]
      state.data.endTime = timeRange[1]
      state.step = 'confirm'
      await setOnboardingState(chatId, tenant.id, state)
      const daysList = (state.data.availableDays || []).map(d => DAY_LABELS[d]).join(', ')
      await sendMsg(chatId, `<b>Please confirm your details:</b>\n\nName: ${state.data.name}\nPhone: ${state.data.phone}\nHome Address: ${state.data.home_address}\nAvailable Days: ${daysList}\nHours: ${formatTime12h(state.data.startTime!)} - ${formatTime12h(state.data.endTime!)}\n\nType <b>YES</b> to confirm or <b>NO</b> to start over.`, tenant)
      return NextResponse.json({ success: true, action: "hours_collected" })
    }

    case 'confirm':
      if (text.toLowerCase() === 'yes' || text.toLowerCase() === 'y') {
        let homeLat: number | null = null
        let homeLng: number | null = null
        let formattedAddress: string | null = state.data.home_address || null

        if (state.data.home_address) {
          const geo = await geocodeAddress(state.data.home_address)
          if (geo) {
            homeLat = geo.lat
            homeLng = geo.lng
            formattedAddress = geo.formattedAddress
          }
        }

        const availabilityData = (state.data.availableDays && state.data.startTime && state.data.endTime)
          ? { rules: [{ days: state.data.availableDays, start: state.data.startTime, end: state.data.endTime }] }
          : null

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
            is_team_lead: false,
            employee_type: isEstimateFlow(tenant) ? 'salesman' : 'technician',
          })
          .select("id, name")
          .single()

        if (insertError) {
          console.error(`[Telegram/${tenant.slug}] Error creating cleaner:`, insertError)
          await sendMsg(chatId, `There was an error registering you. Please try again or contact support.`, tenant)
          await deleteOnboardingState(chatId, tenant.id)
          return NextResponse.json({ success: false, error: "Failed to create cleaner" })
        }

        // Add to team
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
          await client.from("team_members").insert({
            tenant_id: tenant.id,
            team_id: existingTeam.id,
            cleaner_id: newCleaner.id,
            role: "member",
            is_active: true,
          })
        }

        await deleteOnboardingState(chatId, tenant.id)
        await sendMsg(chatId, `<b>Welcome aboard, ${state.data.name}!</b> 🎉\n\nYou're now registered and will receive job notifications here.\n\n<b>Quick tips:</b>\n• You'll get notified here when you're assigned a job\n• Report tips: "tip job 123 - $20"\n• Report upsells: "upsell job 123 - deep clean"\n\nQuestions? Reply here and a team lead will help.`, tenant)

        await logSystemEvent({
          source: "telegram",
          event_type: "CLEANER_BROADCAST",
          message: `New ${getRoleLabel(tenant)} registered via Telegram: ${state.data.name}`,
          cleaner_id: newCleaner.id,
          phone_number: state.data.phone,
          metadata: { telegram_id: telegramUserId, registration_method: "telegram_onboarding", employee_type: isEstimateFlow(tenant) ? 'salesman' : 'technician' }
        })

        return NextResponse.json({ success: true, action: "cleaner_registered", cleaner_id: newCleaner.id })
      } else if (text.toLowerCase() === 'no' || text.toLowerCase() === 'n') {
        await setOnboardingState(chatId, tenant.id, { step: 'name', data: {}, startedAt: Date.now() })
        await sendMsg(chatId, `No problem, let's start over.\n\n<b>Step 1/5:</b> What's your full name?`, tenant)
        return NextResponse.json({ success: true, action: "onboarding_restart" })
      } else {
        await sendMsg(chatId, `Please type <b>YES</b> to confirm or <b>NO</b> to start over.`, tenant)
        return NextResponse.json({ success: true })
      }

    default:
      await deleteOnboardingState(chatId, tenant.id)
      return NextResponse.json({ success: true })
  }
}

async function buildScheduleResponse(userMessage: string, cleanerId: string | null, cleanerName: string, tenantId?: string, roleLabel: string = 'cleaner'): Promise<string> {
  if (!cleanerId) {
    return `Hi! You're not registered as a ${roleLabel} yet. Send "join" to get set up.`
  }

  const supabase = getSupabaseServiceClient()
  const tz = 'America/Chicago'
  const nowLocal = new Date().toLocaleDateString('en-CA', { timeZone: tz })
  const tomorrowLocal = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: tz })

  const msgLower = userMessage.toLowerCase()
  const askingTomorrow = /tomorrow/.test(msgLower)
  const askingToday = !askingTomorrow && (/today|tonight|my\s+schedule|my\s+jobs?|my\s+shift/.test(msgLower))
  const askingWeek = !askingTomorrow && !askingToday && /week|upcoming/.test(msgLower)
  const targetDate = askingTomorrow ? tomorrowLocal : nowLocal
  const dateLabel = askingTomorrow ? 'tomorrow' : askingToday ? 'today' : 'upcoming'

  const { data: assignments } = await supabase
    .from('cleaner_assignments')
    .select('job_id')
    .eq('cleaner_id', cleanerId)
    .in('status', ['confirmed', 'pending'])

  const jobIds = (assignments || []).map((a: any) => a.job_id).filter(Boolean)
  if (jobIds.length === 0) {
    return `Hi ${cleanerName}! You have no upcoming jobs assigned to you right now.`
  }

  let jobQuery = supabase
    .from('jobs')
    .select('id, date, scheduled_at, address, service_type, status')
    .in('id', jobIds)
    .neq('status', 'cancelled')
    .order('date', { ascending: true })
  if (tenantId) jobQuery = jobQuery.eq('tenant_id', tenantId)

  if (askingWeek) {
    const weekEnd = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-CA', { timeZone: tz })
    jobQuery = jobQuery.gte('date', nowLocal).lte('date', weekEnd)
  } else {
    jobQuery = jobQuery.eq('date', targetDate)
  }

  const { data: jobs } = await jobQuery.limit(15)

  if (!jobs || jobs.length === 0) {
    const dayLabel = askingTomorrow ? 'tomorrow' : askingWeek ? 'this week' : 'today'
    return `Hi ${cleanerName}! You have no jobs scheduled for ${dayLabel}. Enjoy the time off!`
  }

  function formatTime(t: string | null): string {
    if (!t) return 'TBD'
    const twelvehr = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
    if (twelvehr) return t.trim()
    const twentyfour = t.match(/^(\d{1,2}):(\d{2})/)
    if (twentyfour) {
      let h = parseInt(twentyfour[1], 10)
      const m = twentyfour[2]
      const ampm = h >= 12 ? 'PM' : 'AM'
      if (h === 0) h = 12
      else if (h > 12) h -= 12
      return `${h}:${m} ${ampm}`
    }
    return t
  }

  function formatDate(d: string): string {
    const [y, mo, day] = d.split('-').map(Number)
    return new Date(y, mo - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  const header = askingWeek ? `📅 Your schedule this week, ${cleanerName}:` : `📅 Your jobs for ${dateLabel}, ${cleanerName}:`
  const lines = jobs.map((j: any, i: number) => {
    const time = formatTime(j.scheduled_at)
    const addr = j.address || 'Address TBD'
    const service = j.service_type || 'Cleaning'
    const datePart = askingWeek ? `${formatDate(j.date)} ` : ''
    return `${i + 1}. ${datePart}${time} — ${service}\n   📍 ${addr} (Job #${j.id})`
  })

  return `${header}\n\n${lines.join('\n\n')}\n\nQuestions? Reply here or use /start to see all commands.`
}

/**
 * AI-powered cleaner assistant with tool-calling for info updates.
 *
 * Cleaners can:
 * - Update their phone, address, name, email, availability
 * - Ask questions about their assigned jobs
 * - Get general help
 *
 * NEVER reveals: full job price, pay percentage, business financials
 */
async function handleCleanerAI(
  userMessage: string,
  cleaner: { id: string; name: string; active: boolean; is_team_lead: boolean; phone: string | null; email: string | null } | null,
  chatId: string,
  telegramUserId: string,
  firstName: string,
  tenant: Tenant
): Promise<{ response: string; action?: string }> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) return { response: getDefaultFallbackResponse(!!cleaner?.is_team_lead, getRoleLabel(tenant)) }

  try {
    const supabase = getSupabaseServiceClient()
    const userName = cleaner?.name || firstName

    // Build job context for this cleaner
    const roleLabel = getRoleLabel(tenant)
    let jobContext = ""
    let cleanerInfoContext = ""
    if (cleaner?.id) {
      // Get current cleaner info
      const { data: cleanerData } = await supabase
        .from("cleaners")
        .select("name, phone, email, home_address, availability")
        .eq("id", cleaner.id)
        .single()
      if (cleanerData) {
        const avail = cleanerData.availability as { rules?: { days?: string[]; start?: string; end?: string }[] } | null
        const availStr = avail?.rules?.[0]
          ? `${(avail.rules[0].days || []).join(', ')} ${avail.rules[0].start || ''}-${avail.rules[0].end || ''}`
          : 'Not set'
        cleanerInfoContext = `\n\n${roleLabel.toUpperCase()}'S CURRENT INFO:\nName: ${cleanerData.name}\nPhone: ${cleanerData.phone || 'Not set'}\nEmail: ${cleanerData.email || 'Not set'}\nHome Address: ${cleanerData.home_address || 'Not set'}\nAvailability: ${availStr}`
      }

      const today = new Date().toLocaleDateString('en-CA', { timeZone: tenant.timezone || 'America/Chicago' })
      const { data: assignments } = await supabase
        .from("cleaner_assignments")
        .select("job_id")
        .eq("cleaner_id", cleaner.id)
        .in("status", ["confirmed", "pending"])
      const jobIds = (assignments || []).map((a: any) => a.job_id).filter(Boolean)
      if (jobIds.length > 0) {
        const { data: jobs } = await supabase
          .from("jobs")
          .select("id, date, scheduled_at, address, service_type, status, hours, notes")
          .in("id", jobIds)
          .eq("tenant_id", tenant.id)
          .gte("date", today)
          .not("status", "in", '("completed","cancelled")')
          .order("date", { ascending: true })
          .limit(10)
        if (jobs && jobs.length > 0) {
          const jobLines = jobs.map((j: any) =>
            `- Job #${j.id}: ${j.date || 'TBD'} at ${j.scheduled_at || 'TBD'}, ${j.service_type || 'Cleaning'} at ${j.address || 'Address not set'}${j.hours ? `, ~${j.hours}h` : ''}${j.notes ? ` (Notes: ${j.notes})` : ''}`
          )
          jobContext = `\n\nUPCOMING JOBS:\n${jobLines.join('\n')}`
        } else {
          jobContext = `\n\nNo upcoming jobs assigned.`
        }
      } else {
        jobContext = `\n\nNo upcoming jobs assigned.`
      }
    } else {
      jobContext = `\n\nThis user is NOT registered as a ${getRoleLabel(tenant)}. Tell them to send "join" to register.`
    }

    const tools: Anthropic.Tool[] = cleaner?.id ? [
      {
        name: "update_cleaner_info",
        description: "Update the team member's personal information in the system. Use this when they ask to change their phone number, email, name, or home address.",
        input_schema: {
          type: "object" as const,
          properties: {
            field: { type: "string", enum: ["name", "phone", "email", "home_address"], description: "The field to update" },
            value: { type: "string", description: "The new value" }
          },
          required: ["field", "value"]
        }
      },
      {
        name: "update_availability",
        description: "Update the team member's work availability schedule. Use this when they want to change what days/hours they work.",
        input_schema: {
          type: "object" as const,
          properties: {
            days: { type: "array", items: { type: "string", enum: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] }, description: "Days available" },
            start_time: { type: "string", description: "Start time in HH:MM 24h format (e.g. 08:00)" },
            end_time: { type: "string", description: "End time in HH:MM 24h format (e.g. 17:00)" }
          },
          required: ["days", "start_time", "end_time"]
        }
      }
    ] : []

    const client = new Anthropic({ apiKey: anthropicKey })
    const roleCap = roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1)
    const systemPrompt = `You are a helpful, friendly assistant for ${tenant.business_name_short || tenant.name}'s team Telegram bot. The user's name is ${userName}. They are a ${roleLabel}.${cleaner?.is_team_lead ? " They are also a team lead." : ""}${cleanerInfoContext}${jobContext}

IMPORTANT: This person's role is "${roleLabel}". Always refer to them and their colleagues as "${roleLabel}s", never as "cleaners" or "technicians".

CAPABILITIES:
- Answer questions about their assigned jobs (dates, times, addresses, service type, notes)
- Update their personal info (phone, email, name, address) using the update_cleaner_info tool
- Update their availability schedule using the update_availability tool
- Help with tips, upsells, and general questions

STRICT RULES - NEVER VIOLATE:
- NEVER reveal the price/revenue of any job. If asked "how much does this job pay" or "what's the job price", tell them their pay was shown in the job notification and to check that message.
- NEVER discuss pay percentages, commission splits, or business revenue.
- NEVER share other ${roleLabel}s' personal info, pay, or schedules.
- If asked about pay structure, say "Your pay is shown on each job notification when it's offered to you."
- Keep responses concise (2-4 sentences). Use plain text, no markdown.
- When updating info, use the tools provided. Confirm the update to the user after.
- For availability updates, convert natural language days to codes: Monday=MO, Tuesday=TU, etc. Convert times to 24h format.`

    let messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }]

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages,
      system: systemPrompt,
      tools: tools.length > 0 ? tools : undefined,
    })

    // Process tool calls if any
    const toolUseBlocks = response.content.filter(b => b.type === "tool_use")
    const textBlocks = response.content.filter(b => b.type === "text")

    if (toolUseBlocks.length > 0 && cleaner?.id) {
      const toolResults: Anthropic.MessageParam[] = []
      const toolResultContents: Anthropic.ToolResultBlockParam[] = []

      for (const toolUse of toolUseBlocks) {
        if (toolUse.type !== "tool_use") continue
        const input = toolUse.input as Record<string, any>

        if (toolUse.name === "update_cleaner_info") {
          const { field, value } = input
          const allowedFields = ["name", "phone", "email", "home_address"]
          if (!allowedFields.includes(field)) {
            toolResultContents.push({ type: "tool_result", tool_use_id: toolUse.id, content: `Error: Cannot update field "${field}"` })
            continue
          }

          const updateData: Record<string, any> = { [field]: value, updated_at: new Date().toISOString() }

          // Geocode if address update
          if (field === "home_address") {
            try {
              const geo = await geocodeAddress(value)
              if (geo) {
                updateData.home_lat = geo.lat
                updateData.home_lng = geo.lng
                updateData.home_address = geo.formattedAddress
              }
            } catch { /* geocode failed, keep raw address */ }
          }

          // Format phone if phone update
          if (field === "phone") {
            const cleanPhone = value.replace(/[\s\-\(\)]/g, '')
            updateData.phone = cleanPhone.startsWith('+') ? cleanPhone : `+1${cleanPhone}`
          }

          const { error } = await supabase
            .from("cleaners")
            .update(updateData)
            .eq("id", cleaner.id)

          if (error) {
            console.error(`[Telegram/${tenant.slug}] Failed to update cleaner ${field}:`, error)
            toolResultContents.push({ type: "tool_result", tool_use_id: toolUse.id, content: `Error updating ${field}: ${error.message}` })
          } else {
            toolResultContents.push({ type: "tool_result", tool_use_id: toolUse.id, content: `Successfully updated ${field} to "${updateData[field] || value}"` })
          }
        }

        if (toolUse.name === "update_availability") {
          const { days, start_time, end_time } = input
          const availability = { rules: [{ days, start: start_time, end: end_time }] }

          const { error } = await supabase
            .from("cleaners")
            .update({ availability, updated_at: new Date().toISOString() })
            .eq("id", cleaner.id)

          if (error) {
            console.error(`[Telegram/${tenant.slug}] Failed to update availability:`, error)
            toolResultContents.push({ type: "tool_result", tool_use_id: toolUse.id, content: `Error updating availability: ${error.message}` })
          } else {
            const dayLabels = (days as string[]).map((d: string) => DAY_LABELS[d] || d).join(', ')
            toolResultContents.push({ type: "tool_result", tool_use_id: toolUse.id, content: `Successfully updated availability to ${dayLabels}, ${start_time}-${end_time}` })
          }
        }
      }

      // Send tool results back to get final response
      messages = [
        { role: "user", content: userMessage },
        { role: "assistant", content: response.content },
        { role: "user", content: toolResultContents }
      ]

      const followUp = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages,
        system: systemPrompt,
        tools,
      })

      const followUpText = followUp.content.find(b => b.type === "text")
      if (followUpText?.type === "text" && followUpText.text) {
        return { response: followUpText.text.trim(), action: "cleaner_info_updated" }
      }
      // If no text in follow-up, use original text blocks
      if (textBlocks.length > 0 && textBlocks[0].type === "text") {
        return { response: textBlocks[0].text.trim(), action: "cleaner_info_updated" }
      }
      return { response: "Done! Your information has been updated.", action: "cleaner_info_updated" }
    }

    // No tool calls — just return text
    if (textBlocks.length > 0 && textBlocks[0].type === "text") {
      return { response: textBlocks[0].text.trim() }
    }
    return { response: getDefaultFallbackResponse(!!cleaner?.is_team_lead, roleLabel) }
  } catch (error) {
    console.error(`[Telegram/${tenant.slug}] AI response error:`, error)
    return { response: getDefaultFallbackResponse(!!cleaner?.is_team_lead, getRoleLabel(tenant)) }
  }
}

function getDefaultFallbackResponse(isTeamLead: boolean, roleLabel: string = 'cleaner'): string {
  return `I didn't quite understand that. Here's what I can help with:\n\n• New ${roleLabel}? Send "join" to register\n• Report a tip: "tip job 123 - $20"\n• Report an upsell: "upsell job 123 - deep clean"\n• Check your schedule: "my schedule"\n• Update your info: "update my phone to 555-123-4567"\n• Need help? Send /start`
}
