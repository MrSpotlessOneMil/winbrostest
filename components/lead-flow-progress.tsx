"use client"

import { useState, useEffect, useRef, DragEvent } from "react"
import { GripVertical } from "lucide-react"

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
  followupPaused: boolean
  onMoveToStage?: (stageNum: number) => void
}

// Map internal stage numbers to display stages
const STAGES = [
  { id: "text_1", label: "Text 1", stageNum: 1, action: "text" },
  { id: "text_2", label: "Text 2", stageNum: 2, action: "text" },
  { id: "call_1", label: "Call 1", stageNum: 3, action: "call" },
  { id: "call_2", label: "Call 2", stageNum: 4, action: "call" },  // Double dial
  { id: "text_3", label: "Text 3", stageNum: 5, action: "text" },
  { id: "customer_response", label: "Responded", stageNum: 6, action: null },
  { id: "price_sent", label: "Price Sent", stageNum: 7, action: null },
  { id: "payment_received", label: "Payment", stageNum: 8, action: null },
  { id: "job_assigned", label: "Assigned", stageNum: 9, action: null },
  { id: "job_fulfilled", label: "Fulfilled", stageNum: 10, action: null },
  { id: "lead_lost", label: "Inactive", stageNum: -1, action: null },
]

function getStageFromLead(lead: Lead | null): number {
  if (!lead) return 0

  // Check status first for terminal states
  if (lead.status === "lost") return -1 // Lead Lost

  // Map followup_stage to our stages (default to 1 if 0 or null - lead exists but sequence not started)
  const followupStage = lead.followup_stage || 1

  // Check for later stages based on status
  if (lead.status === "completed" || lead.status === "fulfilled") return 10 // Job Fulfilled
  if (lead.status === "assigned" || lead.status === "scheduled") return 9 // Job Assigned
  if (lead.status === "booked" || lead.status === "paid") return 8 // Payment Received
  if (lead.status === "quoted" || lead.stripe_payment_link) return 7 // Price Sent
  if (lead.status === "responded" || lead.status === "engaged") return 6 // Customer Response

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
  followupPaused,
  onMoveToStage,
}: LeadFlowProgressProps) {
  const [timeRemaining, setTimeRemaining] = useState<string>("")
  const [dragOverStage, setDragOverStage] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [optimisticStage, setOptimisticStage] = useState<number | null>(null)
  const [isMoving, setIsMoving] = useState(false)
  const prevLeadStageRef = useRef<number | null>(null)

  const actualStage = getStageFromLead(lead)

  // Use optimistic stage if set, otherwise use actual stage
  const currentStage = optimisticStage !== null ? optimisticStage : actualStage

  // Clear optimistic state when actual stage catches up
  useEffect(() => {
    if (prevLeadStageRef.current !== actualStage) {
      // Stage has changed from prop update, clear optimistic state
      setOptimisticStage(null)
      setIsMoving(false)
    }
    prevLeadStageRef.current = actualStage
  }, [actualStage])

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

  // Check if timer should be shown - show whenever there's a pending task for this lead
  // This covers stages 1-5 and also when manually moved to a stage
  const showTimer = Boolean(nextTask && timeRemaining)

  // Drag handlers
  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    if (!lead) return
    e.dataTransfer.setData("text/plain", String(lead.id))
    e.dataTransfer.effectAllowed = "move"
    setIsDragging(true)
  }

  const handleDragEnd = () => {
    setIsDragging(false)
    setDragOverStage(null)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>, stageNum: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    if (stageNum !== currentStage) {
      setDragOverStage(stageNum)
    }
  }

  const handleDragLeave = () => {
    setDragOverStage(null)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>, stageNum: number) => {
    e.preventDefault()
    setDragOverStage(null)
    setIsDragging(false)

    if (stageNum !== currentStage && onMoveToStage) {
      // Optimistically update the UI immediately
      setOptimisticStage(stageNum)
      setIsMoving(true)
      // Then trigger the actual API call
      onMoveToStage(stageNum)
    }
  }

  // If no lead exists for this customer, show a minimal state
  if (!lead) {
    return (
      <div className="flex gap-1.5 overflow-x-auto pb-2">
        <div className="flex-shrink-0 rounded-lg border bg-zinc-800/30 border-zinc-700/30 p-2">
          <div className="text-[10px] font-medium text-zinc-500 text-center">
            No active lead
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-2">
      {STAGES.map((stage) => {
        const isCurrentStage = stage.stageNum === currentStage
        const isPastStage = currentStage !== -1 && stage.stageNum > 0 && stage.stageNum < currentStage
        const isLostStage = stage.id === "lead_lost"
        const isDragOver = dragOverStage === stage.stageNum

        return (
          <div
            key={stage.id}
            className={`flex-shrink-0 rounded-lg border transition-all ${
              isDragOver
                ? "bg-blue-500/30 border-blue-500 ring-2 ring-blue-500/50"
                : isCurrentStage
                ? isLostStage
                  ? "bg-red-500/20 border-red-500/50"
                  : "bg-purple-500/20 border-purple-500/50"
                : isPastStage
                ? "bg-emerald-500/10 border-emerald-500/30"
                : "bg-zinc-800/50 border-zinc-700/50"
            } ${!isCurrentStage && isDragging ? "cursor-pointer" : ""}`}
            style={{ minWidth: isCurrentStage ? "160px" : "90px" }}
            onDragOver={(e) => !isCurrentStage && handleDragOver(e, stage.stageNum)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => !isCurrentStage && handleDrop(e, stage.stageNum)}
          >
            {isCurrentStage ? (
              // Current stage - show customer card (draggable)
              <div className="p-2">
                <div className="text-[10px] font-medium text-zinc-400 mb-1.5">{stage.label}</div>
                <div
                  draggable={!isMoving}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  className={`bg-zinc-900/80 rounded-md p-2 border border-zinc-700/50 transition-all duration-200 ${
                    isMoving
                      ? "opacity-70 cursor-wait"
                      : isDragging
                        ? "opacity-50 cursor-grabbing"
                        : "cursor-grab"
                  }`}
                >
                  <div className="flex items-center gap-1 mb-1">
                    <GripVertical className="w-3 h-3 text-zinc-600" />
                    <div className="text-xs font-medium text-zinc-200 truncate flex-1">
                      {customerName}
                    </div>
                  </div>
                  {followupPaused ? (
                    <div className="text-[10px] text-yellow-500 ml-4">
                      ⏸ Paused
                    </div>
                  ) : isMoving ? (
                    <div className="text-[10px] text-blue-400 ml-4 animate-pulse">
                      Scheduling...
                    </div>
                  ) : showTimer ? (
                    <div className="text-[10px] text-amber-400 ml-4">
                      {timeRemaining === "now" ? "⏳ Sending..." : `Next: ${timeRemaining}`}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              // Other stages - drop target
              <div className="p-2 h-full flex items-center justify-center min-h-[60px]">
                <div
                  className={`text-[10px] font-medium text-center ${
                    isDragOver
                      ? "text-blue-300"
                      : isPastStage
                      ? "text-emerald-400/70"
                      : "text-zinc-500"
                  }`}
                >
                  {isDragOver ? `Drop to ${stage.label}` : stage.label}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
