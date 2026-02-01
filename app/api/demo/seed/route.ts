import { NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getDefaultTenant } from "@/lib/tenant"

type Scenario =
  | "seed_all"
  | "add_team"
  | "add_cleaner"
  | "add_job"
  | "add_lead"
  | "add_call"
  | "add_tip"
  | "add_upsell"
  | "add_message"

function rand(arr: string[]) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randPhone(): string {
  const n = () => Math.floor(Math.random() * 10)
  return `+1555${n()}${n()}${n()}${n()}${n()}${n()}${n()}`
}

async function generateFakeSummary(kind: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return `Fake ${kind} generated (no OPENAI_API_KEY set)`
  const client = new OpenAI({ apiKey: key })
  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Generate short realistic business text. Return plain text only." },
      { role: "user", content: `Generate a short realistic ${kind} text for a home service company.` },
    ],
    temperature: 0.8,
  })
  return resp.choices[0]?.message?.content?.trim() || `Fake ${kind}`
}

export async function POST(request: NextRequest) {
  const client = getSupabaseServiceClient()
  const body = await request.json().catch(() => ({}))
  const scenario: Scenario = body.scenario || "seed_all"

  // Get the default tenant (winbros) - required for all operations
  const tenant = await getDefaultTenant()
  if (!tenant) {
    return NextResponse.json(
      { success: false, error: "No default tenant found. Please set up the winbros tenant first." },
      { status: 500 }
    )
  }
  const tenantId = tenant.id

  const names = ["Marcus Johnson", "David Martinez", "Chris Wilson", "Derek Williams", "Ryan Smith", "Emma Stevens"]
  const streets = ["Oak St", "Maple Ave", "Pine Dr", "Cedar Ln", "Birch St"]

  async function addTeam() {
    const { data, error } = await client.from("teams").insert({
      tenant_id: tenantId,
      name: `Demo Team ${Date.now()}`,
      active: true,
    }).select("*").single()
    if (error) throw error
    return data
  }

  async function addCleaner(teamId?: number) {
    const name = rand(names)
    const phone = randPhone()
    const { data: cleaner, error } = await client.from("cleaners").insert({
      tenant_id: tenantId,
      name,
      phone,
      active: true,
      last_location_lat: 34.05 + Math.random() * 0.03,
      last_location_lng: -118.25 + Math.random() * 0.03,
      last_location_accuracy_meters: 10 + Math.random() * 40,
      last_location_updated_at: new Date().toISOString(),
    }).select("*").single()
    if (error) throw error

    if (teamId) {
      await client.from("team_members").upsert({
        tenant_id: tenantId,
        team_id: teamId,
        cleaner_id: cleaner.id,
        role: "technician",
        is_active: true,
      })
    }
    return cleaner
  }

  async function addCustomer() {
    const parts = rand(names).split(" ")
    const phone = randPhone()
    const { data, error } = await client.from("customers").upsert({
      tenant_id: tenantId,
      phone_number: phone,
      first_name: parts[0],
      last_name: parts.slice(1).join(" "),
      address: `${Math.floor(100 + Math.random() * 900)} ${rand(streets)}, Los Angeles, CA`,
      email: `${parts[0].toLowerCase()}${Math.floor(Math.random() * 100)}@gmail.com`,
    }, { onConflict: "tenant_id,phone_number" }).select("*").single()
    if (error) throw error
    return data
  }

  async function addJob(teamId?: number) {
    const customer = await addCustomer()
    const notes = await generateFakeSummary("job notes")
    const { data, error } = await client.from("jobs").insert({
      tenant_id: tenantId,
      customer_id: customer.id,
      team_id: teamId ?? null,
      phone_number: customer.phone_number,
      service_type: rand(["Window cleaning", "Pressure washing", "Gutter cleaning", "Full service"]),
      date: new Date().toISOString().slice(0, 10),
      scheduled_at: "10:30",
      address: customer.address,
      price: 250 + Math.round(Math.random() * 600),
      hours: 1.5 + Math.round(Math.random() * 20) / 10,
      cleaners: 2,
      status: rand(["scheduled", "in_progress", "completed"]) as any,
      booked: true,
      paid: false,
      notes,
    }).select("*").single()
    if (error) throw error
    return data
  }

  async function addLead() {
    const phone = randPhone()
    const parts = rand(names).split(" ")
    const { data, error } = await client.from("leads").insert({
      tenant_id: tenantId,
      source_id: `demo-${Date.now()}`,
      phone_number: phone,
      first_name: parts[0],
      last_name: parts.slice(1).join(" "),
      email: `${parts[0].toLowerCase()}${Math.floor(Math.random() * 100)}@gmail.com`,
      source: rand(["phone", "sms", "website", "meta"]),
      status: "new",
      form_data: { demo: true },
    }).select("*").single()
    if (error) throw error
    return data
  }

  async function addCall() {
    const customer = await addCustomer()
    const transcript = await generateFakeSummary("call transcript")
    const { data, error } = await client.from("calls").insert({
      tenant_id: tenantId,
      customer_id: customer.id,
      phone_number: customer.phone_number,
      direction: "inbound",
      provider: "vapi",
      provider_call_id: `demo-${Date.now()}`,
      vapi_call_id: `demo-${Date.now()}`,
      caller_name: `${customer.first_name} ${customer.last_name}`.trim(),
      transcript,
      duration_seconds: 60 + Math.round(Math.random() * 600),
      outcome: rand(["booked", "not_booked", "voicemail"]),
      status: "completed",
      started_at: new Date().toISOString(),
      date: new Date().toISOString(),
    }).select("*").single()
    if (error) throw error
    return data
  }

  async function addTip(teamId?: number, jobId?: number) {
    const { data, error } = await client.from("tips").insert({
      tenant_id: tenantId,
      team_id: teamId ?? null,
      job_id: jobId ?? null,
      amount: Math.round((10 + Math.random() * 80) * 100) / 100,
      reported_via: "manual",
    }).select("*").single()
    if (error) throw error
    return data
  }

  async function addUpsell(teamId?: number, jobId?: number) {
    const { data, error } = await client.from("upsells").insert({
      tenant_id: tenantId,
      team_id: teamId ?? null,
      job_id: jobId ?? null,
      upsell_type: rand(["Screen Cleaning", "Gutter Cleaning", "Solar Panel Clean", "Extra Pressure Wash"]),
      value: Math.round((50 + Math.random() * 250) * 100) / 100,
      reported_via: "manual",
    }).select("*").single()
    if (error) throw error
    return data
  }

  async function addMessage() {
    const customer = await addCustomer()
    const content = await generateFakeSummary("sms message")
    const { error } = await client.from("messages").insert({
      tenant_id: tenantId,
      customer_id: customer.id,
      phone_number: customer.phone_number,
      role: "client",
      content,
      direction: "inbound",
      message_type: "sms",
      ai_generated: false,
      timestamp: new Date().toISOString(),
      source: "demo",
      metadata: { demo: true },
    })
    if (error) throw error
    return { ok: true }
  }

  try {
    let result: any = null

    if (scenario === "add_team") result = await addTeam()
    else if (scenario === "add_cleaner") {
      const team = await addTeam()
      result = await addCleaner(Number(team.id))
    } else if (scenario === "add_job") {
      const team = await addTeam()
      await addCleaner(Number(team.id))
      result = await addJob(Number(team.id))
    } else if (scenario === "add_lead") result = await addLead()
    else if (scenario === "add_call") result = await addCall()
    else if (scenario === "add_tip") {
      const team = await addTeam()
      const job = await addJob(Number(team.id))
      result = await addTip(Number(team.id), Number(job.id))
    } else if (scenario === "add_upsell") {
      const team = await addTeam()
      const job = await addJob(Number(team.id))
      result = await addUpsell(Number(team.id), Number(job.id))
    } else if (scenario === "add_message") result = await addMessage()
    else {
      // seed_all: create one team with members, and create one of each record
      const team = await addTeam()
      await addCleaner(Number(team.id))
      await addCleaner(Number(team.id))
      const job = await addJob(Number(team.id))
      await addLead()
      await addCall()
      await addTip(Number(team.id), Number(job.id))
      await addUpsell(Number(team.id), Number(job.id))
      await addMessage()
      result = { seeded: true }
    }

    return NextResponse.json({ success: true, data: result })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || "Failed" }, { status: 500 })
  }
}

