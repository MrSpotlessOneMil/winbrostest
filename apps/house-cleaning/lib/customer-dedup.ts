import type { SupabaseClient } from "@supabase/supabase-js"

export interface LeadCustomerInput {
  tenant_id: string
  phone_number: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  address?: string | null
  lead_source?: string | null
}

export interface DedupMatch {
  reason: "email_match" | "phone_match"
  existing_id: number
  existing_phone: string | null
  existing_email: string | null
}

export interface DedupResult {
  customer_id: number
  was_merged: boolean
  match?: DedupMatch
  duplicate_first_name_count?: number
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const trimmed = email.trim().toLowerCase()
  return trimmed || null
}

export async function upsertLeadCustomer(
  client: SupabaseClient,
  input: LeadCustomerInput
): Promise<DedupResult | null> {
  const { tenant_id, phone_number } = input
  const email = normalizeEmail(input.email)

  if (email) {
    const { data: byEmail } = await client
      .from("customers")
      .select("id, phone_number, email, first_name, last_name")
      .eq("tenant_id", tenant_id)
      .ilike("email", email)
      .limit(2)

    if (byEmail && byEmail.length === 1) {
      const existing = byEmail[0] as {
        id: number
        phone_number: string | null
        email: string | null
        first_name: string | null
        last_name: string | null
      }

      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }
      if (!existing.phone_number && phone_number) updateData.phone_number = phone_number
      if (!existing.first_name && input.first_name) updateData.first_name = input.first_name
      if (!existing.last_name && input.last_name) updateData.last_name = input.last_name
      if (input.address) updateData.address = input.address

      await client.from("customers").update(updateData).eq("id", existing.id)

      return {
        customer_id: existing.id,
        was_merged: true,
        match: {
          reason: "email_match",
          existing_id: existing.id,
          existing_phone: existing.phone_number,
          existing_email: existing.email,
        },
      }
    }

    if (byEmail && byEmail.length > 1) {
      console.warn(
        `[customer-dedup] Email ${email} appears on ${byEmail.length} customers in tenant ${tenant_id} — falling back to phone match`
      )
    }
  }

  const { data: byPhone } = await client
    .from("customers")
    .select("id, phone_number, email, first_name, last_name")
    .eq("tenant_id", tenant_id)
    .eq("phone_number", phone_number)
    .maybeSingle()

  if (byPhone) {
    const existing = byPhone as {
      id: number
      phone_number: string | null
      email: string | null
      first_name: string | null
      last_name: string | null
    }
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (email && !existing.email) updateData.email = email
    if (input.first_name && !existing.first_name) updateData.first_name = input.first_name
    if (input.last_name && !existing.last_name) updateData.last_name = input.last_name
    if (input.address) updateData.address = input.address

    await client.from("customers").update(updateData).eq("id", existing.id)
    return { customer_id: existing.id, was_merged: false }
  }

  const { data: created, error } = await client
    .from("customers")
    .insert({
      tenant_id,
      phone_number,
      first_name: input.first_name || null,
      last_name: input.last_name || null,
      email,
      address: input.address || null,
      lead_source: input.lead_source || null,
    })
    .select("id")
    .single()

  if (error || !created) {
    console.error("[customer-dedup] insert failed", error)
    return null
  }

  const newId = Number((created as { id: number }).id)

  let duplicateFirstNameCount = 0
  if (input.first_name) {
    const { count } = await client
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant_id)
      .ilike("first_name", input.first_name.trim())
      .neq("id", newId)
    duplicateFirstNameCount = count ?? 0
  }

  return {
    customer_id: newId,
    was_merged: false,
    duplicate_first_name_count: duplicateFirstNameCount,
  }
}
