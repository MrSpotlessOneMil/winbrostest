"use client"

import { Search, PanelLeft } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/lib/auth-context"

interface TopNavProps {
  onToggleSidebar?: () => void
}

export function TopNav({ onToggleSidebar }: TopNavProps) {
  const { tenantStatus, isAdmin } = useAuth()

  // Determine status indicator
  const getStatus = () => {
    // Admin sees all tenants — just show "Online"
    if (isAdmin) return { label: "Online", color: "emerald", ping: true }
    if (!tenantStatus) return { label: "Online", color: "emerald", ping: true }
    if (!tenantStatus.active) return { label: "Inactive", color: "red", ping: false }
    if (!tenantStatus.smsEnabled) return { label: "SMS Off", color: "amber", ping: false }
    return { label: "Online", color: "emerald", ping: true }
  }

  const status = getStatus()

  const colorMap: Record<string, { bg: string; text: string; dot: string; pingDot: string }> = {
    emerald: {
      bg: "bg-emerald-500/10",
      text: "text-emerald-400",
      dot: "bg-emerald-500",
      pingDot: "bg-emerald-500",
    },
    amber: {
      bg: "bg-amber-500/10",
      text: "text-amber-400",
      dot: "bg-amber-500",
      pingDot: "bg-amber-500",
    },
    red: {
      bg: "bg-red-500/10",
      text: "text-red-400",
      dot: "bg-red-500",
      pingDot: "bg-red-500",
    },
  }

  const colors = colorMap[status.color] || colorMap.emerald

  return (
    <header className="flex h-14 items-center gap-3 border-b border-zinc-800/60 bg-zinc-900/80 px-4">
      {/* Sidebar Toggle */}
      {onToggleSidebar && (
        <>
          <button
            onClick={onToggleSidebar}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          <div className="h-4 w-px bg-zinc-800" />
        </>
      )}

      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <Input
          placeholder="Search jobs, leads, teams..."
          className="pl-10 bg-zinc-800/80 border-zinc-700/50 text-zinc-300 placeholder-zinc-600 focus:border-zinc-600"
        />
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Status Indicator */}
        <div className={`hidden sm:flex items-center gap-2 rounded-lg ${colors.bg} px-3 py-1.5`}>
          <span className="relative flex h-2 w-2">
            {status.ping && (
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${colors.pingDot} opacity-75`} />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${colors.dot}`} />
          </span>
          <span className={`text-xs font-medium ${colors.text}`}>{status.label}</span>
        </div>
      </div>
    </header>
  )
}
