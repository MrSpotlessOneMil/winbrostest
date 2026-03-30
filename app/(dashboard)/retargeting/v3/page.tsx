"use client"

import { useState, useMemo, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import {
  Phone, X, Loader2, RefreshCw, Search,
  Upload, ArrowRight, RotateCcw, XCircle, Ban, Play,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { ImportModal } from "@/components/pipeline/import-modal"
import CubeLoader from "@/components/ui/cube-loader"
import { usePipeline } from "../use-retargeting"
import {
  PIPELINE_JOURNEY_STAGES,
  SOURCE_LABELS,
  type PipelineStageKey,
  type PipelineItem,
  formatCurrency,
  timeAgo,
} from "../constants"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"

const SALES_STAGES: PipelineStageKey[] = ["new_lead", "engaged", "paid", "booked"]

const SOURCE_COLORS: Record<string, string> = {
  phone: "bg-blue-500", meta: "bg-indigo-500", website: "bg-green-500", vapi: "bg-purple-500",
  sms: "bg-cyan-500", google: "bg-red-500", google_lsa: "bg-orange-500", thumbtack: "bg-teal-500",
  angi: "bg-pink-500", sam: "bg-violet-500", ghl: "bg-amber-500", manual: "bg-muted-foreground",
  housecall_pro: "bg-emerald-500", email: "bg-sky-500",
}

type Tab = "sales" | "winback"

export default function PipelinePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><CubeLoader /></div>}>
      <PipelinePageInner />
    </Suspense>
  )
}

function PipelinePageInner() {
  const { stages, loading, error, clearError, fetchPipeline, enrollSequence, cancelRetargeting, markAsLost, unmarkLost, enrolling, cancelling, markingLost, unmarkingLost } = usePipeline()
  const [showImportModal, setShowImportModal] = useState(false)
  const searchParams = useSearchParams()
  const router = useRouter()
  const activeTab = (searchParams.get("tab") === "winback" ? "winback" : "sales") as Tab
  const setActiveTab = (tab: Tab) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", tab)
    router.replace(`?${params.toString()}`, { scroll: false })
  }
  const [activeMobileStage, setActiveMobileStage] = useState<PipelineStageKey>("new_lead")
  const [winBackSearch, setWinBackSearch] = useState("")
  const isMobile = useIsMobile()

  if (loading) return <div className="flex items-center justify-center h-64"><CubeLoader /></div>

  const funnelCount = SALES_STAGES.reduce((s, k) => s + (stages[k]?.count || 0), 0)
  const funnelValue = SALES_STAGES.reduce((s, k) => s + (stages[k]?.value || 0), 0)
  const winBackData = stages["win_back"] || { count: 0, value: 0, items: [] }
  const filteredWinBack = useMemo(() => {
    if (!winBackSearch.trim()) return winBackData.items
    const q = winBackSearch.toLowerCase()
    return winBackData.items.filter(item =>
      item.name?.toLowerCase().includes(q) ||
      item.phone?.includes(q) ||
      item.lifecycle_stage?.toLowerCase().includes(q)
    )
  }, [winBackData.items, winBackSearch])

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-5 h-full overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Sales Pipeline</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            {activeTab === "sales"
              ? `${funnelCount} people \u2014 ${formatCurrency(funnelValue)} in pipeline`
              : `${winBackData.count} people eligible for win-back`
            }
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {error && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive px-2 py-1 rounded-md flex items-center gap-1.5 text-xs">
              {error}
              <button onClick={clearError}><X className="h-3 w-3" /></button>
            </div>
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowImportModal(true)}>
            <Upload className="h-3 w-3 mr-1" /> <span className="hidden sm:inline">Import</span>
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={fetchPipeline}>
            <RefreshCw className="h-3 w-3 mr-1" /> <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Tab switcher: Sales Funnel | Win-Back */}
      <div className="flex items-center rounded-lg border border-border bg-muted/50 p-0.5 shrink-0 w-fit">
        <button
          onClick={() => setActiveTab("sales")}
          className={cn(
            "px-4 py-1.5 text-xs font-medium rounded-md transition-colors",
            activeTab === "sales"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Sales Funnel
          <Badge variant="outline" className="ml-1.5 text-[10px] px-1.5 border-border">{funnelCount}</Badge>
        </button>
        <button
          onClick={() => setActiveTab("winback")}
          className={cn(
            "px-4 py-1.5 text-xs font-medium rounded-md transition-colors",
            activeTab === "winback"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Win-Back
          <Badge variant="outline" className="ml-1.5 text-[10px] px-1.5 border-border">{winBackData.count}</Badge>
        </button>
      </div>

      {/* TAB CONTENT */}
      {activeTab === "sales" ? (
        isMobile ? (
          /* ===== MOBILE: Tab-based stage selector + vertical card list ===== */
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Stage tabs */}
            <div className="flex gap-1 overflow-x-auto pb-2 shrink-0">
              {SALES_STAGES.map((stageKey) => {
                const stageDef = PIPELINE_JOURNEY_STAGES.find(s => s.key === stageKey)
                if (!stageDef) return null
                const data = stages[stageKey] || { count: 0, value: 0, items: [] }
                return (
                  <button
                    key={stageKey}
                    onClick={() => setActiveMobileStage(stageKey)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0",
                      activeMobileStage === stageKey
                        ? `bg-card border border-border shadow-sm text-foreground`
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {stageDef.label}
                    <Badge variant="outline" className="text-[10px] px-1 border-border">{data.count}</Badge>
                  </button>
                )
              })}
            </div>

            {/* Cards for active stage */}
            <div className="flex-1 overflow-y-auto space-y-2 pt-1">
              {(() => {
                const data = stages[activeMobileStage] || { count: 0, value: 0, items: [] }
                if (data.items.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <p className="text-sm text-muted-foreground">No leads in this stage</p>
                    </div>
                  )
                }
                return data.items.map(item => <PipelineCard key={item.id} item={item} />)
              })()}
            </div>
          </div>
        ) : (
          /* ===== DESKTOP: Horizontal kanban columns ===== */
          <div className="flex gap-3 flex-1 min-h-0 overflow-x-auto pb-2">
            {SALES_STAGES.map((stageKey) => {
              const stageDef = PIPELINE_JOURNEY_STAGES.find(s => s.key === stageKey)
              if (!stageDef) return null
              const data = stages[stageKey] || { count: 0, value: 0, items: [] }
              const Icon = stageDef.icon

              return (
                <div key={stageKey} className="flex-1 min-w-[240px] max-w-[340px] flex flex-col min-h-0">
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
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <p className="text-xs text-muted-foreground">No leads here yet</p>
                      </div>
                    ) : (
                      data.items.map(item => (
                        <PipelineCard key={item.id} item={item} />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (
        /* ===== WIN-BACK TAB ===== */
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Search bar */}
          <div className="relative shrink-0 mb-3">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, or status..."
              value={winBackSearch}
              onChange={(e) => setWinBackSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {winBackData.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <RotateCcw className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-foreground">No win-back candidates</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  One-time customers, lapsed regulars, and unresponsive leads will appear here when eligible for re-engagement
                </p>
              </div>
            ) : filteredWinBack.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No customers match &ldquo;{winBackSearch}&rdquo;</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredWinBack.map((item) => (
                  <WinBackCard
                    key={item.id}
                    item={item}
                    onEnroll={(customerId) => enrollSequence(item.retargeting_sequence || "one_time", [customerId])}
                    onCancel={(customerId) => cancelRetargeting([customerId])}
                    onMarkLost={(customerId) => markAsLost([customerId])}
                    onUnmarkLost={(customerId) => unmarkLost([customerId])}
                    enrolling={enrolling}
                    cancelling={cancelling}
                    markingLost={markingLost}
                    unmarkingLost={unmarkingLost}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <ImportModal open={showImportModal} onClose={() => setShowImportModal(false)}
        onComplete={() => { setShowImportModal(false); fetchPipeline() }} />
    </div>
  )
}

/* ─── Sales Pipeline Card ──────────────────────────────────────────────── */

function PipelineCard({ item }: { item: PipelineItem }) {
  const sourceColor = item.source ? SOURCE_COLORS[item.source] || "bg-muted-foreground" : null

  return (
    <Card className="hover:shadow-md transition-all cursor-pointer">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-semibold truncate">{item.name}</span>
          {item.phone && (
            <a href={`tel:${item.phone}`} className="p-1 rounded hover:bg-muted shrink-0" onClick={e => e.stopPropagation()}>
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            </a>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {sourceColor && (
            <div className="flex items-center gap-1">
              <div className={cn("h-2 w-2 rounded-full", sourceColor)} />
              <span className="text-[10px] text-muted-foreground">{SOURCE_LABELS[item.source!] || item.source}</span>
            </div>
          )}
          {item.value > 0 && (
            <span className="text-[11px] font-medium text-emerald-500">{formatCurrency(item.value)}</span>
          )}
          <span className="text-[10px] text-muted-foreground ml-auto">
            {(item.days_in_stage ?? 0) > 0 ? `${item.days_in_stage}d` : timeAgo(item.time)}
          </span>
        </div>

        {item.last_message && (
          <div className="text-[11px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5 mb-2 truncate">
            &ldquo;{item.last_message}&rdquo;
          </div>
        )}

        {item.next_action && (
          <div className="flex items-center gap-1 text-[11px] font-medium text-primary">
            <ArrowRight className="h-3 w-3" />
            {item.next_action}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ─── Win-Back Card ────────────────────────────────────────────────────── */

function WinBackCard({ item, onEnroll, onCancel, onMarkLost, onUnmarkLost, enrolling, cancelling, markingLost, unmarkingLost }: {
  item: PipelineItem
  onEnroll: (customerId: number) => void
  onCancel: (customerId: number) => void
  onMarkLost: (customerId: number) => void
  onUnmarkLost: (customerId: number) => void
  enrolling: string | null
  cancelling: boolean
  markingLost: number | null
  unmarkingLost: number | null
}) {
  const customerId = item.customer_id || parseInt(item.id)
  const isInSequence = !!item.retargeting_sequence && (item.retargeting_step || 0) > 0
  const isLost = item.lifecycle_stage === "lost"
  const isMarkingThis = markingLost === customerId
  const isUnmarkingThis = unmarkingLost === customerId
  const sequenceLabel = item.retargeting_sequence
    ? `Step ${item.retargeting_step || 1} \u2014 ${item.retargeting_sequence.replace(/_/g, " ")}`
    : null

  return (
    <Card className={cn(isLost && "opacity-60")}>
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold truncate">{item.name}</span>
              {isLost && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Customer Lost</Badge>
              )}
              {item.phone && (
                <a href={`tel:${item.phone}`} className="shrink-0" onClick={e => e.stopPropagation()}>
                  <Phone className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
                </a>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              {item.lifecycle_stage && !isLost && (
                <Badge variant="outline" className="text-[10px] capitalize">{item.lifecycle_stage.replace(/_/g, " ")}</Badge>
              )}
              {item.value > 0 && <span className="text-emerald-500 font-medium">{formatCurrency(item.value)} lifetime</span>}
              {item.job_date && <span>Last job: {timeAgo(item.job_date)}</span>}
              {sequenceLabel && (
                <Badge variant="secondary" className="text-[10px]">
                  <RotateCcw className="h-2.5 w-2.5 mr-1" />
                  {sequenceLabel}
                </Badge>
              )}
            </div>
            {item.last_message && (
              <p className="text-[11px] text-muted-foreground mt-1.5 truncate">
                &ldquo;{item.last_message}&rdquo;
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            {!isLost && (
              <>
                {!isInSequence ? (
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onEnroll(customerId)}
                    disabled={!!enrolling || cancelling}
                  >
                    {enrolling ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                    Start Sequence
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onCancel(customerId)}
                    disabled={!!enrolling || cancelling}
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    Stop
                  </Button>
                )}
              </>
            )}
            <TooltipProvider delayDuration={600}>
              <Tooltip>
                <TooltipTrigger asChild>
                  {isLost ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground hover:text-emerald-500"
                      onClick={() => onUnmarkLost(customerId)}
                      disabled={isUnmarkingThis}
                    >
                      {isUnmarkingThis
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Play className="h-3 w-3" />
                      }
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => onMarkLost(customerId)}
                      disabled={isMarkingThis}
                    >
                      {isMarkingThis
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Ban className="h-3 w-3" />
                      }
                    </Button>
                  )}
                </TooltipTrigger>
                <TooltipContent side="left">
                  {isLost
                    ? "Restore customer — removes the lost status and makes them eligible for win-back"
                    : "Mark as lost — permanently removes this customer from the win-back pipeline"
                  }
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
