"use client"

import { useState, useEffect } from "react"
import { ChevronRight, Phone, MessageSquare, Check, X, Clock, DollarSign, Star, SkipForward } from "lucide-react"

interface Lead {
  id: number
  phone_number: string
  status: string
  followup_stage: number
  followup_started_at?: string
  stripe_payment_link?: string
  created_at: string
}

interface ScheduledTask {
  id: string
  task_type: string
  task_key: string
  scheduled_for: string
  status: string
  payload: {
    stage: number
    action: string
    leadId: string
  }
}

interface LeadFlowProgressProps {
  lead: Lead | null
  scheduledTasks: ScheduledTask[]
  onSkipToStage: (stage: number) => void
  onMarkStatus: (status: "booked" | "lost" | "review_sent") => void
}

const STAGES = [
  { stage: 1, label: "Text 1", icon: MessageSquare, action: "text" },
  { stage: 2, label: "Call 1", icon: Phone, action: "call" },
  { stage: 3, label: "Call 2", icon: Phone, action: "double_call" },
  { stage: 4, label: "Text 2", icon: MessageSquare, action: "text" },
  { stage: 5, label: "Call 3", icon: Phone, action: "call" },
]

function formatTimeRemaining(targetDate: Date): string {
  const now = new Date()
  const diffMs = targetDate.getTime() - now.getTime()

  if (diffMs <= 0) return "Due now"

  const minutes = Math.floor(diffMs / 60000)
  const seconds = Math.floor((diffMs % 60000) / 1000)

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

export function LeadFlowProgress({
  lead,
  scheduledTasks,
  onSkipToStage,
  onMarkStatus,
}: LeadFlowProgressProps) {
  const [timeRemaining, setTimeRemaining] = useState<string>("")

  // Find the next pending task for this lead
  const nextTask = scheduledTasks
    .filter(
      (t) =>
        t.status === "pending" &&
        t.task_type === "lead_followup" &&
        t.payload?.leadId === String(lead?.id)
    )
    .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime())[0]

  // Update timer every second
  useEffect(() => {
    if (!nextTask) {
      setTimeRemaining("")
      return
    }

    const updateTimer = () => {
      const scheduledFor = new Date(nextTask.scheduled_for)
      setTimeRemaining(formatTimeRemaining(scheduledFor))
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [nextTask])

  if (!lead) {
    return (
      <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-4">
        <div className="text-sm text-zinc-500 text-center">No active lead for this customer</div>
      </div>
    )
  }

  const currentStage = lead.followup_stage || 0
  const isCompleted = lead.status === "booked" || lead.status === "lost" || lead.status === "review_sent"

  return (
    <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-300">Lead Follow-up Progress</h3>
        {nextTask && timeRemaining && (
          <div className="flex items-center gap-1.5 text-xs text-amber-400">
            <Clock className="w-3.5 h-3.5" />
            <span>Next: {timeRemaining}</span>
          </div>
        )}
      </div>

      {/* Stage Progress */}
      <div className="flex items-center gap-1 mb-4">
        {STAGES.map((stage, idx) => {
          const Icon = stage.icon
          const isActive = currentStage === stage.stage
          const isCompleted = currentStage > stage.stage
          const isPending = currentStage < stage.stage

          return (
            <div key={stage.stage} className="flex items-center">
              {/* Stage Box */}
              <div
                className={`flex flex-col items-center justify-center w-14 h-14 rounded-lg border transition-all ${
                  isCompleted
                    ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                    : isActive
                    ? "bg-purple-500/20 border-purple-500/50 text-purple-400 ring-2 ring-purple-500/30"
                    : "bg-zinc-800/50 border-zinc-700/50 text-zinc-500"
                }`}
              >
                <Icon className="w-4 h-4 mb-0.5" />
                <span className="text-[10px] font-medium">{stage.label}</span>
              </div>

              {/* Arrow to next stage */}
              {idx < STAGES.length - 1 && (
                <button
                  onClick={() => onSkipToStage(stage.stage + 1)}
                  disabled={currentStage >= stage.stage + 1 || isCompleted}
                  className={`mx-0.5 p-1 rounded transition-colors ${
                    currentStage >= stage.stage + 1 || isCompleted
                      ? "text-zinc-700 cursor-not-allowed"
                      : "text-zinc-500 hover:text-purple-400 hover:bg-purple-500/10"
                  }`}
                  title={`Skip to ${STAGES[idx + 1].label}`}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          )
        })}

        {/* Final skip arrow */}
        <button
          onClick={() => onSkipToStage(6)}
          disabled={currentStage >= 6 || isCompleted}
          className={`mx-0.5 p-1 rounded transition-colors ${
            currentStage >= 6 || isCompleted
              ? "text-zinc-700 cursor-not-allowed"
              : "text-zinc-500 hover:text-purple-400 hover:bg-purple-500/10"
          }`}
          title="Skip to end"
        >
          <SkipForward className="w-4 h-4" />
        </button>
      </div>

      {/* Status Actions */}
      <div className="flex items-center gap-2 pt-3 border-t border-zinc-800">
        <span className="text-xs text-zinc-500 mr-2">Mark as:</span>

        <button
          onClick={() => onMarkStatus("booked")}
          disabled={lead.status === "booked"}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            lead.status === "booked"
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50"
              : "bg-zinc-800 text-zinc-400 hover:bg-emerald-500/10 hover:text-emerald-400 border border-zinc-700"
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" />
          Payment Received
        </button>

        <button
          onClick={() => onMarkStatus("review_sent")}
          disabled={lead.status === "review_sent"}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            lead.status === "review_sent"
              ? "bg-blue-500/20 text-blue-400 border border-blue-500/50"
              : "bg-zinc-800 text-zinc-400 hover:bg-blue-500/10 hover:text-blue-400 border border-zinc-700"
          }`}
        >
          <Star className="w-3.5 h-3.5" />
          Review Sent
        </button>

        <button
          onClick={() => onMarkStatus("lost")}
          disabled={lead.status === "lost"}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            lead.status === "lost"
              ? "bg-red-500/20 text-red-400 border border-red-500/50"
              : "bg-zinc-800 text-zinc-400 hover:bg-red-500/10 hover:text-red-400 border border-zinc-700"
          }`}
        >
          <X className="w-3.5 h-3.5" />
          Lead Lost
        </button>
      </div>

      {/* Current Status Display */}
      {isCompleted && (
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
              lead.status === "booked"
                ? "bg-emerald-500/20 text-emerald-400"
                : lead.status === "review_sent"
                ? "bg-blue-500/20 text-blue-400"
                : "bg-red-500/20 text-red-400"
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            {lead.status === "booked"
              ? "Booked & Paid"
              : lead.status === "review_sent"
              ? "Review Request Sent"
              : "Lead Lost"}
          </div>
        </div>
      )}
    </div>
  )
}
