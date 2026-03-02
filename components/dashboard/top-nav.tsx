"use client"

import { useState, useEffect } from "react"
import { Search, PanelLeft, Menu, Power, PowerOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useAuth } from "@/lib/auth-context"

interface TopNavProps {
  onToggleSidebar?: () => void
  onToggleMobileMenu?: () => void
}

export function TopNav({ onToggleSidebar, onToggleMobileMenu }: TopNavProps) {
  const { tenantStatus, isAdmin, refresh } = useAuth()

  // Local optimistic state for system active toggle — initializes from auth context
  const [localActive, setLocalActive] = useState<boolean | null>(null)

  // Sync from auth context when it loads / changes
  useEffect(() => {
    if (tenantStatus) {
      setLocalActive(tenantStatus.active)
    }
  }, [tenantStatus?.active])

  const systemActive = localActive ?? tenantStatus?.active ?? true

  async function toggleSystem() {
    const newActive = !systemActive
    // Optimistic update — switch immediately
    setLocalActive(newActive)
    try {
      await fetch("/api/tenant/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: newActive }),
      })
      // Sync auth context in background (no await — don't block)
      refresh().catch(() => {})
    } catch {
      // Rollback on failure
      setLocalActive(!newActive)
    }
  }

  // Determine status indicator
  const getStatus = () => {
    if (isAdmin) return { label: "Online", color: "emerald", ping: true }
    if (!tenantStatus) return { label: "Online", color: "emerald", ping: true }
    if (!systemActive) return { label: "Inactive", color: "red", ping: false }
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
    <header className="flex h-14 items-center gap-3 border-b border-zinc-800/60 bg-zinc-900/80 px-3 md:px-4">
      {/* Mobile hamburger menu */}
      {onToggleMobileMenu && (
        <button
          onClick={onToggleMobileMenu}
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-md hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* Desktop sidebar toggle */}
      {onToggleSidebar && (
        <>
          <button
            onClick={onToggleSidebar}
            className="hidden md:flex w-7 h-7 items-center justify-center rounded-md hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          <div className="hidden md:block h-4 w-px bg-zinc-800" />
        </>
      )}

      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <Input
          placeholder="Search..."
          className="pl-10 bg-zinc-800/80 border-zinc-700/50 text-zinc-300 placeholder-zinc-600 focus:border-zinc-600 text-sm"
        />
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {/* System Active Toggle — non-admin only */}
        {!isAdmin && tenantStatus && (
          <div className="flex items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/50 px-3 py-1.5">
            <div className={`p-1 rounded-md ${systemActive ? "bg-green-500/10" : "bg-red-500/10"}`}>
              {systemActive ? (
                <Power className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <PowerOff className="h-3.5 w-3.5 text-red-500" />
              )}
            </div>
            <span className="hidden sm:inline text-xs font-medium text-zinc-300">
              {systemActive ? "Active" : "Offline"}
            </span>
            <Switch
              checked={systemActive}
              onCheckedChange={toggleSystem}
            />
          </div>
        )}

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
