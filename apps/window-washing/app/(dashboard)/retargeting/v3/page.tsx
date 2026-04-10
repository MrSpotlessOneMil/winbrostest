"use client"

import { useState, Suspense } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Phone, X, RefreshCw,
  Upload, ArrowRight,
} from "lucide-react"
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
import { useRouter } from "next/navigation"

const SALES_STAGES: PipelineStageKey[] = ["new_lead", "engaged", "paid", "booked"]

const SOURCE_COLORS: Record<string, string> = {
  phone: "bg-blue-500", meta: "bg-indigo-500", website: "bg-green-500", vapi: "bg-purple-500",
  sms: "bg-cyan-500", google: "bg-red-500", google_lsa: "bg-orange-500", thumbtack: "bg-teal-500",
  angi: "bg-pink-500", sam: "bg-violet-500", ghl: "bg-amber-500", manual: "bg-muted-foreground",
  housecall_pro: "bg-emerald-500", email: "bg-sky-500",
}


export default function PipelinePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><CubeLoader /></div>}>
      <PipelinePageInner />
    </Suspense>
  )
}

function PipelinePageInner() {
  const { stages, loading, error, clearError, fetchPipeline } = usePipeline()
  const [showImportModal, setShowImportModal] = useState(false)
  const [activeMobileStage, setActiveMobileStage] = useState<PipelineStageKey>("new_lead")
  const isMobile = useIsMobile()

  if (loading) return <div className="flex items-center justify-center h-64"><CubeLoader /></div>

  const funnelCount = SALES_STAGES.reduce((s, k) => s + (stages[k]?.count || 0), 0)
  const funnelValue = SALES_STAGES.reduce((s, k) => s + (stages[k]?.value || 0), 0)

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-5 h-full overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Pipeline</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            {`${funnelCount} people \u2014 ${formatCurrency(funnelValue)} in pipeline`}
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


      {/* PIPELINE CONTENT */}
      {isMobile ? (
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
      }

      <ImportModal open={showImportModal} onClose={() => setShowImportModal(false)}
        onComplete={() => { setShowImportModal(false); fetchPipeline() }} />
    </div>
  )
}

/* ─── Sales Pipeline Card ──────────────────────────────────────────────── */

function PipelineCard({ item }: { item: PipelineItem }) {
  const sourceColor = item.source ? SOURCE_COLORS[item.source] || "bg-muted-foreground" : null
  const router = useRouter()

  return (
    <Card
      className="hover:shadow-md transition-all cursor-pointer"
      onClick={() => {
        if (item.phone) router.push(`/customers?phone=${encodeURIComponent(item.phone)}`)
      }}
    >
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

