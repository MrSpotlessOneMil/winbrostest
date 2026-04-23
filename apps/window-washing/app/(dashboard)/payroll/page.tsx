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
  const { user, isAdmin, cleanerId: myCleanerId } = useAuth()
  const [loading, setLoading] = useState(true)
  const [weekDate, setWeekDate] = useState(() => new Date())
  const [technicians, setTechnicians] = useState<any[]>([])
  const [salesmen, setSalesmen] = useState<any[]>([])
  const [status, setStatus] = useState<"draft" | "finalized">("draft")

  const { start, end } = getWeekBounds(weekDate)

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

  const handlePayRateChange = (cleanerId: number, field: 'hourly_rate' | 'pay_percentage', value: number) => {
    setTechnicians(prev =>
      prev.map(t => t.cleaner_id === cleanerId ? { ...t, [field]: value } : t)
    )
    // Debounced save to pay_rates table
    fetch('/api/actions/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cleaner_id: cleanerId, [field]: value }),
    }).catch(() => {})
  }

  const handlePayModeChange = (cleanerId: number, mode: 'hourly' | 'percentage') => {
    // When flipping modes, zero out the field that becomes inactive so payroll is unambiguous.
    setTechnicians(prev =>
      prev.map(t =>
        t.cleaner_id === cleanerId
          ? {
              ...t,
              pay_mode: mode,
              hourly_rate: mode === 'hourly' ? t.hourly_rate : 0,
              pay_percentage: mode === 'percentage' ? t.pay_percentage : 0,
            }
          : t
      )
    )
    fetch('/api/actions/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cleaner_id: cleanerId,
        pay_mode: mode,
        // Defensive zero so the inactive field can't silently contribute to pay
        ...(mode === 'hourly' ? { pay_percentage: 0 } : { hourly_rate: 0 }),
      }),
    }).catch(() => {})
  }

  const handleSalesCommissionChange = (cleanerId: number, field: 'commission_1time_pct' | 'commission_triannual_pct' | 'commission_quarterly_pct', value: number) => {
    setSalesmen(prev =>
      prev.map(s => s.cleaner_id === cleanerId ? { ...s, [field]: value } : s)
    )
    fetch('/api/actions/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cleaner_id: cleanerId, [field]: value }),
    }).catch(() => {})
  }

  const handleReviewCountChange = (cleanerId: number, count: number) => {
    setTechnicians(prev =>
      prev.map(t => t.cleaner_id === cleanerId ? { ...t, review_count: count } : t)
    )
    fetch('/api/actions/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cleaner_id: cleanerId, review_count: count, weekStart: start }),
    }).catch(() => {})
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
        onReviewCountChange={handleReviewCountChange}
        onPayRateChange={handlePayRateChange}
        onPayModeChange={handlePayModeChange}
        onSalesCommissionChange={handleSalesCommissionChange}
      />
    </div>
  )
}
