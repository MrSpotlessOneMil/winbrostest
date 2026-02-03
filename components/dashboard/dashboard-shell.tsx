"use client"

import React, { useState } from "react"
import { Sidebar } from "@/components/dashboard/sidebar"
import { TopNav } from "@/components/dashboard/top-nav"
import { AuthProvider } from "@/lib/auth-context"

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <AuthProvider>
      <div className="flex h-screen overflow-hidden bg-zinc-950">
        <Sidebar collapsed={sidebarCollapsed} />
        <div className="flex-1 flex flex-col min-w-0 m-2 ml-0 rounded-xl bg-zinc-900/80 border border-zinc-800/60 overflow-hidden">
          <TopNav onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)} />
          <main className="flex-1 flex flex-col overflow-y-auto overscroll-contain p-4">{children}</main>
        </div>
      </div>
    </AuthProvider>
  )
}
