'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'

export default function TipSuccessPage() {
  const params = useParams()
  const jobId = params.jobId as string

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-950 to-neutral-900 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full text-center">
        {/* Success Icon */}
        <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20 mb-6">
          <svg className="h-10 w-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        {/* Message */}
        <h1 className="text-3xl font-bold text-white mb-4">
          Thank You!
        </h1>
        <p className="text-lg text-neutral-400 mb-2">
          Your tip has been sent successfully.
        </p>
        <p className="text-emerald-400 mb-8">
          Your cleaner will receive 100% of your generous tip.
        </p>

        {/* Heart Animation */}
        <div className="flex justify-center gap-2 mb-8">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-bounce text-2xl"
              style={{ animationDelay: `${i * 0.15}s` }}
            >
              <span className="text-red-400">&#10084;</span>
            </div>
          ))}
        </div>

        {/* Back Link */}
        <p className="text-sm text-neutral-600">
          You can safely close this window.
        </p>
      </div>
    </div>
  )
}
