import { NextRequest, NextResponse } from "next/server"
import { getTenantScopedClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"

// route-check:no-vercel-cron

interface SearchResult {
  category: string
  title: string
  subtitle: string
  href: string
  params?: Record<string, string>
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)
  if (!tenant) {
    return NextResponse.json({ success: false, error: "No tenant found" }, { status: 403 })
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() || ""
  if (!query || query.length < 2) {
    return NextResponse.json({ success: true, results: [] })
  }

  const client = await getTenantScopedClient(tenant.id)
  const results: SearchResult[] = []
  const lowerQuery = query.toLowerCase()

  try {
    // Run all searches in parallel for speed
    const [
      customersRes,
      messagesRes,
      callsRes,
      jobsRes,
      leadsRes,
      cleanersRes,
      teamMsgsRes,
    ] = await Promise.all([
      // 1. Customers — name, phone, email, address
      client
        .from("customers")
        .select("id, first_name, last_name, phone_number, email, address")
        .or(
          `first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,address.ilike.%${query}%,phone_number.ilike.%${query.replace(/\D/g, "")}%`
        )
        .limit(8),

      // 2. Messages — content search (exclude telegram — those go in Teams category)
      client
        .from("messages")
        .select("id, phone_number, content, customer_id, timestamp, direction, role")
        .ilike("content", `%${query}%`)
        .neq("source", "telegram")
        .order("timestamp", { ascending: false })
        .limit(10),

      // 3. Calls — transcript search
      client
        .from("calls")
        .select("id, phone_number, transcript, caller_name, direction, duration_seconds, created_at")
        .not("transcript", "is", null)
        .ilike("transcript", `%${query}%`)
        .order("created_at", { ascending: false })
        .limit(5),

      // 4. Jobs — service_type, address, notes
      client
        .from("jobs")
        .select("id, service_type, address, notes, date, status, phone_number, customer_name")
        .or(`address.ilike.%${query}%,notes.ilike.%${query}%,service_type.ilike.%${query}%,customer_name.ilike.%${query}%`)
        .order("created_at", { ascending: false })
        .limit(8),

      // 5. Leads — phone, status, form_data search
      client
        .from("leads")
        .select("id, phone_number, status, source, form_data, created_at")
        .or(`phone_number.ilike.%${query.replace(/\D/g, "")}%,status.ilike.%${query}%`)
        .order("created_at", { ascending: false })
        .limit(5),

      // 6. Cleaners/Team members
      client
        .from("cleaners")
        .select("id, name, phone, telegram_id, active")
        .or(`name.ilike.%${query}%,phone.ilike.%${query.replace(/\D/g, "")}%`)
        .limit(5),

      // 7. Team messages (Telegram messages stored in messages table)
      client
        .from("messages")
        .select("id, phone_number, content, direction, timestamp, metadata")
        .eq("source", "telegram")
        .ilike("content", `%${query}%`)
        .order("timestamp", { ascending: false })
        .limit(5),
    ])

    // Process customers
    if (customersRes.data) {
      for (const c of customersRes.data) {
        const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown"
        results.push({
          category: "Customers",
          title: name,
          subtitle: [c.phone_number, c.email, c.address].filter(Boolean).join(" · ").slice(0, 80),
          href: "/customers",
          params: { customerId: String(c.id) },
        })
      }
    }

    // Process messages — group by customer, show most recent match per customer
    if (messagesRes.data) {
      const seenPhones = new Set<string>()
      for (const m of messagesRes.data) {
        if (seenPhones.has(m.phone_number)) continue
        seenPhones.add(m.phone_number)
        const content = m.content || ""
        const idx = content.toLowerCase().indexOf(lowerQuery)
        const start = Math.max(0, idx - 25)
        const end = Math.min(content.length, idx + lowerQuery.length + 40)
        const snippet = (start > 0 ? "..." : "") + content.slice(start, end) + (end < content.length ? "..." : "")
        results.push({
          category: "Messages",
          title: snippet,
          subtitle: `${m.role === "client" ? "Customer" : "AI"} · ${new Date(m.timestamp).toLocaleDateString()}`,
          href: "/customers",
          params: { customerId: String(m.customer_id || ""), q: query, phone: m.phone_number },
        })
      }
    }

    // Process calls
    if (callsRes.data) {
      for (const c of callsRes.data) {
        const transcript = c.transcript || ""
        const idx = transcript.toLowerCase().indexOf(lowerQuery)
        const start = Math.max(0, idx - 25)
        const end = Math.min(transcript.length, idx + lowerQuery.length + 40)
        const snippet = (start > 0 ? "..." : "") + transcript.slice(start, end) + (end < transcript.length ? "..." : "")
        const dir = c.direction === "inbound" ? "Inbound" : "Outbound"
        const dur = c.duration_seconds ? `${Math.floor(c.duration_seconds / 60)}m ${c.duration_seconds % 60}s` : ""
        results.push({
          category: "Calls",
          title: snippet,
          subtitle: `${dir} call${dur ? ` (${dur})` : ""} · ${new Date(c.created_at).toLocaleDateString()}`,
          href: "/customers",
          params: { phone: c.phone_number, q: query },
        })
      }
    }

    // Process jobs
    if (jobsRes.data) {
      for (const j of jobsRes.data) {
        const type = (j.service_type || "Cleaning").replace(/_/g, " ")
        const dateStr = j.date ? new Date(j.date).toLocaleDateString() : "No date"
        results.push({
          category: "Calendar",
          title: `${type} — ${j.customer_name || j.address || "Job #" + j.id}`,
          subtitle: `${dateStr} · ${j.status}${j.address ? ` · ${j.address.slice(0, 40)}` : ""}`,
          href: "/jobs",
          params: { jobId: String(j.id), date: j.date || "" },
        })
      }
    }

    // Process leads
    if (leadsRes.data) {
      for (const l of leadsRes.data) {
        const fd = typeof l.form_data === "object" && l.form_data ? l.form_data : {} as Record<string, unknown>
        const name = [fd.firstName, fd.lastName].filter(Boolean).join(" ") || l.phone_number
        results.push({
          category: "Customers",
          title: `Lead: ${name}`,
          subtitle: `${l.status} · ${l.source || "unknown"} · ${new Date(l.created_at).toLocaleDateString()}`,
          href: "/customers",
          params: { phone: l.phone_number, q: query },
        })
      }
    }

    // Process cleaners
    if (cleanersRes.data) {
      for (const cl of cleanersRes.data) {
        results.push({
          category: "Teams",
          title: cl.name || "Unnamed",
          subtitle: [cl.phone, cl.active ? "Active" : "Inactive"].filter(Boolean).join(" · "),
          href: "/teams",
          params: { cleanerId: String(cl.id) },
        })
      }
    }

    // Process team messages (Telegram)
    if (teamMsgsRes.data) {
      for (const tm of teamMsgsRes.data) {
        const content = tm.content || ""
        const idx = content.toLowerCase().indexOf(lowerQuery)
        const start = Math.max(0, idx - 25)
        const end = Math.min(content.length, idx + lowerQuery.length + 40)
        const snippet = (start > 0 ? "..." : "") + content.slice(start, end) + (end < content.length ? "..." : "")
        results.push({
          category: "Teams",
          title: snippet,
          subtitle: `Telegram · ${new Date(tm.timestamp).toLocaleDateString()}`,
          href: "/teams",
          params: { q: query },
        })
      }
    }

    // Also check campaigns (stored in tenant workflow_config)
    // Campaigns are in-memory config, not a separate table — search tenant settings
    const tenantSlug = (tenant as Record<string, unknown>).slug as string | undefined
    const workflowConfig = (tenant as Record<string, unknown>).workflow_config as Record<string, unknown> | undefined
    if (workflowConfig) {
      const seasonalCampaigns = (workflowConfig.seasonal_campaigns || []) as Array<{ id: string; name: string; message?: string; enabled?: boolean }>
      for (const camp of seasonalCampaigns) {
        const matchName = (camp.name || "").toLowerCase().includes(lowerQuery)
        const matchMsg = (camp.message || "").toLowerCase().includes(lowerQuery)
        if (matchName || matchMsg) {
          results.push({
            category: "Retargeting",
            title: camp.name || "Campaign",
            subtitle: camp.enabled ? "Active" : "Inactive",
            href: "/campaigns",
          })
        }
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (error) {
    console.error("[search] Error:", error)
    return NextResponse.json({ success: false, error: "Search failed" }, { status: 500 })
  }
}
