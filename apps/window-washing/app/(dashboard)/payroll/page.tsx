"use client"

import { useState, useEffect, useCallback } from "react"
import { useAuth } from "@/lib/auth-context"
import { PayrollWeek } from "@/components/winbros/payroll-week"
import { Loader2 } from "lucide-react"

function getWeekBounds(date: Date): { start: string; end: string } {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday start
  const start = new Date(d.setDate(diff))
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  }
}

export default function PayrollPage() {
  const { user, isAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [weekDate, setWeekDate] = useState(() => new Date())
  const [technicians, setTechnicians] = useState<any[]>([])
  const [salesmen, setSalesmen] = useState<any[]>([])
  const [status, setStatus] = useState<"draft" | "finalized">("draft")
  const [myCleanerId, setMyCleanerId] = useState<number | null>(null)

  const { start, end } = getWeekBounds(weekDate)

  // Resolve logged-in user's cleaner_id for field view filtering
  useEffect(() => {
    if (isAdmin || !user?.id) return
    fetch("/api/actions/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMyCleanerId(d.cleaner_id ?? -1))
      .catch(() => setMyCleanerId(-1))
  }, [isAdmin, user?.id])

  const fetchPayroll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/actions/payroll?weekStart=${start}&weekEnd=${end}`)
      if (res.ok) {
        const data = await res.json()
        setTechnicians(data.technicians || [])
        setSalesmen(data.salesmen || [])
        setStatus(data.status || "draft")
      }
    } catch {
      // No payroll data yet for this week
      setTechnicians([])
      setSalesmen([])
    }
    setLoading(false)
  }, [start, end])

  useEffect(() => {
    fetchPayroll()
  }, [fetchPayroll])

  const handleWeekChange = (direction: -1 | 1) => {
    setWeekDate(prev => {
      const next = new Date(prev)
      next.setDate(next.getDate() + direction * 7)
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    )
  }

  // For non-admin users, filter to only their row by cleaner_id or name match
  const userName = user?.display_name || user?.username || ""
  const nameMatch = (name: string) =>
    userName.length > 0 && name.toLowerCase().includes(userName.toLowerCase())

  const visibleTechnicians = isAdmin
    ? technicians
    : technicians.filter(
        (t) => (myCleanerId && myCleanerId > 0 && t.cleaner_id === myCleanerId) || nameMatch(t.name)
      )
  const visibleSalesmen = isAdmin
    ? salesmen
    : salesmen.filter(
        (s) => (myCleanerId && myCleanerId > 0 && s.cleaner_id === myCleanerId) || nameMatch(s.name)
      )

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PayrollWeek
        weekStart={start}
        weekEnd={end}
        technicians={visibleTechnicians}
        salesmen={visibleSalesmen}
        status={status}
        onWeekChange={handleWeekChange}
        onEmployeeClick={(id) => {
          // TODO: open employee detail drawer
        }}
      />
    </div>
  )
}
