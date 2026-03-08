/**
 * Tenant Settings API
 *
 * GET  /api/actions/settings — returns current scheduling config
 * POST /api/actions/settings — updates scheduling config fields in workflow_config
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

// route-check:no-vercel-cron

const ALLOWED_FIELDS = [
  "business_hours_start",
  "business_hours_end",
  "salesman_buffer_minutes",
  "technician_buffer_minutes",
] as const

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  const wc = ((authTenant.workflow_config ?? {}) as unknown as Record<string, unknown>)

  return NextResponse.json({
    success: true,
    settings: {
      business_hours_start: wc.business_hours_start ?? 480,
      business_hours_end: wc.business_hours_end ?? 1020,
      salesman_buffer_minutes: wc.salesman_buffer_minutes ?? 30,
      technician_buffer_minutes: wc.technician_buffer_minutes ?? 30,
    },
    service_description: authTenant.service_description || null,
    tenant_name: authTenant.name,
  })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  const body = await request.json()

  // Validate: only accept known fields with numeric values
  const updates: Record<string, number> = {}
  for (const field of ALLOWED_FIELDS) {
    if (field in body) {
      const val = Number(body[field])
      if (!Number.isFinite(val) || val < 0) {
        return NextResponse.json(
          { success: false, error: `Invalid value for ${field}` },
          { status: 400 }
        )
      }
      updates[field] = val
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { success: false, error: "No valid settings provided" },
      { status: 400 }
    )
  }

  // Validate business hours range
  const wc = ((authTenant.workflow_config ?? {}) as unknown as Record<string, unknown>)
  const newStart = updates.business_hours_start ?? wc.business_hours_start ?? 480
  const newEnd = updates.business_hours_end ?? wc.business_hours_end ?? 1020
  if (newStart >= newEnd) {
    return NextResponse.json(
      { success: false, error: "Business hours start must be before end" },
      { status: 400 }
    )
  }

  // Merge into existing workflow_config
  const merged = { ...wc, ...updates }

  const client = getSupabaseServiceClient()
  const { error } = await client
    .from("tenants")
    .update({ workflow_config: merged })
    .eq("id", authTenant.id)

  if (error) {
    console.error("[settings] Update failed:", error.message)
    return NextResponse.json(
      { success: false, error: "Failed to save settings" },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, settings: updates })
}
