import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { toE164 } from "@/lib/phone-utils"

/**
 * POST — Pull ALL phone numbers from OpenPhone (contacts + message history)
 * and create customer records for every unique number.
 * Matches by phone number. Updates names where missing. Creates new records for unknown numbers.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const apiKey = tenant.openphone_api_key || process.env.OPENPHONE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "OpenPhone API key not configured" }, { status: 400 })
  }

  const phoneNumberId = tenant.openphone_phone_id || process.env.OPENPHONE_PHONE_ID
  const businessPhone = tenant.openphone_phone_number || process.env.OPENPHONE_PHONE_NUMBER

  const supabase = getSupabaseServiceClient()

  // Collect all unique phone numbers with any name/email info we find
  // Map: E164 phone → { firstName, lastName, email }
  const phoneMap = new Map<string, { firstName: string; lastName: string; email: string | null }>()

  // ── Step 1: Pull all contacts (saved contacts with names) ──
  let contactCount = 0
  try {
    let pageToken: string | null = null
    do {
      const url = new URL("https://api.openphone.com/v1/contacts")
      url.searchParams.set("maxResults", "50")
      if (pageToken) url.searchParams.set("pageToken", pageToken)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)

      const res = await fetch(url.toString(), {
        headers: { Authorization: apiKey },
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) break // Don't fail entirely, continue to messages

      const json = await res.json()
      const contacts = json.data || []
      contactCount += contacts.length

      for (const contact of contacts) {
        const firstName = contact.defaultFields?.firstName || ""
        const lastName = contact.defaultFields?.lastName || ""
        const phones: string[] = (contact.defaultFields?.phoneNumbers || []).map((p: any) => p.value).filter(Boolean)
        const email = (contact.defaultFields?.emails || [])[0]?.value || null

        for (const rawPhone of phones) {
          const phone = toE164(rawPhone)
          if (!phone) continue
          // Keep the best name info we have (contacts have better data)
          const existing = phoneMap.get(phone)
          if (!existing || (!existing.firstName && firstName)) {
            phoneMap.set(phone, { firstName: firstName.trim(), lastName: lastName.trim(), email })
          }
        }
      }

      pageToken = json.nextPageToken || null
    } while (pageToken)
  } catch (err) {
    console.error(`[${tenant.slug}] Failed to fetch OpenPhone contacts:`, err)
    // Continue to messages even if contacts fail
  }

  // ── Step 2: Pull all messages to find every number that ever texted ──
  let messagePages = 0
  if (phoneNumberId) {
    try {
      let pageToken: string | null = null
      do {
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

        if (!res.ok) break

        const json = await res.json()
        const messages = json.data || []
        messagePages++

        for (const msg of messages) {
          // Get the external phone number (not our business number)
          const from = msg.from
          const to = msg.to

          const externalNumbers: string[] = []
          if (from && from !== businessPhone) externalNumbers.push(from)
          if (Array.isArray(to)) {
            for (const t of to) {
              if (t && t !== businessPhone) externalNumbers.push(t)
            }
          } else if (to && to !== businessPhone) {
            externalNumbers.push(to)
          }

          for (const rawPhone of externalNumbers) {
            const phone = toE164(rawPhone)
            if (!phone) continue
            if (!phoneMap.has(phone)) {
              phoneMap.set(phone, { firstName: "", lastName: "", email: null })
            }
          }
        }

        pageToken = json.nextPageToken || null
      } while (pageToken)
    } catch (err) {
      console.error(`[${tenant.slug}] Failed to fetch OpenPhone messages:`, err)
    }
  }

  // ── Step 3: Pull all calls to find every number that ever called ──
  if (phoneNumberId) {
    try {
      let pageToken: string | null = null
      do {
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

        for (const call of calls) {
          const from = call.from
          const to = call.to

          const externalNumbers: string[] = []
          if (from && from !== businessPhone) externalNumbers.push(from)
          if (to && to !== businessPhone) externalNumbers.push(to)

          for (const rawPhone of externalNumbers) {
            const phone = toE164(rawPhone)
            if (!phone) continue
            if (!phoneMap.has(phone)) {
              phoneMap.set(phone, { firstName: "", lastName: "", email: null })
            }
          }
        }

        pageToken = json.nextPageToken || null
      } while (pageToken)
    } catch (err) {
      console.error(`[${tenant.slug}] Failed to fetch OpenPhone calls:`, err)
    }
  }

  // ── Step 4: Upsert all numbers into customers table ──
  let updated = 0
  let created = 0
  let skipped = 0

  // Filter out our own business number
  const businessE164 = businessPhone ? toE164(businessPhone) : null

  // Profanity filter for contact names — strip slurs, derogatory labels, offensive descriptors
  const profanityWords = /\b(fuck|shit|bitch|cunt|nigger|nigga|whore|slut|retard|fag|faggot|dick|cock|pussy|bastard|motherfuck|asshole|dumbass|shithead|twat|wanker|prick|douche|skank|tramp|thot|cracker|spic|chink|gook|kike|wetback|beaner|coon|darkie|dyke|lesbo|tranny|shemale|hoe)\b/gi
  const offensivePatterns = /\b(silly|dummy|dumb|stupid|ugly|idiot|moron|creepy|sketchy|nasty|gross|trash|garbage|loser|weird|cheap|rude|mean|annoying)\b/gi
  const sanitizeName = (name: string | null): string | null => {
    if (!name) return null
    let cleaned = name.replace(profanityWords, "").replace(offensivePatterns, "").replace(/\s{2,}/g, " ").trim()
    return cleaned || null
  }

  for (const [phone, info] of phoneMap) {
    if (phone === businessE164) continue // Skip our own number

    const cleanFirst = sanitizeName(info.firstName)
    const cleanLast = sanitizeName(info.lastName)

    const { data: existing } = await supabase
      .from("customers")
      .select("id, first_name, last_name")
      .eq("tenant_id", tenant.id)
      .eq("phone_number", phone)
      .limit(1)
      .single()

    if (existing) {
      // Update name if we have one and customer doesn't
      if (!existing.first_name && !existing.last_name && (cleanFirst || cleanLast)) {
        await supabase
          .from("customers")
          .update({
            first_name: cleanFirst,
            last_name: cleanLast,
            ...(info.email ? { email: info.email } : {}),
          })
          .eq("id", existing.id)
        updated++
      } else {
        skipped++ // Already exists with name
      }
    } else {
      // Create new customer
      const { error: insertErr } = await supabase
        .from("customers")
        .insert({
          tenant_id: tenant.id,
          phone_number: phone,
          first_name: cleanFirst,
          last_name: cleanLast,
          email: info.email || null,
        })
      if (!insertErr) {
        created++
      } else {
        skipped++ // Duplicate or constraint error
      }
    }
  }

  return NextResponse.json({
    success: true,
    sources: {
      contacts: contactCount,
      message_pages: messagePages,
      call_history: phoneNumberId ? "scanned" : "skipped (no phoneNumberId)",
    },
    unique_numbers: phoneMap.size,
    created,
    updated,
    skipped,
  })
}
