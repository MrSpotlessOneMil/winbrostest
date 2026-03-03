import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { upsertCustomer, getSupabaseServiceClient } from "@/lib/supabase"
import { scheduleLeadFollowUp } from "@/lib/scheduler"

interface BatchLead {
  first_name: string
  last_name?: string
  phone_number: string
  email?: string | null
  source: string
}

const VALID_SOURCES = [
  "meta",
  "thumbtack",
  "google",
  "manual",
  "phone",
  "sms",
  "website",
  "email",
]

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const { leads } = await request.json()

  if (!Array.isArray(leads) || leads.length === 0) {
    return NextResponse.json({ error: "Leads array is required" }, { status: 400 })
  }

  if (leads.length > 100) {
    return NextResponse.json({ error: "Maximum 100 leads per batch" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()
  let created = 0
  let skipped = 0
  const errors: string[] = []

  for (const l of leads as BatchLead[]) {
    if (!l.phone_number || !l.first_name) {
      errors.push(`Skipped: missing phone or name for "${l.first_name || "unknown"}"`)
      skipped++
      continue
    }

    const phone = l.phone_number.replace(/\D/g, "")
    const source = VALID_SOURCES.includes(l.source) ? l.source : "manual"
    const name = `${l.first_name.trim()} ${(l.last_name || "").trim()}`.trim()

    try {
      // Check for existing lead with same phone + tenant (skip duplicates)
      const { data: existing } = await supabase
        .from("leads")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("phone_number", phone)
        .in("status", ["new", "contacted", "qualified", "booked", "nurturing"])
        .limit(1)
        .single()

      if (existing) {
        skipped++
        continue
      }

      // Insert lead
      const { data: lead, error: leadErr } = await supabase
        .from("leads")
        .insert({
          tenant_id: tenant.id,
          first_name: l.first_name.trim(),
          last_name: (l.last_name || "").trim(),
          phone_number: phone,
          email: l.email?.trim() || null,
          source,
          status: "new",
        })
        .select("id")
        .single()

      if (leadErr || !lead) {
        errors.push(`Failed to create lead: ${name} (${phone}) — ${leadErr?.message || "unknown"}`)
        continue
      }

      // Upsert customer record
      await upsertCustomer(
        phone,
        {
          first_name: l.first_name.trim(),
          last_name: (l.last_name || "").trim(),
          email: l.email?.trim() || undefined,
          tenant_id: tenant.id,
        } as any,
        { skipHubSpotSync: true }
      )

      // Schedule auto-followup
      await scheduleLeadFollowUp(tenant.id, lead.id, phone, name)

      created++
    } catch (err) {
      errors.push(`Error for ${phone}: ${err instanceof Error ? err.message : "Unknown"}`)
    }
  }

  return NextResponse.json({ success: true, created, skipped, errors })
}
