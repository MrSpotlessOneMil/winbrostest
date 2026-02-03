"use client"

import { useState, useEffect } from "react"
import { SkipForward, SkipBack, Square } from "lucide-react"

interface Lead {
  id: number
  phone_number: string
  first_name?: string
  last_name?: string
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
  customerName: string
  scheduledTasks: ScheduledTask[]
  onSkipForward: () => void
  onSkipBack: () => void
  onStop: () => void
}

// Map internal stage numbers to display stages
const STAGES = [
  { id: "first_text", label: "First Text", stageNum: 1 },
  { id: "call_one", label: "Call One", stageNum: 2 },
  { id: "call_two", label: "Call Two", stageNum: 3 },
  { id: "second_text", label: "Second Text", stageNum: 4 },
  { id: "call_three", label: "Call Three", stageNum: 5 },
  { id: "price_sent", label: "Price Sent", stageNum: 6 },
  { id: "payment_received", label: "Payment Received", stageNum: 7 },
  { id: "job_assigned", label: "Job Assigned", stageNum: 8 },
  { id: "job_fulfilled", label: "Job Fulfilled", stageNum: 9 },
  { id: "lead_lost", label: "Lead Lost", stageNum: -1 },
]

function getStageFromLead(lead: Lead | null): number {
  if (!lead) return 0

  // Check status first for terminal states
  if (lead.status === "lost") return -1 // Lead Lost

  // Map followup_stage to our stages
  const followupStage = lead.followup_stage || 0

  // Check for later stages based on status
  if (lead.status === "completed" || lead.status === "fulfilled") return 9 // Job Fulfilled
  if (lead.status === "assigned" || lead.status === "scheduled") return 8 // Job Assigned
  if (lead.status === "booked" || lead.status === "paid") return 7 // Payment Received
  if (lead.status === "quoted" || lead.stripe_payment_link) return 6 // Price Sent

  // Otherwise use followup_stage directly (1-5 map to our first 5 stages)
  return followupStage
}

function formatTimeRemaining(targetDate: Date): string {
  const now = new Date()
  const diffMs = targetDate.getTime() - now.getTime()

  if (diffMs <= 0) return "now"

  const minutes = Math.floor(diffMs / 60000)
  const seconds = Math.floor((diffMs % 60000) / 1000)

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

export function LeadFlowProgress({
  lead,
  customerName,
  scheduledTasks,
  onSkipForward,
  onSkipBack,
  onStop,
}: LeadFlowProgressProps) {
  const [timeRemaining, setTimeRemaining] = useState<string>("")

  const currentStage = getStageFromLead(lead)

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

  // Check if timer should be shown (not on terminal states)
  const showTimer = currentStage > 0 && currentStage < 7 && timeRemaining

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-2">
      {STAGES.map((stage) => {
        const isCurrentStage = stage.stageNum === currentStage
        const isPastStage = currentStage !== -1 && stage.stageNum > 0 && stage.stageNum < currentStage
        const isLostStage = stage.id === "lead_lost"

        return (
          <div
            key={stage.id}
            className={`flex-shrink-0 rounded-lg border transition-all ${
              isCurrentStage
                ? isLostStage
                  ? "bg-red-500/20 border-red-500/50"
                  : "bg-purple-500/20 border-purple-500/50"
                : isPastStage
                ? "bg-emerald-500/10 border-emerald-500/30"
                : "bg-zinc-800/50 border-zinc-700/50"
            }`}
            style={{ minWidth: isCurrentStage ? "160px" : "90px" }}
          >
            {isCurrentStage ? (
              // Current stage - show customer card
              <div className="p-2">
                <div className="text-[10px] font-medium text-zinc-400 mb-1.5">{stage.label}</div>
                <div className="bg-zinc-900/80 rounded-md p-2 border border-zinc-700/50">
                  <div className="text-xs font-medium text-zinc-200 truncate mb-1">
                    {customerName}
                  </div>
                  {showTimer && (
                    <div className="text-[10px] text-amber-400 mb-1.5">
                      Next: {timeRemaining}
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={onSkipBack}
                      disabled={currentStage <= 1}
                      className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Go back"
                    >
                      <SkipBack className="w-3 h-3 text-zinc-400" />
                    </button>
                    <button
                      onClick={onStop}
                      className="p-1 rounded bg-zinc-800 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                      title="Stop sequence"
                    >
                      <Square className="w-3 h-3 text-zinc-400" />
                    </button>
                    <button
                      onClick={onSkipForward}
                      disabled={currentStage >= 9 || currentStage === -1}
                      className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Skip forward"
                    >
                      <SkipForward className="w-3 h-3 text-zinc-400" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              // Other stages - just show label
              <div className="p-2 h-full flex items-center justify-center">
                <div
                  className={`text-[10px] font-medium text-center ${
                    isPastStage ? "text-emerald-400/70" : "text-zinc-500"
                  }`}
                >
                  {stage.label}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
