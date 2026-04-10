"use client"

export default function CrewError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#f7f5f0" }}>
      <div className="max-w-md w-full text-center">
        <h2 className="text-lg font-bold text-red-600 mb-2">Something went wrong</h2>
        <pre className="text-xs text-left bg-red-50 border border-red-200 rounded-lg p-3 mb-4 overflow-x-auto whitespace-pre-wrap break-words text-red-700">
          {error.message}
          {error.stack && "\n\n" + error.stack}
        </pre>
        <button
          onClick={reset}
          className="px-4 py-2 bg-teal-500 text-white rounded-lg text-sm font-medium"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
