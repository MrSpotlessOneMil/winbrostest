import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getTenantById } from "@/lib/tenant"
import { hasAssistantMemory, loadConversation, deleteConversation } from "@/lib/assistant-memory"

// GET: Load a single conversation with full messages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  const { id } = await params

  const client = getSupabaseServiceClient()
  const { data: userData } = await client
    .from("users")
    .select("tenant_id")
    .eq("id", user.id)
    .single()

  if (!userData?.tenant_id) {
    return NextResponse.json({ error: "No tenant" }, { status: 404 })
  }

  const tenant = await getTenantById(userData.tenant_id)
  if (!hasAssistantMemory(tenant)) {
    return NextResponse.json({ error: "Memory not enabled" }, { status: 404 })
  }

  const conversation = await loadConversation(id)

  if (!conversation || conversation.tenant_id !== userData.tenant_id || conversation.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ conversation })
}

// DELETE: Delete a conversation
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  const { id } = await params

  const client = getSupabaseServiceClient()
  const { data: userData } = await client
    .from("users")
    .select("tenant_id")
    .eq("id", user.id)
    .single()

  if (!userData?.tenant_id) {
    return NextResponse.json({ error: "No tenant" }, { status: 404 })
  }

  const tenant = await getTenantById(userData.tenant_id)
  if (!hasAssistantMemory(tenant)) {
    return NextResponse.json({ error: "Memory not enabled" }, { status: 404 })
  }

  // Verify ownership before deleting
  const conversation = await loadConversation(id)
  if (!conversation || conversation.tenant_id !== userData.tenant_id || conversation.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await deleteConversation(id)

  return NextResponse.json({ success: true })
}
