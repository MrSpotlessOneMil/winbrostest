"use client"

import { useEffect, useMemo, useState, useCallback, type DragEvent } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, Play, StopCircle, MoreVertical, X, Ban } from "lucide-react"
import CubeLoader from "@/components/ui/cube-loader"
import { useRetargeting } from "../use-retargeting"
import {
  PIPELINE_STAGES,
  SEQUENCE_PREVIEWS,
  getCustomerStatus,
  timeAgo,
  type StageKey,
  type PipelineCustomer,
} from "../constants"

export default function RetargetingV3() {
  const {
    pipeline,
    pipelineLoading,
    customers,
    customersLoading,
    fetchPipeline,
    fetchStageCustomers,
    enrollSegment,
    cancelRetargeting,
    markAsLost,
    enrolling,
    cancelling,
    error,
    clearError,
  } = useRetargeting()

  const [dragOver, setDragOver] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ id: number; stage: StageKey; x: number; y: number } | null>(null)

  // Fetch all stage customers on load
  useEffect(() => {
    if (!pipelineLoading) {
      PIPELINE_STAGES.forEach(s => {
        if (pipeline[s.key]) fetchStageCustomers(s.key)
      })
    }
  }, [pipelineLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    window.addEventListener("click", handler)
    return () => window.removeEventListener("click", handler)
  }, [contextMenu])

  // Column data
  const columns = useMemo(() => {
    return PIPELINE_STAGES.map(s => {
      const list = customers[s.key] || []
      const eligible = list.filter(c => getCustomerStatus(c) === "eligible").length
      const active = list.filter(c => getCustomerStatus(c) === "active").length
      const converted = list.filter(c => getCustomerStatus(c) === "converted").length
      return { ...s, customers: list, eligible, active, converted }
    })
  }, [customers])

  // Drag handlers
  const handleDragStart = useCallback((e: DragEvent, customerId: number, fromStage: StageKey) => {
    e.dataTransfer.setData("text/plain", JSON.stringify({ customerId, fromStage }))
    e.dataTransfer.effectAllowed = "move"
  }, [])

  const handleDragOver = useCallback((e: DragEvent, stage: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDragOver(stage)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(null)
  }, [])

  const handleDrop = useCallback(async (e: DragEvent, toStage: StageKey) => {
    e.preventDefault()
    setDragOver(null)
    try {
      const data = JSON.parse(e.dataTransfer.getData("text/plain"))
      const { customerId, fromStage } = data as { customerId: number; fromStage: StageKey }
      if (fromStage === toStage) return

      // Override lifecycle stage via PATCH
      const res = await fetch("/api/actions/retargeting-pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_ids: [customerId], override: toStage }),
      })
      const json = await res.json()
      if (json.success) {
        // Refresh both columns
        await Promise.all([fetchStageCustomers(fromStage), fetchStageCustomers(toStage)])
        await fetchPipeline()
      }
    } catch { /* ignore bad drag data */ }
  }, [fetchStageCustomers, fetchPipeline])

  async function handleStartAll(segment: StageKey) {
    await enrollSegment(segment)
  }

  async function handleCancel(customerId: number, stage: StageKey) {
    const ok = await cancelRetargeting([customerId])
    if (ok) fetchStageCustomers(stage)
  }

  async function handleMarkLost(customerId: number, stage: StageKey) {
    const ok = await markAsLost([customerId])
    if (ok) {
      fetchStageCustomers(stage)
      fetchStageCustomers("lost")
    }
  }

  async function handleStart(customerId: number, stage: StageKey) {
    await enrollSegment(stage, [customerId])
  }

  if (pipelineLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <CubeLoader />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Retargeting</h1>
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-1 rounded-md flex items-center gap-2 text-sm">
            {error}
            <button onClick={clearError}><X className="h-3 w-3" /></button>
          </div>
        )}
      </div>

      {/* Kanban board */}
      <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory md:snap-none">
        {columns.map(col => {
          const isLoading = customersLoading[col.key]
          const headerColors: Record<string, string> = {
            unresponsive: "border-t-red-500",
            quoted_not_booked: "border-t-orange-500",
            new_lead: "border-t-blue-500",
            one_time: "border-t-yellow-500",
            lapsed: "border-t-purple-500",
            lost: "border-t-zinc-500",
          }

          return (
            <div
              key={col.key}
              className={`flex-shrink-0 w-[280px] snap-center flex flex-col rounded-lg border border-zinc-800 ${headerColors[col.key] || ""} border-t-2 bg-zinc-950 ${
                dragOver === col.key ? "ring-2 ring-blue-500/50" : ""
              }`}
              onDragOver={(e) => handleDragOver(e, col.key)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.key)}
            >
              {/* Column header */}
              <div className="px-3 py-3 border-b border-zinc-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <col.icon className={`h-4 w-4 ${col.color}`} />
                    <span className="font-medium text-sm">{col.label}</span>
                    <Badge variant="outline" className="text-xs border-zinc-700">{col.customers.length}</Badge>
                  </div>
                  {col.key !== "lost" && col.eligible > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs"
                      onClick={() => handleStartAll(col.key)}
                      disabled={!!enrolling}
                    >
                      {enrolling === col.key ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <Play className="h-3 w-3 mr-1" />
                          Start All
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-280px)]">
                {isLoading && col.customers.length === 0 && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}

                {!isLoading && col.customers.length === 0 && (
                  <div className="text-center py-8 text-xs text-muted-foreground">
                    Empty
                  </div>
                )}

                {col.customers.map(c => {
                  const status = getCustomerStatus(c)
                  const name = `${c.first_name || ""} ${c.last_name || ""}`.trim()
                  const seq = SEQUENCE_PREVIEWS[c.retargeting_sequence || ""]
                  const totalSteps = seq?.steps.length || 3
                  const currentStep = c.retargeting_step || 0
                  const progressPct = status === "active" ? Math.round((currentStep / totalSteps) * 100) : 0

                  return (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, c.id, col.key)}
                      className={`relative rounded-md border border-zinc-800 bg-zinc-900 p-3 cursor-grab active:cursor-grabbing hover:border-zinc-700 transition-colors ${
                        status === "converted" ? "opacity-60" : ""
                      }`}
                    >
                      {/* Context menu button */}
                      <button
                        className="absolute top-2 right-2 text-zinc-600 hover:text-zinc-400"
                        onClick={(e) => {
                          e.stopPropagation()
                          setContextMenu({ id: c.id, stage: col.key, x: e.clientX, y: e.clientY })
                        }}
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>

                      <div className="font-medium text-sm truncate pr-6">{name}</div>

                      <div className="flex items-center justify-between mt-1.5">
                        <span className={`text-xs ${
                          status === "active" ? "text-blue-400" :
                          status === "converted" ? "text-green-400" :
                          status === "completed" ? "text-zinc-500" :
                          status === "eligible" ? "text-yellow-400" :
                          "text-zinc-600"
                        }`}>
                          {status === "active" ? `Step ${currentStep}/${totalSteps}` :
                           status === "converted" ? "Converted" :
                           status === "completed" ? "Done" :
                           status === "eligible" ? "Eligible" :
                           "Stopped"}
                        </span>
                        {c.retargeting_enrolled_at && (
                          <span className="text-xs text-muted-foreground">
                            {timeAgo(c.retargeting_enrolled_at)}
                          </span>
                        )}
                      </div>

                      {/* Progress bar for active */}
                      {status === "active" && (
                        <div className="mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Column footer */}
              <div className="px-3 py-2 border-t border-zinc-800 text-xs text-muted-foreground">
                {col.eligible > 0 && <span>{col.eligible} eligible</span>}
                {col.eligible > 0 && col.active > 0 && <span> / </span>}
                {col.active > 0 && <span>{col.active} active</span>}
                {(col.eligible > 0 || col.active > 0) && col.converted > 0 && <span> / </span>}
                {col.converted > 0 && <span className="text-green-400">{col.converted} converted</span>}
                {col.eligible === 0 && col.active === 0 && col.converted === 0 && (
                  <span>{col.customers.length} total</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[150px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const c = (customers[contextMenu.stage] || []).find(c => c.id === contextMenu.id)
            if (!c) return null
            const status = getCustomerStatus(c)
            return (
              <>
                {status === "eligible" && (
                  <button
                    className="w-full px-4 py-2 text-left text-sm hover:bg-zinc-800 flex items-center gap-2"
                    onClick={() => { handleStart(contextMenu.id, contextMenu.stage); setContextMenu(null) }}
                    disabled={!!enrolling}
                  >
                    <Play className="h-3.5 w-3.5 text-green-400" />
                    Start Sequence
                  </button>
                )}
                {status === "active" && (
                  <button
                    className="w-full px-4 py-2 text-left text-sm hover:bg-zinc-800 flex items-center gap-2"
                    onClick={() => { handleCancel(contextMenu.id, contextMenu.stage); setContextMenu(null) }}
                    disabled={cancelling}
                  >
                    <StopCircle className="h-3.5 w-3.5 text-red-400" />
                    Cancel Sequence
                  </button>
                )}
                {status === "completed" && (
                  <button
                    className="w-full px-4 py-2 text-left text-sm hover:bg-zinc-800 flex items-center gap-2"
                    onClick={() => { handleStart(contextMenu.id, contextMenu.stage); setContextMenu(null) }}
                    disabled={!!enrolling}
                  >
                    <Play className="h-3.5 w-3.5 text-blue-400" />
                    Restart Sequence
                  </button>
                )}
                <button
                  className="w-full px-4 py-2 text-left text-sm hover:bg-zinc-800 flex items-center gap-2 text-red-400"
                  onClick={() => { handleMarkLost(contextMenu.id, contextMenu.stage); setContextMenu(null) }}
                  disabled={cancelling}
                >
                  <Ban className="h-3.5 w-3.5" />
                  Mark Lost
                </button>
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
