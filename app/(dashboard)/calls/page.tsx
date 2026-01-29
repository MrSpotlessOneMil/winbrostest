"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Phone, Clock, Search } from "lucide-react"
import type { Call, PaginatedResponse } from "@/lib/types"

function formatDuration(seconds?: number) {
  if (!seconds && seconds !== 0) return "—"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(false)
  const [phone, setPhone] = useState("")

  async function load() {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ page: "1", per_page: "50" })
      if (phone.trim()) qs.set("phone", phone.trim())
      const res = await fetch(`/api/calls?${qs.toString()}`, { cache: "no-store" })
      const json = (await res.json()) as PaginatedResponse<Call>
      setCalls(json.data || [])
    } catch {
      setCalls([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Calls</h1>
          <p className="text-sm text-muted-foreground">Inbound/outbound call log from Supabase</p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Call Log</CardTitle>
            <CardDescription>Latest 50 calls</CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Filter by phone (E.164)"
                className="w-64 pl-10"
              />
            </div>
            <Button variant="outline" onClick={load} disabled={loading}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {calls.map((c) => (
              <div key={c.id} className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-foreground">{c.caller_name || c.caller_phone || "Unknown"}</span>
                      <Badge variant="outline">{c.call_type}</Badge>
                      <Badge variant="secondary">{c.handler}</Badge>
                      {c.outcome && <Badge variant="outline">{c.outcome}</Badge>}
                      {!c.is_business_hours && <Badge variant="destructive">after-hours</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{c.caller_phone}</p>
                    {c.transcript && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{c.transcript}</p>
                    )}
                  </div>

                  <div className="text-right text-sm text-muted-foreground">
                    <div className="flex items-center justify-end gap-1">
                      <Clock className="h-4 w-4" />
                      <span>{formatDuration(c.duration_seconds)}</span>
                    </div>
                    <div>{new Date(c.created_at).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            ))}

            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!loading && calls.length === 0 && (
              <p className="text-sm text-muted-foreground">No calls found.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

