import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { toE164 } from "@/lib/phone-utils"

/**
 * POST — Pull all contacts from OpenPhone and sync names/emails into customers table.
 * Matches by phone number. Only updates customers that are missing names.
 * Also creates new customer records for contacts not yet in our DB.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const apiKey = tenant.openphone_api_key || process.env.OPENPHONE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "OpenPhone API key not configured" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Fetch all contacts from OpenPhone (paginated)
  const allContacts: any[] = []
  let pageToken: string | null = null

  try {
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

      if (!res.ok) {
        const errText = await res.text()
        return NextResponse.json({ error: `OpenPhone API error: ${res.status} — ${errText}` }, { status: 502 })
      }

      const json = await res.json()
      allContacts.push(...(json.data || []))
      pageToken = json.nextPageToken || null
    } while (pageToken)
  } catch (err) {
    return NextResponse.json({
      error: `Failed to fetch OpenPhone contacts: ${err instanceof Error ? err.message : "Unknown"}`,
    }, { status: 502 })
  }

  // Process contacts — match by phone, update names
  let updated = 0
  let created = 0
  let skipped = 0

  for (const contact of allContacts) {
    const firstName = contact.defaultFields?.firstName || ""
    const lastName = contact.defaultFields?.lastName || ""
    const phones: string[] = (contact.defaultFields?.phoneNumbers || []).map((p: any) => p.value).filter(Boolean)
    const email = (contact.defaultFields?.emails || [])[0]?.value || null

    if (!firstName && !lastName) {
      skipped++
      continue
    }
    if (phones.length === 0) {
      skipped++
      continue
    }

    for (const rawPhone of phones) {
      const phone = toE164(rawPhone)
      if (!phone) continue

      // Try to find existing customer by phone
      const { data: existing } = await supabase
        .from("customers")
        .select("id, first_name, last_name")
        .eq("tenant_id", tenant.id)
        .eq("phone_number", phone)
        .limit(1)
        .single()

      if (existing) {
        // Only update if name is missing
        if (!existing.first_name && !existing.last_name) {
          await supabase
            .from("customers")
            .update({
              first_name: firstName.trim() || null,
              last_name: lastName.trim() || null,
              ...(email && !existing.first_name ? { email } : {}),
            })
            .eq("id", existing.id)
          updated++
        } else {
          skipped++
        }
      } else {
        // Create new customer from OpenPhone contact
        const { error: insertErr } = await supabase
          .from("customers")
          .insert({
            tenant_id: tenant.id,
            phone_number: phone,
            first_name: firstName.trim() || null,
            last_name: lastName.trim() || null,
            email: email || null,
          })
        if (!insertErr) {
          created++
        } else {
          skipped++ // Likely duplicate phone constraint
        }
      }
    }
  }

  return NextResponse.json({
    success: true,
    total_contacts: allContacts.length,
    updated,
    created,
    skipped,
  })
}
