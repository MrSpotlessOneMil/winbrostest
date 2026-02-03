"use client"

import React, { useState, useEffect } from "react"
import { Sidebar } from "@/components/dashboard/sidebar"
import { TopNav } from "@/components/dashboard/top-nav"

interface UserInfo {
  id: number
  username: string
  display_name: string | null
  email: string | null
}

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [user, setUser] = useState<UserInfo | null>(null)

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch("/api/auth/session")
        const json = await res.json()
        if (json.success && json.data?.user) {
          setUser(json.data.user)
        }
      } catch (error) {
        console.error("Failed to fetch user:", error)
      }
    }
    fetchUser()
  }, [])

  const isAdmin = user?.username === "admin"

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <Sidebar collapsed={sidebarCollapsed} isAdmin={isAdmin} />
      <div className="flex-1 flex flex-col min-w-0 m-2 ml-0 rounded-xl bg-zinc-900/80 border border-zinc-800/60 overflow-hidden">
        <TopNav onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)} />
        <main className="flex-1 flex flex-col overflow-y-auto p-4">{children}</main>
      </div>
    </div>
  )
}
