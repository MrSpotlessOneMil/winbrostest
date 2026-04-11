import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { toE164 } from "@/lib/phone-utils"

/**
 * POST — Pull ALL message history from OpenPhone and store in messages table.
 * Deduplicates by openphone_message_id. Links messages to customers by phone.
 * Run multiple times if needed — it picks up where it left off.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const apiKey = tenant.openphone_api_key || process.env.OPENPHONE_API_KEY
  const phoneNumberId = tenant.openphone_phone_id || process.env.OPENPHONE_PHONE_ID
  const businessPhone = tenant.openphone_phone_number || process.env.OPENPHONE_PHONE_NUMBER

  if (!apiKey || !phoneNumberId) {
    return NextResponse.json({ error: "OpenPhone API key or phone ID not configured" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()
  const startTime = Date.now()
  const MAX_RUNTIME_MS = 55_000 // Stop before Vercel 60s timeout

  // Pre-load customer phone → id map for fast lookups
  const { data: customers } = await supabase
    .from("customers")
    .select("id, phone_number")
    .eq("tenant_id", tenant.id)

  const customerMap = new Map<string, number>()
  for (const c of customers || []) {
    if (c.phone_number) customerMap.set(c.phone_number, c.id)
  }

  let imported = 0
  let skippedDupes = 0
  let pagesProcessed = 0
  let hasMore = true

  // ── Pull messages (paginated) ──
  let pageToken: string | null = null

  try {
    while (hasMore) {
      // Check runtime limit
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        return NextResponse.json({
          success: true,
          partial: true,
          message: "Time limit reached — run again to continue importing",
          imported,
          skipped_dupes: skippedDupes,
          pages_processed: pagesProcessed,
        })
      }

      const url = new URL("https://api.openphone.com/v1/messages")
      url.searchParams.set("phoneNumberId", phoneNumberId)
      url.searchParams.set("maxResults", "50")
      if (pageToken) url.searchParams.set("pageToken", pageToken)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)

      const res = await fetch(url.toString(), {
        headers: { Authorization: apiKey },
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) {
        const errText = await res.text()
        return NextResponse.json({
          error: `OpenPhone API error: ${res.status} — ${errText}`,
          imported,
          skipped_dupes: skippedDupes,
          pages_processed: pagesProcessed,
        }, { status: 502 })
      }

      const json = await res.json()
      const messages = json.data || []
      pagesProcessed++

      if (messages.length === 0) {
        hasMore = false
        break
      }

      // Process each message
      for (const msg of messages) {
        const opMessageId = msg.id
        if (!opMessageId) continue

        // Determine direction and external phone
        const from = msg.from || ""
        const toArr = Array.isArray(msg.to) ? msg.to : (msg.to ? [msg.to] : [])
        const businessE164 = businessPhone ? toE164(businessPhone) : null

        let direction: "inbound" | "outbound" = "inbound"
        let externalPhone = ""

        const fromE164 = toE164(from)
        if (fromE164 === businessE164) {
          // We sent this
          direction = "outbound"
          // External is the "to"
          for (const t of toArr) {
            const te = toE164(t)
            if (te && te !== businessE164) {
              externalPhone = te
              break
            }
          }
        } else {
          // They sent this
          direction = "inbound"
          externalPhone = fromE164 || from
        }

        if (!externalPhone) continue

        const phone = toE164(externalPhone) || externalPhone
        const customerId = customerMap.get(phone) || null
        const body = msg.body || msg.text || msg.content || ""
        const createdAt = msg.createdAt || msg.timestamp || new Date().toISOString()

        // Insert (skip dupes via openphone_message_id)
        const { error: insertErr } = await supabase
          .from("messages")
          .insert({
            tenant_id: tenant.id,
            openphone_message_id: opMessageId,
            direction,
            message_type: "sms",
            phone_number: phone,
            from_number: from,
            to_number: toArr[0] || "",
            content: body,
            role: direction === "outbound" ? "assistant" : "user",
            ai_generated: false,
            source: "openphone_sync",
            customer_id: customerId,
            status: "delivered",
            timestamp: createdAt,
          })

        if (!insertErr) {
          imported++
        } else if (insertErr.code === "23505") {
          // Unique constraint violation — already imported
          skippedDupes++
        }
      }

      pageToken = json.nextPageToken || null
      hasMore = !!pageToken

      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 200))
    }
  } catch (err) {
    return NextResponse.json({
      error: `Failed during message sync: ${err instanceof Error ? err.message : "Unknown"}`,
      imported,
      skipped_dupes: skippedDupes,
      pages_processed: pagesProcessed,
    }, { status: 502 })
  }

  // ── Also pull calls ──
  let callsImported = 0
  pageToken = null
  hasMore = true

  try {
    while (hasMore) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        return NextResponse.json({
          success: true,
          partial: true,
          message: "Time limit reached during call sync — run again to continue",
          messages_imported: imported,
          calls_imported: callsImported,
          skipped_dupes: skippedDupes,
          pages_processed: pagesProcessed,
        })
      }

      const url = new URL("https://api.openphone.com/v1/calls")
      url.searchParams.set("phoneNumberId", phoneNumberId)
      url.searchParams.set("maxResults", "50")
      if (pageToken) url.searchParams.set("pageToken", pageToken)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)

      const res = await fetch(url.toString(), {
        headers: { Authorization: apiKey },
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) break

      const json = await res.json()
      const calls = json.data || []
      pagesProcessed++

      if (calls.length === 0) break

      for (const call of calls) {
        const callId = call.id
        if (!callId) continue

        const from = call.from || ""
        const to = call.to || ""
        const businessE164 = businessPhone ? toE164(businessPhone) : null

        let direction: "inbound" | "outbound" = "inbound"
        let externalPhone = ""

        const fromE164 = toE164(from)
        if (fromE164 === businessE164) {
          direction = "outbound"
          externalPhone = toE164(to) || to
        } else {
          direction = "inbound"
          externalPhone = fromE164 || from
        }

        if (!externalPhone) continue

        const phone = toE164(externalPhone) || externalPhone
        const customerId = customerMap.get(phone) || null
        const duration = call.duration || 0
        const createdAt = call.createdAt || call.timestamp || new Date().toISOString()

        const { error: insertErr } = await supabase
          .from("messages")
          .insert({
            tenant_id: tenant.id,
            openphone_message_id: `call_${callId}`,
            direction,
            message_type: "call",
            phone_number: phone,
            from_number: from,
            to_number: to,
            content: `Phone call (${Math.round(duration / 60)}min ${duration % 60}s)`,
            role: direction === "outbound" ? "assistant" : "user",
            ai_generated: false,
            source: "openphone_sync",
            customer_id: customerId,
            status: call.status || "completed",
            timestamp: createdAt,
            metadata: { call_duration: duration, call_status: call.status },
          })

        if (!insertErr) {
          callsImported++
        } else if (insertErr.code === "23505") {
          skippedDupes++
        }
      }

      pageToken = json.nextPageToken || null
      hasMore = !!pageToken

      await new Promise(r => setTimeout(r, 200))
    }
  } catch (err) {
    console.error(`[${tenant.slug}] Call sync error:`, err)
  }

  return NextResponse.json({
    success: true,
    partial: false,
    messages_imported: imported,
    calls_imported: callsImported,
    skipped_dupes: skippedDupes,
    pages_processed: pagesProcessed,
  })
}
