"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Target } from "lucide-react"

export function RevenueGoalRing() {
  const [revenue, setRevenue] = useState(0)
  const [target, setTarget] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const today = new Date()
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
        const res = await fetch(`/api/metrics?range=month&date=${monthStart}`, { cache: "no-store" })
        const json = await res.json()
        if (json.success && json.data) {
          // Sum all daily revenues in the month
          const days = Array.isArray(json.data) ? json.data : [json.data]
          const totalRev = days.reduce((sum: number, d: any) => sum + (d.total_revenue || 0), 0)
          const totalTarget = days.reduce((sum: number, d: any) => sum + (d.target_revenue || 0), 0)
          setRevenue(totalRev)
          // Use monthly target or extrapolate daily target × days in month
          const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
          setTarget(totalTarget > 0 ? totalTarget : daysInMonth * 1200)
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const pct = target > 0 ? Math.min((revenue / target) * 100, 100) : 0
  const circumference = 2 * Math.PI * 54 // radius = 54
  const offset = circumference - (pct / 100) * circumference
  const isHit = pct >= 100

  const monthName = new Date().toLocaleDateString("en-US", { month: "long" })

  return (
    <Card className="h-full">
      <CardContent className="p-5 flex flex-col items-center justify-center h-full">
        <div className="relative w-32 h-32">
          {/* Background ring */}
          <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
            <circle
              cx="60" cy="60" r="54"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-zinc-800"
            />
            {/* Progress ring */}
            <circle
              cx="60" cy="60" r="54"
              fill="none"
              stroke="url(#ringGradient)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={loading ? circumference : offset}
              className="transition-all duration-1000 ease-out"
            />
            <defs>
              <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={isHit ? "#4ade80" : "#8b5cf6"} />
                <stop offset="100%" stopColor={isHit ? "#22c55e" : "#6366f1"} />
              </linearGradient>
            </defs>
          </svg>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-2xl font-black ${isHit ? "text-green-400" : "text-foreground"}`}>
              {loading ? "..." : `${Math.round(pct)}%`}
            </span>
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
              of goal
            </span>
          </div>
        </div>

        <div className="mt-3 text-center">
          <p className="text-sm font-semibold text-foreground">
            ${revenue.toLocaleString()} <span className="text-muted-foreground font-normal">/ ${target.toLocaleString()}</span>
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
            <Target className="h-3 w-3" />
            {monthName} Revenue Goal
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
