/**
 * Control Center API
 *
 * Single route handling CRUD for all 4 resource types:
 *   messages (automated_messages), pricebook (workflow_config.pricebook JSONB),
 *   tags (tag_definitions), checklists (checklist_templates)
 *
 * GET    /api/actions/control-center?type=messages|pricebook|tags|checklists
 * POST   /api/actions/control-center  { type, data }
 * PATCH  /api/actions/control-center  { type, id, data }
 * DELETE /api/actions/control-center  { type, id }
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

// route-check:no-vercel-cron

type ResourceType = "messages" | "pricebook" | "tags" | "checklists" | "config"

const VALID_TYPES: ResourceType[] = ["messages", "pricebook", "tags", "checklists", "config"]

function isValidType(t: string): t is ResourceType {
  return VALID_TYPES.includes(t as ResourceType)
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  const type = request.nextUrl.searchParams.get("type")
  if (!type || !isValidType(type)) {
    return NextResponse.json(
      { success: false, error: "Invalid type — must be messages, pricebook, tags, or checklists" },
      { status: 400 }
    )
  }

  const client = getSupabaseServiceClient()
  const tenantId = authTenant.id

  switch (type) {
    case "messages": {
      const { data, error } = await client
        .from("automated_messages")
        .select("id, trigger_type, message_template, is_active, created_at")
        .eq("tenant_id", tenantId)
        .order("trigger_type")

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, data: data ?? [] })
    }

    case "pricebook": {
      const wc = (authTenant.workflow_config as unknown as Record<string, unknown>) ?? {}
      const pricebook = (wc.pricebook as Array<Record<string, unknown>>) ?? []
      return NextResponse.json({ success: true, data: pricebook })
    }

    case "tags": {
      const { data, error } = await client
        .from("tag_definitions")
        .select("id, tag_type, tag_value, color, is_active, created_at")
        .eq("tenant_id", tenantId)
        .order("tag_type")
        .order("tag_value")

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, data: data ?? [] })
    }

    case "checklists": {
      const { data, error } = await client
        .from("checklist_templates")
        .select("id, name, items, is_default, created_at")
        .eq("tenant_id", tenantId)
        .order("is_default", { ascending: false })
        .order("name")

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, data: data ?? [] })
    }

    case "config": {
      const wc = (authTenant.workflow_config as unknown as Record<string, unknown>) ?? {}
      return NextResponse.json({
        success: true,
        data: {
          service_plan_label: (wc.service_plan_label as string) || "Service Plans",
          // Phase E2 (Blake 2026-04-28): editable, tenant-wide service-plan
          // agreement. Auto-attached to any quote whose plans are offered to
          // the customer. Empty string = no agreement attached yet.
          service_plan_agreement_html:
            (wc.service_plan_agreement_html as string) || "",
        },
      })
    }
  }
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  let body: { type?: string; data?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 })
  }

  const { type, data } = body
  if (!type || !isValidType(type) || !data) {
    return NextResponse.json(
      { success: false, error: "type (messages|pricebook|tags|checklists) and data are required" },
      { status: 400 }
    )
  }

  const client = getSupabaseServiceClient()
  const tenantId = authTenant.id

  switch (type) {
    case "messages": {
      const triggerType = String(data.trigger_type ?? "").trim()
      const messageTemplate = String(data.message_template ?? "").trim()
      if (!triggerType || !messageTemplate) {
        return NextResponse.json(
          { success: false, error: "trigger_type and message_template are required" },
          { status: 400 }
        )
      }

      const { data: row, error } = await client
        .from("automated_messages")
        .insert({
          tenant_id: tenantId,
          trigger_type: triggerType,
          message_template: messageTemplate,
          is_active: data.is_active !== false,
        })
        .select("id, trigger_type, message_template, is_active, created_at")
        .single()

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, data: row })
    }

    case "pricebook": {
      const name = String(data.name ?? "").trim()
      const price = Number(data.price)
      if (!name || !Number.isFinite(price) || price < 0) {
        return NextResponse.json(
          { success: false, error: "name and price (>= 0) are required" },
          { status: 400 }
        )
      }

      const wc = { ...((authTenant.workflow_config as unknown as Record<string, unknown>) ?? {}) }
      const pricebook = Array.isArray(wc.pricebook) ? [...(wc.pricebook as Array<Record<string, unknown>>)] : []
      const newId = pricebook.length > 0 ? Math.max(...pricebook.map((p) => Number(p.id ?? 0))) + 1 : 1
      const item = { id: newId, name, price, active: true }
      pricebook.push(item)
      wc.pricebook = pricebook

      const { error } = await client
        .from("tenants")
        .update({ workflow_config: wc })
        .eq("id", tenantId)

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, data: item })
    }

    case "tags": {
      const tagType = String(data.tag_type ?? "").trim()
      const tagValue = String(data.tag_value ?? "").trim()
      if (!tagType || !tagValue) {
        return NextResponse.json(
          { success: false, error: "tag_type and tag_value are required" },
          { status: 400 }
        )
      }

      const { data: row, error } = await client
        .from("tag_definitions")
        .insert({
          tenant_id: tenantId,
          tag_type: tagType,
          tag_value: tagValue,
          color: typeof data.color === "string" ? data.color : null,
          is_active: data.is_active !== false,
        })
        .select("id, tag_type, tag_value, color, is_active, created_at")
        .single()

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, data: row })
    }

    case "checklists": {
      const name = String(data.name ?? "").trim()
      const items = Array.isArray(data.items) ? data.items : []
      if (!name) {
        return NextResponse.json(
          { success: false, error: "name is required" },
          { status: 400 }
        )
      }

      const { data: row, error } = await client
        .from("checklist_templates")
        .insert({
          tenant_id: tenantId,
          name,
          items,
          is_default: data.is_default === true,
        })
        .select("id, name, items, is_default, created_at")
        .single()

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, data: row })
    }
  }
}

// ── PATCH ────────────────────────────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  let body: { type?: string; id?: number; data?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 })
  }

  const { type, id, data } = body
  if (!type || !isValidType(type) || !data) {
    return NextResponse.json(
      { success: false, error: "type and data are required" },
      { status: 400 }
    )
  }
  // id is required for all types except config
  if (type !== "config" && id == null) {
    return NextResponse.json(
      { success: false, error: "id is required for this type" },
      { status: 400 }
    )
  }

  const client = getSupabaseServiceClient()
  const tenantId = authTenant.id

  switch (type) {
    case "messages": {
      const updates: Record<string, unknown> = {}
      if (typeof data.trigger_type === "string") updates.trigger_type = data.trigger_type.trim()
      if (typeof data.message_template === "string") updates.message_template = data.message_template.trim()
      if (typeof data.is_active === "boolean") updates.is_active = data.is_active

      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ success: false, error: "No valid fields to update" }, { status: 400 })
      }

      const { data: row, error } = await client
        .from("automated_messages")
        .update(updates)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .select("id, trigger_type, message_template, is_active, created_at")
        .single()

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      if (!row) {
        return NextResponse.json({ success: false, error: "Not found" }, { status: 404 })
      }
      return NextResponse.json({ success: true, data: row })
    }

    case "pricebook": {
      const wc = { ...((authTenant.workflow_config as unknown as Record<string, unknown>) ?? {}) }
      const pricebook = Array.isArray(wc.pricebook) ? [...(wc.pricebook as Array<Record<string, unknown>>)] : []
      const idx = pricebook.findIndex((p) => Number(p.id) === id)

      if (idx === -1) {
        return NextResponse.json({ success: false, error: "Price book item not found" }, { status: 404 })
      }

      const updated = { ...pricebook[idx] }
      if (typeof data.name === "string") updated.name = data.name.trim()
      if (typeof data.price === "number" && Number.isFinite(data.price)) updated.price = data.price
      if (typeof data.active === "boolean") updated.active = data.active
      pricebook[idx] = updated
      wc.pricebook = pricebook

      const { error } = await client
        .from("tenants")
        .update({ workflow_config: wc })
        .eq("id", tenantId)

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, data: updated })
    }

    case "tags": {
      const updates: Record<string, unknown> = {}
      if (typeof data.tag_type === "string") updates.tag_type = data.tag_type.trim()
      if (typeof data.tag_value === "string") updates.tag_value = data.tag_value.trim()
      if (typeof data.color === "string") updates.color = data.color
      if (typeof data.is_active === "boolean") updates.is_active = data.is_active

      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ success: false, error: "No valid fields to update" }, { status: 400 })
      }

      const { data: row, error } = await client
        .from("tag_definitions")
        .update(updates)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .select("id, tag_type, tag_value, color, is_active, created_at")
        .single()

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      if (!row) {
        return NextResponse.json({ success: false, error: "Not found" }, { status: 404 })
      }
      return NextResponse.json({ success: true, data: row })
    }

    case "checklists": {
      const updates: Record<string, unknown> = {}
      if (typeof data.name === "string") updates.name = data.name.trim()
      if (Array.isArray(data.items)) updates.items = data.items
      if (typeof data.is_default === "boolean") updates.is_default = data.is_default

      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ success: false, error: "No valid fields to update" }, { status: 400 })
      }

      const { data: row, error } = await client
        .from("checklist_templates")
        .update(updates)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .select("id, name, items, is_default, created_at")
        .single()

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      if (!row) {
        return NextResponse.json({ success: false, error: "Not found" }, { status: 404 })
      }
      return NextResponse.json({ success: true, data: row })
    }

    case "config": {
      const wc = { ...((authTenant.workflow_config as unknown as Record<string, unknown>) ?? {}) }
      if (typeof data.service_plan_label === "string") {
        wc.service_plan_label = data.service_plan_label.trim() || "Service Plans"
      }
      // Phase E2 — editable plan agreement. We accept any string (HTML
      // allowed for formatting); customer-side render uses sanitized
      // dangerouslySetInnerHTML. Empty string clears the agreement.
      if (typeof data.service_plan_agreement_html === "string") {
        wc.service_plan_agreement_html = data.service_plan_agreement_html
      }
      const { error } = await client
        .from("tenants")
        .update({ workflow_config: wc })
        .eq("id", tenantId)

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({
        success: true,
        data: {
          service_plan_label: wc.service_plan_label,
          service_plan_agreement_html: wc.service_plan_agreement_html ?? "",
        },
      })
    }
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  let body: { type?: string; id?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 })
  }

  const { type, id } = body
  if (!type || !isValidType(type) || id == null) {
    return NextResponse.json(
      { success: false, error: "type and id are required" },
      { status: 400 }
    )
  }

  const client = getSupabaseServiceClient()
  const tenantId = authTenant.id

  switch (type) {
    case "messages": {
      const { error } = await client
        .from("automated_messages")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenantId)

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true })
    }

    case "pricebook": {
      const wc = { ...((authTenant.workflow_config as unknown as Record<string, unknown>) ?? {}) }
      const pricebook = Array.isArray(wc.pricebook) ? [...(wc.pricebook as Array<Record<string, unknown>>)] : []
      const idx = pricebook.findIndex((p) => Number(p.id) === id)

      if (idx === -1) {
        return NextResponse.json({ success: false, error: "Price book item not found" }, { status: 404 })
      }

      pricebook.splice(idx, 1)
      wc.pricebook = pricebook

      const { error } = await client
        .from("tenants")
        .update({ workflow_config: wc })
        .eq("id", tenantId)

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true })
    }

    case "tags": {
      const { error } = await client
        .from("tag_definitions")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenantId)

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true })
    }

    case "checklists": {
      const { error } = await client
        .from("checklist_templates")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenantId)

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true })
    }
  }
}
