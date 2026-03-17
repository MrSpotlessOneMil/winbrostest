'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import NeuralBackground from '@/components/neural-background'
import { DotLoader } from '@/components/dot-loader'
import { cn } from '@/lib/utils'

// Loading animation frames for the dot loader
const LOADING_FRAMES = [
  [0, 1, 2],
  [1, 2, 3],
  [2, 3, 4],
  [3, 4, 5],
  [4, 5, 6],
  [5, 6, 13],
  [6, 13, 20],
  [13, 20, 27],
  [20, 27, 34],
  [27, 34, 41],
  [34, 41, 48],
  [41, 48, 47],
  [48, 47, 46],
  [47, 46, 45],
  [46, 45, 44],
  [45, 44, 43],
  [44, 43, 42],
  [43, 42, 35],
  [42, 35, 28],
  [35, 28, 21],
  [28, 21, 14],
  [21, 14, 7],
  [14, 7, 0],
  [7, 0, 1],
]

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isLoading) return

    setError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        setError(data.error || 'Invalid credentials. Try again.')
        setIsLoading(false)
        return
      }

      // Show success state
      setSuccess(true)
      setIsLoading(false)

      // Redirect after brief delay to show success
      setTimeout(() => {
        router.push(redirect)
        router.refresh()
      }, 1000)
    } catch (err) {
      setError('Connection error. Please try again.')
      setIsLoading(false)
    }
  }

  if (success) {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-emerald-500/20 bg-black/60 p-8 backdrop-blur-xl">
          <div className="text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
              <svg
                className="h-8 w-8 text-emerald-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="font-mono text-2xl font-bold tracking-tight text-emerald-400">
              ACCESS GRANTED
            </h2>
            <p className="mt-2 font-mono text-sm text-neutral-400">
              Welcome back, {username}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md">
      {/* Glowing border effect */}
      <div className="relative">
        <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-emerald-500/20 via-cyan-500/20 to-emerald-500/20 opacity-75 blur-lg" />

        <div className="relative rounded-2xl border border-neutral-800 bg-black/80 p-8 backdrop-blur-xl">
          {/* Header */}
          <div className="mb-8 text-center">
            <h1 className="font-mono text-3xl font-bold tracking-tighter text-neutral-100">
              <span className="text-emerald-400">{">"}</span>
              _CLEAN MACHINE
              <span className="animate-pulse text-emerald-400">_</span>
            </h1>
            <p className="mt-2 font-mono text-xs uppercase tracking-widest text-neutral-500">
              SECURE DASHBOARD ACCESS
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Username Field */}
            <div className="space-y-2">
              <label
                htmlFor="username"
                className="block font-mono text-xs uppercase tracking-wider text-neutral-400"
              >
                <span className="text-emerald-400">//</span> Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900/50 px-4 py-3 font-mono text-neutral-100 placeholder-neutral-600 transition-all duration-200 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                placeholder="enter_username"
                disabled={isLoading}
                required
                autoComplete="username"
                autoFocus
              />
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <label
                htmlFor="password"
                className="block font-mono text-xs uppercase tracking-wider text-neutral-400"
              >
                <span className="text-emerald-400">//</span> Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900/50 px-4 py-3 font-mono text-neutral-100 placeholder-neutral-600 transition-all duration-200 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                placeholder="••••••••"
                disabled={isLoading}
                required
                autoComplete="current-password"
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
                <p className="font-mono text-sm text-red-400">
                  <span className="text-red-500">[ERROR]</span> {error}
                </p>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className={cn(
                "relative w-full overflow-hidden rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-6 py-4 font-mono text-sm font-semibold uppercase tracking-widest text-emerald-400 transition-all duration-300",
                !isLoading && "hover:border-emerald-500/50 hover:bg-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/20",
                isLoading && "cursor-not-allowed opacity-80"
              )}
            >
              {isLoading ? (
                <div className="flex items-center justify-center gap-3">
                  <DotLoader
                    frames={LOADING_FRAMES}
                    duration={50}
                    dotClassName="bg-neutral-700 [&.active]:bg-emerald-400 transition-colors duration-100"
                    className="scale-75"
                  />
                  <span className="text-neutral-400">AUTHENTICATING...</span>
                </div>
              ) : (
                <>
                  <span className="relative z-10">{"[  INITIALIZE  ]"}</span>
                  {/* Hover glow effect */}
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-emerald-500/10 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Help text */}
      <p className="mt-6 text-center font-mono text-xs text-neutral-500">
        Don&apos;t have a login yet? Text &quot;system&quot; to{' '}
        <a
          href="sms:14157204580"
          className="text-emerald-400 underline underline-offset-2 transition-colors hover:text-emerald-300"
        >
          (415) 720-4580
        </a>
      </p>
    </div>
  )
}

function LoginFormFallback() {
  return (
    <div className="w-full max-w-md">
      <div className="relative">
        <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-emerald-500/20 via-cyan-500/20 to-emerald-500/20 opacity-75 blur-lg" />
        <div className="relative rounded-2xl border border-neutral-800 bg-black/80 p-8 backdrop-blur-xl">
          <div className="mb-8 text-center">
            <h1 className="font-mono text-3xl font-bold tracking-tighter text-neutral-100">
              <span className="text-emerald-400">{">"}</span>
              _CLEAN MACHINE
              <span className="animate-pulse text-emerald-400">_</span>
            </h1>
            <p className="mt-2 font-mono text-xs uppercase tracking-widest text-neutral-500">
              LOADING...
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      {/* Neural Background */}
      <div className="absolute inset-0">
        <NeuralBackground
          color="#00ffaa"
          trailOpacity={0.08}
          particleCount={500}
          speed={0.8}
        />
      </div>

      {/* Login Form Container */}
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
        <Suspense fallback={<LoginFormFallback />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
