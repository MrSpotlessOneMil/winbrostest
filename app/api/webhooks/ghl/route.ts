import { NextRequest, NextResponse } from "next/server"
import { getSupabaseClient } from "@/lib/supabase"
import { normalizePhoneNumber } from "@/lib/phone-utils"

// Minimal GoHighLevel webhook handler:
// stores incoming leads into `public.leads`.
export async function POST(request: NextRequest) {
  let payload: any
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  const data = payload?.data || payload
  const contact = data?.contact || data?.contactData || data

  const phoneRaw =
    contact?.phone ||
    contact?.phoneNumber ||
    contact?.phone_number ||
    data?.phone ||
    data?.phoneNumber ||
    data?.phone_number ||
    ""

  const phone = normalizePhoneNumber(String(phoneRaw)) || String(phoneRaw)
  if (!phone) return NextResponse.json({ success: true, ignored: true })

  const firstName = contact?.firstName || contact?.first_name || ""
  const lastName = contact?.lastName || contact?.last_name || ""
  const email = contact?.email || ""

  const sourceId =
    contact?.id ||
    data?.contactId ||
    data?.source_id ||
    `ghl-${Date.now()}`

  const locationId =
    data?.locationId ||
    data?.location_id ||
    payload?.locationId ||
    payload?.location_id ||
    null

  const client = getSupabaseClient()

  // Upsert customer for linking later
  const { data: customer } = await client
    .from("customers")
    .upsert({ phone_number: phone, first_name: firstName || null, last_name: lastName || null, email: email || null }, { onConflict: "phone_number" })
    .select("id")
    .single()

  await client.from("leads").insert({
    source_id: String(sourceId),
    ghl_location_id: locationId ? String(locationId) : null,
    phone_number: phone,
    customer_id: customer?.id ?? null,
    first_name: firstName || null,
    last_name: lastName || null,
    email: email || null,
    source: "meta",
    status: "new",
    form_data: payload,
  })

  return NextResponse.json({ success: true })
}

