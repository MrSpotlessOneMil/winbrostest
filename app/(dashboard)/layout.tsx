"use client"

import React, { useEffect, useState } from "react"
import DashboardShell from "@/components/dashboard/dashboard-shell"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Avoid SSR/client mismatch from Radix-generated IDs by only rendering the shell after mount.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return <div className="min-h-screen bg-background" />
  }

  return <DashboardShell>{children}</DashboardShell>
}
