"use client"

import { TodaysJobs } from "@/components/dashboard/todays-jobs"
import { RecentLeads } from "@/components/dashboard/recent-leads"
import { CallChecklist } from "@/components/dashboard/call-checklist"
import { StatsCards } from "@/components/dashboard/stats-cards"
import { AttentionNeeded } from "@/components/dashboard/attention-needed"
// GhostHealth removed — not needed in current dashboard

export default function DashboardPage() {
  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 stagger-1">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-foreground truncate">Command Center</h1>
        </div>
        <div className="text-right hidden md:block">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Today</p>
          <p className="text-base font-semibold text-foreground">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
      </div>

      {/* Today's scorecard: Revenue, Jobs, New Leads */}
      <div className="stagger-2">
        <StatsCards />
      </div>

      {/* Needs Attention */}
      <div className="stagger-3 space-y-3">
        <AttentionNeeded />
      </div>

      {/* Today's Jobs + Call Checklist */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 stagger-4">
        <div className="md:col-span-2 lg:col-span-2">
          <TodaysJobs />
        </div>
        <div>
          <CallChecklist />
        </div>
      </div>

      {/* Recent Leads */}
      <div className="stagger-5">
        <RecentLeads />
      </div>
    </div>
  )
}
