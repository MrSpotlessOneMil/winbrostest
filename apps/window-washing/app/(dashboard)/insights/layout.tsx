"use client"

import { Suspense } from "react"
import { BarChart3 } from "lucide-react"
import { InsightsNav } from "@/components/insights/insights-nav"
import { DateRangePicker } from "@/components/insights/date-range-picker"

export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          Insights
        </h1>
        <Suspense>
          <DateRangePicker />
        </Suspense>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <InsightsNav />
      </div>
      {children}
    </div>
  )
}
