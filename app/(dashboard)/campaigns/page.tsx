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
  Upload,
  Plus,
  Calendar,
  Clock,
  Edit,
  Trash2,
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
  Repeat,
  TimerOff,
  Ban,
  Zap,
  Eye,
  MessageSquare,
} from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"

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

const SEGMENT_LABELS: Record<SeasonalCampaign["target_segment"], string> = {
  all: "All Customers",
  inactive_30: "Inactive 30+ days",
  inactive_60: "Inactive 60+ days",
  inactive_90: "Inactive 90+ days",
  completed_customers: "Past Completed",
}

interface ParsedLead {
  first_name: string
  last_name: string
  phone_number: string
  email: string | null
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
  created_at: string
}

// Sequence preview data (mirrors lib/scheduler.ts RETARGETING_SEQUENCES + RETARGETING_TEMPLATES)
const SEQUENCE_PREVIEWS: Record<string, { steps: { step: number; delay: string; template: string; message: string }[]; summary: string }> = {
  unresponsive: {
    summary: "3 messages over 7 days",
    steps: [
      { step: 1, delay: "Immediately", template: "9-Word Reactivation", message: "Hi {name}, are you still looking for {service}?" },
      { step: 2, delay: "Day 3", template: "Value Nudge", message: "Hi {name}, just checking in — we have availability this week for {service}. Want me to get you on the schedule?" },
      { step: 3, delay: "Day 7", template: "Closing File", message: "Hi {name}, we're updating our records. Should I close out your file, or are you still interested in {service}? No pressure either way." },
    ],
  },
  quoted_not_booked: {
    summary: "4 messages over 7 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Quote Follow-up", message: "Hi {name}, following up on your {service} quote. Any questions? Happy to adjust — just reply here." },
      { step: 2, delay: "Day 2", template: "Question-Based", message: "Hi {name}, was there anything holding you back from booking? We're happy to work with your schedule or budget." },
      { step: 3, delay: "Day 5", template: "Limited Time", message: "Hi {name}, we have a couple openings this week for {service}. Want me to hold a spot for you?" },
      { step: 4, delay: "Day 7", template: "Closing File", message: "Hi {name}, we're updating our records. Should I close out your file, or are you still interested in {service}? No pressure either way." },
    ],
  },
  one_time: {
    summary: "3 messages over 14 days",
    steps: [
      { step: 1, delay: "Immediately", template: "We Miss You", message: "Hi {name}! It's been a while since we took care of your {service}. Ready for another round? Reply to book." },
      { step: 2, delay: "Day 7", template: "Seasonal Nudge", message: "Hi {name}, the season is changing — perfect time for {service}. Want us to get you scheduled?" },
      { step: 3, delay: "Day 14", template: "Closing File", message: "Hi {name}, we're updating our records. Should I close out your file, or are you still interested in {service}? No pressure either way." },
    ],
  },
  lapsed: {
    summary: "3 messages over 10 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Feedback Ask", message: "Hi {name}, we noticed it's been a while. Was there anything we could've done better? We'd love to earn your business back." },
      { step: 2, delay: "Day 5", template: "Incentive Offer", message: "Hi {name}, we'd love to have you back. Reply YES and we'll get you priority scheduling for your next {service}." },
      { step: 3, delay: "Day 10", template: "Closing File", message: "Hi {name}, we're updating our records. Should I close out your file, or are you still interested in {service}? No pressure either way." },
    ],
  },
}

const PIPELINE_STAGES = [
  { key: "unresponsive", label: "Unresponsive", description: "Texted/called, no reply", icon: UserX, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", sequence: "unresponsive" as const },
  { key: "quoted_not_booked", label: "Quoted, Not Booked", description: "Got a quote, didn't pay", icon: FileQuestion, color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", sequence: "quoted_not_booked" as const },
  { key: "one_time", label: "One-Time", description: "Booked once, hasn't returned", icon: UserCheck, color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20", sequence: "one_time" as const },
  { key: "lapsed", label: "Lapsed", description: "Was active, gone 60+ days", icon: TimerOff, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20", sequence: "lapsed" as const },
  { key: "new_lead", label: "New Leads", description: "Just arrived, not yet contacted", icon: Zap, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", sequence: null },
  { key: "repeat", label: "Repeat", description: "Multiple bookings — loyal", icon: Repeat, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20", sequence: null },
  { key: "active", label: "Active", description: "Has upcoming jobs", icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", sequence: null },
  { key: "lost", label: "Lost", description: "Said no / bad experience", icon: Ban, color: "text-zinc-500", bg: "bg-zinc-500/10", border: "border-zinc-500/20", sequence: null },
]

const SOURCE_OPTIONS = [
  { value: "meta", label: "Meta (Facebook/Instagram)" },
  { value: "thumbtack", label: "Thumbtack" },
  { value: "google", label: "Google" },
  { value: "manual", label: "Other" },
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

  // Lead import state
  const [importSource, setImportSource] = useState("meta")
  const [importText, setImportText] = useState("")
  const [importParsing, setImportParsing] = useState(false)
  const [importParsed, setImportParsed] = useState<ParsedLead[] | null>(null)
  const [importCreating, setImportCreating] = useState(false)
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState<SeasonalCampaign | null>(null)
  const [form, setForm] = useState({
    name: "",
    message: "",
    start_date: "",
    end_date: "",
    target_segment: "all" as SeasonalCampaign["target_segment"],
    enabled: true,
  })

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

  useEffect(() => { fetchSettings(); fetchPipeline() }, [])

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

  function openModal(campaign?: SeasonalCampaign) {
    if (campaign) {
      setEditingCampaign(campaign)
      setForm({
        name: campaign.name,
        message: campaign.message,
        start_date: campaign.start_date,
        end_date: campaign.end_date,
        target_segment: campaign.target_segment,
        enabled: campaign.enabled,
      })
    } else {
      setEditingCampaign(null)
      setForm({ name: "", message: "", start_date: "", end_date: "", target_segment: "all", enabled: true })
    }
    setShowModal(true)
  }

  async function saveCampaign() {
    if (!settings || !form.name || !form.message || !form.start_date || !form.end_date) return

    const campaigns = [...settings.seasonal_campaigns]

    if (editingCampaign) {
      const idx = campaigns.findIndex((c) => c.id === editingCampaign.id)
      if (idx >= 0) {
        campaigns[idx] = { ...campaigns[idx], ...form }
      }
    } else {
      campaigns.push({
        id: crypto.randomUUID(),
        ...form,
        created_at: new Date().toISOString(),
        last_sent_at: null,
      })
    }

    await updateSettings({ seasonal_campaigns: campaigns })
    setShowModal(false)
  }

  async function deleteCampaign(id: string) {
    if (!settings) return
    await updateSettings({
      seasonal_campaigns: settings.seasonal_campaigns.filter((c) => c.id !== id),
    })
  }

  async function toggleCampaign(id: string) {
    if (!settings) return
    const campaigns = [...settings.seasonal_campaigns]
    const idx = campaigns.findIndex((c) => c.id === id)
    if (idx >= 0) {
      campaigns[idx] = { ...campaigns[idx], enabled: !campaigns[idx].enabled }
      await updateSettings({ seasonal_campaigns: campaigns })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading campaigns...
      </div>
    )
  }

  if (error && !settings) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 mb-4">{error}</p>
        <Button onClick={fetchSettings}>Retry</Button>
      </div>
    )
  }

  if (!settings) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold text-foreground">
            <Target className="h-7 w-7 text-primary" />
            Retargeting
          </h1>
          <p className="text-sm text-muted-foreground">Import leads &amp; manage automated re-engagement</p>
        </div>
        <Button variant="ghost" size="icon" onClick={fetchSettings} disabled={loading}>
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Import Leads */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Leads
          </CardTitle>
          <CardDescription>Paste leads from Meta, Thumbtack, Google, etc. They&apos;ll be auto-enrolled in the 5-stage followup sequence.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!importParsed && !importResult && (
            <>
              <div className="space-y-2">
                <Label>Source</Label>
                <select
                  value={importSource}
                  onChange={(e) => setImportSource(e.target.value)}
                  aria-label="Lead source"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  {SOURCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Lead Data</Label>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={6}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
                  placeholder={"John Smith 555-123-4567 john@email.com\nJane Doe (555) 987-6543 jane@email.com"}
                />
                <p className="text-xs text-muted-foreground">Paste in any format — names, phones, emails. AI will parse it.</p>
              </div>
              <Button
                onClick={async () => {
                  setImportParsing(true)
                  try {
                    const res = await fetch("/api/actions/batch-parse-customers", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ text: importText }),
                    })
                    const json = await res.json()
                    if (json.success && json.customers?.length > 0) {
                      setImportParsed(json.customers)
                    } else {
                      setError(json.error || "No leads could be parsed from the text")
                    }
                  } catch {
                    setError("Failed to parse leads")
                  } finally {
                    setImportParsing(false)
                  }
                }}
                disabled={importParsing || !importText.trim()}
              >
                {importParsing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                {importParsing ? "Parsing..." : "Parse Leads"}
              </Button>
            </>
          )}

          {importParsed && !importResult && (
            <>
              <p className="text-sm text-muted-foreground">{importParsed.length} lead{importParsed.length !== 1 ? "s" : ""} found. Review and edit before importing:</p>
              <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                {importParsed.map((l, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2 text-xs">
                    <input
                      value={l.first_name}
                      onChange={(e) => { const u = [...importParsed]; u[i] = { ...u[i], first_name: e.target.value }; setImportParsed(u) }}
                      className="px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="First"
                    />
                    <input
                      value={l.last_name}
                      onChange={(e) => { const u = [...importParsed]; u[i] = { ...u[i], last_name: e.target.value }; setImportParsed(u) }}
                      className="px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="Last"
                    />
                    <input
                      value={l.phone_number}
                      onChange={(e) => { const u = [...importParsed]; u[i] = { ...u[i], phone_number: e.target.value }; setImportParsed(u) }}
                      className="px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="Phone"
                    />
                    <div className="flex gap-1">
                      <input
                        value={l.email || ""}
                        onChange={(e) => { const u = [...importParsed]; u[i] = { ...u[i], email: e.target.value || null }; setImportParsed(u) }}
                        className="flex-1 px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="Email"
                      />
                      <button
                        onClick={() => setImportParsed(importParsed.filter((_, j) => j !== i))}
                        className="px-1.5 text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setImportParsed(null)}>Back</Button>
                <Button
                  onClick={async () => {
                    setImportCreating(true)
                    try {
                      const res = await fetch("/api/actions/batch-create-leads", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          leads: importParsed.map((l) => ({ ...l, source: importSource })),
                        }),
                      })
                      const json = await res.json()
                      if (json.success) {
                        setImportResult({ created: json.created, skipped: json.skipped, errors: json.errors || [] })
                      } else {
                        setError(json.error || "Failed to import leads")
                      }
                    } catch {
                      setError("Failed to import leads")
                    } finally {
                      setImportCreating(false)
                    }
                  }}
                  disabled={importCreating || importParsed.length === 0}
                >
                  {importCreating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  {importCreating ? "Importing..." : `Import & Start Followup (${importParsed.length})`}
                </Button>
              </div>
            </>
          )}

          {importResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-400">
                <CheckCircle className="h-4 w-4" />
                {importResult.created} lead{importResult.created !== 1 ? "s" : ""} imported, followup sequences started.
                {importResult.skipped > 0 && <span className="text-muted-foreground">({importResult.skipped} skipped — already exist)</span>}
              </div>
              {importResult.errors.length > 0 && (
                <div className="text-xs text-red-400 space-y-1">
                  {importResult.errors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setImportResult(null)
                  setImportParsed(null)
                  setImportText("")
                }}
              >
                Import More
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Customer Pipeline */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Customer Pipeline
              </CardTitle>
              <CardDescription>Every customer auto-classified by lifecycle stage. Click a segment to see customers and start retargeting sequences.</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={fetchPipeline} disabled={pipelineLoading}>
              <RefreshCcw className={`h-4 w-4 ${pipelineLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {enrollResult && (
            <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/10 text-sm text-green-400 flex items-center gap-2 mb-3">
              <CheckCircle className="h-4 w-4" />
              {enrollResult.enrolled} customer{enrollResult.enrolled !== 1 ? "s" : ""} enrolled in {enrollResult.segment.replace(/_/g, " ")} retargeting sequence.
            </div>
          )}
          {PIPELINE_STAGES.map((stage) => {
            const data = pipeline[stage.key]
            const total = data?.total || 0
            const inSeq = data?.in_sequence || 0
            const converted = data?.converted || 0
            const isExpanded = expandedStage === stage.key
            const Icon = stage.icon
            const eligible = total - inSeq - converted

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
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{stage.label}</span>
                      <Badge variant="outline" className="text-xs">{total}</Badge>
                      {inSeq > 0 && <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">{inSeq} in sequence</Badge>}
                      {converted > 0 && <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">{converted} converted</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{stage.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {stage.sequence && eligible > 0 && !isExpanded && (
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
                            const eligibleCustomers = stageCustomers.filter(c => !c.retargeting_sequence && c.phone_number)
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
                              const isEligible = !c.retargeting_sequence && !!c.phone_number
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
                                    <span>
                                      {c.retargeting_stopped_reason === "converted" ? (
                                        <Badge className="text-[10px] bg-green-500/20 text-green-400 border-green-500/30">Converted</Badge>
                                      ) : c.retargeting_stopped_reason === "completed" ? (
                                        <Badge variant="outline" className="text-[10px]">Done</Badge>
                                      ) : c.retargeting_sequence ? (
                                        <Badge className="text-[10px] bg-blue-500/20 text-blue-400 border-blue-500/30">
                                          Step {c.retargeting_step}/{c.retargeting_sequence === "quoted_not_booked" ? 4 : 3}
                                        </Badge>
                                      ) : !c.phone_number ? (
                                        <span className="text-muted-foreground text-[10px]">No phone</span>
                                      ) : (
                                        <span className="text-muted-foreground text-[10px]">Eligible</span>
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
                                <Button
                                  size="sm"
                                  className="h-8 text-xs"
                                  disabled={enrolling !== null}
                                  onClick={() => enrollSegment(stage.sequence!, Array.from(selectedCustomerIds))}
                                >
                                  {enrolling === stage.sequence ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Play className="h-3 w-3 mr-1.5" />}
                                  Start for {selectedCustomerIds.size} Selected
                                </Button>
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
                            </div>

                            {/* Sequence preview */}
                            {showPreview === stage.sequence && SEQUENCE_PREVIEWS[stage.sequence] && (
                              <div className="border border-zinc-700/50 rounded-lg bg-zinc-900/50 overflow-hidden">
                                <div className="px-4 py-2.5 border-b border-zinc-700/50 flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <MessageSquare className="h-4 w-4 text-blue-400" />
                                    <span className="text-sm font-medium">Message Sequence</span>
                                  </div>
                                  <span className="text-xs text-muted-foreground">{SEQUENCE_PREVIEWS[stage.sequence].summary}</span>
                                </div>
                                <div className="divide-y divide-zinc-800/50">
                                  {SEQUENCE_PREVIEWS[stage.sequence].steps.map((s) => (
                                    <div key={s.step} className="px-4 py-3">
                                      <div className="flex items-center gap-2 mb-1.5">
                                        <Badge variant="outline" className="text-[10px] font-mono">Step {s.step}</Badge>
                                        <span className="text-[10px] text-muted-foreground">{s.delay}</span>
                                        <span className="text-[10px] text-blue-400">· {s.template}</span>
                                      </div>
                                      <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-800/50 rounded px-3 py-2 italic">
                                        &ldquo;{s.message}&rdquo;
                                      </p>
                                    </div>
                                  ))}
                                </div>
                                <div className="px-4 py-2.5 border-t border-zinc-700/50 bg-emerald-500/5">
                                  <p className="text-[11px] text-emerald-400">
                                    Auto-stops if the customer books a job during the sequence.
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
        </CardContent>
      </Card>

      {/* Settings Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Seasonal Reminders Toggle */}
        <Card>
          <CardContent className="pt-6">
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
          </CardContent>
        </Card>

        {/* Frequency Nudge */}
        <Card>
          <CardContent className="pt-6 space-y-3">
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
          </CardContent>
        </Card>
      </div>

      {/* Campaign List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Seasonal Campaigns</CardTitle>
              <CardDescription>SMS campaigns sent to your customers during specific date ranges</CardDescription>
            </div>
            <Button onClick={() => openModal()} disabled={saving}>
              <Plus className="h-4 w-4 mr-1" />
              Add Campaign
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {settings.seasonal_campaigns.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
              <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No campaigns yet</p>
              <p className="text-sm mt-1">Create a seasonal campaign to start reaching your customers</p>
              <Button className="mt-4" onClick={() => openModal()}>
                <Plus className="h-4 w-4 mr-1" />
                Create Your First Campaign
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {settings.seasonal_campaigns.map((campaign) => {
                const now = new Date()
                const start = new Date(campaign.start_date)
                const end = new Date(campaign.end_date)
                const isActive = campaign.enabled && now >= start && now <= end
                const isPast = now > end
                const isFuture = now < start

                return (
                  <div
                    key={campaign.id}
                    className={`p-4 rounded-lg border ${
                      isActive
                        ? "border-green-500/30 bg-green-500/5"
                        : isPast
                        ? "border-zinc-500/20 bg-zinc-500/5 opacity-60"
                        : "border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{campaign.name}</span>
                          {isActive && <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">Active</Badge>}
                          {isPast && <Badge variant="outline" className="text-xs opacity-60">Ended</Badge>}
                          {isFuture && <Badge variant="outline" className="text-xs text-blue-400 border-blue-500/30">Scheduled</Badge>}
                          {!campaign.enabled && <Badge variant="outline" className="text-xs text-orange-400 border-orange-500/30">Paused</Badge>}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {campaign.start_date} to {campaign.end_date}
                          </span>
                          <span>{SEGMENT_LABELS[campaign.target_segment]}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">{campaign.message}</p>
                        {campaign.last_sent_at && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Last sent: {new Date(campaign.last_sent_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Switch
                          checked={campaign.enabled}
                          onCheckedChange={() => toggleCampaign(campaign.id)}
                          disabled={saving}
                        />
                        <Button variant="ghost" size="icon" onClick={() => openModal(campaign)} disabled={saving}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-300" onClick={() => deleteCampaign(campaign.id)} disabled={saving}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Campaign Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-lg mx-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Megaphone className="h-5 w-5" />
                  {editingCampaign ? "Edit Campaign" : "New Campaign"}
                </CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowModal(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <CardDescription>
                {editingCampaign ? "Update this seasonal campaign" : "Create a new SMS campaign to reach your customers"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Campaign Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Spring Window Cleaning Special"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>SMS Message *</Label>
                  <span className={`text-xs ${form.message.length > 160 ? "text-red-400" : "text-muted-foreground"}`}>
                    {form.message.length}/160
                  </span>
                </div>
                <textarea
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  placeholder="Spring is here! Ready to get your windows sparkling? Reply YES for 15% off your next cleaning!"
                  maxLength={160}
                  rows={3}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Customer name is auto-prepended (e.g., &quot;Hi John! &quot; + your message)
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date *</Label>
                  <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>End Date *</Label>
                  <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Target Customers</Label>
                <select
                  value={form.target_segment}
                  onChange={(e) => setForm({ ...form, target_segment: e.target.value as SeasonalCampaign["target_segment"] })}
                  aria-label="Target customer segment"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="all">All Customers</option>
                  <option value="inactive_30">Inactive 30+ days</option>
                  <option value="inactive_60">Inactive 60+ days</option>
                  <option value="inactive_90">Inactive 90+ days</option>
                  <option value="completed_customers">Past Completed Customers</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <Label>Enabled</Label>
                <Switch checked={form.enabled} onCheckedChange={(checked) => setForm({ ...form, enabled: checked })} />
              </div>
              <div className="flex gap-2 pt-4">
                <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button
                  className="flex-1"
                  onClick={saveCampaign}
                  disabled={saving || !form.name || !form.message || !form.start_date || !form.end_date || form.message.length > 160}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  {editingCampaign ? "Save Changes" : "Create Campaign"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
