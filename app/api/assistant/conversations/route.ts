import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getTenantById } from "@/lib/tenant"
import { hasAssistantMemory, loadConversations, saveConversation } from "@/lib/assistant-memory"

// GET: List conversations for the authenticated user
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

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

  const conversations = await loadConversations(userData.tenant_id, user.id)

  return NextResponse.json({ conversations, memoryEnabled: true })
}

// POST: Create a new conversation
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

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

  const id = crypto.randomUUID()
  await saveConversation(userData.tenant_id, user.id, id, "New Chat", [])

  return NextResponse.json({ id })
}
