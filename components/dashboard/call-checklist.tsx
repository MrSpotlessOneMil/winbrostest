"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Phone, CheckCircle2, Circle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

type CallTask = {
  id: string
  phone_number: string
  customer_name: string | null
  source: string
  scheduled_for: string
  created_at: string
}

const sourceLabels: Record<string, string> = {
  lead_followup: "Lead follow-up",
  quoted_not_booked: "Quote follow-up",
}

export function CallChecklist() {
  const [tasks, setTasks] = useState<CallTask[] | null>(null)
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

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

  const handleCopy = useCallback(async (taskId: string, phone: string) => {
    try {
      await navigator.clipboard.writeText(phone)
      setCopiedId(taskId)
      setTimeout(() => setCopiedId((prev) => (prev === taskId ? null : prev)), 2000)
    } catch {
      // clipboard not available
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
              const isCopied = copiedId === task.id

              return (
                <div
                  key={task.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                    isCompleted
                      ? "border-success/20 bg-success/5 opacity-60"
                      : "border-border hover:bg-muted/50"
                  )}
                >
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
                        <button
                          onClick={() => handleCopy(task.id, task.phone_number)}
                          className={cn(
                            "font-mono transition-colors",
                            isCompleted
                              ? "text-muted-foreground cursor-default"
                              : "text-violet-300 hover:text-violet-200 cursor-pointer"
                          )}
                          disabled={isCompleted}
                        >
                          {isCopied ? (
                            <span className="text-success font-sans">Copied</span>
                          ) : (
                            task.phone_number
                          )}
                        </button>
                      </span>
                    </div>
                    {task.customer_name && (
                      <p className="text-xs text-muted-foreground truncate">
                        {task.customer_name}
                        {task.source && ` · ${sourceLabels[task.source] || task.source}`}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
