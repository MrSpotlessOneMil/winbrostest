"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Phone, X, Play, StopCircle, Ban, Loader2, RefreshCw,
  Upload, ArrowRight, MessageSquare,
} from "lucide-react"
import { ImportModal } from "@/components/pipeline/import-modal"
import CubeLoader from "@/components/ui/cube-loader"
import { usePipeline } from "../use-retargeting"
import {
  PIPELINE_JOURNEY_STAGES,
  SEQUENCE_PREVIEWS,
  SOURCE_LABELS,
  type PipelineStageKey,
  type PipelineItem,
  formatCurrency,
  timeAgo,
} from "../constants"
import { cn } from "@/lib/utils"

type Tab = "funnel" | "winback"

const SALES_STAGES: PipelineStageKey[] = ["new_lead", "engaged", "paid", "booked"]

const SOURCE_COLORS: Record<string, string> = {
  phone: "bg-blue-500", meta: "bg-indigo-500", website: "bg-green-500", vapi: "bg-purple-500",
  sms: "bg-cyan-500", google: "bg-red-500", google_lsa: "bg-orange-500", thumbtack: "bg-teal-500",
  angi: "bg-pink-500", sam: "bg-violet-500", ghl: "bg-amber-500", manual: "bg-zinc-500",
  housecall_pro: "bg-emerald-500", email: "bg-sky-500",
}

export default function PipelinePage() {
  const {
    stages, loading, error, clearError, fetchPipeline,
    enrollSequence, cancelRetargeting, markAsLost, enrolling, cancelling,
  } = usePipeline()

  const [tab, setTab] = useState<Tab>("funnel")
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)

  const getCustomerId = (item: PipelineItem): number | null => {
    if (item.customer_id) return item.customer_id
    if (item.source_table === 'customer' && item.id.startsWith('customer-')) {
      return parseInt(item.id.replace('customer-', ''), 10)
    }
    return null
  }

  const handleStartSequence = useCallback(async (item: PipelineItem) => {
    const customerId = getCustomerId(item)
    if (!customerId || !item.lifecycle_stage) return
    setActionLoading(item.id)
    await enrollSequence(item.lifecycle_stage, [customerId])
    setActionLoading(null)
  }, [enrollSequence])

  const handleCancelSequence = useCallback(async (item: PipelineItem) => {
    const customerId = getCustomerId(item)
    if (!customerId) return
    setActionLoading(item.id)
    await cancelRetargeting([customerId])
    setActionLoading(null)
  }, [cancelRetargeting])

  const handleMarkLost = useCallback(async (item: PipelineItem) => {
    const customerId = getCustomerId(item)
    if (!customerId) return
    setActionLoading(item.id)
    await markAsLost([customerId])
    setActionLoading(null)
  }, [markAsLost])

  if (loading) return <div className="flex items-center justify-center h-64"><CubeLoader /></div>

  // Sales funnel totals
  const funnelCount = SALES_STAGES.reduce((s, k) => s + (stages[k]?.count || 0), 0)
  const funnelValue = SALES_STAGES.reduce((s, k) => s + (stages[k]?.value || 0), 0)
  const winBackData = stages.win_back || { count: 0, value: 0, items: [] }

  return (
    <div className="p-6 space-y-5 h-full overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold">Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {tab === "funnel"
              ? `${funnelCount} people — ${formatCurrency(funnelValue)} in pipeline`
              : `${winBackData.count} customers to win back — ${formatCurrency(winBackData.value)} potential`
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-1 rounded-md flex items-center gap-2 text-sm">
              {error}
              <button onClick={clearError}><X className="h-3 w-3" /></button>
            </div>
          )}
          {/* Tabs */}
          <div className="flex items-center rounded-lg border border-border bg-muted/50 p-0.5">
            <button onClick={() => setTab("funnel")}
              className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                tab === "funnel" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              Sales Funnel
            </button>
            <button onClick={() => setTab("winback")}
              className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                tab === "winback" ? "bg-orange-500/20 text-orange-400 shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              Win-Back ({winBackData.count})
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowImportModal(true)}>
            <Upload className="h-3.5 w-3.5 mr-1.5" /> Import
          </Button>
          <Button variant="outline" size="sm" onClick={fetchPipeline}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* ═══ SALES FUNNEL TAB ═══ */}
      {tab === "funnel" && (
        <div className="flex gap-3 flex-1 min-h-0 overflow-x-auto pb-2">
          {SALES_STAGES.map((stageKey) => {
            const stageDef = PIPELINE_JOURNEY_STAGES.find(s => s.key === stageKey)
            if (!stageDef) return null
            const data = stages[stageKey] || { count: 0, value: 0, items: [] }
            const Icon = stageDef.icon

            return (
              <div key={stageKey} className="flex-1 min-w-[260px] max-w-[340px] flex flex-col min-h-0">
                {/* Column header */}
                <div className={cn("rounded-t-xl px-4 py-3 border-2 border-b-0", stageDef.border, `bg-gradient-to-b ${stageDef.gradient}`)}>
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", stageDef.color)} />
                    <span className="text-sm font-semibold">{stageDef.label}</span>
                    <Badge variant="outline" className="ml-auto text-[10px] border-border">{data.count}</Badge>
                  </div>
                  {data.value > 0 && (
                    <p className={cn("text-xs font-medium mt-1", stageDef.color)}>{formatCurrency(data.value)}</p>
                  )}
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto space-y-2 p-2 rounded-b-xl border-2 border-t-0 border-border bg-muted/20">
                  {data.items.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">Empty</p>
                  ) : (
                    data.items.map(item => (
                      <PipelineCard key={item.id} item={item} stageKey={stageKey} actionLoading={actionLoading} />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ═══ WIN-BACK TAB ═══ */}
      {tab === "winback" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {winBackData.items.length === 0 ? (
              <p className="text-sm text-muted-foreground col-span-full text-center py-10">No customers to win back</p>
            ) : (
              winBackData.items.map(item => {
                const seq = item.retargeting_sequence ? SEQUENCE_PREVIEWS[item.retargeting_sequence] : null
                const totalSteps = seq?.steps.length || 0
                const currentStep = item.retargeting_step || 0

                return (
                  <div key={item.id} className="rounded-xl border border-border bg-card p-4 hover:border-orange-500/30 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold truncate">{item.name}</span>
                      {item.phone && (
                        <a href={`tel:${item.phone}`} className="p-1 rounded hover:bg-muted shrink-0">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {item.lifecycle_stage || 'eligible'}
                      </Badge>
                      {item.value > 0 && (
                        <span className="text-xs text-green-400 font-medium">{formatCurrency(item.value)}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto">{timeAgo(item.time)}</span>
                    </div>

                    {/* Retargeting progress */}
                    {item.status === 'in_sequence' && seq && (
                      <div className="mb-3">
                        <div className="flex items-center gap-1.5 text-xs text-orange-400 mb-1">
                          <MessageSquare className="h-3 w-3" />
                          Step {currentStep}/{totalSteps}
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-orange-500 rounded-full" style={{ width: `${totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0}%` }} />
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-1.5">
                      {actionLoading === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : item.status === 'in_sequence' ? (
                        <Button size="sm" variant="outline" className="h-7 text-[11px] text-red-400 border-red-500/30 hover:bg-red-500/10"
                          onClick={() => handleCancelSequence(item)} disabled={cancelling}>
                          <StopCircle className="h-3 w-3 mr-1" /> Stop
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 text-[11px] text-green-400 border-green-500/30 hover:bg-green-500/10"
                          onClick={() => handleStartSequence(item)} disabled={!!enrolling}>
                          <Play className="h-3 w-3 mr-1" /> Start Sequence
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 text-[11px] text-muted-foreground"
                        onClick={() => handleMarkLost(item)} disabled={cancelling}>
                        <Ban className="h-3 w-3 mr-1" /> Lost
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      <ImportModal open={showImportModal} onClose={() => setShowImportModal(false)}
        onComplete={() => { setShowImportModal(false); fetchPipeline() }} />
    </div>
  )
}

/* ═══ Pipeline Card Component ═══ */
function PipelineCard({ item, stageKey, actionLoading }: {
  item: PipelineItem; stageKey: PipelineStageKey; actionLoading: string | null
}) {
  const sourceColor = item.source ? SOURCE_COLORS[item.source] || "bg-zinc-500" : null

  return (
    <div className="rounded-lg border border-border bg-card p-3 hover:shadow-md hover:border-border/80 transition-all cursor-pointer">
      {/* Name + call */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-semibold truncate">{item.name}</span>
        {item.phone && (
          <a href={`tel:${item.phone}`} className="p-1 rounded hover:bg-muted shrink-0" onClick={e => e.stopPropagation()}>
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
          </a>
        )}
      </div>

      {/* Source + value + time */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        {sourceColor && (
          <div className="flex items-center gap-1">
            <div className={cn("h-2 w-2 rounded-full", sourceColor)} />
            <span className="text-[10px] text-muted-foreground">{SOURCE_LABELS[item.source!] || item.source}</span>
          </div>
        )}
        {item.value > 0 && (
          <span className="text-[11px] font-medium text-green-400">{formatCurrency(item.value)}</span>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto">
          {(item.days_in_stage ?? 0) > 0 ? `${item.days_in_stage}d` : timeAgo(item.time)}
        </span>
      </div>

      {/* Last message */}
      {item.last_message && (
        <div className="text-[11px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5 mb-2 truncate">
          &ldquo;{item.last_message}&rdquo;
        </div>
      )}

      {/* Next action */}
      {item.next_action && (
        <div className="flex items-center gap-1 text-[11px] font-medium text-primary">
          <ArrowRight className="h-3 w-3" />
          {item.next_action}
        </div>
      )}
    </div>
  )
}
