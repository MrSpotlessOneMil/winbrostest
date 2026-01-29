"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Phone, MessageSquare, Globe, Instagram, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Lead as ApiLead, PaginatedResponse } from "@/lib/types"

type UiLead = {
  id: string
  name: string
  source: "phone" | "meta" | "website" | "sms"
  time: string
  status: "new" | "contacted" | "booked" | "nurturing" | "lost"
  service: string
  value: string
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return "—"
  const diffMs = Date.now() - t
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function mapLead(l: ApiLead): UiLead {
  const source = (l.source === "meta" || l.source === "website" || l.source === "sms" ? l.source : "phone") as UiLead["source"]
  const status =
    (l.status === "new" || l.status === "contacted" || l.status === "booked" || l.status === "nurturing" || l.status === "lost"
      ? l.status
      : "new") as UiLead["status"]
  const value =
    l.estimated_value != null
      ? `$${Number(l.estimated_value).toLocaleString()}`
      : "TBD"

  return {
    id: `LEAD-${l.id}`,
    name: l.name || "Unknown",
    source,
    time: timeAgo(l.created_at),
    status,
    service: l.service_interest || "Service inquiry",
    value,
  }
}

const sourceIcons = {
  phone: Phone,
  meta: Instagram,
  website: Globe,
  sms: MessageSquare,
}

const statusConfig = {
  new: { label: "New", className: "bg-primary/10 text-primary border-primary/20" },
  contacted: { label: "Contacted", className: "bg-warning/10 text-warning border-warning/20" },
  booked: { label: "Booked", className: "bg-success/10 text-success border-success/20" },
  nurturing: { label: "Nurturing", className: "bg-accent/10 text-accent border-accent/20" },
  lost: { label: "Lost", className: "bg-destructive/10 text-destructive border-destructive/20" },
}

export function RecentLeads() {
  const [leads, setLeads] = useState<UiLead[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/leads?page=1&per_page=6`, { cache: "no-store" })
        const json = (await res.json()) as PaginatedResponse<ApiLead>
        const rows = (json.data || []).map(mapLead)
        if (!cancelled) setLeads(rows)
      } catch {
        if (!cancelled) setLeads([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Recent Leads</CardTitle>
          <CardDescription>Latest incoming inquiries</CardDescription>
        </div>
        <Button variant="outline" size="sm">
          View All
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {leads.map((lead) => {
            const SourceIcon = sourceIcons[lead.source as keyof typeof sourceIcons]
            return (
              <div
                key={lead.id}
                className="flex items-center gap-4 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
              >
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full",
                    lead.source === "phone" && "bg-primary/10",
                    lead.source === "meta" && "bg-pink-500/10",
                    lead.source === "website" && "bg-success/10",
                    lead.source === "sms" && "bg-accent/10"
                  )}
                >
                  <SourceIcon
                    className={cn(
                      "h-5 w-5",
                      lead.source === "phone" && "text-primary",
                      lead.source === "meta" && "text-pink-500",
                      lead.source === "website" && "text-success",
                      lead.source === "sms" && "text-accent"
                    )}
                  />
                </div>

                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{lead.name}</span>
                    <Badge
                      variant="outline"
                      className={statusConfig[lead.status as keyof typeof statusConfig].className}
                    >
                      {statusConfig[lead.status as keyof typeof statusConfig].label}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{lead.service}</span>
                    <span className="font-medium text-foreground">{lead.value}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{lead.time}</span>
                </div>
              </div>
            )
          })}
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && leads.length === 0 && (
            <p className="text-sm text-muted-foreground">No recent leads.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
