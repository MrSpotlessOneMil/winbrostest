"use client"

import { useEffect, useState } from "react"
import { ShieldCheck, ShieldAlert, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

interface GhostHealthData {
  pending_count: number
  unresponded_24h: number
  watchdog_catches_24h: number
  watchdog_recoveries_24h: number
  status: 'green' | 'yellow' | 'red'
}

export function GhostHealth() {
  const [data, setData] = useState<GhostHealthData | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await fetch('/api/actions/ghost-health')
        if (res.ok) setData(await res.json())
      } catch {}
    }
    fetch_()
    const interval = setInterval(fetch_, 2 * 60 * 1000) // refresh every 2 min
    return () => clearInterval(interval)
  }, [])

  if (!data) return null

  // Green with no issues — show minimal
  if (data.status === 'green' && data.watchdog_catches_24h === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
        <div className="h-2 w-2 rounded-full bg-green-500" />
        <span>SMS healthy</span>
      </div>
    )
  }

  const Icon = data.status === 'red' ? ShieldAlert : data.status === 'yellow' ? AlertTriangle : ShieldCheck
  const colors = {
    green: { bg: 'bg-green-500/10', border: 'border-green-500/20', text: 'text-green-400', dot: 'bg-green-500' },
    yellow: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', text: 'text-yellow-400', dot: 'bg-yellow-500' },
    red: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400', dot: 'bg-red-500' },
  }
  const c = colors[data.status]

  return (
    <div
      className={cn("rounded-lg border p-3 cursor-pointer transition-all", c.bg, c.border)}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2">
        <div className={cn("h-2.5 w-2.5 rounded-full animate-pulse", c.dot)} />
        <Icon className={cn("h-4 w-4", c.text)} />
        <span className={cn("text-sm font-medium", c.text)}>
          {data.status === 'red' ? 'SMS Issues Detected' : data.status === 'yellow' ? 'SMS Attention Needed' : 'SMS Healthy'}
        </span>
        {data.pending_count > 0 && (
          <span className="ml-auto text-xs font-bold text-red-400">{data.pending_count} pending</span>
        )}
      </div>

      {expanded && (
        <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Pending (no response &gt;5 min)</span>
            <span className={cn("font-medium", data.pending_count > 0 ? "text-red-400" : "text-green-400")}>
              {data.pending_count}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Unresponded (24h)</span>
            <span className={cn("font-medium", data.unresponded_24h > 0 ? "text-yellow-400" : "text-green-400")}>
              {data.unresponded_24h}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Ghost catches (24h)</span>
            <span className="font-medium">{data.watchdog_catches_24h}</span>
          </div>
          <div className="flex justify-between">
            <span>Auto-recovered (24h)</span>
            <span className="font-medium text-green-400">{data.watchdog_recoveries_24h}</span>
          </div>
        </div>
      )}
    </div>
  )
}
