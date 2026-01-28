import { NextRequest, NextResponse } from "next/server"
import type { ApiResponse, Tip, Upsell } from "@/lib/types"
import { getSupabaseClient } from "@/lib/supabase"

/**
 * Webhook handler for Telegram bot messages
 * 
 * Handles:
 * - Team job confirmations
 * - Tip reports
 * - Upsell reports
 * - Team availability updates
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

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

// Regex patterns for parsing team messages
const TIP_PATTERN = /tip\s+(?:accepted\s+)?job\s+(\d+)\s*[-–]\s*\$?(\d+(?:\.\d{2})?)/i
const UPSELL_PATTERN = /upsold?\s+job\s+(\d+)\s*[-–]\s*(.+)/i
const CONFIRM_PATTERN = /confirm\s+job\s+(\d+)/i

export async function POST(request: NextRequest) {
  try {
    const update: TelegramUpdate = await request.json()

    if (!update.message?.text) {
      return NextResponse.json({ success: true })
    }

    const { text, from, chat } = update.message
    const telegramUserId = from.id.toString()

    console.log(`[OSIRIS] Telegram message from ${from.username || from.first_name}: ${text}`)
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
      // TODO: Call Telegram API to send confirmation message
      
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
