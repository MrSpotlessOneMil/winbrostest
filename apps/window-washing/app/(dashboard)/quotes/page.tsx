"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import CubeLoader from "@/components/ui/cube-loader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  FileText,
  Plus,
  Copy,
  ExternalLink,
  MessageSquare,
  Loader2,
  Check,
  X,
  Clock,
  CheckCircle,
  AlertTriangle,
  Users,
  Send,
  Trash2,
} from "lucide-react"

interface Quote {
  id: string
  token: string
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  customer_address: string | null
  square_footage: number | null
  property_type: string | null
  notes: string | null
  status: "pending" | "approved" | "expired" | "draft" | "sent" | "converted" | "declined" | "cancelled"
  selected_tier: string | null
  total_price: number | null
  created_at: string
  valid_until: string | null
  preconfirm_status: string | null
  cleaner_pay: number | null
  description: string | null
}

interface CleanerOption {
  id: number
  name: string
  phone: string | null
}

interface PreconfirmStatus {
  id: number
  cleaner_id: number
  cleaner_name: string
  status: string
  notified_at: string | null
  responded_at: string | null
}

interface LineItem {
  id: string
  service_name: string
  price: string
}

const SERVICE_SUGGESTIONS = [
  "Window Cleaning - Interior/Exterior",
  "Window Cleaning - Exterior Only",
  "Screen Cleaning",
  "Gutter Cleaning",
  "Pressure Washing",
  "Hard Water Removal",
  "Track Cleaning",
  "Skylight Cleaning",
]

// Pane count pricing ranges
const PANE_RANGES: { min: number; max: number | null; price: number; label: string }[] = [
  { min: 1, max: 20, price: 200, label: "1-20 panes" },
  { min: 21, max: 40, price: 350, label: "21-40 panes" },
  { min: 41, max: 60, price: 500, label: "41-60 panes" },
  { min: 61, max: 80, price: 650, label: "61-80 panes" },
  { min: 81, max: null, price: 800, label: "81+ panes" },
]

function getPriceForPanes(count: number): number {
  for (const range of PANE_RANGES) {
    if (range.max === null && count >= range.min) return range.price
    if (count >= range.min && range.max !== null && count <= range.max) return range.price
  }
  return 200
}

// Team lead options for assignment
const TEAM_LEADS = [
  { id: "unassigned", name: "Unassigned" },
  { id: "blake_johnson", name: "Blake Johnson" },
  { id: "josh_rivera", name: "Josh Rivera" },
  { id: "trac_nguyen", name: "Trac Nguyen" },
  { id: "max_shoemaker", name: "Max Shoemaker" },
]

function generateLineItemId() {
  return Math.random().toString(36).slice(2, 9)
}

type FilterTab = "all" | "pending" | "approved" | "expired"

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  approved: { label: "Approved", className: "bg-green-500/20 text-green-400 border-green-500/30" },
  expired: { label: "Expired", className: "bg-red-500/20 text-red-400 border-red-500/30" },
  converted: { label: "Converted", className: "bg-green-500/20 text-green-400 border-green-500/30" },
  declined: { label: "Declined", className: "bg-red-500/20 text-red-300 border-red-500/30" },
  draft: { label: "Draft", className: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
  sent: { label: "Sent", className: "bg-violet-500/20 text-violet-400 border-violet-500/30" },
  cancelled: { label: "Cancelled", className: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
}

const FALLBACK_BADGE = { label: "Unknown", className: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" }

const PROPERTY_LABELS: Record<string, string> = {
  single_story: "Single Story",
  two_story: "Two Story",
  larger_two_story: "Larger Two Story",
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

function getQuoteUrl(token: string) {
  return `${window.location.origin}/quote/${token}`
}

export default function QuotesPage() {
  const router = useRouter()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openingBuilder, setOpeningBuilder] = useState(false)
  const [activeTab, setActiveTab] = useState<FilterTab>("all")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [smsStatus, setSmsStatus] = useState<{ id: string; message: string } | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)

  // Create form state
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdQuote, setCreatedQuote] = useState<{ token: string; quote_url: string; phone?: string; id?: string; preconfirm?: boolean } | null>(null)
  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    customer_address: "",
    notes: "",
    // Pane count pricing
    pane_count: "",
    price_override: "",
    assign_to: "unassigned",
    // Pre-confirm fields
    preconfirm: false,
    cleaner_pay: "",
    description: "",
    cleaner_ids: [] as number[],
  })
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: generateLineItemId(), service_name: "", price: "" },
  ])

  // Cleaner options for pre-confirm
  const [cleaners, setCleaners] = useState<CleanerOption[]>([])
  const [loadingCleaners, setLoadingCleaners] = useState(false)

  // Pre-confirm status for expanded quote
  const [preconfirmStatuses, setPreconfirmStatuses] = useState<Record<string, PreconfirmStatus[]>>({})
  const [sendingPreconfirm, setSendingPreconfirm] = useState<string | null>(null)

  // Load cleaners when pre-confirm is toggled on
  useEffect(() => {
    if (form.preconfirm && cleaners.length === 0 && !loadingCleaners) {
      setLoadingCleaners(true)
      fetch("/api/admin/cleaners")
        .then(r => r.json())
        .then(d => setCleaners((d.cleaners || d || []).filter((c: any) => c.active !== false)))
        .catch(() => {})
        .finally(() => setLoadingCleaners(false))
    }
  }, [form.preconfirm, cleaners.length, loadingCleaners])

  async function fetchQuotes() {
    setLoading(true)
    setError(null)
    try {
      const params = activeTab !== "all" ? `?status=${activeTab}` : ""
      const res = await fetch(`/api/actions/quotes${params}`)
      if (!res.ok) throw new Error("Failed to load quotes")
      const data = await res.json()
      setQuotes(data.quotes || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load quotes")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchQuotes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  async function handleCopyLink(token: string, quoteId: string) {
    try {
      await navigator.clipboard.writeText(getQuoteUrl(token))
      setCopiedId(quoteId)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // fallback
    }
  }

  async function handleSendSMS(quoteId: string, phone: string) {
    setSendingId(quoteId)
    setSmsStatus(null)
    try {
      const res = await fetch("/api/actions/quotes/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_id: quoteId, phone }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to send SMS")
      }
      setSmsStatus({ id: quoteId, message: "SMS sent!" })
      setTimeout(() => setSmsStatus(null), 3000)
    } catch (err: unknown) {
      setSmsStatus({ id: quoteId, message: err instanceof Error ? err.message : "Send failed" })
      setTimeout(() => setSmsStatus(null), 4000)
    } finally {
      setSendingId(null)
    }
  }

  async function handleApprove(quoteId: string) {
    setApprovingId(quoteId)
    setSmsStatus(null)
    try {
      const res = await fetch("/api/actions/quotes/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId, approvedBy: "salesman" }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Failed to approve quote")
      }
      setSmsStatus({ id: quoteId, message: `Converted! Job #${data.job_id}` })
      setTimeout(() => setSmsStatus(null), 4000)
      fetchQuotes()
    } catch (err: unknown) {
      setSmsStatus({ id: quoteId, message: err instanceof Error ? err.message : "Approve failed" })
      setTimeout(() => setSmsStatus(null), 4000)
    } finally {
      setApprovingId(null)
    }
  }

  async function handleCreate() {
    if (!form.customer_name.trim()) {
      setCreateError("Customer name is required")
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      // Build line items array — filter out empty rows
      let validLineItems = lineItems
        .filter((item) => item.service_name.trim() && item.price)
        .map((item) => ({
          service_name: item.service_name.trim(),
          price: parseFloat(item.price),
          quantity: 1,
        }))
        .filter((item) => !isNaN(item.price) && item.price > 0)

      // If pane count is set, auto-generate a line item (unless user manually added window cleaning items)
      const paneCount = parseInt(form.pane_count) || 0
      if (paneCount > 0 && validLineItems.length === 0) {
        const autoPrice = form.price_override ? parseFloat(form.price_override) : getPriceForPanes(paneCount)
        if (!isNaN(autoPrice) && autoPrice > 0) {
          validLineItems = [{
            service_name: `Window Cleaning - Exterior (${paneCount} panes)`,
            price: autoPrice,
            quantity: 1,
          }]
        }
      }

      if (validLineItems.length === 0) {
        setCreateError("Add at least one service with a price, or enter a pane count")
        setCreating(false)
        return
      }

      const payload: Record<string, unknown> = {
        customer_name: form.customer_name.trim(),
        customer_phone: form.customer_phone.trim() || undefined,
        customer_email: form.customer_email.trim() || undefined,
        customer_address: form.customer_address.trim() || undefined,
        notes: form.notes.trim() || undefined,
        line_items: validLineItems,
      }

      // Include assignment info in notes if assigned
      if (form.assign_to && form.assign_to !== "unassigned") {
        const lead = TEAM_LEADS.find(t => t.id === form.assign_to)
        const assignNote = `Assigned to: ${lead?.name || form.assign_to}`
        payload.notes = payload.notes ? `${payload.notes}\n${assignNote}` : assignNote
      }

      if (form.preconfirm && form.cleaner_ids.length > 0) {
        payload.cleaner_ids = form.cleaner_ids
        payload.cleaner_pay = form.cleaner_pay ? parseFloat(form.cleaner_pay) : undefined
        payload.description = form.description.trim() || undefined
      }

      const res = await fetch("/api/actions/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to create quote")
      }
      const data = await res.json()
      setCreatedQuote({
        token: data.quote.token,
        quote_url: data.quote_url,
        phone: form.customer_phone.trim() || undefined,
        id: data.quote.id,
        preconfirm: form.preconfirm && form.cleaner_ids.length > 0,
      })
      // Reset form but keep the create panel open to show the result
      setForm({
        customer_name: "",
        customer_phone: "",
        customer_email: "",
        customer_address: "",
        notes: "",
        pane_count: "",
        price_override: "",
        assign_to: "unassigned",
        preconfirm: false,
        cleaner_pay: "",
        description: "",
        cleaner_ids: [],
      })
      setLineItems([{ id: generateLineItemId(), service_name: "", price: "" }])
      fetchQuotes()
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create quote")
    } finally {
      setCreating(false)
    }
  }

  async function handleSendToCleaners(quoteId: string) {
    setSendingPreconfirm(quoteId)
    try {
      const res = await fetch("/api/actions/quotes/preconfirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_id: quoteId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to send")
      setSmsStatus({ id: quoteId, message: `Sent to ${data.sent} cleaner${data.sent > 1 ? 's' : ''}!` })
      setTimeout(() => setSmsStatus(null), 3000)
      fetchQuotes()
    } catch (err: unknown) {
      setSmsStatus({ id: quoteId, message: err instanceof Error ? err.message : "Send failed" })
      setTimeout(() => setSmsStatus(null), 4000)
    } finally {
      setSendingPreconfirm(null)
    }
  }

  async function loadPreconfirmStatus(quoteId: string) {
    try {
      const res = await fetch(`/api/actions/quotes/preconfirm?quote_id=${quoteId}`)
      const data = await res.json()
      if (data.success) {
        setPreconfirmStatuses(prev => ({ ...prev, [quoteId]: data.preconfirms }))
      }
    } catch { /* swallow */ }
  }

  function resetCreateForm() {
    setShowCreate(false)
    setCreatedQuote(null)
    setCreateError(null)
    setForm({
      customer_name: "",
      customer_phone: "",
      customer_email: "",
      customer_address: "",
      notes: "",
      pane_count: "",
      price_override: "",
      assign_to: "unassigned",
      preconfirm: false,
      cleaner_pay: "",
      description: "",
      cleaner_ids: [],
    })
    setLineItems([{ id: generateLineItemId(), service_name: "", price: "" }])
  }

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "expired", label: "Expired" },
  ]

  // Loading state
  if (loading && quotes.length === 0) {
    return <CubeLoader />
  }

  // Error state
  if (error && quotes.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 mb-4">{error}</p>
        <Button onClick={fetchQuotes}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold text-foreground">
            <FileText className="h-7 w-7 text-primary" />
            Quotes
          </h1>
          <p className="text-muted-foreground mt-1">
            Create and manage customer quotes
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={openingBuilder}
            onClick={async () => {
              setOpeningBuilder(true)
              try {
                const res = await fetch('/api/actions/quotes', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ customer_name: 'New Quote (draft)' }),
                })
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const body = await res.json()
                const id: string | undefined = body?.quote?.id
                if (id) router.push(`/quotes/${id}`)
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to open builder')
              } finally {
                setOpeningBuilder(false)
              }
            }}
          >
            <FileText className="h-4 w-4 mr-2" />
            {openingBuilder ? 'Opening…' : 'Builder (beta)'}
          </Button>
          <Button onClick={() => (showCreate ? resetCreateForm() : setShowCreate(true))}>
            {showCreate ? (
              <>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                New Quote
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Create Quote Form */}
      {showCreate && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-lg">
              {createdQuote ? "Quote Created!" : "New Quote"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {createdQuote ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 rounded-md bg-green-500/10 border border-green-500/20">
                  <CheckCircle className="h-5 w-5 text-green-400 shrink-0" />
                  <span className="text-green-400 text-sm">Quote created successfully</span>
                </div>

                <div>
                  <Label className="text-muted-foreground text-xs">Quote URL</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      readOnly
                      value={getQuoteUrl(createdQuote.token)}
                      className="text-sm font-mono"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopyLink(createdQuote.token, "created")}
                    >
                      {copiedId === "created" ? (
                        <Check className="h-4 w-4 text-green-400" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {createdQuote.preconfirm && createdQuote.id ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() => handleSendToCleaners(createdQuote.id!)}
                        disabled={sendingPreconfirm === createdQuote.id}
                      >
                        {sendingPreconfirm === createdQuote.id ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Send className="h-4 w-4 mr-2" />
                        )}
                        Send to Cleaners First
                      </Button>
                      <p className="w-full text-xs text-muted-foreground">
                        Send to cleaners first. Once they confirm, you can send the quote to the client.
                      </p>
                    </>
                  ) : (
                    <>
                      {createdQuote.phone && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            handleSendSMS("created", createdQuote.phone!)
                          }
                          disabled={sendingId === "created"}
                        >
                          {sendingId === "created" ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <MessageSquare className="h-4 w-4 mr-2" />
                          )}
                          Send via SMS
                        </Button>
                      )}
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      window.open(getQuoteUrl(createdQuote.token), "_blank")
                    }
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View Quote
                  </Button>
                  <Button size="sm" onClick={resetCreateForm}>
                    Done
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="customer_name">Customer Name *</Label>
                    <Input
                      id="customer_name"
                      placeholder="John Smith"
                      value={form.customer_name}
                      onChange={(e) =>
                        setForm({ ...form, customer_name: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="customer_phone">Phone Number <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      id="customer_phone"
                      placeholder="+1 (555) 123-4567"
                      value={form.customer_phone}
                      onChange={(e) =>
                        setForm({ ...form, customer_phone: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="customer_email">Email <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      id="customer_email"
                      type="email"
                      placeholder="john@example.com"
                      value={form.customer_email}
                      onChange={(e) =>
                        setForm({ ...form, customer_email: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="customer_address">Address <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      id="customer_address"
                      placeholder="123 Main St, City, ST"
                      value={form.customer_address}
                      onChange={(e) =>
                        setForm({ ...form, customer_address: e.target.value })
                      }
                    />
                  </div>
                </div>

                {/* Pane Count Pricing */}
                <div className="border-t border-border pt-4">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    Pane Count Pricing
                    <span className="text-muted-foreground font-normal text-xs">(auto-calculates price)</span>
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="pane_count" className="text-xs text-muted-foreground">Pane Count</Label>
                      <Input
                        id="pane_count"
                        type="number"
                        placeholder="e.g. 35"
                        min="1"
                        value={form.pane_count}
                        onChange={(e) => {
                          const newPaneCount = e.target.value
                          setForm({ ...form, pane_count: newPaneCount, price_override: "" })
                          // Auto-populate line items when pane count changes
                          const count = parseInt(newPaneCount) || 0
                          if (count > 0) {
                            const autoPrice = getPriceForPanes(count)
                            setLineItems([{
                              id: generateLineItemId(),
                              service_name: `Window Cleaning - Exterior (${count} panes)`,
                              price: String(autoPrice),
                            }])
                          }
                        }}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Auto Price</Label>
                      <div className="h-9 flex items-center px-3 rounded-md border border-input bg-muted text-sm font-medium">
                        {form.pane_count && parseInt(form.pane_count) > 0
                          ? `$${getPriceForPanes(parseInt(form.pane_count)).toFixed(2)}`
                          : "--"}
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="price_override" className="text-xs text-muted-foreground">Override Price ($)</Label>
                      <Input
                        id="price_override"
                        type="number"
                        placeholder="Override"
                        min="0"
                        step="0.01"
                        value={form.price_override}
                        onChange={(e) => {
                          const override = e.target.value
                          setForm({ ...form, price_override: override })
                          // Update line items with override price
                          const count = parseInt(form.pane_count) || 0
                          if (count > 0 && override) {
                            setLineItems([{
                              id: generateLineItemId(),
                              service_name: `Window Cleaning - Exterior (${count} panes)`,
                              price: override,
                            }])
                          }
                        }}
                      />
                    </div>
                  </div>
                  {form.pane_count && parseInt(form.pane_count) > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                      <p className="font-medium text-foreground/70">Pane Pricing Ranges:</p>
                      {PANE_RANGES.map((r) => (
                        <p key={r.label} className={parseInt(form.pane_count) >= r.min && (r.max === null || parseInt(form.pane_count) <= r.max) ? "text-primary font-semibold" : ""}>
                          {r.label}: ${r.price}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Assignment Dropdown */}
                <div className="border-t border-border pt-4">
                  <Label htmlFor="assign_to">Assign To</Label>
                  <select
                    id="assign_to"
                    value={form.assign_to}
                    onChange={(e) => setForm({ ...form, assign_to: e.target.value })}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring mt-1"
                  >
                    {TEAM_LEADS.map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {lead.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Unassigned quotes go to the unscheduled bank
                  </p>
                </div>

                {/* Line Items Builder */}
                <div className="space-y-3">
                  <Label>Services</Label>
                  {lineItems.map((item, index) => (
                    <div key={item.id} className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <Input
                          placeholder="Service name"
                          value={item.service_name}
                          onChange={(e) => {
                            const updated = [...lineItems]
                            updated[index] = { ...item, service_name: e.target.value }
                            setLineItems(updated)
                          }}
                          list="service-suggestions"
                        />
                      </div>
                      <div className="w-28 shrink-0">
                        <Input
                          type="number"
                          placeholder="Price"
                          min="0"
                          step="0.01"
                          value={item.price}
                          onChange={(e) => {
                            const updated = [...lineItems]
                            updated[index] = { ...item, price: e.target.value }
                            setLineItems(updated)
                          }}
                        />
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="shrink-0 mt-0.5 text-muted-foreground hover:text-red-400"
                        onClick={() => {
                          if (lineItems.length <= 1) return
                          setLineItems(lineItems.filter((_, i) => i !== index))
                        }}
                        disabled={lineItems.length <= 1}
                        title="Remove service"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <datalist id="service-suggestions">
                    {SERVICE_SUGGESTIONS.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setLineItems([...lineItems, { id: generateLineItemId(), service_name: "", price: "" }])
                    }
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Service
                  </Button>
                  {/* Total */}
                  {(() => {
                    const total = lineItems.reduce((sum, item) => {
                      const p = parseFloat(item.price)
                      return sum + (isNaN(p) ? 0 : p)
                    }, 0)
                    return (
                      <div className="flex items-center justify-between pt-2 border-t border-border">
                        <span className="text-sm font-medium text-muted-foreground">Total</span>
                        <span className="text-lg font-semibold text-foreground">
                          ${total.toFixed(2)}
                        </span>
                      </div>
                    )
                  })()}
                </div>

                {/* Pre-Confirm Cleaner Toggle */}
                <div className="border-t border-border pt-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.preconfirm}
                      onChange={(e) => setForm({ ...form, preconfirm: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <div>
                      <span className="text-sm font-medium flex items-center gap-2">
                        <Users className="h-4 w-4 text-primary" />
                        Pre-confirm cleaners
                      </span>
                      <p className="text-xs text-muted-foreground">
                        Ask cleaners if they want this job before sending the quote to the client
                      </p>
                    </div>
                  </label>
                </div>

                {/* Pre-Confirm Fields (shown when toggle is on) */}
                {form.preconfirm && (
                  <div className="space-y-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
                    <div>
                      <Label htmlFor="description">Service Description</Label>
                      <Input
                        id="description"
                        placeholder="e.g. Deep Clean - 3 bed/2 bath"
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="cleaner_pay">Cleaner Pay ($)</Label>
                      <Input
                        id="cleaner_pay"
                        type="number"
                        placeholder="e.g. 150"
                        min="0"
                        step="0.01"
                        value={form.cleaner_pay}
                        onChange={(e) => setForm({ ...form, cleaner_pay: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        What the cleaner gets paid (not shown to client)
                      </p>
                    </div>
                    <div>
                      <Label>Select Cleaners</Label>
                      {loadingCleaners ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading cleaners...
                        </div>
                      ) : cleaners.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">No active cleaners found</p>
                      ) : (
                        <div className="space-y-2 mt-2 max-h-48 overflow-y-auto">
                          {cleaners.map((c) => (
                            <label key={c.id} className="flex items-center gap-3 p-2 rounded hover:bg-accent cursor-pointer">
                              <input
                                type="checkbox"
                                checked={form.cleaner_ids.includes(c.id)}
                                onChange={(e) => {
                                  const ids = e.target.checked
                                    ? [...form.cleaner_ids, c.id]
                                    : form.cleaner_ids.filter(id => id !== c.id)
                                  setForm({ ...form, cleaner_ids: ids })
                                }}
                                className="w-4 h-4 rounded border-gray-300"
                              />
                              <span className="text-sm">{c.name}</span>
                              {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
                            </label>
                          ))}
                        </div>
                      )}
                      {form.cleaner_ids.length > 0 && (
                        <p className="text-xs text-primary mt-2">
                          {form.cleaner_ids.length} cleaner{form.cleaner_ids.length > 1 ? 's' : ''} selected
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <Label htmlFor="notes">Notes</Label>
                  <textarea
                    id="notes"
                    placeholder="Any special instructions or details..."
                    value={form.notes}
                    onChange={(e) =>
                      setForm({ ...form, notes: e.target.value })
                    }
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  />
                </div>
                {createError && (
                  <p className="text-red-400 text-sm">{createError}</p>
                )}
                <div className="flex gap-2">
                  <Button onClick={handleCreate} disabled={creating}>
                    {creating && (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    )}
                    Create Quote
                  </Button>
                  <Button variant="outline" onClick={resetCreateForm}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-1 p-1 bg-zinc-900 rounded-lg w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-zinc-800 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Quotes List */}
      {quotes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No {activeTab !== "all" ? activeTab : ""} quotes yet</p>
            <p className="text-sm mt-1">Create your first quote to get started</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {quotes.map((quote) => {
            const badge = STATUS_BADGE[quote.status] || FALLBACK_BADGE
            return (
              <Card
                key={quote.id}
                className="hover:border-zinc-700 transition-colors cursor-pointer"
                onClick={() => handleCopyLink(quote.token, quote.id)}
              >
                <CardContent className="py-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    {/* Left: Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">
                          {quote.customer_name}
                        </span>
                        <Badge
                          variant="outline"
                          className={badge.className}
                        >
                          {badge.label}
                        </Badge>
                        {quote.selected_tier && (
                          <Badge variant="outline" className="text-xs">
                            {quote.selected_tier.charAt(0).toUpperCase() +
                              quote.selected_tier.slice(1)}
                          </Badge>
                        )}
                        {quote.preconfirm_status === "awaiting_cleaners" && (
                          <Badge variant="outline" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                            <Users className="h-3 w-3 mr-1" />
                            Awaiting Cleaners
                          </Badge>
                        )}
                        {quote.preconfirm_status === "cleaners_confirmed" && (
                          <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Cleaner Confirmed
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
                        {quote.property_type && (
                          <span>
                            {PROPERTY_LABELS[quote.property_type] || quote.property_type}
                          </span>
                        )}
                        {quote.square_footage && (
                          <span>{quote.square_footage.toLocaleString()} sqft</span>
                        )}
                        {quote.total_price != null && (
                          <span className="font-medium text-foreground">
                            {formatCurrency(quote.total_price)}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(quote.created_at)}
                        </span>
                        {quote.valid_until && (
                          <span className="flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Expires {formatDate(quote.valid_until)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div
                      className="flex items-center gap-2 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopyLink(quote.token, quote.id)}
                        title="Copy link"
                      >
                        {copiedId === quote.id ? (
                          <Check className="h-4 w-4 text-green-400" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      {/* Pre-confirm: Send to Cleaners */}
                      {quote.status === "pending" && quote.preconfirm_status === "awaiting_cleaners" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleSendToCleaners(quote.id)}
                          disabled={sendingPreconfirm === quote.id}
                          title="Send to cleaners"
                        >
                          {sendingPreconfirm === quote.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      {/* Normal or confirmed: Send to Client */}
                      {quote.status === "pending" && quote.customer_phone && quote.preconfirm_status !== "awaiting_cleaners" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            handleSendSMS(quote.id, quote.customer_phone!)
                          }
                          disabled={sendingId === quote.id}
                          title={quote.preconfirm_status === "cleaners_confirmed" ? "Send quote to client (cleaner confirmed!)" : "Send via SMS"}
                        >
                          {sendingId === quote.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MessageSquare className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      {["draft", "sent", "pending"].includes(quote.status) && (
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => handleApprove(quote.id)}
                          disabled={approvingId === quote.id}
                          title="Approve & convert to job"
                        >
                          {approvingId === quote.id ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-1" />
                          ) : (
                            <CheckCircle className="h-4 w-4 mr-1" />
                          )}
                          Approve & Convert
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          window.open(getQuoteUrl(quote.token), "_blank")
                        }
                        title="View quote"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      {smsStatus?.id === quote.id && (
                        <span className="text-xs text-muted-foreground">
                          {smsStatus.message}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
