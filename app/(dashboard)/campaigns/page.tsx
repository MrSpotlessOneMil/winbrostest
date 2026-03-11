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
  Upload,
  ArrowRight,
  AlertTriangle,
} from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
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

const SEGMENT_LABELS: Record<SeasonalCampaign["target_segment"], string> = {
  all: "All Customers",
  inactive_30: "Inactive 30+ days",
  inactive_60: "Inactive 60+ days",
  inactive_90: "Inactive 90+ days",
  completed_customers: "Past Completed",
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
// Each step has variant a and b for A/B testing
const SEQUENCE_PREVIEWS: Record<string, { steps: { step: number; delay: string; template: string; a: string; b: string }[]; summary: string }> = {
  unresponsive: {
    summary: "3 messages over 7 days",
    steps: [
      { step: 1, delay: "Immediately", template: "9-Word Reactivation", a: "Hey {name}! We have a couple openings for {service} this week — want me to save you a spot?", b: "Hey {name}, quick question — are you still needing {service}? Reply YES and I'll get you on the schedule." },
      { step: 2, delay: "Day 3", template: "Value Nudge", a: "Hi {name}, just finished a job near you and thought of you! We've got one more opening this week for {service}. Want me to pencil you in?", b: "Hi {name}, we have 2 spots left this week for {service}. Want me to grab one for you before they fill up?" },
      { step: 3, delay: "Day 7", template: "Closing File", a: "Hey {name}, last check-in from me! We'd love to have you back for {service} but no pressure. Reply YES to book, otherwise I'll stop reaching out.", b: "Hi {name}, I'm cleaning up my list — should I keep you on it for {service}, or would you rather I stop texting? Either way, no hard feelings!" },
    ],
  },
  quoted_not_booked: {
    summary: "6 messages over 14 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Quote Follow-up", a: "Hey {name}, your {service} quote is still good! Any questions or want to adjust anything? Just reply here — happy to work with you.", b: "Hi {name}, following up on your quote — I can hold your spot if you want to lock it in this week. Just say the word!" },
      { step: 2, delay: "Day 2", template: "Question-Based", a: "Hey {name}, totally get that timing matters. Is there anything we can do to make booking easier for you? We're flexible on scheduling.", b: "Hi {name}, was there something we could do differently? Happy to work around your schedule or adjust the price." },
      { step: 3, delay: "Day 4", template: "Limited Time", a: "Hey {name}, only 2 openings left this week for {service} — want me to hold one for you? They go fast!", b: "Hi {name}, we just had a cancellation and have a spot open for {service}. Want it? Reply YES to grab it." },
      { step: 4, delay: "Day 7", template: "Check-In", a: "Hey {name}, just circling back — still interested in {service}? I can work with you on timing or price. What would make this a yes?", b: "Hi {name}, wanted to make sure your quote didn't slip through the cracks. We've got availability this week — want me to book you in?" },
      { step: 5, delay: "Day 10", template: "Social Proof", a: "Hey {name}, just wrapped up {service} for a neighbor nearby and they loved it! We'd love to take care of your place too. Reply YES to book.", b: "Hi {name}, we've been busy in your area doing {service} — your neighbors are loving the results! Want us to swing by yours too?" },
      { step: 6, delay: "Day 14", template: "Closing File", a: "Hey {name}, last check-in from me! We'd love to get you booked for {service} but no pressure. Reply YES to book, otherwise I'll close out your file.", b: "Hi {name}, I'm closing out quotes this week — should I keep yours open for {service}, or would you rather I stop reaching out? Either way, no hard feelings!" },
    ],
  },
  one_time: {
    summary: "3 messages over 14 days",
    steps: [
      { step: 1, delay: "Immediately", template: "We Miss You", a: "Hey {name}! It's been a minute — your place is probably due for {service} again. Want us to swing by? Reply YES to book.", b: "Hi {name}, we were just in your area doing {service} and thought of you! Ready for another round? Just say when." },
      { step: 2, delay: "Day 7", template: "Seasonal Nudge", a: "Hey {name}, perfect time of year for {service}! We're booking up this week — want me to squeeze you in?", b: "Hi {name}, most of our customers are getting their {service} done right now. Want me to get you on the schedule too?" },
      { step: 3, delay: "Day 14", template: "Closing File", a: "Hey {name}, last check-in from me! We'd love to have you back for {service} but no pressure. Reply YES to book, otherwise I'll stop reaching out.", b: "Hi {name}, I'm cleaning up my list — should I keep you on it for {service}, or would you rather I stop texting? Either way, no hard feelings!" },
    ],
  },
  lapsed: {
    summary: "3 messages over 10 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Feedback Ask", a: "Hey {name}, real quick — was there anything we could've done better last time? We'd love another chance to impress you.", b: "Hi {name}, just checking in. If there's anything we can improve, I'd love to hear it. Either way, we'd love to have you back!" },
      { step: 2, delay: "Day 5", template: "Incentive Offer", a: "Hey {name}, we'd love to have you back! Reply YES and I'll get you priority scheduling for your next {service}.", b: "Hi {name}, we're offering priority booking to returning customers this week. Want me to put you at the top of the list for {service}?" },
      { step: 3, delay: "Day 10", template: "Closing File", a: "Hey {name}, last check-in from me! We'd love to have you back for {service} but no pressure. Reply YES to book, otherwise I'll stop reaching out.", b: "Hi {name}, I'm cleaning up my list — should I keep you on it for {service}, or would you rather I stop texting? Either way, no hard feelings!" },
    ],
  },
  new_lead: {
    summary: "3 messages over 5 days",
    steps: [
      { step: 1, delay: "Immediately", template: "9-Word Reactivation", a: "Hey {name}! We have a couple openings for {service} this week — want me to save you a spot?", b: "Hey {name}, quick question — are you still needing {service}? Reply YES and I'll get you on the schedule." },
      { step: 2, delay: "Day 2", template: "Value Nudge", a: "Hi {name}, just finished a job near you and thought of you! We've got one more opening this week for {service}. Want me to pencil you in?", b: "Hi {name}, we have 2 spots left this week for {service}. Want me to grab one for you before they fill up?" },
      { step: 3, delay: "Day 5", template: "Closing File", a: "Hey {name}, last check-in from me! We'd love to have you back for {service} but no pressure. Reply YES to book, otherwise I'll stop reaching out.", b: "Hi {name}, I'm cleaning up my list — should I keep you on it for {service}, or would you rather I stop texting? Either way, no hard feelings!" },
    ],
  },
  repeat: {
    summary: "2 messages over 7 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Seasonal Nudge", a: "Hey {name}, perfect time of year for {service}! We're booking up this week — want me to squeeze you in?", b: "Hi {name}, most of our customers are getting their {service} done right now. Want me to get you on the schedule too?" },
      { step: 2, delay: "Day 7", template: "Incentive Offer", a: "Hey {name}, we'd love to have you back! Reply YES and I'll get you priority scheduling for your next {service}.", b: "Hi {name}, we're offering priority booking to returning customers this week. Want me to put you at the top of the list for {service}?" },
    ],
  },
  active: {
    summary: "2 messages over 7 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Seasonal Nudge", a: "Hey {name}, perfect time of year for {service}! We're booking up this week — want me to squeeze you in?", b: "Hi {name}, most of our customers are getting their {service} done right now. Want me to get you on the schedule too?" },
      { step: 2, delay: "Day 7", template: "Value Nudge", a: "Hi {name}, just finished a job near you and thought of you! We've got one more opening this week for {service}. Want me to pencil you in?", b: "Hi {name}, we have 2 spots left this week for {service}. Want me to grab one for you before they fill up?" },
    ],
  },
  lost: {
    summary: "3 messages over 10 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Feedback Ask", a: "Hey {name}, real quick — was there anything we could've done better last time? We'd love another chance to impress you.", b: "Hi {name}, just checking in. If there's anything we can improve, I'd love to hear it. Either way, we'd love to have you back!" },
      { step: 2, delay: "Day 5", template: "Incentive Offer", a: "Hey {name}, we'd love to have you back! Reply YES and I'll get you priority scheduling for your next {service}.", b: "Hi {name}, we're offering priority booking to returning customers this week. Want me to put you at the top of the list for {service}?" },
      { step: 3, delay: "Day 10", template: "Closing File", a: "Hey {name}, last check-in from me! We'd love to have you back for {service} but no pressure. Reply YES to book, otherwise I'll stop reaching out.", b: "Hi {name}, I'm cleaning up my list — should I keep you on it for {service}, or would you rather I stop texting? Either way, no hard feelings!" },
    ],
  },
}

const PIPELINE_STAGES = [
  { key: "unresponsive", label: "Unresponsive", description: "Texted/called, no reply", icon: UserX, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", sequence: "unresponsive" as const },
  { key: "quoted_not_booked", label: "Quoted, Not Booked", description: "Got a quote, didn't pay", icon: FileQuestion, color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", sequence: "quoted_not_booked" as const },
  { key: "one_time", label: "One-Time", description: "Booked once, hasn't returned", icon: UserCheck, color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20", sequence: "one_time" as const },
  { key: "lapsed", label: "Lapsed", description: "Was active, gone 60+ days", icon: TimerOff, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20", sequence: "lapsed" as const },
  { key: "new_lead", label: "New Leads", description: "Completed follow-up, no response", icon: Zap, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", sequence: "new_lead" as const },
  { key: "repeat", label: "Repeat", description: "Multiple bookings — loyal", icon: Repeat, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20", sequence: "repeat" as const },
  { key: "active", label: "Active", description: "Has upcoming jobs", icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", sequence: "active" as const },
  { key: "lost", label: "Lost", description: "Said no / bad experience", icon: Ban, color: "text-zinc-500", bg: "bg-zinc-500/10", border: "border-zinc-500/20", sequence: "lost" as const },
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

    const customers = csvRows.map(row => {
      const firstName = csvMapping.first_name ? row[csvMapping.first_name] || "" : ""
      const lastName = csvMapping.last_name ? row[csvMapping.last_name] || "" : ""

      // If mapped to a single "name" field, split on first space
      let fn = firstName
      let ln = lastName
      if (firstName && !csvMapping.last_name && firstName.includes(" ")) {
        const parts = firstName.split(" ")
        fn = parts[0]
        ln = parts.slice(1).join(" ")
      }

      const stageRaw = csvMapping.stage ? row[csvMapping.stage] || "" : ""
      const validStages = ["unresponsive", "quoted_not_booked", "one_time", "lapsed"]
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
    }).filter(c => c.phone) // Skip rows without phone

    try {
      const res = await fetch("/api/actions/import-customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customers, auto_enroll: csvAutoEnroll }),
      })
      const json = await res.json()
      if (json.success) {
        setImportResult(json)
        // Refresh pipeline data
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
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold text-foreground">
            <Target className="h-7 w-7 text-primary" />
            Retargeting
          </h1>
          <p className="text-sm text-muted-foreground">Manage automated re-engagement sequences</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setShowImportModal(true); setCsvRows([]); setCsvHeaders([]); setImportResult(null) }}>
            <Upload className="h-4 w-4 mr-1.5" />
            Import CSV
          </Button>
          <Button variant="ghost" size="icon" onClick={fetchSettings} disabled={loading}>
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Lead Journey Visualization */}
      {journey && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowRight className="h-5 w-5" />
                  Lead Follow-Up Journey
                </CardTitle>
                <CardDescription>6-stage SMS follow-up pipeline: see where leads drop off and convert</CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={fetchJourney} disabled={journeyLoading}>
                <RefreshCcw className={`h-4 w-4 ${journeyLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto pb-2">
              <div className="flex items-center gap-1 min-w-[700px]">
                {[
                  { label: "Lead In", stage: 0, timing: "Instant" },
                  { label: "Stage 1", stage: 1, timing: "Instant" },
                  { label: "Stage 2", stage: 2, timing: "15 min" },
                  { label: "Stage 3", stage: 3, timing: "Day 1" },
                  { label: "Stage 4", stage: 4, timing: "Day 3" },
                  { label: "Stage 5", stage: 5, timing: "Day 7" },
                  { label: "Stage 6", stage: 6, timing: "Day 14" },
                ].map((s, idx) => {
                  const count = journey.followup.by_stage[s.stage] || 0
                  const prevCount = idx > 0 ? (journey.followup.by_stage[(idx - 1)] || 0) : 0
                  const retention = idx > 0 && prevCount > 0 ? Math.round((count / prevCount) * 100) : null
                  // Gradient from blue-500 to blue-700
                  const opacity = Math.max(0.3, 1 - idx * 0.1)

                  return (
                    <div key={s.stage} className="flex items-center gap-1">
                      <div
                        className="flex flex-col items-center justify-center px-3 py-2 rounded-lg border border-blue-500/30 min-w-[75px] text-center"
                        style={{ backgroundColor: `rgba(59, 130, 246, ${opacity * 0.15})` }}
                      >
                        <span className="text-[10px] text-blue-400 font-medium">{s.timing}</span>
                        <span className="text-lg font-bold text-foreground">{count}</span>
                        {retention !== null && (
                          <span className="text-[10px] text-muted-foreground">{retention}%</span>
                        )}
                      </div>
                      {idx < 6 && <ArrowRight className="h-3 w-3 text-zinc-600 shrink-0" />}
                    </div>
                  )
                })}
                <ArrowRight className="h-3 w-3 text-zinc-600 shrink-0" />
                {/* Retargeting node */}
                <div className="flex flex-col items-center justify-center px-3 py-2 rounded-lg border border-purple-500/30 bg-purple-500/10 min-w-[75px] text-center">
                  <span className="text-[10px] text-purple-400 font-medium">Retarget</span>
                  <span className="text-lg font-bold text-foreground">{journey.retargeting.in_sequence}</span>
                  <span className="text-[10px] text-muted-foreground">active</span>
                </div>
                <ArrowRight className="h-3 w-3 text-zinc-600 shrink-0" />
                {/* Outcomes node */}
                <div className="flex flex-col items-center justify-center px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-800/50 min-w-[85px] text-center">
                  <span className="text-[10px] text-zinc-400 font-medium">Outcomes</span>
                  <div className="flex flex-col gap-0.5 mt-0.5">
                    <span className="text-xs"><span className="text-green-400 font-bold">{journey.followup.converted}</span> <span className="text-[10px] text-muted-foreground">booked</span></span>
                    <span className="text-xs"><span className="text-blue-400 font-bold">{journey.followup.responded}</span> <span className="text-[10px] text-muted-foreground">replied</span></span>
                    <span className="text-xs"><span className="text-zinc-500 font-bold">{journey.followup.lost}</span> <span className="text-[10px] text-muted-foreground">lost</span></span>
                  </div>
                </div>
              </div>
            </div>
            {journey.opted_out > 0 && (
              <div className="mt-3 flex items-center gap-2 text-xs text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {journey.opted_out} customer{journey.opted_out !== 1 ? "s" : ""} opted out of SMS
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
                                        <span className="text-[10px] text-blue-400">· {s.template}</span>
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

      {/* CSV Import Modal */}
      <Dialog open={showImportModal} onOpenChange={setShowImportModal}>
        <DialogContent className="sm:max-w-xl">
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
                <p>Stages: unresponsive, quoted_not_booked, one_time, lapsed</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
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
                      {csvRows.slice(0, 5).map((row, i) => (
                        <tr key={i}>
                          {csvHeaders.slice(0, 6).map(h => (
                            <td key={h} className="px-2 py-1.5 truncate max-w-[120px]">{row[h] || "—"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {csvRows.length > 5 && (
                    <p className="text-[10px] text-muted-foreground px-2 py-1 bg-zinc-900/30">...and {csvRows.length - 5} more rows</p>
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

              {/* Default stage + auto-enroll */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="text-xs w-28 shrink-0">Default stage</Label>
                  <select
                    value={csvDefaultStage}
                    onChange={(e) => setCsvDefaultStage(e.target.value)}
                    className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
                    aria-label="Default lifecycle stage"
                  >
                    <option value="unresponsive">Unresponsive</option>
                    <option value="quoted_not_booked">Quoted, Not Booked</option>
                    <option value="one_time">One-Time</option>
                    <option value="lapsed">Lapsed</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="auto-enroll"
                    checked={csvAutoEnroll}
                    onCheckedChange={(checked) => setCsvAutoEnroll(checked === true)}
                  />
                  <Label htmlFor="auto-enroll" className="text-xs">Auto-start retargeting sequences</Label>
                </div>
              </div>

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

      {/* Campaign Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-md flex items-center justify-center z-50">
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
