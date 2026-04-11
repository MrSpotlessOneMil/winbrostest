"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Search,
  PanelLeft,
  Menu,
  Power,
  PowerOff,
  UserCircle,
  MessageSquare,
  Phone,
  CalendarDays,
  Users,
  Target,
  Loader2,
  Sun,
  Moon,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useAuth } from "@/lib/auth-context"
import { useTheme } from "next-themes"

interface TopNavProps {
  onToggleSidebar?: () => void
  onToggleMobileMenu?: () => void
}

interface SearchResult {
  category: string
  title: string
  subtitle: string
  href: string
  params?: Record<string, string>
}

const CATEGORY_ICONS: Record<string, typeof UserCircle> = {
  Customers: UserCircle,
  Messages: MessageSquare,
  Calls: Phone,
  Calendar: CalendarDays,
  Teams: Users,
  Retargeting: Target,
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <div className="w-8 h-8" />
  const isDark = theme === "dark"
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  )
}

export function TopNav({ onToggleSidebar, onToggleMobileMenu }: TopNavProps) {
  const { tenantStatus, isAdmin, refresh } = useAuth()
  const router = useRouter()

  // Search state
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([])
      setSearchOpen(false)
      return
    }
    setSearchLoading(true)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery.trim())}`)
        const json = await res.json()
        if (json.success) {
          setSearchResults(json.results || [])
          setSearchOpen(true)
        }
      } catch {
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [searchQuery])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!searchOpen || searchResults.length === 0) return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : 0))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : searchResults.length - 1))
      } else if (e.key === "Enter" && selectedIndex >= 0) {
        e.preventDefault()
        navigateToResult(searchResults[selectedIndex])
      } else if (e.key === "Escape") {
        setSearchOpen(false)
        inputRef.current?.blur()
      }
    },
    [searchOpen, searchResults, selectedIndex]
  )

  const navigateToResult = (result: SearchResult) => {
    const params = new URLSearchParams()
    if (result.params) {
      for (const [k, v] of Object.entries(result.params)) {
        if (v) params.set(k, v)
      }
    }
    const paramStr = params.toString()
    const url = paramStr ? `${result.href}?${paramStr}` : result.href
    setSearchOpen(false)
    setSearchQuery("")
    router.push(url)
  }

  // Group results by category
  const grouped = searchResults.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.category]) acc[r.category] = []
    acc[r.category].push(r)
    return acc
  }, {})

  // Flatten for keyboard index
  let flatIndex = 0

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
    <header className="flex h-14 items-center gap-3 border-b border-border bg-card/80 backdrop-blur-sm px-3 md:px-4">
      {/* Mobile hamburger menu */}
      {onToggleMobileMenu && (
        <button
          onClick={onToggleMobileMenu}
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* Desktop sidebar toggle */}
      {onToggleSidebar && (
        <>
          <button
            onClick={onToggleSidebar}
            className="hidden md:flex w-7 h-7 items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          <div className="hidden md:block h-4 w-px bg-border" />
        </>
      )}

      {/* Search */}
      <div className="relative flex-1 max-w-md" ref={searchRef}>
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        {searchLoading && (
          <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground animate-spin" />
        )}
        <Input
          ref={inputRef}
          placeholder="Search everything..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value)
            setSelectedIndex(-1)
          }}
          onFocus={() => {
            if (searchResults.length > 0) setSearchOpen(true)
          }}
          onKeyDown={handleKeyDown}
          className="pl-10 bg-muted/80 border-border text-foreground placeholder-muted-foreground focus:border-ring text-sm"
        />

        {/* Search results dropdown */}
        {searchOpen && searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-xl shadow-2xl overflow-hidden z-50 max-h-[70vh] overflow-y-auto">
            {Object.entries(grouped).map(([category, items]) => {
              const Icon = CATEGORY_ICONS[category] || Search
              return (
                <div key={category}>
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b border-border">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      {category}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">{items.length}</span>
                  </div>
                  {items.map((result) => {
                    const thisIndex = flatIndex++
                    const isSelected = thisIndex === selectedIndex
                    return (
                      <button
                        key={`${category}-${thisIndex}`}
                        onClick={() => navigateToResult(result)}
                        onMouseEnter={() => setSelectedIndex(thisIndex)}
                        className={`w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors ${
                          isSelected ? "bg-purple-500/10" : "hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm truncate ${isSelected ? "text-purple-200" : "text-foreground"}`}>
                            {result.title}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {result.subtitle}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {searchOpen && searchQuery.trim().length >= 2 && searchResults.length === 0 && !searchLoading && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-xl shadow-2xl z-50 p-4 text-center text-sm text-muted-foreground">
            No results found
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* System Active Toggle — non-admin only */}
        {!isAdmin && tenantStatus && (
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-popover/50 px-2 py-1">
            <div className={`p-1 rounded-md ${systemActive ? "bg-green-500/10" : "bg-red-500/10"}`}>
              {systemActive ? (
                <Power className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <PowerOff className="h-3.5 w-3.5 text-red-500" />
              )}
            </div>
            <span className="hidden sm:inline text-xs font-medium text-foreground">
              {systemActive ? "Active" : "Offline"}
            </span>
            <Switch
              checked={systemActive}
              onCheckedChange={toggleSystem}
            />
          </div>
        )}

        {/* Theme toggle */}
        <ThemeToggle />

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
