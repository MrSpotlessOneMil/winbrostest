"use client"

import { useEffect, useState, useCallback } from "react"
import { useAuth } from "@/lib/auth-context"
import { DaySchedule } from "@/components/winbros/day-schedule"
import { Loader2 } from "lucide-react"

export default function SchedulePage() {
  const { user } = useAuth()
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0])
  const [loading, setLoading] = useState(true)
  const [crews, setCrews] = useState<any[]>([])
  const [salesmanAppointments, setSalesmanAppointments] = useState<any[]>([])

  const fetchSchedule = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/actions/schedule-day?date=${date}`)
      if (res.ok) {
        const data = await res.json()
        setCrews(data.crews || [])
        setSalesmanAppointments(data.salesmanAppointments || [])
      } else {
        // API may not exist yet — show empty state
        setCrews([])
        setSalesmanAppointments([])
      }
    } catch {
      setCrews([])
      setSalesmanAppointments([])
    }
    setLoading(false)
  }, [date])

  useEffect(() => {
    fetchSchedule()
  }, [fetchSchedule])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <DaySchedule
        date={date}
        crews={crews}
        salesmanAppointments={salesmanAppointments}
        onDateChange={setDate}
        onJobClick={(jobId) => {
          window.location.href = `/jobs?job=${jobId}`
        }}
      />
    </div>
  )
}
