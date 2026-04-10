"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Target,
  X,
  Loader2,
  RefreshCcw,
  Megaphone,
  CheckCircle,
  Users,
  Play,
  ChevronDown,
  ChevronUp,
  UserX,
  FileQuestion,
  UserCheck,
  TimerOff,
  Ban,
  Zap,
  Eye,
  MessageSquare,
  Upload,
  ArrowRight,
  AlertTriangle,
  Clock,
  Settings,
} from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import CubeLoader from "@/components/ui/cube-loader"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface SeasonalCampaign {
  id: string
  name: string
  message: string
  start_date: string
  end_date: string
  target_segment: "all" | "inactive_30" | "inactive_60" | "inactive_90" | "completed_customers"
  enabled: boolean
  created_at: string
  last_sent_at: string | null
}

interface CampaignSettings {
  seasonal_reminders_enabled: boolean
  frequency_nudge_enabled: boolean
  frequency_nudge_days: number
  review_only_followup_enabled: boolean
  seasonal_campaigns: SeasonalCampaign[]
}

interface PipelineStage {
  total: number
  in_sequence: number
  completed_sequence: number
  converted: number
}

interface PipelineCustomer {
  id: number
  first_name: string
  last_name: string
  phone_number: string
  email: string | null
  retargeting_sequence: string | null
  retargeting_step: number | null
  retargeting_stopped_reason: string | null
  retargeting_enrolled_at: string | null
  sms_opt_out?: boolean
  created_at: string
}

// Sequence preview data (mirrors lib/scheduler.ts RETARGETING_SEQUENCES + RETARGETING_TEMPLATES)
const SEQUENCE_PREVIEWS: Record<string, { steps: { step: number; delay: string; template: string; a: string; b: string }[]; summary: string }> = {
  unresponsive: {
    summary: "3 steps, 7 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Opener", a: "Hey {name}, we got a couple spots open for {service} this week if you're interested", b: "Hey {name} its been a bit, you still looking into getting {service} done?" },
      { step: 2, delay: "Day 3", template: "Value Nudge", a: "Hey {name} we just finished up a job near you actually, got one more opening this week if you wanna get on the schedule for {service}", b: "Hey {name} we got a couple spots left this week for {service} if you wanna grab one before they fill up" },
      { step: 3, delay: "Day 7", template: "Last Check", a: "Hey {name} last message from me, would love to get you on the schedule for {service} but totally understand if the timing isn't right. just let me know either way", b: "Hey {name} I'm cleaning up my list, should I keep you on it for {service} or would you rather I stop texting? no hard feelings either way" },
    ],
  },
  quoted_not_booked: {
    summary: "6 steps, 14 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Quote Follow-up", a: "Hey {name} just following up on that {service} quote, let me know if you have any questions or wanna tweak anything", b: "Hey {name} your quote for {service} is still good, I can hold a spot for you this week if you wanna lock it in" },
      { step: 2, delay: "Day 2", template: "Question-Based", a: "Hey {name} totally get that timing matters, anything we can do to make it easier to get {service} scheduled? pretty flexible on our end", b: "Hey {name} was there anything holding you back from booking? happy to work around your schedule for {service}" },
      { step: 3, delay: "Day 4", template: "Limited Time", a: "Hey {name} we only got like 2 openings left this week for {service}, want me to hold one for you?", b: "Hey {name} just had a cancellation so we got a spot open for {service} if you want it" },
      { step: 4, delay: "Day 7", template: "Check-In", a: "Hey {name} just circling back on {service}, happy to work with you on timing or price. what would make it work for you?", b: "Hey {name} didn't wanna let your quote slip through the cracks, we got availability this week if you wanna get {service} booked" },
      { step: 5, delay: "Day 10", template: "Social Proof", a: "Hey {name} we just wrapped up {service} for someone nearby and they were super happy with it, would love to take care of your place too", b: "Hey {name} we've been busy in your area with {service} lately, your neighbors are loving it. want us to swing by yours?" },
      { step: 6, delay: "Day 14", template: "Last Check", a: "Hey {name} last message from me, would love to get you on the schedule for {service} but totally understand if the timing isn't right. just let me know either way", b: "Hey {name} I'm cleaning up my list, should I keep you on it for {service} or would you rather I stop texting? no hard feelings either way" },
    ],
  },
  one_time: {
    summary: "3 steps, 14 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Check-In", a: "Hey {name} its been a while, your place is probably due for {service} again. want us to swing by?", b: "Hey {name} we were in your area doing {service} and thought of you, let me know if you wanna get back on the schedule" },
      { step: 2, delay: "Day 7", template: "Seasonal Nudge", a: "Hey {name} great time of year for {service}, we're filling up this week, want me to squeeze you in?", b: "Hey {name} most of our regulars are getting their {service} done right now, want me to get you on the schedule too?" },
      { step: 3, delay: "Day 14", template: "Last Check", a: "Hey {name} last message from me, would love to get you on the schedule for {service} but totally understand if the timing isn't right. just let me know either way", b: "Hey {name} I'm cleaning up my list, should I keep you on it for {service} or would you rather I stop texting? no hard feelings either way" },
    ],
  },
  lapsed: {
    summary: "3 steps, 10 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Feedback Ask", a: "Hey {name} real quick, was there anything we could've done better last time? would love another shot", b: "Hey {name} just wanted to check in, if there was anything we could improve I'd love to hear it. either way hope you're doing well" },
      { step: 2, delay: "Day 5", template: "Priority Offer", a: "Hey {name} we'd love to have you back, I can get you priority scheduling for your next {service} if you're interested", b: "Hey {name} we're giving priority booking to returning customers this week for {service}, want me to put you at the top of the list?" },
      { step: 3, delay: "Day 10", template: "Last Check", a: "Hey {name} last message from me, would love to get you on the schedule for {service} but totally understand if the timing isn't right. just let me know either way", b: "Hey {name} I'm cleaning up my list, should I keep you on it for {service} or would you rather I stop texting? no hard feelings either way" },
    ],
  },
  new_lead: {
    summary: "3 steps, 5 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Opener", a: "Hey {name}, we got a couple spots open for {service} this week if you're interested", b: "Hey {name} its been a bit, you still looking into getting {service} done?" },
      { step: 2, delay: "Day 2", template: "Value Nudge", a: "Hey {name} we just finished up a job near you actually, got one more opening this week if you wanna get on the schedule for {service}", b: "Hey {name} we got a couple spots left this week for {service} if you wanna grab one before they fill up" },
      { step: 3, delay: "Day 5", template: "Last Check", a: "Hey {name} last message from me, would love to get you on the schedule for {service} but totally understand if the timing isn't right. just let me know either way", b: "Hey {name} I'm cleaning up my list, should I keep you on it for {service} or would you rather I stop texting? no hard feelings either way" },
    ],
  },
  lost: {
    summary: "3 steps, 10 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Feedback Ask", a: "Hey {name} real quick, was there anything we could've done better last time? would love another shot", b: "Hey {name} just wanted to check in, if there was anything we could improve I'd love to hear it. either way hope you're doing well" },
      { step: 2, delay: "Day 5", template: "Priority Offer", a: "Hey {name} we'd love to have you back, I can get you priority scheduling for your next {service} if you're interested", b: "Hey {name} we're giving priority booking to returning customers this week for {service}, want me to put you at the top of the list?" },
      { step: 3, delay: "Day 10", template: "Last Check", a: "Hey {name} last message from me, would love to get you on the schedule for {service} but totally understand if the timing isn't right. just let me know either way", b: "Hey {name} I'm cleaning up my list, should I keep you on it for {service} or would you rather I stop texting? no hard feelings either way" },
    ],
  },
}

const PIPELINE_STAGES = [
  { key: "unresponsive", label: "Unresponsive", description: "Texted/called, no reply", icon: UserX, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", sequence: "unresponsive" as const, group: "lead_dropoffs" },
  { key: "quoted_not_booked", label: "Quoted, Not Booked", description: "Got a quote, didn't pay", icon: FileQuestion, color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", sequence: "quoted_not_booked" as const, group: "lead_dropoffs" },
  { key: "new_lead", label: "New Leads", description: "Completed follow-up, no response", icon: Zap, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", sequence: "new_lead" as const, group: "lead_dropoffs" },
  { key: "one_time", label: "One-Time", description: "Booked once, hasn't returned", icon: UserCheck, color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20", sequence: "one_time" as const, group: "win_back" },
  { key: "lapsed", label: "Lapsed", description: "Was active, gone 60+ days", icon: TimerOff, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20", sequence: "lapsed" as const, group: "win_back" },
  { key: "lost", label: "Lost", description: "Said no / bad experience", icon: Ban, color: "text-zinc-500", bg: "bg-zinc-500/10", border: "border-zinc-500/20", sequence: "lost" as const, group: "last_chance" },
]

const PIPELINE_GROUPS = [
  { key: "lead_dropoffs", label: "Lead Drop-Offs", description: "Leads who showed interest but never booked" },
  { key: "win_back", label: "Past Customer Win-Back", description: "Customers who booked before but haven't returned" },
  { key: "last_chance", label: "Last Chance", description: "Re-engage or close the file" },
]

export default function CampaignsPage() {
  const [settings, setSettings] = useState<CampaignSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pipeline state
  const [pipeline, setPipeline] = useState<Record<string, PipelineStage>>({})
  const [pipelineLoading, setPipelineLoading] = useState(false)
  const [expandedStage, setExpandedStage] = useState<string | null>(null)
  const [stageCustomers, setStageCustomers] = useState<PipelineCustomer[]>([])
  const [stageCustomersLoading, setStageCustomersLoading] = useState(false)
  const [enrolling, setEnrolling] = useState<string | null>(null)
  const [enrollResult, setEnrollResult] = useState<{ segment: string; enrolled: number } | null>(null)
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<number>>(new Set())
  const [showPreview, setShowPreview] = useState<string | null>(null)
  const [previewVariant, setPreviewVariant] = useState<'a' | 'b'>('a')
  const [cancelling, setCancelling] = useState(false)

  // A/B results state
  const [abResults, setAbResults] = useState<Record<string, Record<string, { enrolled: number; replied: number; converted: number }>>>({})
  const [abLoading, setAbLoading] = useState(false)
  const [abExpanded, setAbExpanded] = useState(false)

  // Lead journey state
  const [journey, setJourney] = useState<{
    followup: { total: number; by_stage: Record<number, number>; converted: number; lost: number; responded: number }
    retargeting: { in_sequence: number; completed: number; converted: number }
    opted_out: number
  } | null>(null)
  const [journeyLoading, setJourneyLoading] = useState(false)

  // CSV Import state
  const [showImportModal, setShowImportModal] = useState(false)
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([])
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvMapping, setCsvMapping] = useState<{ first_name: string; last_name: string; phone: string; email: string; address: string; stage: string }>({ first_name: "", last_name: "", phone: "", email: "", address: "", stage: "" })
  const [csvDefaultStage, setCsvDefaultStage] = useState("unresponsive")
  const [csvAutoEnroll, setCsvAutoEnroll] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; enrolled: number; skipped: number; errors?: string[] } | null>(null)

  // Settings collapsed state
  const [settingsExpanded, setSettingsExpanded] = useState(false)

  async function fetchSettings() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/tenant/campaigns", { cache: "no-store" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to load")
      setSettings(json.data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchPipeline() {
    setPipelineLoading(true)
    try {
      const res = await fetch("/api/actions/retargeting-pipeline", { cache: "no-store" })
      const json = await res.json()
      if (json.success) setPipeline(json.stages || {})
    } catch { /* ignore */ }
    finally { setPipelineLoading(false) }
  }

  async function fetchStageCustomers(stage: string) {
    setStageCustomersLoading(true)
    try {
      const res = await fetch(`/api/actions/retargeting-customers?stage=${stage}`, { cache: "no-store" })
      const json = await res.json()
      if (json.success) setStageCustomers(json.customers || [])
    } catch { setStageCustomers([]) }
    finally { setStageCustomersLoading(false) }
  }

  async function enrollSegment(segment: string, customerIds?: number[]) {
    setEnrolling(segment)
    setEnrollResult(null)
    try {
      const body: Record<string, unknown> = { segment }
      if (customerIds && customerIds.length > 0) {
        body.customer_ids = customerIds
      }
      const res = await fetch("/api/actions/retargeting-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (json.success) {
        setEnrollResult({ segment, enrolled: json.enrolled })
        setSelectedCustomerIds(new Set())
        await fetchPipeline()
        if (expandedStage === segment) await fetchStageCustomers(segment)
      } else {
        setError(json.error || "Failed to enroll segment")
      }
    } catch {
      setError("Failed to enroll segment")
    } finally {
      setEnrolling(null)
    }
  }

  async function markAsLost(customerIds: number[]) {
    if (customerIds.length === 0) return
    setCancelling(true)
    try {
      const res = await fetch("/api/actions/retargeting-pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_ids: customerIds, override: "lost" }),
      })
      const json = await res.json()
      if (json.success) {
        setEnrollResult(null)
        setSelectedCustomerIds(new Set())
        await fetchPipeline()
        if (expandedStage) await fetchStageCustomers(expandedStage)
      } else {
        setError(json.error || "Failed to mark as bad experience")
      }
    } catch {
      setError("Failed to mark as bad experience")
    } finally {
      setCancelling(false)
    }
  }

  async function cancelRetargeting(customerIds: number[]) {
    if (customerIds.length === 0) return
    setCancelling(true)
    try {
      const res = await fetch("/api/actions/retargeting-pipeline", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_ids: customerIds }),
      })
      const json = await res.json()
      if (json.success) {
        setEnrollResult(null)
        setSelectedCustomerIds(new Set())
        await fetchPipeline()
        if (expandedStage) await fetchStageCustomers(expandedStage)
      } else {
        setError(json.error || "Failed to cancel retargeting")
      }
    } catch {
      setError("Failed to cancel retargeting")
    } finally {
      setCancelling(false)
    }
  }

  async function fetchAbResults() {
    setAbLoading(true)
    try {
      const res = await fetch("/api/actions/retargeting-ab-results", { cache: "no-store" })
      const json = await res.json()
      if (json.success) setAbResults(json.results || {})
    } catch { /* ignore */ }
    finally { setAbLoading(false) }
  }

  async function fetchJourney() {
    setJourneyLoading(true)
    try {
      const res = await fetch("/api/actions/lead-journey", { cache: "no-store" })
      const json = await res.json()
      if (json.success) setJourney(json)
    } catch { /* ignore */ }
    finally { setJourneyLoading(false) }
  }

  function handleCsvFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      if (!text) return
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      if (lines.length < 2) return

      const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/['"]/g, ""))
      setCsvHeaders(headers)

      const rows: Record<string, string>[] = []
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",").map(v => v.trim().replace(/^["']|["']$/g, ""))
        const row: Record<string, string> = {}
        headers.forEach((h, idx) => { row[h] = values[idx] || "" })
        rows.push(row)
      }
      setCsvRows(rows)

      // Auto-detect column mapping
      const mapping = { first_name: "", last_name: "", phone: "", email: "", address: "", stage: "" }
      for (const h of headers) {
        if (/^(first.?name|fname)$/i.test(h)) mapping.first_name = h
        else if (/^(last.?name|lname)$/i.test(h)) mapping.last_name = h
        else if (/^(name|full.?name|customer)$/i.test(h) && !mapping.first_name) mapping.first_name = h
        else if (/^(phone|phone.?number|mobile|cell|tel)$/i.test(h)) mapping.phone = h
        else if (/^(email|e.?mail)$/i.test(h)) mapping.email = h
        else if (/^(address|street|location)$/i.test(h)) mapping.address = h
        else if (/^(stage|status|lifecycle|type)$/i.test(h)) mapping.stage = h
      }
      setCsvMapping(mapping)
    }
    reader.readAsText(file)
  }

  async function doImport() {
    if (csvRows.length === 0) return
    setImporting(true)
    setImportResult(null)

    const validStages = ["unresponsive", "quoted_not_booked", "one_time", "lapsed", "new_lead", "lost"]

    const customers = csvRows.map(row => {
      const firstName = csvMapping.first_name ? row[csvMapping.first_name] || "" : ""
      const lastName = csvMapping.last_name ? row[csvMapping.last_name] || "" : ""

      let fn = firstName
      let ln = lastName
      if (firstName && !csvMapping.last_name && firstName.includes(" ")) {
        const parts = firstName.split(" ")
        fn = parts[0]
        ln = parts.slice(1).join(" ")
      }

      const stageRaw = csvMapping.stage ? row[csvMapping.stage] || "" : ""
      const stage = validStages.includes(stageRaw.toLowerCase().replace(/ /g, "_"))
        ? stageRaw.toLowerCase().replace(/ /g, "_")
        : csvDefaultStage

      return {
        first_name: fn || "Unknown",
        last_name: ln || undefined,
        phone: csvMapping.phone ? row[csvMapping.phone] || "" : "",
        email: csvMapping.email ? row[csvMapping.email] || "" : undefined,
        address: csvMapping.address ? row[csvMapping.address] || "" : undefined,
        stage,
      }
    }).filter(c => c.phone)

    try {
      const res = await fetch("/api/actions/import-customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customers, auto_enroll: csvAutoEnroll }),
      })
      const json = await res.json()
      if (json.success) {
        setImportResult(json)
        await fetchPipeline()
      } else {
        setImportResult({ imported: 0, enrolled: 0, skipped: customers.length, errors: [json.error || "Import failed"] })
      }
    } catch {
      setImportResult({ imported: 0, enrolled: 0, skipped: customers.length, errors: ["Network error"] })
    } finally {
      setImporting(false)
    }
  }

  useEffect(() => { fetchSettings(); fetchPipeline(); fetchAbResults(); fetchJourney() }, [])

  async function updateSettings(updates: Partial<CampaignSettings>) {
    setSaving(true)
    try {
      const res = await fetch("/api/tenant/campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error || "Failed to save")
      }
      await fetchSettings()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // Compute summary stats
  const totalInSequences = PIPELINE_STAGES.reduce((sum, s) => sum + (pipeline[s.key]?.in_sequence || 0), 0)
  const totalConverted = PIPELINE_STAGES.reduce((sum, s) => sum + (pipeline[s.key]?.converted || 0), 0)
  const totalEligible = PIPELINE_STAGES.reduce((sum, s) => {
    const d = pipeline[s.key]
    return sum + (d ? Math.max(0, d.total - d.in_sequence - d.converted) : 0)
  }, 0)
  const responseRate = journey && journey.followup.total > 0
    ? Math.round((journey.followup.responded / journey.followup.total) * 100)
    : null

  // Compute CSV import preview
  function getImportPreview() {
    if (csvRows.length === 0 || !csvMapping.phone) return null
    const validStages = ["unresponsive", "quoted_not_booked", "one_time", "lapsed", "new_lead", "lost"]
    const rowsWithPhone = csvRows.filter(r => r[csvMapping.phone])

    if (csvMapping.stage) {
      const breakdown: Record<string, number> = {}
      for (const row of rowsWithPhone) {
        const stageRaw = row[csvMapping.stage] || ""
        const stage = validStages.includes(stageRaw.toLowerCase().replace(/ /g, "_"))
          ? stageRaw.toLowerCase().replace(/ /g, "_")
          : csvDefaultStage
        breakdown[stage] = (breakdown[stage] || 0) + 1
      }
      return { type: "breakdown" as const, breakdown, total: rowsWithPhone.length }
    }

    return { type: "single" as const, stage: csvDefaultStage, total: rowsWithPhone.length }
  }

  const importPreview = getImportPreview()

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between stagger-1">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold text-foreground">
            <Target className="h-7 w-7 text-primary" />
            Retargeting
          </h1>
          <p className="text-sm text-muted-foreground">Re-engage leads and customers who dropped off</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setShowImportModal(true); setCsvRows([]); setCsvHeaders([]); setImportResult(null) }}>
            <Upload className="h-4 w-4 mr-1.5" />
            Import CSV
          </Button>
          <Button variant="ghost" size="icon" onClick={() => { fetchSettings(); fetchPipeline(); fetchJourney() }} disabled={loading}>
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {loading ? <CubeLoader /> : !settings ? (
        error ? (
          <div className="text-center py-20">
            <p className="text-red-400 mb-4">{error}</p>
            <Button onClick={fetchSettings}>Retry</Button>
          </div>
        ) : null
      ) : <>
      {error && (
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Summary Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
          <p className="text-2xl font-bold text-blue-400">{totalInSequences}</p>
          <p className="text-xs text-muted-foreground">In sequences</p>
        </div>
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3">
          <p className="text-2xl font-bold text-green-400">{totalConverted}</p>
          <p className="text-xs text-muted-foreground">Converted</p>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 px-4 py-3">
          <p className="text-2xl font-bold">{totalEligible}</p>
          <p className="text-xs text-muted-foreground">Eligible</p>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 px-4 py-3">
          <p className="text-2xl font-bold">{responseRate !== null ? `${responseRate}%` : "—"}</p>
          <p className="text-xs text-muted-foreground">Response rate</p>
        </div>
      </div>

      {/* Simplified Lead Follow-Up Journey */}
      {journey && (() => {
        const totalLeads = journey.followup.total
        const inFunnel = Object.values(journey.followup.by_stage).reduce((a, b) => a + b, 0)
        const converted = journey.followup.converted
        const dropped = journey.followup.lost
        const inRetargeting = journey.retargeting.in_sequence
        const barTotal = Math.max(1, inFunnel + converted + dropped + inRetargeting)

        return (
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <ArrowRight className="h-4 w-4" />
                  Lead Follow-Up Journey
                </h3>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchJourney} disabled={journeyLoading}>
                  <RefreshCcw className={`h-3.5 w-3.5 ${journeyLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>

              <div className="flex items-baseline gap-6 mb-3 flex-wrap">
                <span className="text-xs"><span className="text-xl font-bold">{totalLeads}</span> <span className="text-muted-foreground">total leads</span></span>
                <span className="text-xs"><span className="text-xl font-bold text-blue-400">{inFunnel}</span> <span className="text-muted-foreground">in funnel</span></span>
                <span className="text-xs"><span className="text-xl font-bold text-purple-400">{inRetargeting}</span> <span className="text-muted-foreground">retargeting</span></span>
                <span className="text-xs"><span className="text-xl font-bold text-green-400">{converted}</span> <span className="text-muted-foreground">converted</span></span>
                <span className="text-xs"><span className="text-xl font-bold text-zinc-500">{dropped}</span> <span className="text-muted-foreground">dropped</span></span>
              </div>

              {/* Horizontal progress bar */}
              <div className="h-3 rounded-full bg-zinc-800 overflow-hidden flex">
                {inFunnel > 0 && (
                  <div
                    className="bg-blue-500 h-full transition-all"
                    style={{ width: `${(inFunnel / barTotal) * 100}%` }}
                    title={`${inFunnel} in funnel`}
                  />
                )}
                {inRetargeting > 0 && (
                  <div
                    className="bg-purple-500 h-full transition-all"
                    style={{ width: `${(inRetargeting / barTotal) * 100}%` }}
                    title={`${inRetargeting} retargeting`}
                  />
                )}
                {converted > 0 && (
                  <div
                    className="bg-green-500 h-full transition-all"
                    style={{ width: `${(converted / barTotal) * 100}%` }}
                    title={`${converted} converted`}
                  />
                )}
                {dropped > 0 && (
                  <div
                    className="bg-zinc-600 h-full transition-all"
                    style={{ width: `${(dropped / barTotal) * 100}%` }}
                    title={`${dropped} dropped`}
                  />
                )}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> In funnel</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" /> Retargeting</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Converted</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-zinc-600" /> Dropped</span>
              </div>

              {journey.opted_out > 0 && (
                <div className="mt-2 flex items-center gap-2 text-xs text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {journey.opted_out} customer{journey.opted_out !== 1 ? "s" : ""} opted out of SMS
                </div>
              )}
            </CardContent>
          </Card>
        )
      })()}

      {/* Customer Pipeline — Grouped */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Retargeting Pipeline
              </CardTitle>
              <CardDescription>Customers grouped by where they dropped off. Click a segment to view and start sequences.</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={fetchPipeline} disabled={pipelineLoading}>
              <RefreshCcw className={`h-4 w-4 ${pipelineLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {enrollResult && (
            <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/10 text-sm text-green-400 flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              {enrollResult.enrolled} customer{enrollResult.enrolled !== 1 ? "s" : ""} enrolled in {enrollResult.segment.replace(/_/g, " ")} retargeting sequence.
            </div>
          )}

          {PIPELINE_GROUPS.map((group) => {
            const groupStages = PIPELINE_STAGES.filter(s => s.group === group.key)
            const groupTotal = groupStages.reduce((sum, s) => sum + (pipeline[s.key]?.total || 0), 0)

            return (
              <div key={group.key} className="space-y-2">
                {/* Group header */}
                <div className="flex items-center gap-2 pb-1 border-b border-zinc-800">
                  <h3 className="text-sm font-semibold">{group.label}</h3>
                  <span className="text-xs text-muted-foreground flex-1">{group.description}</span>
                  <Badge variant="outline" className="text-xs">{groupTotal}</Badge>
                </div>

                {/* Stages in group */}
                {groupStages.map((stage) => {
                  const data = pipeline[stage.key]
                  const total = data?.total || 0
                  const inSeq = data?.in_sequence || 0
                  const converted = data?.converted || 0
                  const isExpanded = expandedStage === stage.key
                  const Icon = stage.icon
                  const eligible = Math.max(0, total - inSeq - converted)
                  const seqInfo = SEQUENCE_PREVIEWS[stage.sequence]

                  return (
                    <div key={stage.key}>
                      <button
                        onClick={async () => {
                          if (isExpanded) {
                            setExpandedStage(null)
                            setStageCustomers([])
                            setSelectedCustomerIds(new Set())
                            setShowPreview(null)
                          } else {
                            setExpandedStage(stage.key)
                            setSelectedCustomerIds(new Set())
                            setShowPreview(null)
                            await fetchStageCustomers(stage.key)
                          }
                        }}
                        className={`w-full p-3 rounded-lg border ${stage.border} ${stage.bg} flex items-center gap-3 hover:opacity-90 transition-opacity text-left`}
                      >
                        <Icon className={`h-5 w-5 ${stage.color} shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{stage.label}</span>
                            <Badge variant="outline" className="text-xs">{total}</Badge>
                            {seqInfo && <Badge variant="outline" className="text-[10px] text-muted-foreground border-zinc-700">{seqInfo.summary}</Badge>}
                            {inSeq > 0 && <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">{inSeq} in sequence</Badge>}
                            {converted > 0 && <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">{converted} converted</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{stage.description}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {/* Mini progress bar */}
                          {total > 0 && (
                            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden flex w-20 hidden md:flex">
                              {inSeq > 0 && <div className="bg-blue-500 h-full" style={{ width: `${(inSeq / total) * 100}%` }} />}
                              {converted > 0 && <div className="bg-green-500 h-full" style={{ width: `${(converted / total) * 100}%` }} />}
                            </div>
                          )}
                          {eligible > 0 && !isExpanded && (
                            <Badge className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/20">{eligible} eligible</Badge>
                          )}
                          {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </div>
                      </button>

                      {/* Expanded customer list */}
                      {isExpanded && (
                        <div className="ml-4 md:ml-8 mt-2 mb-2 space-y-3">
                          {stageCustomersLoading ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Loading customers...
                            </div>
                          ) : stageCustomers.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-3">No customers in this stage</p>
                          ) : (
                            <>
                              {/* Customer list with checkboxes */}
                              <div className="border border-zinc-800 rounded-lg overflow-hidden">
                                {/* Select all header */}
                                {stage.sequence && (() => {
                                  const eligibleCustomers = stageCustomers.filter(c => !c.retargeting_sequence && c.phone_number && !c.sms_opt_out)
                                  return eligibleCustomers.length > 0 ? (
                                    <div className="flex items-center gap-3 px-3 py-2 bg-zinc-900/50 border-b border-zinc-800">
                                      <Checkbox
                                        checked={eligibleCustomers.length > 0 && eligibleCustomers.every(c => selectedCustomerIds.has(c.id))}
                                        onCheckedChange={(checked) => {
                                          const next = new Set(selectedCustomerIds)
                                          if (checked) {
                                            eligibleCustomers.forEach(c => next.add(c.id))
                                          } else {
                                            eligibleCustomers.forEach(c => next.delete(c.id))
                                          }
                                          setSelectedCustomerIds(next)
                                        }}
                                      />
                                      <span className="text-xs text-muted-foreground">
                                        {selectedCustomerIds.size > 0
                                          ? `${selectedCustomerIds.size} selected`
                                          : `Select all (${eligibleCustomers.length} eligible)`}
                                      </span>
                                    </div>
                                  ) : null
                                })()}
                                <div className="divide-y divide-zinc-800/50">
                                  {stageCustomers.map((c) => {
                                    const isEligible = !c.retargeting_sequence && !!c.phone_number && !c.sms_opt_out
                                    const isSelected = selectedCustomerIds.has(c.id)
                                    return (
                                      <div
                                        key={c.id}
                                        className={`flex items-center gap-3 px-3 py-2 text-xs ${isEligible ? "hover:bg-white/[0.03] cursor-pointer" : "opacity-60"}`}
                                        onClick={() => {
                                          if (!isEligible) return
                                          const next = new Set(selectedCustomerIds)
                                          if (isSelected) next.delete(c.id)
                                          else next.add(c.id)
                                          setSelectedCustomerIds(next)
                                        }}
                                      >
                                        {stage.sequence && (
                                          <Checkbox
                                            checked={isSelected}
                                            disabled={!isEligible}
                                            onCheckedChange={() => {
                                              if (!isEligible) return
                                              const next = new Set(selectedCustomerIds)
                                              if (isSelected) next.delete(c.id)
                                              else next.add(c.id)
                                              setSelectedCustomerIds(next)
                                            }}
                                          />
                                        )}
                                        <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-4 gap-2">
                                          <span className="truncate font-medium">{c.first_name} {c.last_name}</span>
                                          <span className="text-muted-foreground hidden md:block">{c.phone_number}</span>
                                          <span className="text-muted-foreground truncate hidden md:block">{c.email || "—"}</span>
                                          <span className="flex items-center gap-1">
                                            {c.retargeting_stopped_reason === "converted" ? (
                                              <Badge className="text-[10px] bg-green-500/20 text-green-400 border-green-500/30">Converted</Badge>
                                            ) : c.retargeting_stopped_reason === "completed" ? (
                                              <Badge variant="outline" className="text-[10px]">Done</Badge>
                                            ) : c.retargeting_sequence ? (
                                              <>
                                                <Badge className="text-[10px] bg-blue-500/20 text-blue-400 border-blue-500/30">
                                                  Step {c.retargeting_step}/{SEQUENCE_PREVIEWS[c.retargeting_sequence]?.steps.length || 3}
                                                </Badge>
                                                <button
                                                  onClick={(e) => { e.stopPropagation(); cancelRetargeting([c.id]) }}
                                                  className="p-0.5 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-colors"
                                                  title="Cancel sequence"
                                                >
                                                  <X className="h-3 w-3" />
                                                </button>
                                                <button
                                                  onClick={(e) => { e.stopPropagation(); markAsLost([c.id]) }}
                                                  className="p-0.5 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-colors"
                                                  title="Mark as bad experience"
                                                >
                                                  <Ban className="h-3 w-3" />
                                                </button>
                                              </>
                                            ) : c.sms_opt_out ? (
                                              <Badge className="text-[10px] bg-red-500/20 text-red-400 border-red-500/30">Opted Out</Badge>
                                            ) : !c.phone_number ? (
                                              <span className="text-muted-foreground text-[10px]">No phone</span>
                                            ) : (
                                              <span className="flex items-center gap-1">
                                                <span className="text-muted-foreground text-[10px]">Eligible</span>
                                                <button
                                                  onClick={(e) => { e.stopPropagation(); markAsLost([c.id]) }}
                                                  className="p-0.5 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-colors"
                                                  title="Mark as bad experience"
                                                >
                                                  <Ban className="h-3 w-3" />
                                                </button>
                                              </span>
                                            )}
                                          </span>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>

                              {/* Action buttons + preview toggle */}
                              {stage.sequence && (
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 text-xs"
                                      onClick={() => setShowPreview(showPreview === stage.sequence ? null : stage.sequence!)}
                                    >
                                      <Eye className="h-3 w-3 mr-1.5" />
                                      {showPreview === stage.sequence ? "Hide" : "Preview"} Messages
                                    </Button>
                                    {selectedCustomerIds.size > 0 && (
                                      <>
                                        <Button
                                          size="sm"
                                          className="h-8 text-xs"
                                          disabled={enrolling !== null}
                                          onClick={() => enrollSegment(stage.sequence!, Array.from(selectedCustomerIds))}
                                        >
                                          {enrolling === stage.sequence ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Play className="h-3 w-3 mr-1.5" />}
                                          Start for {selectedCustomerIds.size} Selected
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-8 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
                                          disabled={cancelling}
                                          onClick={() => markAsLost(Array.from(selectedCustomerIds))}
                                        >
                                          {cancelling ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Ban className="h-3 w-3 mr-1.5" />}
                                          Bad Experience ({selectedCustomerIds.size})
                                        </Button>
                                      </>
                                    )}
                                    {eligible > 0 && (
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        className="h-8 text-xs"
                                        disabled={enrolling !== null}
                                        onClick={() => enrollSegment(stage.sequence!)}
                                      >
                                        {enrolling === stage.sequence && selectedCustomerIds.size === 0 ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Users className="h-3 w-3 mr-1.5" />}
                                        Start All ({eligible})
                                      </Button>
                                    )}
                                    {(() => {
                                      const activeInSequence = stageCustomers.filter(c => c.retargeting_sequence && !c.retargeting_stopped_reason)
                                      return activeInSequence.length > 0 ? (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-8 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
                                          disabled={cancelling}
                                          onClick={() => cancelRetargeting(activeInSequence.map(c => c.id))}
                                        >
                                          {cancelling ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <X className="h-3 w-3 mr-1.5" />}
                                          Cancel All Active ({activeInSequence.length})
                                        </Button>
                                      ) : null
                                    })()}
                                  </div>

                                  {/* Sequence preview */}
                                  {showPreview === stage.sequence && SEQUENCE_PREVIEWS[stage.sequence] && (
                                    <div className="border border-zinc-700/50 rounded-lg bg-zinc-900/50 overflow-hidden">
                                      <div className="px-4 py-2.5 border-b border-zinc-700/50 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <MessageSquare className="h-4 w-4 text-blue-400" />
                                          <span className="text-sm font-medium">Message Sequence</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs text-muted-foreground">{SEQUENCE_PREVIEWS[stage.sequence].summary}</span>
                                          <div className="flex rounded-md border border-zinc-700 overflow-hidden text-[10px]">
                                            <button
                                              className={`px-2 py-0.5 ${previewVariant === 'a' ? 'bg-blue-500/20 text-blue-400' : 'text-muted-foreground hover:bg-zinc-800'}`}
                                              onClick={() => setPreviewVariant('a')}
                                            >
                                              A
                                            </button>
                                            <button
                                              className={`px-2 py-0.5 border-l border-zinc-700 ${previewVariant === 'b' ? 'bg-purple-500/20 text-purple-400' : 'text-muted-foreground hover:bg-zinc-800'}`}
                                              onClick={() => setPreviewVariant('b')}
                                            >
                                              B
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                      <div className="divide-y divide-zinc-800/50">
                                        {SEQUENCE_PREVIEWS[stage.sequence].steps.map((s) => (
                                          <div key={s.step} className="px-4 py-3">
                                            <div className="flex items-center gap-2 mb-1.5">
                                              <Badge variant="outline" className="text-[10px] font-mono">Step {s.step}</Badge>
                                              <span className="text-[10px] text-muted-foreground">{s.delay}</span>
                                              <span className="text-[10px] text-blue-400">{s.template}</span>
                                              <Badge className={`text-[9px] ${previewVariant === 'a' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'bg-purple-500/20 text-purple-400 border-purple-500/30'}`}>
                                                Variant {previewVariant.toUpperCase()}
                                              </Badge>
                                            </div>
                                            <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-800/50 rounded px-3 py-2 italic">
                                              &ldquo;{previewVariant === 'a' ? s.a : s.b}&rdquo;
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                      <div className="px-4 py-2.5 border-t border-zinc-700/50 bg-emerald-500/5">
                                        <p className="text-[11px] text-emerald-400">
                                          Auto-stops if the customer books a job during the sequence. Each customer is randomly assigned variant A or B.
                                        </p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* A/B Test Results */}
      <Card>
        <CardHeader className="cursor-pointer" onClick={() => { setAbExpanded(!abExpanded); if (!abExpanded && Object.keys(abResults).length === 0) fetchAbResults() }}>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-5 w-5" />
                A/B Test Results
              </CardTitle>
              <CardDescription>Compare variant A vs B performance across retargeting sequences</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {abLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {abExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>
        {abExpanded && (
          <CardContent>
            {Object.keys(abResults).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No A/B data yet. Enroll customers in retargeting sequences to start collecting data.</p>
            ) : (
              <div className="space-y-4">
                {Object.entries(abResults).map(([seq, variants]) => {
                  const stageInfo = PIPELINE_STAGES.find(s => s.key === seq)
                  const a = variants.a || { enrolled: 0, replied: 0, converted: 0 }
                  const b = variants.b || { enrolled: 0, replied: 0, converted: 0 }
                  const aReplyRate = a.enrolled > 0 ? Math.round((a.replied / a.enrolled) * 100) : 0
                  const bReplyRate = b.enrolled > 0 ? Math.round((b.replied / b.enrolled) * 100) : 0
                  const aConvRate = a.enrolled > 0 ? Math.round((a.converted / a.enrolled) * 100) : 0
                  const bConvRate = b.enrolled > 0 ? Math.round((b.converted / b.enrolled) * 100) : 0
                  return (
                    <div key={seq} className="border border-zinc-800 rounded-lg overflow-hidden">
                      <div className="px-4 py-2 bg-zinc-900/50 border-b border-zinc-800">
                        <span className="text-sm font-medium">{stageInfo?.label || seq.replace(/_/g, " ")}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-px text-xs">
                        <div className="px-3 py-2 bg-zinc-900/30 text-muted-foreground font-medium"></div>
                        <div className="px-3 py-2 bg-zinc-900/30 text-muted-foreground font-medium text-center">Enrolled</div>
                        <div className="px-3 py-2 bg-zinc-900/30 text-muted-foreground font-medium text-center">Replied</div>
                        <div className="px-3 py-2 bg-zinc-900/30 text-muted-foreground font-medium text-center">Converted</div>
                        <div className="px-3 py-2 font-medium text-blue-400">Variant A</div>
                        <div className="px-3 py-2 text-center">{a.enrolled}</div>
                        <div className="px-3 py-2 text-center">{a.replied} <span className="text-muted-foreground">({aReplyRate}%)</span></div>
                        <div className="px-3 py-2 text-center">{a.converted} <span className="text-muted-foreground">({aConvRate}%)</span></div>
                        <div className="px-3 py-2 font-medium text-purple-400">Variant B</div>
                        <div className="px-3 py-2 text-center">{b.enrolled}</div>
                        <div className="px-3 py-2 text-center">{b.replied} <span className="text-muted-foreground">({bReplyRate}%)</span></div>
                        <div className="px-3 py-2 text-center">{b.converted} <span className="text-muted-foreground">({bConvRate}%)</span></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Automation Settings (collapsible) */}
      <Card>
        <CardHeader
          className="cursor-pointer"
          onClick={() => setSettingsExpanded(!settingsExpanded)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings className="h-5 w-5" />
              Automation Settings
            </CardTitle>
            {settingsExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </CardHeader>
        {settingsExpanded && (
          <CardContent className="space-y-6">
            {/* Seasonal Reminders Toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${settings.seasonal_reminders_enabled ? "bg-green-500/10" : "bg-zinc-500/10"}`}>
                  <Megaphone className={`h-5 w-5 ${settings.seasonal_reminders_enabled ? "text-green-500" : "text-zinc-500"}`} />
                </div>
                <div>
                  <div className="font-medium">Seasonal Reminders</div>
                  <div className="text-sm text-muted-foreground">Auto-send SMS campaigns on scheduled dates</div>
                </div>
              </div>
              <Switch
                checked={settings.seasonal_reminders_enabled}
                onCheckedChange={(checked) => updateSettings({ seasonal_reminders_enabled: checked })}
                disabled={saving}
              />
            </div>

            <div className="border-t border-zinc-800" />

            {/* Frequency Nudge */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${settings.frequency_nudge_enabled ? "bg-blue-500/10" : "bg-zinc-500/10"}`}>
                    <Clock className={`h-5 w-5 ${settings.frequency_nudge_enabled ? "text-blue-500" : "text-zinc-500"}`} />
                  </div>
                  <div>
                    <div className="font-medium">Service Frequency Nudges</div>
                    <div className="text-sm text-muted-foreground">Remind customers when due for repeat service</div>
                  </div>
                </div>
                <Switch
                  checked={settings.frequency_nudge_enabled}
                  onCheckedChange={(checked) => updateSettings({ frequency_nudge_enabled: checked })}
                  disabled={saving}
                />
              </div>
              <div className="flex items-center justify-between pl-12">
                <Label className="text-sm text-muted-foreground">Days after last service</Label>
                <Input
                  type="number"
                  min={7}
                  max={90}
                  value={settings.frequency_nudge_days}
                  onChange={(e) => updateSettings({ frequency_nudge_days: parseInt(e.target.value) || 21 })}
                  disabled={saving}
                  className="w-20 text-center"
                />
              </div>
              <div className="flex items-center justify-between pl-12">
                <Label className="text-sm text-muted-foreground">Review-only follow-up (no invoice)</Label>
                <Switch
                  checked={settings.review_only_followup_enabled}
                  onCheckedChange={(checked) => updateSettings({ review_only_followup_enabled: checked })}
                  disabled={saving}
                />
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      </>}

      {/* CSV Import Modal */}
      <Dialog open={showImportModal} onOpenChange={setShowImportModal}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Customers
            </DialogTitle>
            <DialogDescription>
              Upload a CSV file to bulk-add customers and auto-start retargeting sequences.
            </DialogDescription>
          </DialogHeader>

          {importResult ? (
            <div className="space-y-3">
              <div className="p-4 rounded-lg border border-green-500/30 bg-green-500/10 text-sm space-y-1">
                <p className="text-green-400 font-medium">Import complete</p>
                <p className="text-green-400">{importResult.imported} imported, {importResult.enrolled} enrolled in retargeting, {importResult.skipped} skipped</p>
              </div>
              {importResult.errors && importResult.errors.length > 0 && (
                <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-400 max-h-32 overflow-y-auto space-y-0.5">
                  {importResult.errors.map((err, i) => <p key={i}>{err}</p>)}
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => { setShowImportModal(false); setCsvRows([]); setImportResult(null) }}>Done</Button>
              </DialogFooter>
            </div>
          ) : csvRows.length === 0 ? (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-zinc-700 rounded-lg p-8 text-center">
                <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-3">Drop a CSV file or click to browse</p>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  id="csv-upload"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleCsvFile(file)
                    e.target.value = ""
                  }}
                />
                <Button variant="outline" size="sm" onClick={() => document.getElementById("csv-upload")?.click()}>
                  Choose File
                </Button>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-medium">Expected format:</p>
                <code className="block bg-zinc-900 rounded px-2 py-1">name,phone,email,stage</code>
                <code className="block bg-zinc-900 rounded px-2 py-1">John Smith,555-123-4567,john@email.com,quoted_not_booked</code>
                <p>Stages: unresponsive, quoted_not_booked, one_time, lapsed, new_lead, lost</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Preview */}
              <div>
                <p className="text-sm font-medium mb-2">{csvRows.length} rows detected</p>
                <div className="border border-zinc-800 rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-zinc-900/50 border-b border-zinc-800">
                        {csvHeaders.slice(0, 6).map(h => (
                          <th key={h} className="px-2 py-1.5 text-left text-muted-foreground font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {csvRows.slice(0, 3).map((row, i) => (
                        <tr key={i}>
                          {csvHeaders.slice(0, 6).map(h => (
                            <td key={h} className="px-2 py-1.5 truncate max-w-[120px]">{row[h] || "—"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {csvRows.length > 3 && (
                    <p className="text-[10px] text-muted-foreground px-2 py-1 bg-zinc-900/30">...and {csvRows.length - 3} more rows</p>
                  )}
                </div>
              </div>

              {/* Column mapping */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Column Mapping</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {(["first_name", "last_name", "phone", "email", "address", "stage"] as const).map(field => (
                    <div key={field} className="flex items-center gap-2">
                      <Label className="text-xs w-20 shrink-0 capitalize">{field.replace("_", " ")}</Label>
                      <select
                        value={csvMapping[field]}
                        onChange={(e) => setCsvMapping({ ...csvMapping, [field]: e.target.value })}
                        className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
                        aria-label={`Map ${field} column`}
                      >
                        <option value="">— skip —</option>
                        {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Visual segment picker */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Assign to retargeting sequence</p>
                <p className="text-xs text-muted-foreground">
                  {csvMapping.stage ? "Default for rows without a valid stage column value" : "All imported customers will enter this sequence"}
                </p>
                <div className="grid grid-cols-1 gap-1.5">
                  {PIPELINE_STAGES.map(stage => {
                    const Icon = stage.icon
                    const seqInfo = SEQUENCE_PREVIEWS[stage.sequence]
                    const isSelected = csvDefaultStage === stage.key
                    return (
                      <button
                        key={stage.key}
                        onClick={() => setCsvDefaultStage(stage.key)}
                        className={`p-2.5 rounded-lg border text-left flex items-center gap-3 transition-colors ${
                          isSelected
                            ? `${stage.border} ${stage.bg}`
                            : "border-zinc-800 hover:border-zinc-700"
                        }`}
                      >
                        <Icon className={`h-4 w-4 ${stage.color} shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{stage.label}</span>
                            {seqInfo && <Badge variant="outline" className="text-[10px] text-muted-foreground border-zinc-700">{seqInfo.summary}</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">{stage.description}</p>
                        </div>
                        {isSelected && <CheckCircle className="h-4 w-4 text-primary shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Auto-enroll checkbox */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="auto-enroll"
                  checked={csvAutoEnroll}
                  onCheckedChange={(checked) => setCsvAutoEnroll(checked === true)}
                />
                <Label htmlFor="auto-enroll" className="text-xs">Auto-start retargeting sequences after import</Label>
              </div>

              {/* Import preview summary */}
              {importPreview && (
                <div className="p-3 rounded-lg border border-blue-500/20 bg-blue-500/5 text-sm">
                  {importPreview.type === "breakdown" ? (
                    <>
                      <p className="font-medium text-blue-400 text-xs mb-1">Import Preview</p>
                      <div className="space-y-0.5">
                        {Object.entries(importPreview.breakdown).map(([stage, count]) => (
                          <p key={stage} className="text-xs">
                            {count} &rarr; {PIPELINE_STAGES.find(s => s.key === stage)?.label || stage.replace(/_/g, " ")}
                          </p>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-blue-400">
                      Ready to import: {importPreview.total} &rarr; {PIPELINE_STAGES.find(s => s.key === importPreview.stage)?.label}
                      {csvAutoEnroll ? ", auto-start sequences" : ""}
                    </p>
                  )}
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => { setCsvRows([]); setCsvHeaders([]) }}>
                  Back
                </Button>
                <Button
                  size="sm"
                  disabled={importing || !csvMapping.phone}
                  onClick={doImport}
                >
                  {importing ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Upload className="h-3 w-3 mr-1.5" />}
                  Import {csvRows.length} Customer{csvRows.length !== 1 ? "s" : ""}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
