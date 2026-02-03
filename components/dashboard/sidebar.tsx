"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Settings,
  Bug,
  ShieldCheck,
  UserCircle,
  LogOut,
  ChevronsUpDown,
  Plus,
  Check,
  X,
  Loader2,
} from "lucide-react"
import { useState, useRef, useEffect } from "react"

const navigation = [
  { name: "Overview", href: "/", icon: LayoutDashboard, adminOnly: false },
  { name: "Customers", href: "/customers", icon: UserCircle, adminOnly: false },
  { name: "Jobs Calendar", href: "/jobs", icon: CalendarDays, adminOnly: false },
  { name: "Teams", href: "/teams", icon: Users, adminOnly: false },
  { name: "Debug", href: "/exceptions", icon: Bug, adminOnly: true },
  { name: "Admin", href: "/admin", icon: ShieldCheck, adminOnly: true },
]

interface SidebarProps {
  collapsed: boolean
}

export function Sidebar({ collapsed }: SidebarProps) {
  const pathname = usePathname()
  const { isAdmin, user, logout, accounts, addAccount, switchAccount } = useAuth()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [loginUsername, setLoginUsername] = useState("")
  const [loginPassword, setLoginPassword] = useState("")
  const [loginError, setLoginError] = useState("")
  const [loggingIn, setLoggingIn] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setShowAddAccount(false)
        setLoginError("")
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

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
      setDropdownOpen(false)
    } else {
      setLoginError(result.error || "Login failed")
    }

    setLoggingIn(false)
  }

  const otherAccounts = accounts.filter((a) => a.user.id !== user?.id)

  // Filter navigation items based on admin status
  const filteredNavigation = navigation.filter(item => !item.adminOnly || isAdmin)

  return (
    <aside
      className={`${
        collapsed ? "w-[3.5rem]" : "w-64"
      } bg-zinc-950 border-r border-zinc-800/60 h-screen sticky top-0 flex flex-col transition-all duration-200`}
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
      <nav className={`flex-1 overflow-y-auto ${collapsed ? "px-2" : "px-3"} py-4 space-y-1`}>
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
              <div className="absolute left-0 right-0 bottom-full mb-2 bg-zinc-900 border border-zinc-700/80 rounded-lg py-1 z-50 shadow-2xl shadow-black/50 max-h-80 overflow-y-auto">
                {/* Current account indicator */}
                <div className="px-3 py-1.5 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Current Account
                </div>
                <div className="flex items-center gap-2.5 px-3 py-2 bg-zinc-800/50">
                  <div className="w-7 h-7 rounded-md bg-purple-500/15 flex items-center justify-center text-xs font-semibold text-purple-300 shrink-0">
                    {user?.display_name?.charAt(0)?.toUpperCase() || user?.username?.charAt(0)?.toUpperCase() || "U"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-200 truncate">
                      {user?.display_name || user?.username || "User"}
                    </div>
                    <div className="text-[10px] text-zinc-500 truncate">
                      {user?.email || ""}
                    </div>
                  </div>
                  <Check className="w-4 h-4 text-purple-400" />
                </div>

                {/* Other accounts */}
                {otherAccounts.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 mt-1 text-xs font-medium text-zinc-500 uppercase tracking-wider border-t border-zinc-800">
                      Switch Account
                    </div>
                    {otherAccounts.map((account) => (
                      <button
                        key={account.user.id}
                        onClick={() => switchAccount(account.user.id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-zinc-800"
                      >
                        <div className="w-7 h-7 rounded-md bg-zinc-700/50 flex items-center justify-center text-xs font-semibold text-zinc-400 shrink-0">
                          {account.user.display_name?.charAt(0)?.toUpperCase() || account.user.username?.charAt(0)?.toUpperCase() || "U"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-zinc-300 truncate">
                            {account.user.display_name || account.user.username}
                          </div>
                          <div className="text-[10px] text-zinc-500 truncate">
                            {account.user.email || ""}
                          </div>
                        </div>
                      </button>
                    ))}
                  </>
                )}

                {/* Add account */}
                {!showAddAccount ? (
                  <button
                    onClick={() => setShowAddAccount(true)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 text-left border-t border-zinc-800 mt-1"
                  >
                    <Plus className="w-4 h-4" />
                    Add another account
                  </button>
                ) : (
                  <form onSubmit={handleAddAccount} className="px-3 py-2 border-t border-zinc-800 mt-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-zinc-400">Sign in to account</span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddAccount(false)
                          setLoginError("")
                        }}
                        className="text-zinc-500 hover:text-zinc-300"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Username"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                    />
                    {loginError && (
                      <p className="text-xs text-red-400">{loginError}</p>
                    )}
                    <button
                      type="submit"
                      disabled={loggingIn || !loginUsername || !loginPassword}
                      className="w-full py-1.5 text-sm font-medium bg-purple-500 hover:bg-purple-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded flex items-center justify-center gap-2"
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

                <div className="border-t border-zinc-800 mt-1" />

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
