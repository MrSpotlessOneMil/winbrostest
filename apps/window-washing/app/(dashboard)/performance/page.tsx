"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/lib/auth-context"
import { BarChart3, Loader2, Users, Target } from "lucide-react"

interface SalesmanMetric {
  salesman_id: number | null
  salesman_name: string
  total_quotes: number
  converted_quotes: number
  conversion_rate: number
  active_plans: number
  total_arr: number
}

interface TechnicianMetric {
  technician_id: number | null
  technician_name: string
  total_visits_completed: number
  total_revenue: number
  upsell_revenue: number
  avg_minutes_per_job: number | null
}

export default function PerformancePage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [salesman, setSalesman] = useState<SalesmanMetric[]>([])
  const [technician, setTechnician] = useState<TechnicianMetric[]>([])

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/actions/performance")
        const data = await res.json()
        if (data.success) {
          setSalesman(data.salesman ?? [])
          setTechnician(data.technician ?? [])
        } else {
          setError(data.error ?? "Failed to load performance data")
        }
      } catch {
        setError("Failed to load performance data")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    )
  }

  const formatCurrency = (val: number) =>
    val.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 })

  const formatMinutes = (mins: number | null) => {
    if (mins == null) return "-"
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Performance
        </h2>
        <p className="text-sm text-zinc-400 mt-1">
          Salesman and technician metrics across all time
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Salesman Metrics */}
        <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-4">
          <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2 mb-4">
            <Target className="w-4 h-4 text-teal-400" />
            Salesman Metrics
          </h3>

          {salesman.length === 0 ? (
            <p className="text-xs text-zinc-500">No quote data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-500 text-xs border-b border-zinc-800">
                    <th className="text-left py-2 pr-2">Name</th>
                    <th className="text-right py-2 px-2">Quotes</th>
                    <th className="text-right py-2 px-2">Conv.</th>
                    <th className="text-right py-2 px-2">Rate</th>
                    <th className="text-right py-2 px-2">Plans</th>
                    <th className="text-right py-2 pl-2">ARR</th>
                  </tr>
                </thead>
                <tbody>
                  {salesman.map((s) => (
                    <tr key={s.salesman_id ?? "unassigned"} className="border-b border-zinc-800/50">
                      <td className="py-2 pr-2 text-white font-medium">{s.salesman_name}</td>
                      <td className="py-2 px-2 text-right text-zinc-300">{s.total_quotes}</td>
                      <td className="py-2 px-2 text-right text-zinc-300">{s.converted_quotes}</td>
                      <td className="py-2 px-2 text-right text-teal-400">{s.conversion_rate}%</td>
                      <td className="py-2 px-2 text-right text-zinc-300">{s.active_plans}</td>
                      <td className="py-2 pl-2 text-right text-zinc-300">{formatCurrency(s.total_arr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Technician Metrics */}
        <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-4">
          <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-teal-400" />
            Technician Metrics
          </h3>

          {technician.length === 0 ? (
            <p className="text-xs text-zinc-500">No completed visits yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-500 text-xs border-b border-zinc-800">
                    <th className="text-left py-2 pr-2">Name</th>
                    <th className="text-right py-2 px-2">Visits</th>
                    <th className="text-right py-2 px-2">Revenue</th>
                    <th className="text-right py-2 px-2">Upsells</th>
                    <th className="text-right py-2 pl-2">Avg Time</th>
                  </tr>
                </thead>
                <tbody>
                  {technician.map((t) => (
                    <tr key={t.technician_id ?? "unassigned"} className="border-b border-zinc-800/50">
                      <td className="py-2 pr-2 text-white font-medium">{t.technician_name}</td>
                      <td className="py-2 px-2 text-right text-zinc-300">{t.total_visits_completed}</td>
                      <td className="py-2 px-2 text-right text-zinc-300">{formatCurrency(t.total_revenue)}</td>
                      <td className="py-2 px-2 text-right text-teal-400">{formatCurrency(t.upsell_revenue)}</td>
                      <td className="py-2 pl-2 text-right text-zinc-300">{formatMinutes(t.avg_minutes_per_job)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
