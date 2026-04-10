import React from "react"
import type { Metadata, Viewport } from "next"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
}

export const metadata: Metadata = {
  title: "Your Quote",
  description: "Review and approve your service quote",
}

export default function QuoteLayout({ children }: { children: React.ReactNode }) {
  return (
    // Force light mode for customer-facing quote pages
    <div className="light bg-white text-slate-800" style={{ colorScheme: "light" }}>
      {children}
    </div>
  )
}
