"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Phone, PhoneOutgoing, CheckCircle2, Circle, Loader2, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

type CallTask = {
  id: string
  phone_number: string
  customer_name: string | null
  source: string
  source_context: { briefing?: string } | null
  scheduled_for: string
  created_at: string
}

const sourceLabels: Record<string, string> = {
  lead_followup: "Lead follow-up",
  quoted_not_booked: "Quote follow-up",
  retargeting_unresponsive: "Unresponsive reactivation",
  retargeting_one_time: "Win-back",
  retargeting_lapsed: "Lapsed re-engagement",
  retargeting_quoted_not_booked: "Quote follow-up",
}

export function CallChecklist() {
  const [tasks, setTasks] = useState<CallTask[] | null>(null)
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch("/api/call-tasks", { cache: "no-store" })
        const json = await res.json()
        if (!cancelled) setTasks(json.data || [])
      } catch {
        if (!cancelled) setTasks([])
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const handleComplete = useCallback(async (taskId: string) => {
    setCompletingId(taskId)
    try {
      const res = await fetch("/api/actions/complete-call-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      })
      if (res.ok) {
        setCompletedIds((prev) => new Set(prev).add(taskId))
      }
    } catch {
      // silently fail — task stays unchecked
    } finally {
      setCompletingId(null)
    }
  }, [])

  const visibleTasks = tasks?.filter((t) => true) || [] // show all including completed (they vanish on reload)
  const pendingCount = visibleTasks.filter((t) => !completedIds.has(t.id)).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-violet-400" />
          Call Checklist
        </CardTitle>
        <CardDescription>
          {tasks === null
            ? "Loading..."
            : pendingCount === 0
              ? "No calls today"
              : `${pendingCount} call${pendingCount === 1 ? "" : "s"} to make today`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tasks === null ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
              <Phone className="h-6 w-6 text-success" />
            </div>
            <p className="mt-3 font-medium text-foreground">All clear!</p>
            <p className="text-sm text-muted-foreground">No calls scheduled for today</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleTasks.map((task) => {
              const isCompleted = completedIds.has(task.id)
              const isCompleting = completingId === task.id

              const hasBriefing = !!task.source_context?.briefing
              const isExpanded = expandedId === task.id

              return (
                <div
                  key={task.id}
                  className={cn(
                    "rounded-lg border transition-colors",
                    isCompleted
                      ? "border-success/20 bg-success/5 opacity-60"
                      : "border-border hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-center gap-3 p-3">
                    {/* Check circle button */}
                    <button
                      onClick={() => !isCompleted && !isCompleting && handleComplete(task.id)}
                      disabled={isCompleted || isCompleting}
                      className="shrink-0 transition-colors"
                      aria-label={isCompleted ? "Completed" : "Mark as completed"}
                    >
                      {isCompleting ? (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      ) : isCompleted ? (
                        <CheckCircle2 className="h-5 w-5 text-success" />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground hover:text-violet-400 cursor-pointer" />
                      )}
                    </button>

                    {/* Task content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-sm font-medium",
                          isCompleted ? "line-through text-muted-foreground" : "text-foreground"
                        )}>
                          Call{" "}
                          <a
                            href={`tel:${task.phone_number}`}
                            className={cn(
                              "font-mono transition-colors inline-flex items-center gap-1",
                              isCompleted
                                ? "text-muted-foreground pointer-events-none"
                                : "text-violet-300 hover:text-violet-200"
                            )}
                          >
                            {task.phone_number}
                            <PhoneOutgoing className="h-3.5 w-3.5" />
                          </a>
                        </span>
                      </div>
                      {task.customer_name && (
                        <p className="text-xs text-muted-foreground truncate">
                          {task.customer_name}
                          {task.source && ` · ${sourceLabels[task.source] || task.source}`}
                        </p>
                      )}
                    </div>

                    {/* Briefing toggle */}
                    {hasBriefing && !isCompleted && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : task.id)}
                        className="shrink-0 text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 transition-colors"
                      >
                        {isExpanded ? "Hide" : "Briefing"}
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>

                  {/* Expanded briefing */}
                  {isExpanded && hasBriefing && (
                    <div className="border-t border-border px-3 py-3 bg-muted/30">
                      <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">
                        {task.source_context!.briefing}
                      </pre>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
