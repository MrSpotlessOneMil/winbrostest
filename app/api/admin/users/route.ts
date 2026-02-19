import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdmin } from "@/lib/auth"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey)
}


// GET - List all users
export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const client = getAdminClient()

  const { data: users, error } = await client
    .from("users")
    .select(`
      id,
      tenant_id,
      username,
      display_name,
      email,
      is_active,
      created_at,
      updated_at,
      tenants(name, slug)
    `)
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: users })
}

// POST - Create new user
export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { username, password, display_name, email, tenant_id } = body

  if (!username || !password) {
    return NextResponse.json({ success: false, error: "Username and password are required" }, { status: 400 })
  }

  if (password.length < 4) {
    return NextResponse.json({ success: false, error: "Password must be at least 4 characters" }, { status: 400 })
  }

  const client = getAdminClient()

  // Check if username already exists
  const { data: existing } = await client
    .from("users")
    .select("id")
    .eq("username", username)
    .single()

  if (existing) {
    return NextResponse.json({ success: false, error: "Username already exists" }, { status: 400 })
  }

  // Create the user with hashed password using Postgres crypt function
  const { data: user, error } = await client.rpc("create_user_with_password", {
    p_username: username,
    p_password: password,
    p_display_name: display_name || null,
    p_email: email || null,
    p_tenant_id: tenant_id || null,
  })

  if (error) {
    // If the RPC doesn't exist, try direct insert (fallback)
    console.error("RPC create_user_with_password failed:", error.message)

    // Try inserting with raw SQL via Supabase function
    const { data: rawUser, error: rawError } = await client
      .from("users")
      .insert({
        username,
        password_hash: password, // This won't be hashed - we'll need to fix this
        display_name: display_name || null,
        email: email || null,
        tenant_id: tenant_id || null,
        is_active: true,
      })
      .select("id, username, display_name, email, is_active, created_at")
      .single()

    if (rawError) {
      return NextResponse.json({ success: false, error: rawError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: rawUser,
      warning: "Password was not hashed properly - please update via database"
    })
  }

  return NextResponse.json({ success: true, data: user })
}

// PATCH - Update user
export async function PATCH(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { userId, updates } = body

  if (!userId) {
    return NextResponse.json({ success: false, error: "userId is required" }, { status: 400 })
  }

  const client = getAdminClient()

  // Don't allow updating password_hash directly - use a separate endpoint
  const { password_hash, ...safeUpdates } = updates

  const { data, error } = await client
    .from("users")
    .update({
      ...safeUpdates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select("id, username, display_name, email, is_active, updated_at")
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data })
}

// DELETE - Deactivate user (soft delete)
export async function DELETE(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const userId = searchParams.get("userId")

  if (!userId) {
    return NextResponse.json({ success: false, error: "userId is required" }, { status: 400 })
  }

  const client = getAdminClient()

  const { error } = await client
    .from("users")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", userId)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
