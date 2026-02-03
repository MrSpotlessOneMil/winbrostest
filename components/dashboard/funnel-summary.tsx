"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useEffect, useState } from "react"
import type { Lead, PaginatedResponse } from "@/lib/types"

export function FunnelSummary() {
  const [funnel, setFunnel] = useState({ total: 0, contacted: 0, qualified: 0, booked: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/leads?page=1&per_page=200`, { cache: "no-store" })
        const json = (await res.json()) as PaginatedResponse<Lead>
        const leads = json.data || []
        if (!cancelled) {
          const total = leads.length
          const contacted = leads.filter((l) =>
            ["contacted", "qualified", "booked", "nurturing"].includes(l.status)
          ).length
          const qualified = leads.filter((l) =>
            ["qualified", "booked"].includes(l.status)
          ).length
          const booked = leads.filter((l) => l.status === "booked").length
          setFunnel({ total, contacted, qualified, booked })
        }
      } catch {
        if (!cancelled) setFunnel({ total: 0, contacted: 0, qualified: 0, booked: 0 })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const stages = [
    { name: "Leads", value: funnel.total, color: "bg-blue-500" },
    { name: "Contacted", value: funnel.contacted, color: "bg-cyan-500" },
    { name: "Qualified", value: funnel.qualified, color: "bg-teal-500" },
    { name: "Booked", value: funnel.booked, color: "bg-emerald-500" },
  ]

  const closeRate = funnel.total > 0 ? Math.round((funnel.booked / funnel.total) * 100) : 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">Lead Funnel</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-3">
            {stages.map((stage, index) => {
              const baseValue = stages[0]?.value || 0
              const percentage = baseValue > 0 ? Math.round((stage.value / baseValue) * 100) : 0
              return (
                <div key={stage.name} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{stage.name}</span>
                    <span className="font-medium">{stage.value}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${stage.color} transition-all duration-500`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              )
            })}
            <div className="pt-2 border-t border-border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Close Rate</span>
                <span className="font-semibold text-emerald-500">{closeRate}%</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
