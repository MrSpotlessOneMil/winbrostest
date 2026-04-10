import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { upsertCustomer } from "@/lib/supabase"

interface BatchCustomer {
  first_name: string
  last_name?: string
  phone_number: string
  email?: string | null
  address?: string | null
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let customers: BatchCustomer[]
  try {
    const body = await request.json()
    customers = body.customers
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!Array.isArray(customers) || customers.length === 0) {
    return NextResponse.json({ error: "Customers array is required" }, { status: 400 })
  }

  if (customers.length > 100) {
    return NextResponse.json({ error: "Maximum 100 customers per batch" }, { status: 400 })
  }

  let created = 0
  let updated = 0
  const errors: string[] = []

  for (const c of customers as BatchCustomer[]) {
    if (!c.phone_number || !c.first_name) {
      errors.push(`Skipped: missing phone or name for "${c.first_name || "unknown"}"`)
      continue
    }

    try {
      const result = await upsertCustomer(
        c.phone_number,
        {
          first_name: c.first_name.trim(),
          last_name: (c.last_name || "").trim(),
          email: c.email?.trim() || undefined,
          address: c.address?.trim() || undefined,
          tenant_id: tenant.id,
        } as any,
        { skipHubSpotSync: true }
      )

      if (result) {
        // If created_at and updated_at are very close, it's a new record
        const createdTime = new Date(result.created_at || 0).getTime()
        const updatedTime = new Date(result.updated_at || 0).getTime()
        if (Math.abs(updatedTime - createdTime) < 2000) {
          created++
        } else {
          updated++
        }
      } else {
        errors.push(`Failed to upsert: ${c.first_name} ${c.last_name || ""} (${c.phone_number})`)
      }
    } catch (err) {
      errors.push(`Error for ${c.phone_number}: ${err instanceof Error ? err.message : "Unknown"}`)
    }
  }

  return NextResponse.json({ success: true, created, updated, errors })
}
