"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { RefreshCcw, Loader2, Square, CheckCircle, Play, StopCircle, RotateCcw, X } from "lucide-react"
import CubeLoader from "@/components/ui/cube-loader"
import { useRetargeting } from "../use-retargeting"
import {
  PIPELINE_STAGES,
  getCustomerStatus,
  getCustomerStatusLabel,
  timeAgo,
  type StageKey,
  type PipelineCustomer,
} from "../constants"

export default function RetargetingV1() {
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

  const [activeTab, setActiveTab] = useState<"all" | StageKey>("all")
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // Fetch customers for every stage on mount + when pipeline changes
  useEffect(() => {
    if (!pipelineLoading) {
      PIPELINE_STAGES.forEach(s => {
        if (pipeline[s.key]) fetchStageCustomers(s.key)
      })
    }
  }, [pipelineLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Combine all customers or filter by tab
  const allCustomers: (PipelineCustomer & { stage: StageKey })[] = []
  for (const s of PIPELINE_STAGES) {
    const list = customers[s.key] || []
    for (const c of list) {
      allCustomers.push({ ...c, stage: s.key })
    }
  }

  const filteredCustomers = activeTab === "all"
    ? allCustomers
    : allCustomers.filter(c => c.stage === activeTab)

  // Sort: eligible first, then active, then completed/converted
  const sortOrder = { eligible: 0, active: 1, stopped: 2, completed: 3, converted: 4 }
  const sortedCustomers = [...filteredCustomers].sort(
    (a, b) => sortOrder[getCustomerStatus(a)] - sortOrder[getCustomerStatus(b)]
  )

  const needFollowUp = allCustomers.filter(c => getCustomerStatus(c) === "eligible").length

  // Tab counts
  const tabCounts: Record<string, number> = { all: allCustomers.length }
  for (const s of PIPELINE_STAGES) {
    tabCounts[s.key] = (customers[s.key] || []).length
  }

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    const eligible = sortedCustomers.filter(c => getCustomerStatus(c) !== "converted")
    if (selected.size === eligible.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(eligible.map(c => c.id)))
    }
  }

  async function handleEnroll(customerIds: number[], segment: StageKey) {
    const result = await enrollSegment(segment, customerIds)
    if (result) setSelected(new Set())
  }

  async function handleCancel(customerIds: number[]) {
    const ok = await cancelRetargeting(customerIds)
    if (ok) {
      setSelected(new Set())
      PIPELINE_STAGES.forEach(s => fetchStageCustomers(s.key))
    }
  }

  async function handleMarkLost(customerIds: number[]) {
    const ok = await markAsLost(customerIds)
    if (ok) {
      setSelected(new Set())
      PIPELINE_STAGES.forEach(s => fetchStageCustomers(s.key))
    }
  }

  const anyLoading = Object.values(customersLoading).some(Boolean)

  if (pipelineLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <CubeLoader />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Retargeting</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {needFollowUp > 0
              ? `${needFollowUp} need follow-up`
              : "Everyone's been contacted. Nice work."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            fetchPipeline()
            PIPELINE_STAGES.forEach(s => fetchStageCustomers(s.key))
          }}
          disabled={anyLoading}
        >
          {anyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-2 rounded-md flex items-center justify-between text-sm">
          {error}
          <button onClick={clearError}><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { setActiveTab("all"); setSelected(new Set()) }}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            activeTab === "all"
              ? "bg-white text-black"
              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
          }`}
        >
          All ({tabCounts.all})
        </button>
        {PIPELINE_STAGES.map(s => (
          <button
            key={s.key}
            onClick={() => { setActiveTab(s.key); setSelected(new Set()) }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeTab === s.key
                ? "bg-white text-black"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {s.label} ({tabCounts[s.key] || 0})
          </button>
        ))}
      </div>

      {/* Customer list */}
      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        {/* Select all header */}
        {sortedCustomers.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 bg-zinc-900/50 border-b border-zinc-800 text-sm text-muted-foreground">
            <Checkbox
              checked={selected.size > 0 && selected.size === sortedCustomers.filter(c => getCustomerStatus(c) !== "converted").length}
              onCheckedChange={toggleSelectAll}
            />
            <span className="flex-1">Customer</span>
            <span className="w-40 text-right">Stage</span>
            <span className="w-24 text-right">Status</span>
            <span className="w-20 text-right">Action</span>
          </div>
        )}

        {sortedCustomers.length === 0 && !anyLoading && (
          <div className="text-center py-12 text-muted-foreground">
            {activeTab === "all"
              ? "No customers in the pipeline yet."
              : `No customers in ${PIPELINE_STAGES.find(s => s.key === activeTab)?.label || activeTab}.`}
          </div>
        )}

        {anyLoading && sortedCustomers.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {sortedCustomers.map(c => {
          const status = getCustomerStatus(c)
          const statusLabel = getCustomerStatusLabel(c)
          const stageDef = PIPELINE_STAGES.find(s => s.key === c.stage)

          return (
            <div
              key={c.id}
              className={`flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50 last:border-0 hover:bg-zinc-900/30 transition-colors ${
                status === "converted" ? "opacity-50" : ""
              }`}
            >
              {status === "converted" ? (
                <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
              ) : (
                <Checkbox
                  checked={selected.has(c.id)}
                  onCheckedChange={() => toggleSelect(c.id)}
                />
              )}

              <div className="flex-1 min-w-0">
                <span className="font-medium truncate block">
                  {c.first_name} {c.last_name}
                </span>
                {c.retargeting_enrolled_at && (
                  <span className="text-xs text-muted-foreground">
                    enrolled {timeAgo(c.retargeting_enrolled_at)}
                  </span>
                )}
              </div>

              <div className="w-40 text-right">
                <Badge variant="outline" className={`${stageDef?.color || ""} border-zinc-700`}>
                  {stageDef?.label || c.stage}
                </Badge>
              </div>

              <div className="w-24 text-right">
                <span className={`text-sm ${
                  status === "active" ? "text-blue-400" :
                  status === "converted" ? "text-green-400" :
                  status === "completed" ? "text-zinc-400" :
                  status === "eligible" ? "text-yellow-400" :
                  "text-zinc-500"
                }`}>
                  {statusLabel}
                </span>
              </div>

              <div className="w-20 text-right">
                {status === "eligible" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={!!enrolling}
                    onClick={() => handleEnroll([c.id], c.stage)}
                  >
                    {enrolling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                    Start
                  </Button>
                )}
                {status === "active" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-red-400 hover:text-red-300"
                    disabled={cancelling}
                    onClick={() => handleCancel([c.id])}
                  >
                    <StopCircle className="h-3 w-3 mr-1" />
                    Stop
                  </Button>
                )}
                {status === "completed" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={!!enrolling}
                    onClick={() => handleEnroll([c.id], c.stage)}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Restart
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Batch action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-700 rounded-lg px-6 py-3 flex items-center gap-4 shadow-xl z-50">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button
            size="sm"
            onClick={() => {
              const segment = activeTab !== "all" ? activeTab : undefined
              if (segment) {
                handleEnroll(Array.from(selected), segment)
              } else {
                // Group by stage and enroll each
                const byStage: Record<string, number[]> = {}
                for (const c of sortedCustomers) {
                  if (selected.has(c.id) && getCustomerStatus(c) === "eligible") {
                    if (!byStage[c.stage]) byStage[c.stage] = []
                    byStage[c.stage].push(c.id)
                  }
                }
                for (const [seg, ids] of Object.entries(byStage)) {
                  handleEnroll(ids, seg as StageKey)
                }
              }
            }}
            disabled={!!enrolling}
          >
            {enrolling ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
            Start Sequence
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red-400 border-red-500/30 hover:bg-red-500/10"
            onClick={() => handleMarkLost(Array.from(selected))}
            disabled={cancelling}
          >
            Mark Lost
          </Button>
          <button onClick={() => setSelected(new Set())} className="text-zinc-500 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
