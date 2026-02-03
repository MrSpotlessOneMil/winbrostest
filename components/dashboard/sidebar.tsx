"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  TrendingUp,
  DollarSign,
  Settings,
  Phone,
  Trophy,
  Bug,
  ShieldCheck,
  UserCircle,
  LogOut,
  ChevronsUpDown,
} from "lucide-react"
import { useState, useRef, useEffect } from "react"

const navigation = [
  { name: "Overview", href: "/", icon: LayoutDashboard, adminOnly: false },
  { name: "Customers", href: "/customers", icon: UserCircle, adminOnly: false },
  { name: "Jobs Calendar", href: "/jobs", icon: CalendarDays, adminOnly: false },
  { name: "Lead Funnel", href: "/leads", icon: TrendingUp, adminOnly: false },
  { name: "Teams", href: "/teams", icon: Users, adminOnly: false },
  { name: "Tips & Upsells", href: "/earnings", icon: DollarSign, adminOnly: false },
  { name: "Leaderboard", href: "/leaderboard", icon: Trophy, adminOnly: false },
  { name: "Calls", href: "/calls", icon: Phone, adminOnly: false },
  { name: "Debug", href: "/exceptions", icon: Bug, adminOnly: true },
  { name: "Admin", href: "/admin", icon: ShieldCheck, adminOnly: true },
]

interface SidebarProps {
  collapsed: boolean
}

export function Sidebar({ collapsed }: SidebarProps) {
  const pathname = usePathname()
  const { isAdmin, user, logout } = useAuth()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  // Filter navigation items based on admin status
  const filteredNavigation = navigation.filter(item => !item.adminOnly || isAdmin)

  return (
    <aside
      className={`${
        collapsed ? "w-[3.5rem]" : "w-64"
      } bg-zinc-950 border-r border-zinc-800/60 min-h-screen flex flex-col transition-all duration-200`}
    >
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-zinc-800/60">
        {!collapsed && (
          <Link href="/" className="font-semibold text-zinc-100 tracking-wide hover:text-purple-300 transition-colors text-sm">
            OSIRIS
          </Link>
        )}
        {collapsed && (
          <Link href="/" className="w-full flex justify-center">
            <div className="w-7 h-7 rounded-md bg-purple-500/20 flex items-center justify-center text-xs font-bold text-purple-300">
              O
            </div>
          </Link>
        )}
      </div>

      {/* Navigation */}
      <nav className={`flex-1 ${collapsed ? "px-2" : "px-3"} py-4 space-y-1`}>
        {filteredNavigation.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.name : undefined}
              className={`flex items-center ${collapsed ? "justify-center" : "gap-3 px-3"} py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "text-zinc-100 bg-purple-500/10"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-purple-400" : ""}`} />
              {!collapsed && <span>{item.name}</span>}
            </Link>
          )
        })}
      </nav>

      {/* User Switcher */}
      <div className="px-3 py-3 border-t border-zinc-800/60">
        {!collapsed ? (
          <div ref={dropdownRef} className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-zinc-800/50 text-left"
            >
              <div className="w-8 h-8 rounded-md bg-purple-500/15 flex items-center justify-center text-xs font-semibold text-purple-300 shrink-0">
                {user?.display_name?.charAt(0)?.toUpperCase() || user?.username?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-200 truncate">
                  {user?.display_name || user?.username || "User"}
                </div>
                <div className="text-[11px] text-zinc-500 truncate">
                  {user?.email || ""}
                </div>
              </div>
              <ChevronsUpDown className="w-4 h-4 text-zinc-600 shrink-0" />
            </button>

            {dropdownOpen && (
              <div className="absolute left-0 right-0 bottom-full mb-2 bg-zinc-900 border border-zinc-700/80 rounded-lg py-1 z-50 shadow-2xl shadow-black/50">
                {/* Settings */}
                <Link
                  href="/settings"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Settings
                </Link>

                {/* Logout */}
                <button
                  onClick={() => {
                    logout()
                    setDropdownOpen(false)
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 text-left"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Log out
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex justify-center">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              title={user?.display_name || user?.username || "User"}
              className="w-8 h-8 rounded-md bg-purple-500/15 flex items-center justify-center text-xs font-semibold text-purple-300"
            >
              {user?.display_name?.charAt(0)?.toUpperCase() || user?.username?.charAt(0)?.toUpperCase() || "U"}
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
