"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import NeuralBackground from "@/components/neural-background"
import { cn } from "@/lib/utils"

type Mode = "select" | "signin"
type Role = "technician" | "salesman" | "operator"

const ROLE_META: Record<Role, { label: string; sub: string; accent: string }> = {
  technician: {
    label: "Technician / Cleaner",
    sub: "Field crew sign in",
    accent: "blue",
  },
  salesman: {
    label: "Salesman",
    sub: "Sales team sign in",
    accent: "purple",
  },
  operator: {
    label: "Operator / Owner",
    sub: "Dashboard access for operators, team leads, and owners",
    accent: "emerald",
  },
}

export default function AppEntryPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>("select")
  const [role, setRole] = useState<Role | null>(null)
  const [checkingAuth, setCheckingAuth] = useState(true)

  // Auto-redirect if already logged in. Owners → /overview (admin Command
  // Center). Field roles (technician / salesman / team-lead) → /my-day so
  // they land on their Command Center, not the owner dashboard.
  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data?.user) {
          const dest = data.data.type === "employee" ? "/my-day" : "/overview"
          router.replace(dest)
        } else {
          setCheckingAuth(false)
        }
      })
      .catch(() => setCheckingAuth(false))
  }, [router])

  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  function pickRole(r: Role) {
    setRole(r)
    setMode("signin")
    setError("")
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()

      if (!res.ok || !data.success) {
        setError(data.error || "Invalid credentials")
        setLoading(false)
        return
      }

      setLoading(false)
      // Owners land on /overview (admin Command Center). Techs / salesmen /
      // team-leads land on /my-day (field Command Center) — that's their
      // dashboard. Sidebar role-gating from auth-context handles the rest.
      const dest = data.data?.type === "employee" ? "/my-day" : "/overview"
      router.push(dest)
      router.refresh()
    } catch {
      setError("Connection error. Try again.")
      setLoading(false)
    }
  }

  // Checking existing auth
  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="animate-pulse text-emerald-400 font-mono text-sm">LOADING...</div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <div className="absolute inset-0">
        <NeuralBackground color="#00ffaa" trailOpacity={0.08} particleCount={300} speed={0.8} />
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="mb-8 text-center">
            <h1 className="font-mono text-3xl font-bold tracking-tighter text-neutral-100">
              <span className="text-emerald-400">{">"}</span>
              _CLEAN MACHINE
              <span className="animate-pulse text-emerald-400">_</span>
            </h1>
            {mode === "select" && (
              <p className="mt-2 font-mono text-xs uppercase tracking-widest text-neutral-500">
                SELECT YOUR ROLE
              </p>
            )}
          </div>

          {/* Role Selection */}
          {mode === "select" && (
            <div className="space-y-3">
              <button
                onClick={() => pickRole("technician")}
                className="w-full rounded-xl border border-neutral-700 bg-black/60 p-5 text-left backdrop-blur-xl transition-all hover:border-blue-500/50 hover:bg-blue-500/5 active:scale-[0.98]"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/20">
                    <svg className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-neutral-100">Technician / Cleaner</h3>
                    <p className="text-xs text-neutral-500 mt-0.5">Field crew</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => pickRole("salesman")}
                className="w-full rounded-xl border border-neutral-700 bg-black/60 p-5 text-left backdrop-blur-xl transition-all hover:border-purple-500/50 hover:bg-purple-500/5 active:scale-[0.98]"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-500/20">
                    <svg className="h-6 w-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-neutral-100">Salesman</h3>
                    <p className="text-xs text-neutral-500 mt-0.5">Quotes &amp; commission</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => pickRole("operator")}
                className="w-full rounded-xl border border-neutral-700 bg-black/60 p-5 text-left backdrop-blur-xl transition-all hover:border-emerald-500/50 hover:bg-emerald-500/5 active:scale-[0.98]"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-500/20">
                    <svg className="h-6 w-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-neutral-100">Operator / Owner</h3>
                    <p className="text-xs text-neutral-500 mt-0.5">Owners &amp; team leads</p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* Sign In — single username + password form for every role */}
          {mode === "signin" && role && (
            <div className="relative">
              <div
                className={cn(
                  "absolute -inset-1 rounded-2xl opacity-75 blur-lg",
                  role === "technician" && "bg-gradient-to-r from-blue-500/20 via-cyan-500/20 to-blue-500/20",
                  role === "salesman" && "bg-gradient-to-r from-purple-500/20 via-fuchsia-500/20 to-purple-500/20",
                  role === "operator" && "bg-gradient-to-r from-emerald-500/20 via-cyan-500/20 to-emerald-500/20",
                )}
              />
              <div className="relative rounded-2xl border border-neutral-800 bg-black/80 p-6 backdrop-blur-xl">
                <button
                  onClick={() => { setMode("select"); setError(""); setRole(null) }}
                  className="mb-4 flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>

                <h2 className="mb-1 text-xl font-bold text-neutral-100">
                  {ROLE_META[role].label} Sign In
                </h2>
                <p className="mb-6 text-sm text-neutral-500">{ROLE_META[role].sub}</p>

                <form onSubmit={handleSignIn} className="space-y-4">
                  <div>
                    <label className="block font-mono text-xs uppercase tracking-wider text-neutral-400 mb-2">
                      Username
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="username"
                      className={cn(
                        "w-full rounded-lg border border-neutral-700 bg-neutral-900/50 px-4 py-3 font-mono text-neutral-100 placeholder-neutral-600 transition-all focus:outline-none focus:ring-2",
                        role === "technician" && "focus:border-blue-500/50 focus:ring-blue-500/20",
                        role === "salesman" && "focus:border-purple-500/50 focus:ring-purple-500/20",
                        role === "operator" && "focus:border-emerald-500/50 focus:ring-emerald-500/20",
                      )}
                      autoFocus
                      required
                      autoComplete="username"
                    />
                  </div>

                  <div>
                    <label className="block font-mono text-xs uppercase tracking-wider text-neutral-400 mb-2">
                      Password / PIN
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="--------"
                      className={cn(
                        "w-full rounded-lg border border-neutral-700 bg-neutral-900/50 px-4 py-3 font-mono text-neutral-100 placeholder-neutral-600 transition-all focus:outline-none focus:ring-2",
                        role === "technician" && "focus:border-blue-500/50 focus:ring-blue-500/20",
                        role === "salesman" && "focus:border-purple-500/50 focus:ring-purple-500/20",
                        role === "operator" && "focus:border-emerald-500/50 focus:ring-emerald-500/20",
                      )}
                      required
                      autoComplete="current-password"
                    />
                  </div>

                  {error && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
                      <p className="text-sm text-red-400">{error}</p>
                      <p className="mt-1 text-xs text-neutral-500">
                        Field crew: your username is your full name (e.g.{" "}
                        <span className="font-mono">Bob Jones</span>) and your PIN is 4 digits. Ask your manager if you don&apos;t have it.
                      </p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className={cn(
                      "w-full rounded-lg border px-6 py-4 font-mono font-semibold uppercase tracking-wider transition-all",
                      role === "technician" && "border-blue-500/30 bg-blue-500/10 text-blue-400 hover:border-blue-500/50 hover:bg-blue-500/20",
                      role === "salesman" && "border-purple-500/30 bg-purple-500/10 text-purple-400 hover:border-purple-500/50 hover:bg-purple-500/20",
                      role === "operator" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/20",
                      loading && "cursor-not-allowed opacity-50"
                    )}
                  >
                    {loading ? "Signing in..." : "[ SIGN IN ]"}
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
