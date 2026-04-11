import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getTenantById } from "@/lib/tenant"
import { hasAssistantMemory, loadConversation, summarizeConversation } from "@/lib/assistant-memory"

// POST: Generate summary for a conversation (called when user switches away)
export async function POST(
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

  // Skip if already summarized or too few messages
  if (conversation.summary || conversation.message_count < 2) {
    return NextResponse.json({ success: true, skipped: true })
  }

  const result = await summarizeConversation(id, conversation.messages)

  return NextResponse.json({ success: true, summary: result?.summary || null })
}
