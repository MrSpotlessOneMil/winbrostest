"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Phone, PhoneOutgoing, MessageSquare, Globe, Instagram, ChevronRight, Radar, MapPin, Wrench, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import type { Lead as ApiLead, PaginatedResponse } from "@/lib/types"

type UiLead = {
  id: string
  name: string
  phone: string | null
  source: "phone" | "meta" | "website" | "sms" | "sam" | "google_lsa" | "thumbtack" | "angi"
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
  const validSources = ["meta", "website", "sms", "sam", "google_lsa", "thumbtack", "angi"]
  const source = (validSources.includes(l.source) ? l.source : "phone") as UiLead["source"]
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
    phone: l.phone || null,
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
  sam: Radar,
  google_lsa: MapPin,
  thumbtack: Wrench,
  angi: Star,
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
        <Link href="/leads">
          <Button variant="outline" size="sm">
            View All
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton-card p-3 flex items-center gap-4">
                  <div className="skeleton-circle w-10 h-10 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="flex justify-between">
                      <div className="skeleton-line w-28" />
                      <div className="skeleton-line w-16" />
                    </div>
                    <div className="skeleton-line w-40" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && leads.map((lead) => {
            const SourceIcon = sourceIcons[lead.source as keyof typeof sourceIcons] || Phone
            return (
              <Link
                key={lead.id}
                href={lead.phone ? `/customers?phone=${encodeURIComponent(lead.phone)}` : '/customers'}
                className="flex items-center gap-4 glass-list-item p-3 cursor-pointer hover:bg-zinc-800/60 transition-colors"
              >
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full icon-glow",
                    lead.source === "phone" && "bg-primary/15 text-primary",
                    lead.source === "meta" && "bg-pink-500/15 text-pink-500",
                    lead.source === "website" && "bg-success/15 text-success",
                    lead.source === "sms" && "bg-accent/15 text-accent",
                    lead.source === "sam" && "bg-orange-500/15 text-orange-500",
                    lead.source === "google_lsa" && "bg-emerald-500/15 text-emerald-400",
                    lead.source === "thumbtack" && "bg-cyan-500/15 text-cyan-400",
                    lead.source === "angi" && "bg-orange-600/15 text-orange-500"
                  )}
                >
                  <SourceIcon className="h-5 w-5" />
                </div>

                <div className="flex-1 space-y-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium text-foreground truncate">{lead.name}</span>
                      {lead.phone && (
                        <a href={`tel:${lead.phone}`} className="shrink-0 p-1 rounded hover:bg-zinc-800 transition-colors" onClick={(e) => e.stopPropagation()}>
                          <PhoneOutgoing className="h-3.5 w-3.5 text-violet-400" />
                        </a>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={statusConfig[lead.status as keyof typeof statusConfig].className}
                    >
                      {statusConfig[lead.status as keyof typeof statusConfig].label}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">{lead.service}</span>
                    <span className="font-semibold text-zinc-200">{lead.value}</span>
                  </div>
                  <span className="text-xs text-zinc-600">{lead.time}</span>
                </div>
              </Link>
            )
          })}
          {!loading && leads.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800/60">
                <Phone className="h-6 w-6 text-zinc-500" />
              </div>
              <p className="mt-3 font-medium text-zinc-300">No recent leads</p>
              <p className="text-sm text-zinc-500">New inquiries will show up here</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
