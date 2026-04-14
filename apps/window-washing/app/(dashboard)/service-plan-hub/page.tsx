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
  const [data, setData] = useState<any>(null)
  const year = new Date().getFullYear()

  useEffect(() => {
    async function fetch_data() {
      try {
        const res = await fetch(`/api/actions/service-plans/analytics?year=${year}`)
        if (res.ok) {
          setData(await res.json())
        }
      } catch {
        // No data yet
      }
      setLoading(false)
    }
    fetch_data()
  }, [year])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    )
  }

  // Default empty state
  const planTypes = data?.planTypes || [
    { type: "quarterly", label: "Quarterly", total_arr: 0, plan_count: 0, color: "#3b82f6" },
    { type: "triannual", label: "Triannual", total_arr: 0, plan_count: 0, color: "#8b5cf6" },
    { type: "triannual_exterior", label: "Triannual Exterior", total_arr: 0, plan_count: 0, color: "#06b6d4" },
    { type: "monthly", label: "Monthly", total_arr: 0, plan_count: 0, color: "#22c55e" },
  ]

  const monthlyArr = data?.monthlyArr || MONTH_NAMES.map((name, i) => ({
    month: i + 1,
    month_name: name,
    booked: 0,
    target: 0,
  }))

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <ServicePlanHub
        year={year}
        planTypes={planTypes}
        monthlyArr={monthlyArr}
        totalArr={data?.totalArr || 0}
        totalPlans={data?.totalPlans || 0}
        revenueThisYear={data?.revenueThisYear}
        statusCounts={data?.statusCounts || { active: 0, cancelled: 0, pending: 0 }}
      />
    </div>
  )
}
