"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import NeuralBackground from "@/components/neural-background"
import { cn } from "@/lib/utils"

type Mode = "select" | "crew" | "staff"

export default function AppEntryPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>("select")
  const [checkingAuth, setCheckingAuth] = useState(true)

  // Auto-redirect if already logged in (staff with active session)
  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data?.user) {
          router.replace("/overview")
        } else {
          setCheckingAuth(false)
        }
      })
      .catch(() => setCheckingAuth(false))
  }, [router])

  // Also check for saved crew portal token
  useEffect(() => {
    const savedPortal = localStorage.getItem("crew_portal_url")
    if (savedPortal && !checkingAuth) {
      // Don't auto-redirect, but pre-select crew mode
    }
  }, [checkingAuth])
  const [phone, setPhone] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [crewResult, setCrewResult] = useState<{ name: string; employee_type: string; portalUrl: string } | null>(null)

  // Format phone as user types: (xxx) xxx-xxxx
  function handlePhoneChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 10)
    if (digits.length <= 3) setPhone(digits)
    else if (digits.length <= 6) setPhone(`(${digits.slice(0, 3)}) ${digits.slice(3)}`)
    else setPhone(`(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`)
  }

  async function handleCrewLogin(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/crew-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Something went wrong")
        setLoading(false)
        return
      }

      setCrewResult({ name: data.cleaner.name, employee_type: data.cleaner.employee_type, portalUrl: data.portalUrl })
      // Save for quick re-login
      try { localStorage.setItem("crew_portal_url", data.portalUrl) } catch {}
      setLoading(false)

      // Auto-redirect after showing welcome
      setTimeout(() => router.push(data.portalUrl), 1200)
    } catch {
      setError("Connection error. Try again.")
      setLoading(false)
    }
  }

  async function handleStaffLogin(e: React.FormEvent) {
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
      router.push("/overview")
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

  // Crew success screen
  if (crewResult) {
    const roleLabel = crewResult.employee_type === "salesman" ? "Sales" : "Crew"
    return (
      <div className="relative min-h-screen w-full overflow-hidden">
        <div className="absolute inset-0">
          <NeuralBackground color="#00ffaa" trailOpacity={0.08} particleCount={300} speed={0.8} />
        </div>
        <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
          <div className="w-full max-w-sm text-center">
            <div className="rounded-2xl border border-emerald-500/20 bg-black/60 p-8 backdrop-blur-xl">
              <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
                <svg className="h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="font-mono text-2xl font-bold tracking-tight text-emerald-400">
                Welcome back
              </h2>
              <p className="mt-2 text-lg text-neutral-200">{crewResult.name}</p>
              <span className="mt-1 inline-block rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-400">
                {roleLabel}
              </span>
              <p className="mt-4 text-sm text-neutral-500">Loading your portal...</p>
            </div>
          </div>
        </div>
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
                onClick={() => setMode("crew")}
                className="w-full rounded-xl border border-neutral-700 bg-black/60 p-5 text-left backdrop-blur-xl transition-all hover:border-emerald-500/50 hover:bg-emerald-500/5 active:scale-[0.98]"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/20">
                    <svg className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-neutral-100">Technician / Cleaner</h3>
                    <p className="text-sm text-neutral-500">View jobs, update status, checklists</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setMode("crew")}
                className="w-full rounded-xl border border-neutral-700 bg-black/60 p-5 text-left backdrop-blur-xl transition-all hover:border-emerald-500/50 hover:bg-emerald-500/5 active:scale-[0.98]"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-500/20">
                    <svg className="h-6 w-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-neutral-100">Salesman</h3>
                    <p className="text-sm text-neutral-500">Estimates, quotes, customer info</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setMode("staff")}
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
                    <p className="text-sm text-neutral-500">Full dashboard, inbox, scheduling</p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* Crew Login (Phone) */}
          {mode === "crew" && (
            <div className="relative">
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-blue-500/20 via-cyan-500/20 to-blue-500/20 opacity-75 blur-lg" />
              <div className="relative rounded-2xl border border-neutral-800 bg-black/80 p-6 backdrop-blur-xl">
                <button
                  onClick={() => { setMode("select"); setError("") }}
                  className="mb-4 flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>

                <h2 className="mb-1 text-xl font-bold text-neutral-100">Crew Sign In</h2>
                <p className="mb-6 text-sm text-neutral-500">Enter the phone number your company has on file</p>

                <form onSubmit={handleCrewLogin} className="space-y-4">
                  <div>
                    <label className="block font-mono text-xs uppercase tracking-wider text-neutral-400 mb-2">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      placeholder="(555) 123-4567"
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-900/50 px-4 py-3.5 text-lg text-neutral-100 placeholder-neutral-600 transition-all focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      autoFocus
                      required
                      inputMode="tel"
                      autoComplete="tel"
                    />
                  </div>

                  {error && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
                      <p className="text-sm text-red-400">{error}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || phone.replace(/\D/g, "").length < 10}
                    className={cn(
                      "w-full rounded-lg border border-blue-500/30 bg-blue-500/10 px-6 py-4 font-semibold uppercase tracking-wider text-blue-400 transition-all",
                      !loading && "hover:border-blue-500/50 hover:bg-blue-500/20",
                      (loading || phone.replace(/\D/g, "").length < 10) && "cursor-not-allowed opacity-50"
                    )}
                  >
                    {loading ? "Signing in..." : "Sign In"}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Staff Login (Username/Password) */}
          {mode === "staff" && (
            <div className="relative">
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-emerald-500/20 via-cyan-500/20 to-emerald-500/20 opacity-75 blur-lg" />
              <div className="relative rounded-2xl border border-neutral-800 bg-black/80 p-6 backdrop-blur-xl">
                <button
                  onClick={() => { setMode("select"); setError("") }}
                  className="mb-4 flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>

                <h2 className="mb-1 text-xl font-bold text-neutral-100">Staff Sign In</h2>
                <p className="mb-6 text-sm text-neutral-500">Dashboard access for operators and owners</p>

                <form onSubmit={handleStaffLogin} className="space-y-4">
                  <div>
                    <label className="block font-mono text-xs uppercase tracking-wider text-neutral-400 mb-2">
                      Username
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="enter_username"
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-900/50 px-4 py-3 font-mono text-neutral-100 placeholder-neutral-600 transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      autoFocus
                      required
                      autoComplete="username"
                    />
                  </div>

                  <div>
                    <label className="block font-mono text-xs uppercase tracking-wider text-neutral-400 mb-2">
                      Password
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="--------"
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-900/50 px-4 py-3 font-mono text-neutral-100 placeholder-neutral-600 transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      required
                      autoComplete="current-password"
                    />
                  </div>

                  {error && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
                      <p className="text-sm text-red-400">{error}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className={cn(
                      "w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-6 py-4 font-mono font-semibold uppercase tracking-wider text-emerald-400 transition-all",
                      !loading && "hover:border-emerald-500/50 hover:bg-emerald-500/20",
                      loading && "cursor-not-allowed opacity-50"
                    )}
                  >
                    {loading ? "Authenticating..." : "[ INITIALIZE ]"}
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
