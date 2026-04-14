"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/lib/auth-context"
import { ServicePlanHub } from "@/components/winbros/service-plan-hub"
import { Loader2 } from "lucide-react"

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

export default function ServicePlanHubPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const year = new Date().getFullYear()

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/actions/service-plans/analytics?year=${year}`)
        if (res.ok) {
          setData(await res.json())
        }
      } catch {
        // No data yet — will show empty state
      }
      setLoading(false)
    }
    fetchData()
  }, [year])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    )
  }

  // Default empty state with WinBros plan types
  const planTypes = (data?.planTypes as Array<{
    type: string
    label: string
    total_arr: number
    plan_count: number
    color: string
  }>) || [
    { type: "quarterly", label: "Quarterly", total_arr: 0, plan_count: 0, color: "#14b8a6" },
    { type: "triannual", label: "Biannual", total_arr: 0, plan_count: 0, color: "#3b82f6" },
    { type: "triannual_exterior", label: "Triannual Exterior", total_arr: 0, plan_count: 0, color: "#8b5cf6" },
    { type: "monthly", label: "Monthly", total_arr: 0, plan_count: 0, color: "#22c55e" },
  ]

  const monthlyArr = (data?.monthlyArr as Array<{
    month: number
    month_name: string
    booked: number
    target: number
  }>) || MONTH_NAMES.map((name, i) => ({
    month: i + 1,
    month_name: name,
    booked: 0,
    target: 0,
  }))

  const statusCounts = (data?.statusCounts as {
    active: number
    cancelled: number
    pending: number
  }) || { active: 0, cancelled: 0, pending: 0 }

  return (
    <div className="min-h-screen bg-zinc-950 p-6 md:p-8 max-w-7xl mx-auto">
      <ServicePlanHub
        year={year}
        planTypes={planTypes}
        monthlyArr={monthlyArr}
        totalArr={(data?.totalArr as number) || 0}
        totalPlans={(data?.totalPlans as number) || 0}
        revenueThisYear={data?.revenueThisYear as number | undefined}
        statusCounts={statusCounts}
      />
    </div>
  )
}
