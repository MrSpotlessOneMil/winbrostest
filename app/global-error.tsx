"use client"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body style={{ background: "#0a0a0a", color: "#e5e5e5", fontFamily: "system-ui", padding: "2rem" }}>
        <div style={{ maxWidth: 500, margin: "4rem auto" }}>
          <h2 style={{ color: "#f87171", marginBottom: "1rem" }}>Something went wrong</h2>
          <pre style={{
            fontSize: 12, background: "#1a1a1a", padding: 16, borderRadius: 8,
            overflow: "auto", maxHeight: 300, whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {error.message}
            {error.stack && `\n\n${error.stack}`}
          </pre>
          <button
            onClick={reset}
            style={{
              marginTop: 16, padding: "8px 16px", background: "#a855f7",
              color: "white", border: "none", borderRadius: 8, cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
