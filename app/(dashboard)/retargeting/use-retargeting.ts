import { useCallback, useEffect, useState } from "react"
import type {
  PipelineStage,
  PipelineCustomer,
  StageKey,
  PipelineStageKey,
  PipelineStageData,
} from "./constants"

// ---------------------------------------------------------------------------
// usePipeline - new hook for the 7-stage journey pipeline (v3 rewrite)
// ---------------------------------------------------------------------------

interface UsePipelineReturn {
  stages: Record<string, PipelineStageData>
  loading: boolean
  error: string | null
  clearError: () => void
  fetchPipeline: () => Promise<void>

  // Retargeting actions (Win Back stage)
  enrollSequence: (segment: string, customerIds?: number[]) => Promise<{ enrolled: number } | null>
  cancelRetargeting: (customerIds: number[]) => Promise<boolean>
  markAsLost: (customerIds: number[]) => Promise<boolean>
  enrolling: string | null
  cancelling: boolean
}

export function usePipeline(): UsePipelineReturn {
  const [stages, setStages] = useState<Record<string, PipelineStageData>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enrolling, setEnrolling] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const fetchPipeline = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/actions/pipeline", { cache: "no-store" })
      const json = await res.json()
      if (json.stages) {
        setStages(json.stages)
      } else {
        setError(json.error || "Failed to load pipeline")
      }
    } catch {
      setError("Failed to load pipeline")
    } finally {
      setLoading(false)
    }
  }, [])

  const enrollSequence = useCallback(async (segment: string, customerIds?: number[]) => {
    setEnrolling(segment)
    try {
      const body: Record<string, unknown> = { segment }
      if (customerIds && customerIds.length > 0) body.customer_ids = customerIds
      const res = await fetch("/api/actions/retargeting-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (json.success) {
        await fetchPipeline()
        return { enrolled: json.enrolled }
      }
      setError(json.error || "Failed to enroll")
      return null
    } catch {
      setError("Failed to enroll segment")
      return null
    } finally {
      setEnrolling(null)
    }
  }, [fetchPipeline])

  const cancelRetargeting = useCallback(async (customerIds: number[]) => {
    if (customerIds.length === 0) return false
    setCancelling(true)
    try {
      const res = await fetch("/api/actions/retargeting-pipeline", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_ids: customerIds }),
      })
      const json = await res.json()
      if (json.success) {
        await fetchPipeline()
        return true
      }
      setError(json.error || "Failed to cancel")
      return false
    } catch {
      setError("Failed to cancel retargeting")
      return false
    } finally {
      setCancelling(false)
    }
  }, [fetchPipeline])

  const markAsLost = useCallback(async (customerIds: number[]) => {
    if (customerIds.length === 0) return false
    setCancelling(true)
    try {
      const res = await fetch("/api/actions/retargeting-pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_ids: customerIds, override: "lost" }),
      })
      const json = await res.json()
      if (json.success) {
        await fetchPipeline()
        return true
      }
      setError(json.error || "Failed to mark as lost")
      return false
    } catch {
      setError("Failed to mark as lost")
      return false
    } finally {
      setCancelling(false)
    }
  }, [fetchPipeline])

  const clearError = useCallback(() => setError(null), [])

  useEffect(() => { fetchPipeline() }, [fetchPipeline])

  return {
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
  }
}

// ---------------------------------------------------------------------------
// useRetargeting - legacy hook (used by v1/v2 pages)
// ---------------------------------------------------------------------------

interface UseRetargetingReturn {
  pipeline: Record<string, PipelineStage>
  pipelineLoading: boolean
  totalCustomers: number
  customers: Record<string, PipelineCustomer[]>
  customersLoading: Record<string, boolean>
  fetchPipeline: () => Promise<void>
  fetchStageCustomers: (stage: string) => Promise<void>
  enrollSegment: (segment: StageKey, customerIds?: number[]) => Promise<{ enrolled: number } | null>
  cancelRetargeting: (customerIds: number[]) => Promise<boolean>
  markAsLost: (customerIds: number[]) => Promise<boolean>
  enrolling: string | null
  cancelling: boolean
  error: string | null
  clearError: () => void
}

export function useRetargeting(): UseRetargetingReturn {
  const [pipeline, setPipeline] = useState<Record<string, PipelineStage>>({})
  const [pipelineLoading, setPipelineLoading] = useState(true)
  const [totalCustomers, setTotalCustomers] = useState(0)

  const [customers, setCustomers] = useState<Record<string, PipelineCustomer[]>>({})
  const [customersLoading, setCustomersLoading] = useState<Record<string, boolean>>({})

  const [enrolling, setEnrolling] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPipeline = useCallback(async () => {
    setPipelineLoading(true)
    try {
      const res = await fetch("/api/actions/retargeting-pipeline", { cache: "no-store" })
      const json = await res.json()
      if (json.success) {
        setPipeline(json.stages || {})
        setTotalCustomers(json.total || 0)
      }
    } catch {
      setError("Failed to load pipeline")
    } finally {
      setPipelineLoading(false)
    }
  }, [])

  const fetchStageCustomers = useCallback(async (stage: string) => {
    setCustomersLoading(prev => ({ ...prev, [stage]: true }))
    try {
      const res = await fetch(`/api/actions/retargeting-customers?stage=${stage}`, { cache: "no-store" })
      const json = await res.json()
      if (json.success) {
        setCustomers(prev => ({ ...prev, [stage]: json.customers || [] }))
      }
    } catch {
      setCustomers(prev => ({ ...prev, [stage]: [] }))
    } finally {
      setCustomersLoading(prev => ({ ...prev, [stage]: false }))
    }
  }, [])

  const enrollSegment = useCallback(async (segment: StageKey, customerIds?: number[]) => {
    setEnrolling(segment)
    try {
      const body: Record<string, unknown> = { segment }
      if (customerIds && customerIds.length > 0) body.customer_ids = customerIds
      const res = await fetch("/api/actions/retargeting-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (json.success) {
        await fetchPipeline()
        await fetchStageCustomers(segment)
        return { enrolled: json.enrolled }
      } else {
        setError(json.error || "Failed to enroll")
        return null
      }
    } catch {
      setError("Failed to enroll segment")
      return null
    } finally {
      setEnrolling(null)
    }
  }, [fetchPipeline, fetchStageCustomers])

  const cancelRetargeting = useCallback(async (customerIds: number[]) => {
    if (customerIds.length === 0) return false
    setCancelling(true)
    try {
      const res = await fetch("/api/actions/retargeting-pipeline", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_ids: customerIds }),
      })
      const json = await res.json()
      if (json.success) {
        await fetchPipeline()
        return true
      }
      setError(json.error || "Failed to cancel")
      return false
    } catch {
      setError("Failed to cancel retargeting")
      return false
    } finally {
      setCancelling(false)
    }
  }, [fetchPipeline])

  const markAsLost = useCallback(async (customerIds: number[]) => {
    if (customerIds.length === 0) return false
    setCancelling(true)
    try {
      const res = await fetch("/api/actions/retargeting-pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_ids: customerIds, override: "lost" }),
      })
      const json = await res.json()
      if (json.success) {
        await fetchPipeline()
        return true
      }
      setError(json.error || "Failed to mark as lost")
      return false
    } catch {
      setError("Failed to mark as lost")
      return false
    } finally {
      setCancelling(false)
    }
  }, [fetchPipeline])

  const clearError = useCallback(() => setError(null), [])

  useEffect(() => { fetchPipeline() }, [fetchPipeline])

  return {
    pipeline,
    pipelineLoading,
    totalCustomers,
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
  }
}
