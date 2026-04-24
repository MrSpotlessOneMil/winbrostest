import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { createEmployeeSession, setSessionCookie } from "@/lib/auth"

/**
 * POST /api/crew/[token]/quote-session
 *
 * Mints an employee session cookie for the cleaner matching the given
 * portal token, so they can navigate into the admin quote builder
 * (`/quotes/[id]`) directly from their crew portal without re-logging in.
 *
 * Any active cleaner can open a quote — price edits are always allowed per
 * Max's Round 2 non-negotiable. Authorization on what they can change lives
 * in the admin quote API (cross-tenant guard, etc.).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const client = getSupabaseServiceClient()

  const { data: cleaner, error } = await client
    .from("cleaners")
    .select("id, active")
    .eq("portal_token", token)
    .is("deleted_at", null)
    .maybeSingle()

  if (error || !cleaner || !cleaner.active) {
    return NextResponse.json(
      { success: false, error: "Invalid portal link" },
      { status: 404 }
    )
  }

  const sessionToken = await createEmployeeSession(cleaner.id)
  const response = NextResponse.json({ success: true })
  setSessionCookie(response, sessionToken)
  return response
}
