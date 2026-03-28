"use client"

import { TodaysJobs } from "@/components/dashboard/todays-jobs"
import { RecentLeads } from "@/components/dashboard/recent-leads"
import { ActivityFeed } from "@/components/dashboard/activity-feed"
import { CallChecklist } from "@/components/dashboard/call-checklist"
import { RightNow } from "@/components/dashboard/right-now"
import { StatsCards } from "@/components/dashboard/stats-cards"
import { RevenueGoalRing } from "@/components/dashboard/revenue-goal-ring"

export default function DashboardPage() {
  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 stagger-1">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-foreground truncate">Command Center</h1>
        </div>
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

      {/* Live pulse + Revenue Goal + today's scorecard */}
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="lg:col-span-1">
          <RightNow />
        </div>
        <div className="lg:col-span-1">
          <RevenueGoalRing />
        </div>
        <div className="lg:col-span-2">
          <StatsCards />
        </div>
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

      {/* Recent Leads + Activity Feed */}
      <div className="grid gap-4 md:grid-cols-2 stagger-5">
        <RecentLeads />
        <ActivityFeed />
      </div>
    </div>
  )
}
