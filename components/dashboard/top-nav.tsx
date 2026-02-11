"use client"

import { Search, PanelLeft } from "lucide-react"
import { Input } from "@/components/ui/input"

interface TopNavProps {
  onToggleSidebar?: () => void
}

export function TopNav({ onToggleSidebar }: TopNavProps) {
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
        <div className="hidden sm:flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-xs font-medium text-emerald-400">Online</span>
        </div>
      </div>
    </header>
  )
}
