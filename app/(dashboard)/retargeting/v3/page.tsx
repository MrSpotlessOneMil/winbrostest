"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ChevronRight, Phone, ExternalLink, Calendar,
  X, Play, StopCircle, Ban, Loader2, RefreshCw,
  PhoneCall, MessageSquare, Upload,
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
  formatPhone,
  timeAgo,
} from "../constants"

export default function PipelinePage() {
  const {
    stages,
    loading,
    error,
    clearError,
    fetchPipeline,
    enrollSequence,
    cancelRetargeting,
    markAsLost,
    enrolling,
    cancelling,
  } = usePipeline()

  const [expandedStage, setExpandedStage] = useState<PipelineStageKey | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)

  // Compute conversion rates between adjacent stages
  const stageKeys = PIPELINE_JOURNEY_STAGES.map(s => s.key)
  const conversions: Record<string, number | null> = {}
  for (let i = 0; i < stageKeys.length - 1; i++) {
    const current = stages[stageKeys[i]]?.count || 0
    const next = stages[stageKeys[i + 1]]?.count || 0
    conversions[stageKeys[i]] = current > 0 ? Math.round((next / current) * 100) : null
  }

  const totalCount = stageKeys.reduce((sum, k) => sum + (stages[k]?.count || 0), 0)
  const totalValue = stageKeys.reduce((sum, k) => sum + (stages[k]?.value || 0), 0)

  const handleToggle = (key: PipelineStageKey) => {
    setExpandedStage(prev => prev === key ? null : key)
  }

  // Extract numeric customer_id from item
  const getCustomerId = (item: PipelineItem): number | null => {
    if (item.customer_id) return item.customer_id
    // For customer source_table, parse from id
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <CubeLoader />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalCount} people - {formatCurrency(totalValue)} total value
          </p>
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-1 rounded-md flex items-center gap-2 text-sm">
              {error}
              <button onClick={clearError}><X className="h-3 w-3" /></button>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowImportModal(true)}
            className="border-zinc-700 text-zinc-400 hover:text-zinc-200"
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Import
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchPipeline}
            className="border-zinc-700 text-zinc-400 hover:text-zinc-200"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stage boxes - horizontal pipeline */}
      <div className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory md:snap-none scrollbar-thin">
        {PIPELINE_JOURNEY_STAGES.map((stage, i) => {
          const data = stages[stage.key] || { count: 0, value: 0, items: [] }
          const isExpanded = expandedStage === stage.key
          const conversion = conversions[stage.key]
          const Icon = stage.icon

          return (
            <div key={stage.key} className="flex items-center gap-1.5 snap-center flex-shrink-0">
              <button
                onClick={() => handleToggle(stage.key)}
                className={`
                  w-[130px] rounded-xl p-4 transition-all duration-200 cursor-pointer
                  border-2 backdrop-blur-sm
                  hover:scale-[1.03] hover:shadow-lg
                  ${isExpanded
                    ? `${stage.border} bg-gradient-to-b ${stage.gradient} shadow-lg`
                    : 'border-zinc-800/60 bg-zinc-950/80 hover:border-zinc-700'
                  }
                `}
              >
                <div className="flex items-center gap-1.5 mb-3">
                  <Icon className={`h-4 w-4 ${stage.color} flex-shrink-0`} />
                  <span className="text-[11px] font-medium text-zinc-300 truncate">{stage.label}</span>
                </div>
                <div className="text-2xl font-bold tracking-tight">{data.count}</div>
                <div className={`text-sm font-semibold mt-0.5 ${data.value > 0 ? stage.color : 'text-zinc-600'}`}>
                  {formatCurrency(data.value)}
                </div>
              </button>

              {/* Conversion arrow */}
              {i < PIPELINE_JOURNEY_STAGES.length - 1 && (
                <div className="flex flex-col items-center flex-shrink-0 w-6">
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-700" />
                  {conversion !== null && conversion !== undefined && (
                    <span className="text-[9px] text-zinc-600 font-medium">{conversion}%</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Expanded detail panel */}
      {expandedStage && stages[expandedStage] && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/80 backdrop-blur-sm overflow-hidden animate-in slide-in-from-top-2 duration-200">
          {/* Detail header */}
          <div className="px-5 py-3.5 border-b border-zinc-800/60 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {(() => {
                const s = PIPELINE_JOURNEY_STAGES.find(s => s.key === expandedStage)!
                const Icon = s.icon
                return (
                  <>
                    <div className={`p-1.5 rounded-lg ${s.bg}`}>
                      <Icon className={`h-4 w-4 ${s.color}`} />
                    </div>
                    <div>
                      <span className="font-semibold text-sm">{s.label}</span>
                      <span className="text-xs text-muted-foreground ml-2">{s.description}</span>
                    </div>
                    <Badge variant="outline" className="text-xs border-zinc-700 ml-1">
                      {stages[expandedStage].count}
                    </Badge>
                  </>
                )
              })()}
            </div>
            <button
              onClick={() => setExpandedStage(null)}
              className="text-zinc-500 hover:text-zinc-300 p-1 rounded-md hover:bg-zinc-800/50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Column headers */}
          <div className="px-5 py-2 border-b border-zinc-800/40 grid grid-cols-[1fr_80px_180px_70px_120px] gap-4 text-[11px] text-zinc-500 uppercase tracking-wider font-medium">
            <span>Name</span>
            <span>Value</span>
            <span>Status</span>
            <span>Time</span>
            <span className="text-right">Actions</span>
          </div>

          {/* Items list */}
          <div className="max-h-[420px] overflow-y-auto">
            {stages[expandedStage].items.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                No items in this stage
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/30">
                {stages[expandedStage].items.map(item => (
                  <div
                    key={item.id}
                    className="px-5 py-3 hover:bg-zinc-900/40 transition-colors grid grid-cols-[1fr_80px_180px_70px_120px] gap-4 items-center"
                  >
                    {/* Name + phone + source */}
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{item.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{formatPhone(item.phone)}</span>
                        {item.source && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-zinc-700/50 text-zinc-500">
                            {SOURCE_LABELS[item.source] || item.source}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Value */}
                    <div className={`text-sm font-medium ${item.value > 0 ? 'text-green-400' : 'text-zinc-600'}`}>
                      {item.value > 0 ? `$${item.value.toLocaleString()}` : '-'}
                    </div>

                    {/* Status / substatus */}
                    <div className="min-w-0">
                      {renderSubstatus(item, expandedStage)}
                    </div>

                    {/* Time */}
                    <div className="text-xs text-zinc-600">
                      {timeAgo(item.time)}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 justify-end">
                      {actionLoading === item.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      ) : (
                        renderActions(item, expandedStage, {
                          onStart: handleStartSequence,
                          onCancel: handleCancelSequence,
                          onMarkLost: handleMarkLost,
                          enrolling,
                          cancelling,
                        })
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <ImportModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        onComplete={() => {
          setShowImportModal(false)
          fetchPipeline()
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stage-specific substatus rendering
// ---------------------------------------------------------------------------

function renderSubstatus(item: PipelineItem, stage: PipelineStageKey) {
  switch (stage) {
    case 'new_lead':
      return (
        <div className="text-xs">
          <span className="text-blue-400">{item.substatus}</span>
        </div>
      )

    case 'engaged':
      return (
        <div className="text-xs space-y-0.5">
          <span className="text-cyan-400">{item.substatus}</span>
        </div>
      )

    case 'quoted':
      return (
        <div className="text-xs">
          <span className="text-amber-400">{item.substatus}</span>
          {item.quote_token && (
            <a
              href={`/quote/${item.quote_token}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1.5 text-zinc-500 hover:text-amber-400 inline-flex items-center"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )

    case 'paid':
      return (
        <div className="text-xs text-green-400">{item.substatus}</div>
      )

    case 'booked':
      return (
        <div className="text-xs space-y-0.5">
          <span className="text-violet-400">{item.substatus}</span>
          {item.job_date && (
            <div className="text-zinc-500">{item.job_date}</div>
          )}
        </div>
      )

    case 'completed':
      return (
        <div className="text-xs">
          <span className={
            item.satisfaction_response === 'positive' ? 'text-emerald-400' :
            item.satisfaction_response === 'negative' ? 'text-red-400' :
            'text-zinc-500'
          }>
            {item.substatus}
          </span>
        </div>
      )

    case 'win_back': {
      const seq = item.retargeting_sequence ? SEQUENCE_PREVIEWS[item.retargeting_sequence] : null
      const totalSteps = seq?.steps.length || 0
      const currentStep = item.retargeting_step || 0
      const currentStepInfo = seq?.steps.find(s => s.step === currentStep)

      if (item.status === 'in_sequence' && seq) {
        return (
          <div className="text-xs space-y-1">
            <div className="flex items-center gap-1.5">
              {currentStepInfo?.type === 'call' ? (
                <PhoneCall className="h-3 w-3 text-orange-400" />
              ) : (
                <MessageSquare className="h-3 w-3 text-orange-400" />
              )}
              <span className="text-orange-400">
                Step {currentStep}/{totalSteps}
                {currentStepInfo ? ` - ${currentStepInfo.template}` : ''}
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden w-24">
              <div
                className="h-full bg-orange-500 rounded-full transition-all"
                style={{ width: `${totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0}%` }}
              />
            </div>
          </div>
        )
      }

      return (
        <div className="text-xs">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-zinc-700/50 text-zinc-500">
            {item.lifecycle_stage || 'eligible'}
          </Badge>
        </div>
      )
    }

    default:
      return <span className="text-xs text-muted-foreground">{item.substatus}</span>
  }
}

// ---------------------------------------------------------------------------
// Stage-specific action buttons
// ---------------------------------------------------------------------------

function renderActions(
  item: PipelineItem,
  stage: PipelineStageKey,
  handlers: {
    onStart: (item: PipelineItem) => void
    onCancel: (item: PipelineItem) => void
    onMarkLost: (item: PipelineItem) => void
    enrolling: string | null
    cancelling: boolean
  }
) {
  const actions: React.ReactNode[] = []
  const btnClass = "p-1.5 rounded-md hover:bg-zinc-800/80 text-zinc-500 hover:text-zinc-300 transition-colors"

  // Call button (universal when phone exists)
  if (item.phone) {
    actions.push(
      <a key="call" href={`tel:${item.phone}`} className={btnClass} title="Call">
        <Phone className="h-3.5 w-3.5" />
      </a>
    )
  }

  // Stage-specific actions
  switch (stage) {
    case 'quoted':
      if (item.quote_token) {
        actions.push(
          <a
            key="quote"
            href={`/quote/${item.quote_token}`}
            target="_blank"
            rel="noopener noreferrer"
            className={btnClass}
            title="View Quote"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )
      }
      break

    case 'booked':
      actions.push(
        <a key="cal" href="/calendar" className={btnClass} title="View Calendar">
          <Calendar className="h-3.5 w-3.5" />
        </a>
      )
      break

    case 'win_back':
      if (item.status === 'in_sequence') {
        actions.push(
          <button
            key="cancel"
            onClick={() => handlers.onCancel(item)}
            className={`${btnClass} hover:text-red-400`}
            title="Cancel Sequence"
            disabled={handlers.cancelling}
          >
            <StopCircle className="h-3.5 w-3.5" />
          </button>
        )
      } else {
        actions.push(
          <button
            key="start"
            onClick={() => handlers.onStart(item)}
            className={`${btnClass} hover:text-green-400`}
            title="Start Sequence"
            disabled={!!handlers.enrolling}
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )
      }
      break
  }

  // Mark Lost (for customer-facing stages)
  if (['win_back'].includes(stage) && item.source_table === 'customer') {
    actions.push(
      <button
        key="lost"
        onClick={() => handlers.onMarkLost(item)}
        className={`${btnClass} hover:text-red-400`}
        title="Mark Lost"
        disabled={handlers.cancelling}
      >
        <Ban className="h-3.5 w-3.5" />
      </button>
    )
  }

  return <>{actions}</>
}
