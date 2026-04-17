import React from "react"
import type { Metadata, Viewport } from "next"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
}

export const metadata: Metadata = {
  title: "Service Agreement — WinBros",
  description: "Review and sign your WinBros service plan agreement",
}

export default function ServicePlanLayout({ children }: { children: React.ReactNode }) {
  return (
    // Force light mode for customer-facing signing pages
    <div className="light bg-white text-slate-800" style={{ colorScheme: "light" }}>
      {children}
    </div>
  )
}
