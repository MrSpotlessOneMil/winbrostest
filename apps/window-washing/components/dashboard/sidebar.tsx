"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Sparkles,
  Bug,
  ShieldCheck,
  UserCircle,
  LogOut,
  ChevronsUpDown,
  Plus,
  Check,
  X,
  Loader2,
  Target,
  Lightbulb,
  Settings,
  Inbox,
  Clock,
  ClipboardList,
  DollarSign,
  BarChart3,
  Calendar,
  Repeat,
  Sliders,
  FileText,
} from "lucide-react"
import { useState, useRef, useEffect, useMemo } from "react"

// Tenant-specific accent colors
const TENANT_COLORS: Record<string, { active: string; bg: string; bgStrong: string; text: string; textLight: string; btn: string; btnHover: string }> = {
  winbros: {
    active: "text-teal-400",
    bg: "bg-teal-500/15",
    bgStrong: "bg-teal-500/25",
    text: "text-teal-300",
    textLight: "text-teal-200",
    btn: "bg-teal-500",
    btnHover: "hover:bg-teal-600",
  },
}

const DEFAULT_COLORS = {
  active: "text-purple-400",
  bg: "bg-purple-500/15",
  bgStrong: "bg-purple-500/25",
  text: "text-purple-300",
  textLight: "text-purple-200",
  btn: "bg-purple-500",
  btnHover: "hover:bg-purple-600",
}

const navigation = [
  { name: "Customers", href: "/customers", icon: UserCircle, adminOnly: false },
  { name: "Quotes", href: "/quotes", icon: FileText, adminOnly: false },
  { name: "Calendar", href: "/jobs", icon: ClipboardList, adminOnly: false },
  { name: "Schedule", href: "/schedule", icon: CalendarDays, adminOnly: false },
  { name: "Service Plans", href: "/service-plan-schedule", icon: Calendar, adminOnly: false },
  { name: "ARR Dashboard", href: "/service-plan-hub", icon: Repeat, adminOnly: false },
  { name: "Payroll", href: "/payroll", icon: DollarSign, adminOnly: false },
  { name: "Control Center", href: "/control-center", icon: Sliders, adminOnly: false },
  { name: "Teams", href: "/teams", icon: Users, adminOnly: true },
  { name: "Reporting", href: "/insights", icon: BarChart3, adminOnly: true },
  { name: "Admin", href: "/admin", icon: ShieldCheck, adminOnly: true },
]

interface SidebarProps {
  collapsed: boolean
  onNavClick?: () => void  // Called when a nav item is clicked (closes mobile drawer)
  onOpenSettings?: () => void  // Opens full-page settings from dashboard shell
}

export function Sidebar({ collapsed, onNavClick, onOpenSettings }: SidebarProps) {
  const pathname = usePathname()
  const { isAdmin, user, logout, accounts, addAccount, switchAccount, tenant } = useAuth()
  const tenantSlug = tenant?.slug || user?.tenantSlug || ''
  const c = useMemo(() => TENANT_COLORS[tenantSlug] || DEFAULT_COLORS, [tenantSlug])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [dropdownVisible, setDropdownVisible] = useState(false)
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [loginUsername, setLoginUsername] = useState("")
  const [loginPassword, setLoginPassword] = useState("")
  const [loginError, setLoginError] = useState("")
  const [loggingIn, setLoggingIn] = useState(false)
  const [switchingTo, setSwitchingTo] = useState<number | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Animate dropdown open/close
  useEffect(() => {
    if (dropdownOpen) {
      setDropdownVisible(true)
    }
  }, [dropdownOpen])

  const closeDropdown = () => {
    setDropdownOpen(false)
    setTimeout(() => {
      setDropdownVisible(false)
      setShowAddAccount(false)
      setLoginError("")
    }, 200)
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeDropdown()
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const handleSwitchAccount = async (userId: number) => {
    setSwitchingTo(userId)
    // Brief press animation, then close dropdown, then switch
    await new Promise((r) => setTimeout(r, 150))
    closeDropdown()
    await new Promise((r) => setTimeout(r, 200))
    await switchAccount(userId)
    setSwitchingTo(null)
  }

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!loginUsername || !loginPassword) return

    setLoggingIn(true)
    setLoginError("")

    const result = await addAccount(loginUsername, loginPassword)

    if (result.success) {
      setShowAddAccount(false)
      setLoginUsername("")
      setLoginPassword("")
      closeDropdown()
    } else {
      setLoginError(result.error || "Login failed")
    }

    setLoggingIn(false)
  }

  // Use the tenant slug as the single account identifier (fall back to username for admin)
  const accountLabel = (u: { username: string; tenantSlug?: string | null }) =>
    u.tenantSlug || u.username

  const otherAccounts = accounts
    .filter((a) => accountLabel(a.user) !== (user ? accountLabel(user) : null))
    .filter((a, i, arr) => arr.findIndex((b) => accountLabel(b.user) === accountLabel(a.user)) === i)
    .sort((a, b) => {
      // Admin always first
      if (a.user.username === "admin") return -1
      if (b.user.username === "admin") return 1
      return accountLabel(a.user).localeCompare(accountLabel(b.user))
    })

  // Filter navigation items based on admin status
  const filteredNavigation = navigation.filter(item => {
    if (item.adminOnly && !isAdmin) return false
    if ((item as any).tenantOnly && (item as any).tenantOnly !== tenantSlug) return false
    return true
  })

  // Prevent scroll events on sidebar from scrolling the main content
  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation()
  }

  return (
    <aside
      onWheel={handleWheel}
      data-tenant={tenantSlug || undefined}
      className={`${
        collapsed ? "w-[3.5rem]" : "w-64"
      } bg-sidebar backdrop-blur-xl border-r border-sidebar-border h-full flex-shrink-0 flex flex-col transition-all duration-200 overflow-hidden`}
    >
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-white/[0.06]">
        {!collapsed && (
          <Link href="/customers" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <img src="/icon-192x192.png" alt="" className="w-7 h-7 rounded-md" />
            <span className="font-semibold text-sidebar-foreground tracking-tight text-sm">
              {tenant?.name?.toUpperCase() || "OSIRIS"}
            </span>
          </Link>
        )}
        {collapsed && (
          <Link href="/customers" className="w-full flex justify-center">
            <img src="/icon-192x192.png" alt="" className="w-7 h-7 rounded-md" />
          </Link>
        )}
      </div>

      {/* Navigation */}
      <nav className={`flex-1 overflow-y-auto overscroll-contain ${collapsed ? "px-2" : "px-3"} py-4 space-y-1`}>
        {filteredNavigation.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.name : undefined}
              onClick={onNavClick}
              className={`flex items-center ${collapsed ? "justify-center" : "gap-3 px-3"} py-2 rounded-md text-sm font-medium transition-all duration-150 min-h-[44px] ${
                isActive
                  ? "text-sidebar-foreground bg-white/[0.06] sidebar-active-border"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? c.active : ""}`} />
              {!collapsed && <span>{item.name}</span>}
            </Link>
          )
        })}
      </nav>

      {/* User Switcher */}
      <div className="px-3 py-3 border-t border-white/[0.06]">
        {!collapsed ? (
          <div ref={dropdownRef} className="relative">
            <button
              onClick={() => dropdownOpen ? closeDropdown() : setDropdownOpen(true)}
              className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-sidebar-accent text-left transition-colors"
            >
              <div className={`w-8 h-8 rounded-md ${c.bg} flex items-center justify-center text-xs font-semibold ${c.text} shrink-0`}>
                {user ? accountLabel(user).charAt(0).toUpperCase() : "U"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                  {user ? accountLabel(user) : "User"}
                </div>
              </div>
              <ChevronsUpDown className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>

            {dropdownVisible && (
              <div
                className={`absolute left-0 right-0 bottom-full mb-2 rounded-xl py-1 z-50 transition-all duration-200 origin-bottom ${
                  dropdownOpen
                    ? "opacity-100 scale-100 translate-y-0"
                    : "opacity-0 scale-95 translate-y-2 pointer-events-none"
                }`}
                style={{ background: 'rgba(24, 24, 27, 0.85)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255, 255, 255, 0.08)', boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)' }}
              >
                {/* Current account indicator */}
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Current Account
                </div>
                <div className="flex items-center gap-2.5 px-3 py-2 bg-sidebar-accent">
                  <div className={`w-7 h-7 rounded-md ${c.bg} flex items-center justify-center text-xs font-semibold ${c.text} shrink-0`}>
                    {user ? accountLabel(user).charAt(0).toUpperCase() : "U"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {user ? accountLabel(user) : "User"}
                    </div>
                  </div>
                  <Check className={`w-4 h-4 ${c.active}`} />
                </div>

                {/* Other accounts */}
                {otherAccounts.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 mt-1 text-xs font-medium text-muted-foreground uppercase tracking-wider border-t border-sidebar-border">
                      Switch Account
                    </div>
                    {otherAccounts.map((account) => {
                      const isSwitching = switchingTo === account.user.id
                      return (
                        <button
                          key={account.user.id}
                          onClick={() => handleSwitchAccount(account.user.id)}
                          disabled={switchingTo !== null}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all duration-150 ${
                            isSwitching
                              ? `${c.bg} scale-[0.97]`
                              : "hover:bg-sidebar-accent scale-100"
                          }`}
                        >
                          <div className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-semibold shrink-0 transition-colors duration-150 ${
                            isSwitching
                              ? `${c.bgStrong} ${c.text}`
                              : "bg-sidebar-accent/50 text-muted-foreground"
                          }`}>
                            {accountLabel(account.user).charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-medium truncate transition-colors duration-150 ${
                              isSwitching ? c.textLight : "text-foreground"
                            }`}>
                              {accountLabel(account.user)}
                            </div>
                          </div>
                          {isSwitching && (
                            <Loader2 className={`w-3.5 h-3.5 ${c.active} animate-spin shrink-0`} />
                          )}
                        </button>
                      )
                    })}
                  </>
                )}

                {/* Add account */}
                {!showAddAccount ? (
                  <button
                    onClick={() => setShowAddAccount(true)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent text-left border-t border-sidebar-border mt-1"
                  >
                    <Plus className="w-4 h-4" />
                    Add another account
                  </button>
                ) : (
                  <form onSubmit={handleAddAccount} className="px-3 py-2 border-t border-sidebar-border mt-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Sign in to account</span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddAccount(false)
                          setLoginError("")
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Username"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm bg-sidebar-accent border border-sidebar-border rounded text-foreground placeholder-muted-foreground focus:outline-none focus:border-sidebar-ring"
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm bg-sidebar-accent border border-sidebar-border rounded text-foreground placeholder-muted-foreground focus:outline-none focus:border-sidebar-ring"
                    />
                    {loginError && (
                      <p className="text-xs text-red-400">{loginError}</p>
                    )}
                    <button
                      type="submit"
                      disabled={loggingIn || !loginUsername || !loginPassword}
                      className={`w-full py-1.5 text-sm font-medium ${c.btn} ${c.btnHover} disabled:bg-muted disabled:text-muted-foreground text-white rounded flex items-center justify-center gap-2`}
                    >
                      {loggingIn ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Signing in...
                        </>
                      ) : (
                        "Sign in"
                      )}
                    </button>
                  </form>
                )}

                <div className="border-t border-sidebar-border mt-1" />

                {/* Settings */}
                <button
                  onClick={() => {
                    closeDropdown()
                    onOpenSettings?.()
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent text-left"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Settings
                </button>

                {/* Logout */}
                <button
                  onClick={() => {
                    closeDropdown()
                    logout()
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent text-left"
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
              onClick={() => dropdownOpen ? closeDropdown() : setDropdownOpen(true)}
              title={user ? accountLabel(user) : "User"}
              className={`w-8 h-8 rounded-md ${c.bg} flex items-center justify-center text-xs font-semibold ${c.text}`}
            >
              {user ? accountLabel(user).charAt(0).toUpperCase() : "U"}
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
