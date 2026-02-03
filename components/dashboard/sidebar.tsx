"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
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
} from "lucide-react"

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

const bottomNav = [
  { name: "Settings", href: "/settings", icon: Settings },
]

interface SidebarProps {
  collapsed: boolean
  isAdmin?: boolean
}

export function Sidebar({ collapsed, isAdmin = false }: SidebarProps) {
  const pathname = usePathname()

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

      {/* Bottom Navigation */}
      <div className={`${collapsed ? "px-2" : "px-3"} py-3 border-t border-zinc-800/60`}>
        {bottomNav.map((item) => {
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
      </div>
    </aside>
  )
}
