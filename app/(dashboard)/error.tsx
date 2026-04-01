"use client"

import { useEffect } from "react"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Dashboard error:", error)
  }, [error])

  return (
    <div className="flex items-center justify-center h-[60vh]">
      <div className="max-w-md w-full rounded-xl border border-red-500/30 bg-red-500/5 p-6 space-y-4">
        <h2 className="text-lg font-bold text-red-400">Something went wrong</h2>
        <pre className="text-xs text-muted-foreground bg-black/50 rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap break-words">
          {error.message}
          {error.stack && `\n\n${error.stack}`}
        </pre>
        <button
          onClick={reset}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
