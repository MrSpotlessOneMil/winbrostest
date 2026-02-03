"use client"

import { Bell, Search, User, LogOut, Settings, Plug, UserCircle, PanelLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"

type NotificationItem = {
  id: string
  title: string
  subtitle?: string
  time: string
}

type CurrentUser = {
  id: number
  username: string
  display_name: string | null
  email: string | null
}

interface TopNavProps {
  onToggleSidebar?: () => void
}

export function TopNav({ onToggleSidebar }: TopNavProps) {
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  // Fetch current user session
  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" })
        const json = await res.json()
        if (json.success && json.user) {
          setUser(json.user)
        }
      } catch {
        setUser(null)
      }
    }
    fetchUser()
  }, [])

  // Fetch notifications
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch("/api/notifications?limit=10", { cache: "no-store" })
        const json = await res.json()
        const rows = Array.isArray(json?.data) ? (json.data as NotificationItem[]) : []
        if (!cancelled) setItems(rows)
      } catch {
        if (!cancelled) setItems([])
      }
    }
    load()
    const t = setInterval(load, 15000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  const count = useMemo(() => Math.min(99, items.length), [items.length])

  const handleLogout = async () => {
    if (isLoggingOut) return
    setIsLoggingOut(true)

    try {
      await fetch("/api/auth/logout", { method: "POST" })
      router.push("/login")
    } catch (error) {
      console.error("Logout failed:", error)
      setIsLoggingOut(false)
    }
  }

  const displayName = user?.username || user?.display_name || "User"
  const initials = displayName.charAt(0).toUpperCase()

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

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              {count > 0 && (
                <Badge className="absolute -right-1 -top-1 h-5 min-w-5 rounded-full p-0 px-1 text-[10px]">
                  {count}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {items.length === 0 ? (
              <DropdownMenuItem className="flex flex-col items-start gap-1 p-3">
                <span className="text-sm font-medium">No notifications</span>
                <span className="text-xs text-muted-foreground">New events will appear here.</span>
              </DropdownMenuItem>
            ) : (
              items.map((n) => (
                <DropdownMenuItem key={n.id} className="flex flex-col items-start gap-1 p-3">
                  <span className="text-sm font-medium">{n.title}</span>
                  {n.subtitle && <span className="text-xs text-muted-foreground">{n.subtitle}</span>}
                  <span className="text-xs text-muted-foreground">{n.time}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary">
                {user ? (
                  <span className="text-sm font-medium text-primary-foreground">{initials}</span>
                ) : (
                  <User className="h-4 w-4 text-primary-foreground" />
                )}
              </div>
              <div className="hidden flex-col items-start md:flex">
                <span className="text-sm font-medium">{displayName}</span>
                <span className="text-xs text-muted-foreground">Owner</span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              {user?.email ? (
                <div className="flex flex-col">
                  <span>{displayName}</span>
                  <span className="text-xs font-normal text-muted-foreground">{user.email}</span>
                </div>
              ) : (
                "My Account"
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings?tab=business" className="flex items-center gap-2 cursor-pointer">
                <UserCircle className="h-4 w-4" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" className="flex items-center gap-2 cursor-pointer">
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings?tab=integrations" className="flex items-center gap-2 cursor-pointer">
                <Plug className="h-4 w-4" />
                Integrations
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              {isLoggingOut ? "Signing out..." : "Sign out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
