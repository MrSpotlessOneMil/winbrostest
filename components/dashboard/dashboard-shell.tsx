"use client"

import React, { useState, useEffect } from "react"
import { Sidebar } from "@/components/dashboard/sidebar"
import { TopNav } from "@/components/dashboard/top-nav"
import { SettingsModal } from "@/components/dashboard/settings-modal"
import { AuthProvider } from "@/lib/auth-context"

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("sidebar-collapsed") === "true"
    }
    return false
  })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", String(sidebarCollapsed))
  }, [sidebarCollapsed])

  // Close mobile menu on resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) setMobileMenuOpen(false)
    }
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => { document.body.style.overflow = "" }
  }, [mobileMenuOpen])

  return (
    <AuthProvider>
      <div className="flex h-[100dvh] overflow-hidden bg-zinc-950">
        {/* Desktop sidebar */}
        <div className="hidden md:block">
          <Sidebar collapsed={sidebarCollapsed} onNavClick={() => setSettingsOpen(false)} onOpenSettings={() => setSettingsOpen(true)} />
        </div>

        {/* Mobile sidebar drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
            />
            {/* Drawer */}
            <div className="absolute inset-y-0 left-0 w-64 animate-in slide-in-from-left duration-200">
              <Sidebar collapsed={false} onNavClick={() => { setMobileMenuOpen(false); setSettingsOpen(false) }} onOpenSettings={() => { setMobileMenuOpen(false); setSettingsOpen(true) }} />
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0 m-1 md:m-2 md:ml-0 rounded-xl bg-zinc-900/80 border border-zinc-800/60 overflow-hidden relative">
          {settingsOpen ? (
            <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          ) : (
            <>
              <TopNav
                onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
                onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
              />
              <main className="flex-1 flex flex-col overflow-y-auto overscroll-contain p-3 md:p-4">{children}</main>
            </>
          )}
        </div>
      </div>
    </AuthProvider>
  )
}
