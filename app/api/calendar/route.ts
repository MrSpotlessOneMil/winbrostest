import { NextResponse } from "next/server"
import { getSupabaseClient } from "@/lib/supabase"

export async function GET() {
  try {
    const client = getSupabaseClient()
    const { data, error } = await client
      .from("jobs")
      .select("*, customers (*), cleaners (*)")
      .order("created_at", { ascending: false })
      .limit(2000)

    if (error) {
      throw error
    }

    return NextResponse.json({ jobs: data || [] })
  } catch (error) {
    console.error("Failed to load calendar jobs:", error)
    return NextResponse.json({ jobs: [] }, { status: 500 })
  }
}
