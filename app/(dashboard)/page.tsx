"use client"

import { useState, useEffect } from "react"
import { Power, PowerOff } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { StatsCards } from "@/components/dashboard/stats-cards"
import { RevenueChart } from "@/components/dashboard/revenue-chart"
import { LeadSourceChart } from "@/components/dashboard/lead-source-chart"
import { TodaysJobs } from "@/components/dashboard/todays-jobs"
import { RecentLeads } from "@/components/dashboard/recent-leads"
import { TeamStatus } from "@/components/dashboard/team-status"
import { ExceptionsList } from "@/components/dashboard/exceptions-list"
import { FunnelSummary } from "@/components/dashboard/funnel-summary"
import { EarningsSummary } from "@/components/dashboard/earnings-summary"
import { TopPerformer } from "@/components/dashboard/top-performer"

export default function DashboardPage() {
  const [systemActive, setSystemActive] = useState(true)
  const [systemLoading, setSystemLoading] = useState(true)
  const [tenantName, setTenantName] = useState("")

  useEffect(() => {
    fetch("/api/tenant/status")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setSystemActive(data.active)
          setTenantName(data.tenantName || "")
        }
      })
      .catch(() => {})
      .finally(() => setSystemLoading(false))
  }, [])

  async function toggleSystem() {
    const newActive = !systemActive
    setSystemLoading(true)
    try {
      const res = await fetch("/api/tenant/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: newActive }),
      })
      const data = await res.json()
      if (data.success) {
        setSystemActive(data.active)
      }
    } catch {}
    setSystemLoading(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 stagger-1">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-foreground truncate page-title-gradient">Command Center</h1>
          <p className="text-xs md:text-sm text-zinc-500 hidden sm:block">
            Real-time overview of operations
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* System Toggle */}
          <div className="flex items-center gap-3 rounded-xl system-badge px-4 py-2.5">
            <div className={systemActive ? "live-dot" : "live-dot-offline"} />
            <div className="hidden sm:block">
              <div className="text-sm font-medium text-zinc-200">
                {systemActive ? "System Active" : "System Offline"}
              </div>
              {tenantName && (
                <div className="text-[11px] text-zinc-500">{tenantName}</div>
              )}
            </div>
            <Switch
              checked={systemActive}
              onCheckedChange={toggleSystem}
              disabled={systemLoading}
            />
          </div>

          {/* Date */}
          <div className="text-right hidden md:block">
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium">Today</p>
            <p className="text-base font-semibold text-zinc-200">
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <StatsCards />

      {/* Charts Row */}
      <div className="grid gap-4 md:gap-6 md:grid-cols-2 lg:grid-cols-3 stagger-3">
        <div className="md:col-span-2">
          <RevenueChart />
        </div>
        <LeadSourceChart />
      </div>

      {/* Today's Jobs + Team Status */}
      <div className="grid gap-4 md:gap-6 md:grid-cols-2 lg:grid-cols-3 stagger-4">
        <div className="md:col-span-2 lg:col-span-2">
          <TodaysJobs />
        </div>
        <TeamStatus />
      </div>

      {/* Funnel, Earnings, Top Performer */}
      <div className="grid gap-4 md:gap-6 sm:grid-cols-2 lg:grid-cols-3 stagger-5">
        <FunnelSummary />
        <EarningsSummary />
        <TopPerformer />
      </div>

      {/* Recent Leads + Exceptions */}
      <div className="grid gap-4 md:gap-6 md:grid-cols-2 stagger-6">
        <RecentLeads />
        <ExceptionsList />
      </div>
    </div>
  )
}
