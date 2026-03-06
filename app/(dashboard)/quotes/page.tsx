"use client"

import { useEffect, useState } from "react"
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
  status: "pending" | "approved" | "expired"
  selected_tier: string | null
  total_price: number | null
  created_at: string
  valid_until: string | null
}

type FilterTab = "all" | "pending" | "approved" | "expired"

const STATUS_BADGE: Record<Quote["status"], { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  approved: { label: "Approved", className: "bg-green-500/20 text-green-400 border-green-500/30" },
  expired: { label: "Expired", className: "bg-red-500/20 text-red-400 border-red-500/30" },
}

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
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<FilterTab>("all")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [smsStatus, setSmsStatus] = useState<{ id: string; message: string } | null>(null)

  // Create form state
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdQuote, setCreatedQuote] = useState<{ token: string; quote_url: string; phone?: string } | null>(null)
  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    customer_address: "",
    square_footage: "",
    property_type: "",
    notes: "",
  })

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

  async function handleCreate() {
    if (!form.customer_name.trim()) {
      setCreateError("Customer name is required")
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch("/api/actions/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: form.customer_name.trim(),
          customer_phone: form.customer_phone.trim() || undefined,
          customer_email: form.customer_email.trim() || undefined,
          customer_address: form.customer_address.trim() || undefined,
          square_footage: form.square_footage ? parseInt(form.square_footage, 10) : undefined,
          property_type: form.property_type || undefined,
          notes: form.notes.trim() || undefined,
        }),
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
      })
      // Reset form but keep the create panel open to show the result
      setForm({
        customer_name: "",
        customer_phone: "",
        customer_email: "",
        customer_address: "",
        square_footage: "",
        property_type: "",
        notes: "",
      })
      fetchQuotes()
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create quote")
    } finally {
      setCreating(false)
    }
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
      square_footage: "",
      property_type: "",
      notes: "",
    })
  }

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "expired", label: "Expired" },
  ]

  // Loading state
  if (loading && quotes.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading quotes...
      </div>
    )
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
    <div className="space-y-6">
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

                <div className="flex gap-2">
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
                    <Label htmlFor="customer_phone">Phone Number</Label>
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
                    <Label htmlFor="customer_email">Email</Label>
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
                    <Label htmlFor="customer_address">Address</Label>
                    <Input
                      id="customer_address"
                      placeholder="123 Main St, City, ST"
                      value={form.customer_address}
                      onChange={(e) =>
                        setForm({ ...form, customer_address: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="square_footage">Square Footage</Label>
                    <Input
                      id="square_footage"
                      type="number"
                      placeholder="2000"
                      value={form.square_footage}
                      onChange={(e) =>
                        setForm({ ...form, square_footage: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="property_type">Property Type</Label>
                    <select
                      id="property_type"
                      value={form.property_type}
                      onChange={(e) =>
                        setForm({ ...form, property_type: e.target.value })
                      }
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Select type...</option>
                      <option value="single_story">Single Story</option>
                      <option value="two_story">Two Story</option>
                      <option value="larger_two_story">Larger Two Story</option>
                    </select>
                  </div>
                </div>
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
            const badge = STATUS_BADGE[quote.status]
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
                      {quote.status === "pending" && quote.customer_phone && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            handleSendSMS(quote.id, quote.customer_phone!)
                          }
                          disabled={sendingId === quote.id}
                          title="Send via SMS"
                        >
                          {sendingId === quote.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MessageSquare className="h-4 w-4" />
                          )}
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
