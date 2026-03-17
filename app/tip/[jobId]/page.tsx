'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface JobInfo {
  cleanerName: string
  serviceType: string
  date: string
  businessName: string
}

const TIP_AMOUNTS = [5, 10, 15, 20, 25]

export default function TipPage() {
  const params = useParams()
  const jobId = params.jobId as string

  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchJobInfo() {
      try {
        const response = await fetch(`/api/tip/job-info?jobId=${jobId}`)
        const data = await response.json()

        if (data.success && data.data) {
          setJobInfo(data.data)
        } else {
          setError(data.error || 'Job not found')
        }
      } catch {
        setError('Failed to load job information')
      } finally {
        setLoading(false)
      }
    }

    if (jobId) {
      fetchJobInfo()
    }
  }, [jobId])

  const getTipAmount = (): number => {
    if (selectedAmount !== null) {
      return selectedAmount
    }
    const custom = parseFloat(customAmount)
    return isNaN(custom) ? 0 : custom
  }

  const handleSubmit = async () => {
    const amount = getTipAmount()
    if (amount <= 0) {
      setError('Please select or enter a tip amount')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const response = await fetch('/api/tip/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, amount }),
      })

      const data = await response.json()

      if (data.success && data.url) {
        // Redirect to Stripe checkout
        window.location.href = data.url
      } else {
        setError(data.error || 'Failed to create tip payment')
        setSubmitting(false)
      }
    } catch {
      setError('Failed to process tip. Please try again.')
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-neutral-950 to-neutral-900 flex items-center justify-center">
        <div className="text-neutral-400 text-lg">Loading...</div>
      </div>
    )
  }

  if (!jobInfo) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-neutral-950 to-neutral-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="text-red-400 text-xl mb-2">Job Not Found</div>
          <p className="text-neutral-500">{error || 'This tip link may have expired or is invalid.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 py-12">
      {/* Background image with overlay */}
      <div className="absolute inset-0 z-0">
        <img src="/winbros-team.jpg" alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />
      </div>
      <div className="max-w-md w-full relative z-10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 mb-4">
            <svg className="h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            Tip {jobInfo.cleanerName}
          </h1>
          <p className="text-neutral-400">
            {jobInfo.serviceType} on {new Date(jobInfo.date).toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric'
            })}
          </p>
          <p className="text-sm text-emerald-400 mt-2">
            100% of your tip goes directly to your cleaner
          </p>
        </div>

        {/* Tip Card */}
        <div className="rounded-2xl border border-neutral-800 bg-black/60 p-6 backdrop-blur-xl">
          {/* Preset Amounts */}
          <div className="grid grid-cols-5 gap-2 mb-6">
            {TIP_AMOUNTS.map((amount) => (
              <button
                key={amount}
                onClick={() => {
                  setSelectedAmount(amount)
                  setCustomAmount('')
                }}
                className={`py-3 rounded-lg font-semibold transition-all ${
                  selectedAmount === amount
                    ? 'bg-emerald-500 text-white'
                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                ${amount}
              </button>
            ))}
          </div>

          {/* Custom Amount */}
          <div className="mb-6">
            <label className="block text-sm text-neutral-400 mb-2">
              Or enter a custom amount
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500">$</span>
              <input
                type="number"
                min="1"
                step="1"
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value)
                  setSelectedAmount(null)
                }}
                placeholder="0"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900/50 px-4 py-3 pl-8 text-white placeholder-neutral-600 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={submitting || getTipAmount() <= 0}
            className={`w-full py-4 rounded-lg font-semibold text-lg transition-all ${
              submitting || getTipAmount() <= 0
                ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                : 'bg-emerald-500 text-white hover:bg-emerald-600'
            }`}
          >
            {submitting ? (
              'Processing...'
            ) : getTipAmount() > 0 ? (
              `Tip $${getTipAmount().toFixed(2)}`
            ) : (
              'Select an amount'
            )}
          </button>

          {/* Security Note */}
          <p className="text-center text-xs text-neutral-500 mt-4">
            Secure payment powered by Stripe
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-neutral-600 mt-6">
          {jobInfo.businessName}
        </p>
      </div>
    </div>
  )
}
