'use client'

/**
 * Visit Flow Bar — Top Action Bar for WinBros Visit Execution
 *
 * Sequential steps: On My Way → Start Visit → Stop Visit → Completed →
 *                   Checklist → Collect Payment → Close Job
 *
 * Each button only active when previous step is done.
 * Shows running timer between Start/Stop.
 */

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Navigation, Play, Square, CheckCircle2, ClipboardCheck,
  CreditCard, Lock, Clock
} from 'lucide-react'

type VisitStatus =
  | 'not_started' | 'on_my_way' | 'in_progress' | 'stopped'
  | 'completed' | 'checklist_done' | 'payment_collected' | 'closed'

interface VisitFlowBarProps {
  visitId: number
  status: VisitStatus
  startedAt: string | null
  stoppedAt: string | null
  checklistComplete: boolean
  paymentRecorded: boolean
  onTransition: (targetStatus: VisitStatus) => Promise<void>
  onCollectPayment: () => void
}

const STEPS: Array<{
  status: VisitStatus
  label: string
  icon: React.ElementType
  activeColor: string
}> = [
  { status: 'on_my_way', label: 'On My Way', icon: Navigation, activeColor: 'bg-blue-600 hover:bg-blue-700' },
  { status: 'in_progress', label: 'Start Visit', icon: Play, activeColor: 'bg-green-600 hover:bg-green-700' },
  { status: 'stopped', label: 'Stop Visit', icon: Square, activeColor: 'bg-orange-600 hover:bg-orange-700' },
  { status: 'completed', label: 'Completed', icon: CheckCircle2, activeColor: 'bg-emerald-600 hover:bg-emerald-700' },
  { status: 'checklist_done', label: 'Checklist', icon: ClipboardCheck, activeColor: 'bg-purple-600 hover:bg-purple-700' },
  { status: 'payment_collected', label: 'Payment', icon: CreditCard, activeColor: 'bg-indigo-600 hover:bg-indigo-700' },
  { status: 'closed', label: 'Close Job', icon: Lock, activeColor: 'bg-red-600 hover:bg-red-700' },
]

const STATUS_ORDER: VisitStatus[] = [
  'not_started', 'on_my_way', 'in_progress', 'stopped',
  'completed', 'checklist_done', 'payment_collected', 'closed',
]

function getStatusIndex(status: VisitStatus): number {
  return STATUS_ORDER.indexOf(status)
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export function VisitFlowBar({
  visitId,
  status,
  startedAt,
  stoppedAt,
  checklistComplete,
  paymentRecorded,
  onTransition,
  onCollectPayment,
}: VisitFlowBarProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  // Running timer
  useEffect(() => {
    if (status === 'in_progress' && startedAt) {
      const start = new Date(startedAt).getTime()
      const interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - start) / 1000))
      }, 1000)
      return () => clearInterval(interval)
    }
    if (stoppedAt && startedAt) {
      setElapsed(
        Math.floor((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1000)
      )
    }
  }, [status, startedAt, stoppedAt])

  const handleStep = useCallback(async (targetStatus: VisitStatus) => {
    if (targetStatus === 'payment_collected') {
      onCollectPayment()
      return
    }
    setLoading(targetStatus)
    try {
      await onTransition(targetStatus)
    } finally {
      setLoading(null)
    }
  }, [onTransition, onCollectPayment])

  const currentIndex = getStatusIndex(status)

  return (
    <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950">
      {/* Timer display */}
      {(status === 'in_progress' || (startedAt && stoppedAt)) && (
        <div className="flex items-center justify-center gap-2 mb-4 py-2 bg-zinc-900 rounded">
          <Clock className="w-4 h-4 text-zinc-400" />
          <span className={`text-xl font-mono font-bold ${status === 'in_progress' ? 'text-green-400' : 'text-zinc-300'}`}>
            {formatDuration(elapsed)}
          </span>
          {status === 'in_progress' && (
            <span className="text-xs text-green-500 animate-pulse">ACTIVE</span>
          )}
        </div>
      )}

      {/* Step buttons */}
      <div className="flex flex-wrap gap-2">
        {STEPS.map((step, index) => {
          const stepIndex = getStatusIndex(step.status)
          const isDone = currentIndex >= stepIndex
          const isNext = currentIndex === stepIndex - 1
          const isDisabled = !isNext || loading !== null

          // Special: checklist requires completion
          const checklistBlocked = step.status === 'checklist_done' && !checklistComplete && isNext
          // Special: close requires both checklist + payment
          const closeBlocked = step.status === 'closed' && (!checklistComplete || !paymentRecorded) && isNext

          return (
            <Button
              key={step.status}
              variant={isDone ? 'default' : 'outline'}
              size="sm"
              disabled={isDisabled || checklistBlocked || closeBlocked}
              onClick={() => handleStep(step.status)}
              className={`
                flex items-center gap-1.5 text-xs font-medium cursor-pointer
                ${isDone ? 'bg-zinc-700 text-white border-zinc-600' : ''}
                ${isNext && !checklistBlocked && !closeBlocked ? step.activeColor + ' text-white border-transparent' : ''}
                ${(checklistBlocked || closeBlocked) ? 'opacity-50' : ''}
              `}
            >
              {loading === step.status ? (
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <step.icon className="w-3 h-3" />
              )}
              {step.label}
              {isDone && <CheckCircle2 className="w-3 h-3 text-green-400" />}
            </Button>
          )
        })}
      </div>

      {/* Status hint */}
      {status === 'completed' && !checklistComplete && (
        <p className="text-xs text-amber-400 mt-2">Complete the checklist before proceeding</p>
      )}
      {status === 'checklist_done' && !paymentRecorded && (
        <p className="text-xs text-amber-400 mt-2">Collect payment before closing the job</p>
      )}
      {status === 'closed' && (
        <p className="text-xs text-green-400 mt-2">Job closed — receipt, review request, and thank you sent</p>
      )}
    </div>
  )
}
