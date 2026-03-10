import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { toE164 } from "@/lib/phone-utils"
import { scheduleRetargetingSequence, RetargetingSequenceType } from "@/lib/scheduler"

const VALID_STAGES: RetargetingSequenceType[] = [
  "unresponsive",
  "quoted_not_booked",
  "one_time",
  "lapsed",
]

interface ImportCustomer {
  first_name: string
  last_name?: string
  phone: string
  email?: string
  address?: string
  stage: string
}

/**
 * POST — Bulk import customers from CSV data + auto-enroll in retargeting
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: { customers: ImportCustomer[]; auto_enroll?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!Array.isArray(body.customers) || body.customers.length === 0) {
    return NextResponse.json({ error: "customers array required" }, { status: 400 })
  }

  if (body.customers.length > 500) {
    return NextResponse.json({ error: "Maximum 500 customers per import" }, { status: 400 })
  }

  const autoEnroll = body.auto_enroll !== false // default true
  const supabase = getSupabaseServiceClient()
  const errors: string[] = []
  let imported = 0
  let enrolled = 0
  let skipped = 0

  for (const row of body.customers) {
    // Validate phone
    const phone = toE164(row.phone)
    if (!phone) {
      skipped++
      errors.push(`Skipped "${row.first_name || "unknown"}": invalid phone "${row.phone}"`)
      continue
    }

    // Validate stage
    const stage = row.stage as RetargetingSequenceType
    if (!VALID_STAGES.includes(stage)) {
      skipped++
      errors.push(`Skipped "${row.first_name || "unknown"}": invalid stage "${row.stage}"`)
      continue
    }

    // Build upsert data — don't overwrite existing data with blanks
    const upsertData: Record<string, unknown> = {
      tenant_id: tenant.id,
      phone_number: phone,
      first_name: row.first_name || "Unknown",
      lifecycle_stage: stage,
      lifecycle_stage_override: stage,
    }
    if (row.last_name) upsertData.last_name = row.last_name
    if (row.email) upsertData.email = row.email
    if (row.address) upsertData.address = row.address

    // Upsert: on conflict update name/stage but don't blank existing fields
    const { data: customer, error: upsertError } = await supabase
      .from("customers")
      .upsert(upsertData, {
        onConflict: "tenant_id,phone_number",
        ignoreDuplicates: false,
      })
      .select("id, first_name, phone_number, sms_opt_out")
      .single()

    if (upsertError) {
      skipped++
      errors.push(`Error for "${row.first_name}": ${upsertError.message}`)
      continue
    }

    imported++

    // Auto-enroll in retargeting (skip opted-out customers)
    if (autoEnroll && customer && !customer.sms_opt_out) {
      const result = await scheduleRetargetingSequence(
        tenant.id,
        customer.id,
        customer.phone_number,
        customer.first_name,
        stage,
      )
      if (result.success) enrolled++
    }
  }

  return NextResponse.json({
    success: true,
    imported,
    enrolled,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  })
}
