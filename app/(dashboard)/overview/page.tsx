"use client"

import { TodaysJobs } from "@/components/dashboard/todays-jobs"
import { RecentLeads } from "@/components/dashboard/recent-leads"
import { CallChecklist } from "@/components/dashboard/call-checklist"
import { StatsCards } from "@/components/dashboard/stats-cards"
import { AttentionNeeded } from "@/components/dashboard/attention-needed"
import { GhostHealth } from "@/components/dashboard/ghost-health"

export default function DashboardPage() {
  return (
    <div className="animate-fade-in space-y-5">
      {/* Header — compact, date on same line */}
      <div className="flex items-baseline justify-between gap-3 stagger-1">
        <h1 className="text-xl md:text-2xl font-bold text-foreground">Command Center</h1>
        <p className="text-sm text-muted-foreground font-medium hidden sm:block">
          {new Date().toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>

      {/* HERO: Attention + Ghost Health — what needs you RIGHT NOW */}
      <div className="stagger-2 space-y-3">
        <AttentionNeeded />
        <GhostHealth />
      </div>

      {/* Desktop: 2-column layout. Mobile: stacked. */}
      <div className="grid gap-5 lg:grid-cols-[5fr_3fr]">
        {/* LEFT COLUMN — operational: schedule + leads */}
        <div className="space-y-5">
          <div className="stagger-3">
            <TodaysJobs />
          </div>
          <div className="stagger-5">
            <RecentLeads />
          </div>
        </div>

        {/* RIGHT COLUMN — metrics + calls */}
        <div className="space-y-5">
          <div className="stagger-3">
            <StatsCards />
          </div>
          <div className="stagger-4">
            <CallChecklist />
          </div>
        </div>
      </div>
    </div>
  )
}
