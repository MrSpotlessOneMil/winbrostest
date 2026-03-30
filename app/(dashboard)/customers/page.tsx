"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { MessageBubble } from "@/components/message-bubble"
import { CallBubble } from "@/components/call-bubble"
import { parseFormData } from "@/lib/utils"
import { useAuth } from "@/lib/auth-context"
import { Send, Loader2, Trash2, Copy, Check, Pencil, X, DollarSign, CreditCard, FileText, UserPlus, RefreshCw, Download, ChevronDown, ChevronUp, Zap, KeyRound, Ban, Pause, Play, XCircle, Plus, Crown, ExternalLink } from "lucide-react"
import { StripeCardForm } from "@/components/stripe-card-form"
import CubeLoader from "@/components/ui/cube-loader"

// Normalize phone to 10 digits for comparison
function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  let digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1)
  }
  return digits
}

// iMessage-style relative timestamp
function formatThreadTimestamp(timestamp: string): string {
  const now = new Date()
  const date = new Date(timestamp)
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHrs = Math.floor(diffMs / 3600000)

  if (diffMin < 1) return "now"
  if (diffMin < 60) return `${diffMin}m`
  if (diffHrs < 24) return `${diffHrs}h`

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"

  // Same week → day name
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays < 7) return date.toLocaleDateString("en-US", { weekday: "short" })

  // Older → "Jan 5"
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

type TabType = "messages" | "jobs" | "quotes" | "membership" | "info"

interface Customer {
  id: number
  phone_number: string
  first_name?: string
  last_name?: string
  email?: string
  address?: string
  notes?: string
  auto_response_paused?: boolean
  is_commercial?: boolean
  card_on_file_at?: string | null
  stripe_customer_id?: string | null
  preferred_frequency?: string | null
  preferred_day?: string | null
  recurring_notes?: string | null
  lifecycle_stage?: string | null
  lead_source?: string | null
  sms_opt_out?: boolean
  created_at: string
  updated_at: string
}

interface Message {
  id: number
  phone_number: string
  role: string
  content: string
  direction: string
  timestamp: string
  ai_generated: boolean
}

interface Job {
  id: number
  phone_number?: string
  customer_id?: number
  service_type?: string
  address?: string
  date?: string
  scheduled_at?: string
  price?: number
  hours?: number
  status?: string
  paid?: boolean
  payment_status?: string
  notes?: string
  bedrooms?: number
  bathrooms?: number
  sqft?: number
  frequency?: string
  parent_job_id?: number | null
  paused_at?: string | null
  last_generated_date?: string | null
  quote_id?: number | null
  stripe_invoice_id?: string | null
  invoice_sent?: boolean
  addons?: string | null
  created_at: string
}

interface Call {
  id: number
  phone_number?: string
  caller_name?: string
  direction?: string
  duration_seconds?: number
  outcome?: string
  transcript?: string
  audio_url?: string
  created_at: string
}

interface Lead {
  id: number
  phone_number: string
  status: string
  source?: string
  converted_to_job_id?: number | null
  followup_stage: number
  followup_started_at?: string
  stripe_payment_link?: string
  created_at: string
  // form_data can be an object OR a JSON string (database inconsistency)
  form_data?: string | Record<string, unknown>
}

// Helper to safely get followup_paused from a lead's form_data
function isFollowupPaused(lead: Lead | null): boolean {
  if (!lead) return false
  const formData = parseFormData(lead.form_data)
  return formData.followup_paused === true
}

interface ScheduledTask {
  id: string
  task_type: string
  task_key: string
  scheduled_for: string
  status: string
  payload: {
    stage: number
    action: string
    leadId: string
  }
}

interface MembershipData {
  id: string
  status: "active" | "paused" | "cancelled" | "completed"
  customer_id: number
  visits_completed: number
  next_visit_at: string | null
  started_at: string | null
  renewal_choice: string | null
  renewal_asked_at: string | null
  created_at: string
  customers?: { id: string; first_name: string | null; last_name: string | null } | null
  service_plans: {
    id: string
    name: string
    slug: string
    visits_per_year: number
    interval_months: number
    discount_per_visit: number
  } | null
}

interface ServicePlan {
  id: string
  name: string
  slug: string
  visits_per_year: number
  interval_months: number
  discount_per_visit: number
}

interface SystemLog {
  id: number
  source: string
  event_type: string
  message: string | null
  phone_number: string | null
  job_id: string | null
  lead_id: string | null
  cleaner_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface TimelineItem {
  type: "message" | "call"
  timestamp: string
  data: Message | Call
}

// Lifecycle stage badge config
const LIFECYCLE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  new: { label: "New", color: "text-blue-300", bg: "bg-blue-500/15" },
  new_lead: { label: "New Lead", color: "text-blue-300", bg: "bg-blue-500/15" },
  contacted: { label: "Following Up", color: "text-yellow-300", bg: "bg-yellow-500/15" },
  qualified: { label: "Qualified", color: "text-cyan-300", bg: "bg-cyan-500/15" },
  quoted_not_booked: { label: "Quoted", color: "text-orange-300", bg: "bg-orange-500/15" },
  booked: { label: "Booked", color: "text-green-300", bg: "bg-green-500/15" },
  active: { label: "Active", color: "text-emerald-300", bg: "bg-emerald-500/15" },
  repeat: { label: "Repeat", color: "text-emerald-300", bg: "bg-emerald-500/15" },
  completed: { label: "Completed", color: "text-emerald-300", bg: "bg-emerald-500/15" },
  one_time: { label: "One-Time", color: "text-yellow-300", bg: "bg-yellow-500/15" },
  unresponsive: { label: "Unresponsive", color: "text-red-300", bg: "bg-red-500/15" },
  lapsed: { label: "Lapsed", color: "text-amber-300", bg: "bg-amber-500/15" },
  recurring_accepted: { label: "Recurring", color: "text-purple-300", bg: "bg-purple-500/15" },
  satisfaction_sent: { label: "Follow Up", color: "text-amber-300", bg: "bg-amber-500/15" },
  recurring_offered: { label: "Offered Recurring", color: "text-indigo-300", bg: "bg-indigo-500/15" },
  lost: { label: "Lost", color: "text-red-300", bg: "bg-red-500/15" },
  opted_out: { label: "Opted Out", color: "text-zinc-400", bg: "bg-zinc-500/15" },
}

function getLifecycleBadge(customer: Customer) {
  if (customer.sms_opt_out) return LIFECYCLE_BADGE.opted_out
  // Retargeting customers should show "Retargeting", not "New Lead"
  if (customer.lead_source === 'retargeting' && (!customer.lifecycle_stage || customer.lifecycle_stage === 'new_lead')) {
    return { label: "Retargeting", color: "text-cyan-300", bg: "bg-cyan-500/15" }
  }
  const stage = customer.lifecycle_stage
  if (!stage) return null
  return LIFECYCLE_BADGE[stage] || null
}

const LEAD_SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
  phone: { label: "Phone", color: "#5b8def" },
  vapi: { label: "Vapi", color: "#7ca3f0" },
  meta: { label: "Meta", color: "#4ade80" },
  google_lsa: { label: "LSA", color: "#34d399" },
  thumbtack: { label: "Thumbtack", color: "#009fd9" },
  angi: { label: "Angi", color: "#ff6138" },
  website: { label: "Website", color: "#facc15" },
  sms: { label: "SMS", color: "#f472b6" },
  housecall_pro: { label: "HCP", color: "#a78bfa" },
  ghl: { label: "GHL", color: "#fb923c" },
  manual: { label: "Manual", color: "#94a3b8" },
}

function getLeadSourceConfig(source: string) {
  return LEAD_SOURCE_CONFIG[source] || { label: source, color: "#6b7280" }
}

export default function CustomersPage() {
  const { user } = useAuth()
  const urlParams = useSearchParams()
  const isHouseCleaning = user?.tenantSlug !== "winbros"
  const [customers, setCustomers] = useState<Customer[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [calls, setCalls] = useState<Call[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const urlParamsHandled = useRef(false)
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("customers_active_tab")
      if (saved === "messages" || saved === "jobs" || saved === "quotes" || saved === "membership" || saved === "info") return saved
    }
    return "messages"
  })
  const switchTab = (tab: TabType) => {
    setActiveTab(tab)
    localStorage.setItem("customers_active_tab", tab)
    // Lazy-fetch quotes when switching to quotes tab
    if (tab === "quotes" && selectedCustomer) {
      fetchCustomerQuotes(selectedCustomer.id, selectedCustomer.phone_number)
    }
    // Lazy-fetch logs when switching to info tab
    if (tab === "info" && selectedCustomer) {
      fetchCustomerLogs(selectedCustomer.phone_number, selectedCustomer.id)
    }
  }
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchLoading, setSearchLoading] = useState(false)
  const [smsMessage, setSmsMessage] = useState("")
  const [sendingSms, setSendingSms] = useState(false)
  const [deletingCustomer, setDeletingCustomer] = useState(false)
  const deletingRef = useRef(false) // ref to skip polling during delete
  const [copied, setCopied] = useState(false)
  const [customerLogs, setCustomerLogs] = useState<SystemLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsCopied, setLogsCopied] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [editingJob, setEditingJob] = useState<Job | null>(null)
  const [savingJob, setSavingJob] = useState(false)

  // New customer modal state
  const [newCustomerOpen, setNewCustomerOpen] = useState(false)
  const [newCustomerForm, setNewCustomerForm] = useState({
    first_name: "", last_name: "", phone_number: "", email: "", address: "", notes: "", is_commercial: false,
  })
  const [savingNewCustomer, setSavingNewCustomer] = useState(false)
  const [newCustomerError, setNewCustomerError] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [pendingScrollSearch, setPendingScrollSearch] = useState<string | null>(null)

  // Payment popover state
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentType, setPaymentType] = useState<string | null>(null)
  const [paymentAmount, setPaymentAmount] = useState("")
  const [paymentJobId, setPaymentJobId] = useState<string>("")
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentResult, setPaymentResult] = useState<{ url?: string; invoiceId?: string } | null>(null)
  const [paymentCopied, setPaymentCopied] = useState(false)
  const [paymentSmsSent, setPaymentSmsSent] = useState(false)
  const [chargeCardLoading, setChargeCardLoading] = useState(false)
  const [chargeCardResult, setChargeCardResult] = useState<{ success: boolean; amount?: number; error?: string } | null>(null)
  const [chargeCardDescription, setChargeCardDescription] = useState("")
  const paymentRef = useRef<HTMLDivElement>(null)

  // Cleaner phones for badge
  const [cleanerPhones, setCleanerPhones] = useState<string[]>([])

  // Membership state (WinBros only)
  const [membershipsList, setMembershipsList] = useState<MembershipData[]>([])
  const [membershipPlans, setMembershipPlans] = useState<ServicePlan[]>([])
  const [membershipActionLoading, setMembershipActionLoading] = useState<string | null>(null)
  const [createMembershipOpen, setCreateMembershipOpen] = useState(false)
  const [createMembershipPlanSlug, setCreateMembershipPlanSlug] = useState("")
  const [createMembershipSaving, setCreateMembershipSaving] = useState(false)

  // Invoice details state (lazy-loaded when Invoices tab is opened)
  const [invoiceDetails, setInvoiceDetails] = useState<Record<number, {
    tier: string | null; addons: string[]; subtotal: number | null; total: number | null
    discount: number | null; invoiceUrl: string | null; invoicePdfUrl: string | null; invoiceStatus: string
  }>>({})
  const [invoiceDetailsLoading, setInvoiceDetailsLoading] = useState(false)
  const [expandedInvoiceJob, setExpandedInvoiceJob] = useState<number | null>(null)

  // Quotes state (lazy-loaded when Quotes tab is opened)
  const [customerQuotes, setCustomerQuotes] = useState<any[]>([])
  const [quotesLoading, setQuotesLoading] = useState(false)
  const prevSelectedCustomerIdRef = useRef<number | null>(null)
  const [createMembershipError, setCreateMembershipError] = useState("")

  // Batch add state
  const [syncingContacts, setSyncingContacts] = useState(false)
  const [syncResult, setSyncResult] = useState<{ updated: number; created: number; total_contacts: number } | null>(null)
  const [syncingMessages, setSyncingMessages] = useState(false)
  const [msgSyncResult, setMsgSyncResult] = useState<{ messages_imported: number; calls_imported: number; partial: boolean } | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchText, setBatchText] = useState("")
  const [batchParsing, setBatchParsing] = useState(false)
  const [batchParsed, setBatchParsed] = useState<Array<{ first_name: string; last_name: string; phone_number: string; email: string | null; address: string | null }> | null>(null)
  const [batchCreating, setBatchCreating] = useState(false)
  const [batchResult, setBatchResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null)

  // Fetch customers (with optional search)
  const fetchCustomers = async (search?: string) => {
    try {
      const url = search ? `/api/customers?search=${encodeURIComponent(search)}` : "/api/customers"
      const res = await fetch(url, { cache: "no-store" })
      const json = await res.json()
      console.log(`[customers] fetch: success=${json.success} customers=${json.data?.customers?.length ?? 0} messages=${json.data?.messages?.length ?? 0}`, json.error || '')
      if (json.success) {
        setCustomers(json.data.customers)
        setMessages(json.data.messages)
        setJobs(json.data.jobs)
        setCalls(json.data.calls)
        setLeads(json.data.leads || [])
        setScheduledTasks(json.data.scheduledTasks || [])
        setCleanerPhones(json.data.cleanerPhones || [])
        if (!search && json.data.customers.length > 0 && !selectedCustomer) {
          const savedId = typeof window !== "undefined" ? localStorage.getItem("selectedCustomerId") : null
          const restored = savedId ? json.data.customers.find((c: Customer) => String(c.id) === savedId) : null
          setSelectedCustomer(restored || json.data.customers[0])
        }
      } else {
        // API returned error — clear stale data so we don't show wrong tenant's info
        console.warn('[customers] API error:', json.error)
        setCustomers([])
        setMessages([])
        setJobs([])
        setCalls([])
        setLeads([])
      }
    } catch (error) {
      console.error("Failed to fetch customers:", error)
      // Network error — clear stale data
      setCustomers([])
      setMessages([])
      setJobs([])
      setCalls([])
      setLeads([])
    } finally {
      setLoading(false)
    }
  }

  // Fetch memberships for WinBros
  const fetchMemberships = async () => {
    try {
      const res = await fetch("/api/actions/memberships?limit=200")
      const data = await res.json()
      if (data.memberships) setMembershipsList(data.memberships)
    } catch {
      // silent
    }
  }

  // Fetch service plans for create membership modal
  const fetchServicePlans = async () => {
    try {
      const res = await fetch("/api/service-plans")
      const data = await res.json()
      if (data.plans) setMembershipPlans(data.plans)
    } catch {
      // silent
    }
  }

  // Initial data fetch + re-fetch when account switches
  const currentUserId = user?.id
  useEffect(() => {
    // Reset ALL state when account changes to prevent stale cross-tenant data
    setSelectedCustomer(null)
    setCustomers([])
    setMessages([])
    setJobs([])
    setCalls([])
    setLeads([])
    setScheduledTasks([])
    setCleanerPhones([])
    setLoading(true)
    fetchCustomers()
    if (!isHouseCleaning) {
      fetchMemberships()
      fetchServicePlans()
    }
  }, [currentUserId])

  // Helper: get membership for a customer
  const getCustomerMembership = (customerId: number): MembershipData | null => {
    return membershipsList.find((m) => m.customer_id === customerId && (m.status === "active" || m.status === "paused")) || null
  }

  // Helper: get all memberships for a customer (including completed)
  const getCustomerMemberships = (customerId: number): MembershipData[] => {
    return membershipsList.filter((m) => m.customer_id === customerId)
  }

  // Membership actions
  const handleMembershipAction = async (membershipId: string, action: "pause" | "resume" | "cancel") => {
    setMembershipActionLoading(membershipId)
    try {
      const res = await fetch("/api/actions/memberships", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_id: membershipId, action }),
      })
      const data = await res.json()
      if (data.success) {
        await fetchMemberships()
      } else {
        alert(data.error || `Failed to ${action} membership`)
      }
    } catch {
      alert(`Failed to ${action} membership`)
    } finally {
      setMembershipActionLoading(null)
    }
  }

  // Create membership
  const handleCreateMembership = async () => {
    if (!selectedCustomer || !createMembershipPlanSlug) {
      setCreateMembershipError("Select a plan")
      return
    }
    setCreateMembershipSaving(true)
    setCreateMembershipError("")
    try {
      const res = await fetch("/api/actions/memberships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: selectedCustomer.id, plan_slug: createMembershipPlanSlug }),
      })
      const data = await res.json()
      if (!data.success) {
        setCreateMembershipError(data.error || "Failed to create membership")
        return
      }
      setCreateMembershipOpen(false)
      setCreateMembershipPlanSlug("")
      await fetchMemberships()
    } catch {
      setCreateMembershipError("Connection error")
    } finally {
      setCreateMembershipSaving(false)
    }
  }

  // Fetch quotes for selected customer (lazy — only when Quotes tab is opened)
  const fetchCustomerQuotes = async (custId: number, phone: string) => {
    setQuotesLoading(true)
    try {
      const res = await fetch(`/api/actions/quotes?customer_id=${custId}&limit=50`)
      const data = await res.json()
      let quotes = data.quotes || []
      // Fallback: also fetch by phone if no results by customer_id
      if (quotes.length === 0 && phone) {
        const res2 = await fetch(`/api/actions/quotes?customer_phone=${encodeURIComponent(phone)}&limit=50`)
        const data2 = await res2.json()
        quotes = data2.quotes || []
      }
      setCustomerQuotes(quotes)
    } catch {
      setCustomerQuotes([])
    } finally {
      setQuotesLoading(false)
    }
  }

  // Reset + re-fetch quotes when selected customer changes while on quotes tab
  useEffect(() => {
    if (selectedCustomer?.id !== prevSelectedCustomerIdRef.current) {
      prevSelectedCustomerIdRef.current = selectedCustomer?.id ?? null
      setCustomerQuotes([])
      if (activeTab === "quotes" && selectedCustomer) {
        fetchCustomerQuotes(selectedCustomer.id, selectedCustomer.phone_number)
      }
    }
  }, [selectedCustomer?.id])

  // Fetch activity logs for a customer (lazy — only when Info tab is opened)
  const fetchCustomerLogs = async (phone: string, custId: number) => {
    setLogsLoading(true)
    try {
      const res = await fetch(`/api/actions/customer-logs?phone=${encodeURIComponent(phone)}&customer_id=${custId}`)
      const data = await res.json()
      setCustomerLogs(data.data || [])
    } catch {
      setCustomerLogs([])
    } finally {
      setLogsLoading(false)
    }
  }

  // Reset + re-fetch logs when selected customer changes while on info tab
  useEffect(() => {
    if (activeTab === "info" && selectedCustomer) {
      fetchCustomerLogs(selectedCustomer.phone_number, selectedCustomer.id)
    }
    if (activeTab !== "info") {
      setCustomerLogs([]) // clear when leaving tab
    }
  }, [selectedCustomer?.id, activeTab])

  // Fetch invoice details for selected customer (lazy — only when Invoices tab is opened)
  const fetchInvoiceDetails = async (custId: number) => {
    setInvoiceDetailsLoading(true)
    try {
      const res = await fetch(`/api/actions/job-invoice-details?customerId=${custId}`)
      const data = await res.json()
      if (data.invoices) {
        const detailsMap: typeof invoiceDetails = {}
        for (const inv of data.invoices) {
          detailsMap[inv.jobId] = {
            tier: inv.tier, addons: inv.addons, subtotal: inv.subtotal,
            total: inv.total, discount: inv.discount, invoiceUrl: inv.invoiceUrl,
            invoicePdfUrl: inv.invoicePdfUrl, invoiceStatus: inv.invoiceStatus,
          }
        }
        setInvoiceDetails(detailsMap)
      }
    } catch {
      // silent
    } finally {
      setInvoiceDetailsLoading(false)
    }
  }

  // Handle URL params from global search (e.g. ?customerId=123&q=term&phone=+1234)
  useEffect(() => {
    if (urlParamsHandled.current || loading || customers.length === 0) return
    const paramCustomerId = urlParams.get("customerId")
    const paramPhone = urlParams.get("phone")
    const paramQ = urlParams.get("q")

    if (paramCustomerId || paramPhone) {
      urlParamsHandled.current = true
      let target: Customer | undefined
      if (paramCustomerId) {
        target = customers.find((c) => String(c.id) === paramCustomerId)
      }
      if (!target && paramPhone) {
        const normParam = normalizePhone(paramPhone)
        target = customers.find((c) => normalizePhone(c.phone_number) === normParam)
      }
      if (target) {
        setSelectedCustomer(target)
        markAsRead(target.id)
        switchTab("messages")
        if (paramQ) {
          setPendingScrollSearch(paramQ.toLowerCase())
        }
      }
      // Clean URL params without reload
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", "/customers")
      }
    }
  }, [loading, customers, urlParams])

  // Debounced server-side search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!searchQuery) {
      setSearchLoading(false)
      // Reset to default when search cleared
      fetchCustomers()
      return
    }
    setSearchLoading(true)
    searchTimerRef.current = setTimeout(async () => {
      await fetchCustomers(searchQuery)
      setSearchLoading(false)
    }, 300)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [searchQuery])

  // Scroll to the most recent message matching the search term after selecting a customer
  useEffect(() => {
    if (!pendingScrollSearch || !selectedCustomer || !messagesContainerRef.current) return
    // Use requestAnimationFrame to wait for DOM paint, then jump instantly
    const raf = requestAnimationFrame(() => {
      const container = messagesContainerRef.current
      if (!container) { setPendingScrollSearch(null); return }
      const bubbles = container.querySelectorAll<HTMLElement>("[data-msg-content]")
      let lastMatch: HTMLElement | null = null
      bubbles.forEach((el) => {
        const content = el.getAttribute("data-msg-content")?.toLowerCase() || ""
        if (content.includes(pendingScrollSearch)) lastMatch = el
      })
      if (lastMatch) {
        (lastMatch as HTMLElement).scrollIntoView({ behavior: "instant", block: "start" })
      }
      setPendingScrollSearch(null)
    })
    return () => cancelAnimationFrame(raf)
  }, [pendingScrollSearch, selectedCustomer])

  // Poll for new messages and updates every 3 seconds
  // Use ref to access current searchQuery without re-creating the interval
  const searchQueryRef = useRef(searchQuery)
  useEffect(() => { searchQueryRef.current = searchQuery }, [searchQuery])

  useEffect(() => {
    const pollInterval = setInterval(async () => {
      // Skip polling while a delete is in progress to avoid race conditions
      if (deletingRef.current) return
      try {
        const currentSearch = searchQueryRef.current
        const url = currentSearch ? `/api/customers?search=${encodeURIComponent(currentSearch)}` : "/api/customers"
        const res = await fetch(url, { cache: "no-store" })
        const json = await res.json()
        if (json.success) {
          // Check if there are new messages to trigger scroll
          const prevCount = messages.length
          const newMessages = json.data.messages || []

          // Update customers list - always sync to catch new/updated records
          setCustomers(json.data.customers || [])
          // Update jobs
          setJobs(json.data.jobs || [])
          // Update messages - this shows new incoming/outgoing texts immediately
          setMessages(newMessages)
          // Update leads to get latest form_data (including followup_paused)
          setLeads(json.data.leads || [])
          // Update scheduled tasks
          setScheduledTasks(json.data.scheduledTasks || [])
          // Update calls
          setCalls(json.data.calls)
          // Update cleaner phones
          setCleanerPhones(json.data.cleanerPhones || [])

          // Auto-scroll if new messages arrived
          if (newMessages.length > prevCount) {
            setTimeout(() => {
              messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
            }, 100)
          }
        }
      } catch (error) {
        // Silently fail on polling errors - don't spam console
      }
    }, 3000)

    return () => clearInterval(pollInterval)
  }, [messages.length, currentUserId])

  const sourceLabelsMap: Record<string, string> = {
    phone: "Phone Lead",
    meta: "Meta Lead",
    website: "Website Lead",
    sms: "SMS Lead",
    sam: "SAM Lead",
    google_lsa: "LSA Lead",
    google: "Google Lead",
    ghl: "GHL Lead",
    thumbtack: "Thumbtack Lead",
    angi: "Angi Lead",
    vapi: "Call Lead",
    manual: "Manual Lead",
    email: "Email Lead",
    retargeting: "Retargeting",
    housecall_pro: "HouseCall Pro",
  }

  const getCustomerName = (customer: Customer) => {
    if (customer.first_name || customer.last_name) {
      return [customer.first_name, customer.last_name].filter(Boolean).join(" ")
    }
    return formatPhone(customer.phone_number)
  }

  const getSourceBadge = (customer: Customer) => {
    if (!customer.lead_source) return null
    // Only show badge for paid/trackable channels — not for generic sources
    const trackableChannels: Record<string, { label: string; className: string }> = {
      retargeting: { label: "Retargeting", className: "bg-violet-500/20 text-violet-300" },
      sms: { label: "SMS", className: "bg-cyan-500/20 text-cyan-300" },
      phone: { label: "Phone", className: "bg-sky-500/20 text-sky-300" },
      email: { label: "Email", className: "bg-amber-500/20 text-amber-300" },
      sam: { label: "SAM", className: "bg-orange-500/20 text-orange-300" },
      meta: { label: "Meta", className: "bg-pink-500/20 text-pink-300" },
      google_lsa: { label: "LSA", className: "bg-green-500/20 text-green-300" },
      google: { label: "Google", className: "bg-blue-500/20 text-blue-300" },
      website: { label: "Website", className: "bg-emerald-500/20 text-emerald-300" },
      thumbtack: { label: "Thumbtack", className: "bg-yellow-500/20 text-yellow-300" },
      angi: { label: "Angi", className: "bg-red-500/20 text-red-300" },
      ghl: { label: "GHL", className: "bg-purple-500/20 text-purple-300" },
      housecall_pro: { label: "HCP", className: "bg-teal-500/20 text-teal-300" },
    }
    return trackableChannels[customer.lead_source] || null
  }

  const getCustomerMessages = (phoneNumber: string) => {
    const normalizedCustomerPhone = normalizePhone(phoneNumber)
    return messages.filter((m) => normalizePhone(m.phone_number) === normalizedCustomerPhone)
  }

  const getCustomerJobs = (phoneNumber: string) => {
    const normalizedCustomerPhone = normalizePhone(phoneNumber)
    return jobs.filter((j) => normalizePhone(j.phone_number) === normalizedCustomerPhone)
  }

  const getCustomerCalls = (phoneNumber: string) => {
    const normalizedCustomerPhone = normalizePhone(phoneNumber)
    return calls.filter((c) => normalizePhone(c.phone_number) === normalizedCustomerPhone)
  }

  const getCustomerRevenue = (phoneNumber: string) =>
    getCustomerJobs(phoneNumber).reduce((sum, j) => sum + (j.price || 0), 0)

  const getCustomerPaid = (phoneNumber: string) =>
    getCustomerJobs(phoneNumber)
      .filter((j) => j.paid)
      .reduce((sum, j) => sum + (j.price || 0), 0)

  // Get the most recent lead for a customer (by phone number)
  const getCustomerLead = (phoneNumber: string): Lead | null => {
    const normalizedCustomerPhone = normalizePhone(phoneNumber)
    const customerLeads = leads.filter((l) => normalizePhone(l.phone_number) === normalizedCustomerPhone)
    if (customerLeads.length === 0) return null
    // Return the most recent lead
    return customerLeads.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0]
  }

  const getJobLeadSource = (jobId: number): string => {
    const lead = leads.find((l) => l.converted_to_job_id === jobId)
    return lead?.source || ""
  }

  // Get badge config for a lead's current stage
  const getLeadBadge = (lead: Lead | null): { label: string; className: string } => {
    if (!lead) return { label: "Customer", className: "bg-zinc-700/50 text-zinc-300" }
    if (lead.status === "lost") return { label: "Inactive", className: "bg-red-500/20 text-red-400" }
    if (lead.status === "completed" || lead.status === "fulfilled") return { label: "Completed", className: "bg-zinc-600/30 text-zinc-300" }
    if (lead.status === "assigned" || lead.status === "scheduled") return { label: "Assigned", className: "bg-emerald-500/20 text-emerald-400" }
    if (lead.status === "paid") return { label: "Paid", className: "bg-green-500/20 text-green-400" }
    if (lead.status === "booked") return { label: "Booked", className: "bg-yellow-500/20 text-yellow-400" }
    if (lead.status === "qualified") return { label: "Qualified", className: "bg-violet-500/20 text-violet-400" }
    if (lead.status === "quoted" || lead.stripe_payment_link) return { label: "Quoted", className: "bg-cyan-500/20 text-cyan-400" }
    if (lead.status === "responded" || lead.status === "engaged") return { label: "Engaged", className: "bg-purple-500/20 text-purple-400" }
    if (lead.status === "contacted") return { label: "Contacted", className: "bg-sky-500/20 text-sky-400" }
    const stage = lead.followup_stage || 0
    if (stage <= 1) return { label: "New", className: "bg-blue-500/20 text-blue-400" }
    return { label: "Following Up", className: "bg-amber-500/20 text-amber-400" }
  }

  // Handle move to stage (drag & drop) - executes the action
  const handleMoveToStage = async (targetStage: number) => {
    if (!selectedCustomer) return
    const lead = getCustomerLead(selectedCustomer.phone_number)
    if (!lead) return

    try {
      // If dragging to "Lost" stage (-1), use mark_status action instead
      if (targetStage === -1) {
        const res = await fetch(`/api/leads/${lead.id}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mark_status", status: "lost" }),
        })
        const json = await res.json()
        if (json.success) {
          setLeads((prev) =>
            prev.map((l) => (l.id === lead.id ? { ...l, status: "lost" } : l))
          )
          setScheduledTasks((prev) =>
            prev.filter((t) => t.payload?.leadId !== String(lead.id))
          )
        } else {
          alert(json.error || "Failed to mark as lost")
        }
        return
      }

      const res = await fetch(`/api/leads/${lead.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move_to_stage", stage: targetStage }),
      })
      const json = await res.json()
      if (json.success) {
        // Refresh data to get the new message and scheduled tasks FIRST
        // This ensures scheduled tasks are available when the lead state updates
        const dataRes = await fetch("/api/customers")
        const dataJson = await dataRes.json()
        if (dataJson.success) {
          // Update messages and scheduled tasks first
          setMessages(dataJson.data.messages)
          setScheduledTasks(dataJson.data.scheduledTasks || [])
          // Then update the lead state (which triggers the LeadFlowProgress to clear isMoving)
          setLeads((prev) =>
            prev.map((l) =>
              l.id === lead.id
                ? { ...l, followup_stage: targetStage, status: json.data.newStatus || l.status }
                : l
            )
          )
        } else {
          // Fallback: just update the lead state
          setLeads((prev) =>
            prev.map((l) =>
              l.id === lead.id
                ? { ...l, followup_stage: targetStage, status: json.data.newStatus || l.status }
                : l
            )
          )
        }
      } else {
        alert(json.error || "Failed to move to stage")
      }
    } catch (error) {
      console.error("Failed to move to stage:", error)
      alert("Failed to move to stage")
    }
  }

  // Handle delete customer
  const handleDeleteCustomer = async () => {
    if (!selectedCustomer) return
    const name = getCustomerName(selectedCustomer)
    if (!confirm(`Delete ${name} and all their data? This cannot be undone.`)) return

    setDeletingCustomer(true)
    deletingRef.current = true
    try {
      const res = await fetch(`/api/customers?id=${selectedCustomer.id}`, { method: "DELETE" })
      const json = await res.json()
      if (!json.success) {
        alert(json.error || "Failed to delete customer")
        return
      }
      // Remove from local state
      const remaining = customers.filter((c) => c.id !== selectedCustomer.id)
      setCustomers(remaining)
      setMessages((prev) => prev.filter((m) => normalizePhone(m.phone_number) !== normalizePhone(selectedCustomer.phone_number)))
      setCalls((prev) => prev.filter((c) => normalizePhone(c.phone_number) !== normalizePhone(selectedCustomer.phone_number)))
      setLeads((prev) => prev.filter((l) => normalizePhone(l.phone_number) !== normalizePhone(selectedCustomer.phone_number)))
      setSelectedCustomer(remaining.length > 0 ? remaining[0] : null)
    } catch (error) {
      console.error("Failed to delete customer:", error)
      alert("Failed to delete customer")
    } finally {
      setDeletingCustomer(false)
      deletingRef.current = false
    }
  }

  // Handle mark customer as lost
  const handleMarkAsLost = async () => {
    if (!selectedCustomer) return
    const name = getCustomerName(selectedCustomer)
    if (!confirm(`Mark ${name} as lost (bad experience)? They won't receive any retargeting messages.`)) return

    try {
      const res = await fetch("/api/customers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedCustomer.id, lifecycle_stage: "lost" }),
      })
      const json = await res.json()
      if (json.success) {
        setCustomers((prev) => prev.map((c) => c.id === selectedCustomer.id ? { ...c, lifecycle_stage: "lost" } : c))
        setSelectedCustomer({ ...selectedCustomer, lifecycle_stage: "lost" } as typeof selectedCustomer)
      } else {
        alert(json.error || "Failed to mark as lost")
      }
    } catch {
      alert("Failed to mark as lost")
    }
  }

  // Handle save customer edits
  const handleSaveCustomer = async () => {
    if (!editingCustomer) return
    setSavingCustomer(true)
    try {
      const res = await fetch("/api/customers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingCustomer.id,
          first_name: editingCustomer.first_name || "",
          last_name: editingCustomer.last_name || "",
          email: editingCustomer.email || "",
          phone_number: editingCustomer.phone_number,
          address: editingCustomer.address || "",
          notes: editingCustomer.notes || "",
          is_commercial: editingCustomer.is_commercial || false,
        }),
      })
      const json = await res.json()
      if (json.success) {
        // Update local state
        const updated = json.data
        setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
        setSelectedCustomer(updated)
        setEditingCustomer(null)
      } else {
        alert(json.error || "Failed to update customer")
      }
    } catch (error) {
      console.error("Failed to update customer:", error)
      alert("Failed to update customer")
    } finally {
      setSavingCustomer(false)
    }
  }

  // Handle create new customer
  const handleCreateCustomer = async () => {
    if (!newCustomerForm.phone_number.replace(/\D/g, "").length) {
      setNewCustomerError("Phone number is required")
      return
    }
    setSavingNewCustomer(true)
    setNewCustomerError("")
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCustomerForm),
      })
      const json = await res.json()
      if (json.success) {
        setCustomers((prev) => [json.data, ...prev])
        setSelectedCustomer(json.data)
        setNewCustomerOpen(false)
        setNewCustomerForm({ first_name: "", last_name: "", phone_number: "", email: "", address: "", notes: "", is_commercial: false })
      } else {
        setNewCustomerError(json.error || "Failed to create customer")
      }
    } catch (error) {
      console.error("Failed to create customer:", error)
      setNewCustomerError("Failed to create customer")
    } finally {
      setSavingNewCustomer(false)
    }
  }

  // Handle save job edits
  const handleSaveJob = async () => {
    if (!editingJob) return
    setSavingJob(true)
    try {
      const res = await fetch("/api/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingJob.id,
          service_type: editingJob.service_type || "",
          address: editingJob.address || "",
          date: editingJob.date || "",
          scheduled_at: editingJob.scheduled_at || "",
          price: editingJob.price != null ? Number(editingJob.price) : undefined,
          hours: editingJob.hours != null ? Number(editingJob.hours) : undefined,
          status: editingJob.status || "",
          notes: editingJob.notes || "",
        }),
      })
      const json = await res.json()
      if (json.success) {
        // The jobs PATCH returns the full row — update local state
        const updated = json.data
        setJobs((prev) => prev.map((j) => (j.id === updated.id ? { ...j, ...updated } : j)))
        setEditingJob(null)
      } else {
        alert(json.error || "Failed to update job")
      }
    } catch (error) {
      console.error("Failed to update job:", error)
      alert("Failed to update job")
    } finally {
      setSavingJob(false)
    }
  }

  // Handle delete job (with option to delete future recurring instances)
  const [deletingJob, setDeletingJob] = useState(false)
  const handleDeleteJob = async (deleteFuture: boolean) => {
    if (!editingJob) return
    setDeletingJob(true)
    try {
      // Delete the job itself
      const res = await fetch(`/api/jobs?id=${editingJob.id}`, { method: "DELETE" })
      const json = await res.json()
      if (!json.success) {
        alert(json.error || "Failed to delete job")
        return
      }

      let deletedIds = [editingJob.id]

      // If deleting future recurring instances
      if (deleteFuture && editingJob.parent_job_id) {
        const today = editingJob.date || new Date().toISOString().split("T")[0]
        const futureJobs = jobs.filter(
          (j) =>
            j.parent_job_id === editingJob.parent_job_id &&
            j.id !== editingJob.id &&
            j.date && j.date >= today &&
            j.status !== "cancelled" && j.status !== "completed"
        )
        for (const fj of futureJobs) {
          await fetch(`/api/jobs?id=${fj.id}`, { method: "DELETE" })
          deletedIds.push(fj.id)
        }
      }

      // Update local state
      setJobs((prev) => prev.filter((j) => !deletedIds.includes(j.id)))
      setEditingJob(null)
    } catch {
      alert("Failed to delete job")
    } finally {
      setDeletingJob(false)
    }
  }

  // Handle toggle auto-response on/off - with optimistic update
  const handleToggleFollowup = async (paused: boolean) => {
    if (!selectedCustomer) return
    const lead = getCustomerLead(selectedCustomer.phone_number)
    if (!lead) return

    // Save previous state for rollback
    const previousFormData = lead.form_data

    // Parse existing form_data (handles both string and object)
    const parsedFormData = parseFormData(lead.form_data)
    const newFormData = { ...parsedFormData, followup_paused: paused }

    // Optimistic update - update UI immediately with parsed object
    setLeads((prev) =>
      prev.map((l) =>
        l.id === lead.id
          ? { ...l, form_data: newFormData }
          : l
      )
    )

    // If pausing, optimistically clear scheduled tasks from UI
    if (paused) {
      setScheduledTasks((prev) =>
        prev.filter((t) => t.payload?.leadId !== String(lead.id))
      )
    }

    try {
      const res = await fetch(`/api/leads/${lead.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_followup", paused }),
      })
      const json = await res.json()
      if (!json.success) {
        // Rollback on failure
        setLeads((prev) =>
          prev.map((l) =>
            l.id === lead.id
              ? { ...l, form_data: previousFormData }
              : l
          )
        )
        alert(json.error || "Failed to toggle auto-response")
      } else if (!paused) {
        // If resuming, refresh to get any new scheduled tasks
        const dataRes = await fetch("/api/customers")
        const dataJson = await dataRes.json()
        if (dataJson.success) {
          setScheduledTasks(dataJson.data.scheduledTasks || [])
        }
      }
    } catch (error) {
      // Rollback on error
      setLeads((prev) =>
        prev.map((l) =>
          l.id === lead.id
            ? { ...l, form_data: previousFormData }
            : l
        )
      )
      console.error("Failed to toggle auto-response:", error)
      alert("Failed to toggle auto-response")
    }
  }

  // Per-customer auto-response toggle (stored on customers table)
  const handleToggleCustomerAutoResponse = async (customer: Customer) => {
    const newPaused = !customer.auto_response_paused

    // Optimistic update
    setCustomers((prev) =>
      prev.map((c) => c.id === customer.id ? { ...c, auto_response_paused: newPaused } : c)
    )
    if (selectedCustomer?.id === customer.id) {
      setSelectedCustomer((prev) => prev ? { ...prev, auto_response_paused: newPaused } : prev)
    }

    try {
      // Update customer flag
      const res = await fetch("/api/customers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: customer.id, auto_response_paused: newPaused }),
      })
      const json = await res.json()
      if (!json.success) {
        // Rollback
        setCustomers((prev) =>
          prev.map((c) => c.id === customer.id ? { ...c, auto_response_paused: !newPaused } : c)
        )
        if (selectedCustomer?.id === customer.id) {
          setSelectedCustomer((prev) => prev ? { ...prev, auto_response_paused: !newPaused } : prev)
        }
        return
      }

      // Also sync lead followup_paused (fire-and-forget, don't refresh full data)
      const lead = getCustomerLead(customer.phone_number)
      if (lead) {
        fetch(`/api/leads/${lead.id}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "toggle_followup", paused: newPaused }),
        }).catch(() => {})
        // Optimistic lead update
        const parsedFormData = parseFormData(lead.form_data)
        setLeads((prev) =>
          prev.map((l) =>
            l.id === lead.id ? { ...l, form_data: { ...parsedFormData, followup_paused: newPaused } } : l
          )
        )
      }
    } catch {
      // Rollback
      setCustomers((prev) =>
        prev.map((c) => c.id === customer.id ? { ...c, auto_response_paused: !newPaused } : c)
      )
      if (selectedCustomer?.id === customer.id) {
        setSelectedCustomer((prev) => prev ? { ...prev, auto_response_paused: !newPaused } : prev)
      }
    }
  }

  const getCustomerTimeline = (customer: Customer): TimelineItem[] => {
    const items: TimelineItem[] = []

    // Add messages
    getCustomerMessages(customer.phone_number).forEach((msg) => {
      items.push({ type: "message", timestamp: msg.timestamp, data: msg })
    })

    // Add calls
    getCustomerCalls(customer.phone_number).forEach((call) => {
      items.push({ type: "call", timestamp: call.created_at, data: call })
    })

    // Sort by timestamp ascending; calls before messages when timestamps tie
    items.sort((a, b) => {
      const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      if (diff !== 0) return diff
      // Same timestamp: calls come before messages (call triggers the text)
      if (a.type === "call" && b.type !== "call") return -1
      if (a.type !== "call" && b.type === "call") return 1
      return 0
    })
    return items
  }

  const formatPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "")
    const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
    if (national.length === 10) {
      return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
    }
    return phone
  }

  const sendSms = async () => {
    if (!selectedCustomer || !smsMessage.trim() || sendingSms) return

    setSendingSms(true)
    try {
      const res = await fetch("/api/actions/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selectedCustomer.phone_number,
          message: smsMessage.trim(),
        }),
      })

      const json = await res.json()
      if (res.ok && json.success) {
        // Add the message to the local state immediately for UI feedback
        const newMessage: Message = {
          id: Date.now(),
          phone_number: selectedCustomer.phone_number,
          role: "business",
          content: smsMessage.trim(),
          direction: "outbound",
          timestamp: new Date().toISOString(),
          ai_generated: false,
        }
        setMessages((prev) => [...prev, newMessage])
        setSmsMessage("")
        // Scroll to bottom
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
        }, 100)
        // Reset followup timer: push pending tasks 30 min from now so the bot doesn't double-text
        const lead = getCustomerLead(selectedCustomer.phone_number)
        if (lead?.id) {
          fetch(`/api/leads/${lead.id}/actions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reschedule_after_contact" }),
          }).catch(() => {})
        }
      } else {
        alert(json.error || "Failed to send message")
      }
    } catch (error) {
      console.error("Failed to send SMS:", error)
      alert("Failed to send message")
    } finally {
      setSendingSms(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendSms()
    }
  }

  // Close payment popover on outside click
  useEffect(() => {
    if (!paymentOpen) return
    const handler = (e: MouseEvent) => {
      if (paymentRef.current && !paymentRef.current.contains(e.target as Node)) {
        setPaymentOpen(false)
        setPaymentType(null)
        setPaymentResult(null)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [paymentOpen])

  const handleGeneratePaymentLink = async (type: string) => {
    if (!selectedCustomer) return
    setPaymentLoading(true)
    setPaymentResult(null)
    setPaymentCopied(false)
    setPaymentSmsSent(false)

    try {
      const body: Record<string, unknown> = {
        customerId: selectedCustomer.id,
        type,
      }
      if (type === "payment") {
        body.amount = parseFloat(paymentAmount)
        body.description = "Payment"
      }
      if (paymentJobId) body.jobId = paymentJobId

      const res = await fetch("/api/actions/generate-payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        setPaymentResult({ url: json.url, invoiceId: json.invoiceId })
      } else {
        alert(json.error || "Failed to generate link")
      }
    } catch {
      alert("Failed to generate link")
    } finally {
      setPaymentLoading(false)
    }
  }

  const handlePaymentCopy = () => {
    if (paymentResult?.url) {
      navigator.clipboard.writeText(paymentResult.url)
      setPaymentCopied(true)
      setTimeout(() => setPaymentCopied(false), 2000)
    }
  }

  const [paymentSmsSending, setPaymentSmsSending] = useState(false)
  const handlePaymentSms = async () => {
    if (!paymentResult?.url || !selectedCustomer || paymentSmsSending || paymentSmsSent) return
    setPaymentSmsSending(true)
    setPaymentSmsSent(false)
    try {
      const res = await fetch("/api/actions/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selectedCustomer.phone_number,
          message: `Here's your payment link: ${paymentResult.url}`,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setPaymentSmsSent(true)
      } else {
        alert(json.error || "Failed to send SMS")
      }
    } catch {
      alert("Failed to send SMS")
    } finally {
      setPaymentSmsSending(false)
    }
  }

  const handleChargeCard = async () => {
    if (!selectedCustomer || chargeCardLoading) return
    const amt = parseFloat(paymentAmount)
    if (!amt || amt <= 0) return

    setChargeCardLoading(true)
    setChargeCardResult(null)
    try {
      const res = await fetch("/api/actions/charge-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: selectedCustomer.id,
          amount: amt,
          description: chargeCardDescription || undefined,
        }),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        setChargeCardResult({ success: true, amount: json.amount })
      } else {
        setChargeCardResult({ success: false, error: json.error || "Charge failed" })
      }
    } catch {
      setChargeCardResult({ success: false, error: "Failed to charge card" })
    } finally {
      setChargeCardLoading(false)
    }
  }

  const handleCopyTranscript = async () => {
    if (!selectedCustomer) return
    const customerName = getCustomerName(selectedCustomer)
    const lead = leads.find((l) => normalizePhone(l.phone_number) === normalizePhone(selectedCustomer.phone_number))
    const formData = lead?.form_data
      ? (typeof lead.form_data === "string" ? (() => { try { return JSON.parse(lead.form_data) } catch { return {} } })() : lead.form_data)
      : {}
    const custJobs = getCustomerJobs(selectedCustomer.phone_number)
    const custCalls = getCustomerCalls(selectedCustomer.phone_number)

    // === SECTION 1: Customer Info ===
    const infoLines = [
      `=== CUSTOMER INFO ===`,
      `Name: ${customerName}`,
      `Phone: ${selectedCustomer.phone_number}`,
      `Email: ${selectedCustomer.email || "—"}`,
      `Address: ${selectedCustomer.address || "—"}`,
      `Lead Source: ${selectedCustomer.lead_source || lead?.source || "—"}`,
      `Lead Status: ${lead?.status || "—"}`,
      `Lifecycle Stage: ${selectedCustomer.lifecycle_stage || "—"}`,
      `Created: ${selectedCustomer.created_at ? new Date(selectedCustomer.created_at).toISOString() : "—"}`,
      `Card on File: ${selectedCustomer.card_on_file_at ? "Yes" : "No"}`,
      `Stripe Customer: ${selectedCustomer.stripe_customer_id || "—"}`,
      `SMS Opt-Out: ${selectedCustomer.sms_opt_out ? "Yes" : "No"}`,
      `Commercial: ${selectedCustomer.is_commercial ? "Yes" : "No"}`,
      `Auto-Response Paused: ${selectedCustomer.auto_response_paused ? "Yes" : "No"}`,
      `Preferred Frequency: ${selectedCustomer.preferred_frequency || "—"}`,
      `Preferred Day: ${selectedCustomer.preferred_day || "—"}`,
      `Total Jobs: ${custJobs.length}`,
      `Total Revenue: $${getCustomerRevenue(selectedCustomer.phone_number).toLocaleString()}`,
      `Total Paid: $${getCustomerPaid(selectedCustomer.phone_number).toLocaleString()}`,
      `Total Calls: ${custCalls.length}`,
    ]
    if (selectedCustomer.notes) infoLines.push(`Notes: ${selectedCustomer.notes}`)
    if (selectedCustomer.recurring_notes) infoLines.push(`Recurring Notes: ${selectedCustomer.recurring_notes}`)

    // HCP data
    if (formData.hcp_lead_id || formData.hcp_work_requested) {
      infoLines.push(``, `--- HouseCall Pro ---`)
      if (formData.hcp_lead_id) infoLines.push(`HCP Lead ID: ${formData.hcp_lead_id}`)
      if (formData.hcp_lead_source) infoLines.push(`HCP Lead Source: ${formData.hcp_lead_source}`)
      if (formData.hcp_work_requested) infoLines.push(`HCP Work Requested: ${formData.hcp_work_requested}`)
      if (formData.hcp_job_id) infoLines.push(`HCP Job ID: ${formData.hcp_job_id}`)
    }

    // Raw form data
    if (Object.keys(formData).length > 0) {
      infoLines.push(``, `--- Raw Lead Data ---`, JSON.stringify(formData, null, 2))
    }

    // === SECTION 2: Conversation (messages + calls) ===
    const timeline = getCustomerTimeline(selectedCustomer)
    const convoLines = [``, `=== CONVERSATION (${timeline.length} items) ===`]
    timeline.forEach((item) => {
      if (item.type === "message") {
        const msg = item.data as Message
        let sender: string
        if (msg.role === "client") sender = customerName
        else if (msg.role === "assistant") sender = "OSIRIS (AI)"
        else if (msg.role === "business") sender = "Staff"
        else sender = "System"
        const ts = new Date(msg.timestamp).toISOString()
        convoLines.push(`[${ts}] ${sender} (${msg.direction}): ${msg.content}`)
      } else {
        const call = item.data as Call
        const dir = call.direction === "inbound" ? "Inbound" : "Outbound"
        const dur = call.duration_seconds ? ` (${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s)` : ""
        const ts = new Date(call.created_at).toISOString()
        convoLines.push(`[${ts}] [${dir} Call${dur}] outcome=${call.outcome || "unknown"}`)
        if (call.transcript) convoLines.push(call.transcript)
      }
    })

    // === SECTION 3: Jobs ===
    const jobLines = [``, `=== JOBS (${custJobs.length}) ===`]
    custJobs.forEach((j) => {
      jobLines.push(`Job #${j.id} | ${j.service_type || "—"} | ${j.status || "—"} | ${j.date || "—"} | $${j.price || 0} | paid=${j.paid ? "yes" : "no"} | ${j.address || "—"}`)
      if (j.notes) jobLines.push(`  Notes: ${j.notes}`)
    })

    // === SECTION 4: Activity Logs (fetch on-demand if not already loaded) ===
    let logs = customerLogs
    if (logs.length === 0) {
      try {
        const res = await fetch(`/api/actions/customer-logs?phone=${encodeURIComponent(selectedCustomer.phone_number)}&customer_id=${selectedCustomer.id}`)
        const data = await res.json()
        logs = data.data || []
      } catch {
        logs = []
      }
    }
    const logLines = [``, `=== ACTIVITY LOGS (${logs.length}) ===`]
    logs.forEach((log: SystemLog) => {
      const ts = new Date(log.created_at).toISOString()
      const meta = log.metadata ? JSON.stringify(log.metadata) : ""
      logLines.push(`[${ts}] [${log.source}] ${log.event_type}: ${log.message || "—"}${log.job_id ? ` | job=${log.job_id}` : ""}${log.lead_id ? ` | lead=${log.lead_id}` : ""}${log.cleaner_id ? ` | cleaner=${log.cleaner_id}` : ""}${meta ? `\n  metadata: ${meta}` : ""}`)
    })

    const fullText = [...infoLines, ...convoLines, ...jobLines, ...logLines].join("\n")
    navigator.clipboard.writeText(fullText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const tabs: { id: TabType; label: string; count?: number }[] = selectedCustomer
    ? [
        {
          id: "messages",
          label: "Messages",
          count:
            getCustomerMessages(selectedCustomer.phone_number).length +
            getCustomerCalls(selectedCustomer.phone_number).length,
        },
        { id: "jobs", label: "Jobs", count: getCustomerJobs(selectedCustomer.phone_number).length },
        {
          id: "quotes" as TabType,
          label: "Quotes",
          count: customerQuotes.length,
        },
        ...(!isHouseCleaning ? [{
          id: "membership" as TabType,
          label: "Membership",
          count: getCustomerMemberships(selectedCustomer.id).filter(m => m.status === "active" || m.status === "paused").length,
        }] : []),
        {
          id: "info" as TabType,
          label: "Info",
        },
      ]
    : []

  // Server already sorts by last activity and handles search — just use as-is
  const filteredCustomers = customers

  // localStorage-based read tracking for unread badges
  const [readVersion, setReadVersion] = useState(0)
  const getReadTimestamps = (): Record<number, string> => {
    if (typeof window === "undefined") return {}
    try {
      return JSON.parse(localStorage.getItem("customerReadTimestamps") || "{}")
    } catch { return {} }
  }
  const markAsRead = (customerId: number) => {
    const timestamps = getReadTimestamps()
    timestamps[customerId] = new Date().toISOString()
    localStorage.setItem("customerReadTimestamps", JSON.stringify(timestamps))
    setReadVersion((v) => v + 1) // trigger useMemo recompute
  }

  // Derived data for iMessage-style rows
  const customerRowData = useMemo(() => {
    const readTimestamps = getReadTimestamps()
    void readVersion // dependency to recompute on mark-as-read
    const lowerSearch = searchQuery.trim().toLowerCase()
    return filteredCustomers.map((customer) => {
      const customerMessages = getCustomerMessages(customer.phone_number)
      const lastMessage = customerMessages.length > 0
        ? customerMessages[customerMessages.length - 1]
        : null

      // When searching, find the most recent message matching the search term for preview
      let previewMessage = lastMessage
      if (lowerSearch && customerMessages.length > 0) {
        for (let i = customerMessages.length - 1; i >= 0; i--) {
          if (customerMessages[i].content?.toLowerCase().includes(lowerSearch)) {
            previewMessage = customerMessages[i]
            break
          }
        }
      }

      const lastReadTs = readTimestamps[customer.id]
      const unreadCount = lastReadTs
        ? customerMessages.filter(
            (m) => m.direction === "inbound" && m.timestamp > lastReadTs
          ).length
        : customerMessages.filter((m) => m.direction === "inbound").length > 0
          ? customerMessages.filter((m) => m.direction === "inbound").length
          : 0
      return { customer, lastMessage, previewMessage, unreadCount }
    })
  }, [filteredCustomers, messages, readVersion, searchQuery])

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-fade-in">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Main Layout */}
        <div className="flex flex-1 gap-4 min-h-0 overflow-hidden">
          {/* Customer List Sidebar - Hidden on mobile when a customer is selected */}
          <div className={`w-full md:w-72 flex-shrink-0 flex flex-col min-h-0 overflow-hidden stagger-1 ${selectedCustomer ? "hidden md:flex" : "flex"}`}>
            <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 flex flex-col h-full overflow-hidden">
              <div className="p-3 border-b border-zinc-800 space-y-2">
                <div className="relative">
                  <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search customers..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700/50 text-sm text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                  />
                  {searchLoading && (
                    <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 animate-spin" />
                  )}
                </div>
                <div className="relative">
                  <button
                    onClick={() => setActionsOpen(!actionsOpen)}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-700/50 hover:bg-zinc-700 border border-zinc-600/50 rounded-lg transition-colors"
                  >
                    {(syncingContacts || syncingMessages) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    Actions
                  </button>
                  {actionsOpen && (
                    <div className="absolute z-50 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden">
                      <button
                        onClick={() => { setActionsOpen(false); setNewCustomerOpen(true); setNewCustomerError("") }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700/50 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        New Customer
                      </button>
                      <button
                        onClick={() => { setActionsOpen(false); setBatchOpen(true); setBatchText(""); setBatchParsed(null); setBatchResult(null) }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700/50 transition-colors"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        Batch Add
                      </button>
                      <button
                        onClick={async () => {
                          setActionsOpen(false)
                          setSyncingContacts(true)
                          setSyncResult(null)
                          try {
                            const res = await fetch("/api/actions/sync-openphone-contacts", { method: "POST" })
                            const json = await res.json()
                            if (json.success) {
                              setSyncResult({ updated: json.updated, created: json.created, total_contacts: json.total_contacts })
                              const refresh = await fetch("/api/customers")
                              const refreshJson = await refresh.json()
                              if (refreshJson.success) {
                                setCustomers(refreshJson.data.customers)
                                setMessages(refreshJson.data.messages)
                                setJobs(refreshJson.data.jobs)
                                setCalls(refreshJson.data.calls)
                                setLeads(refreshJson.data.leads || [])
                                setCleanerPhones(refreshJson.data.cleanerPhones || [])
                              }
                            } else { alert(json.error || "Failed to sync contacts") }
                          } catch { alert("Failed to sync contacts") }
                          finally { setSyncingContacts(false) }
                        }}
                        disabled={syncingContacts}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700/50 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {syncingContacts ? "Syncing..." : "Sync OpenPhone Contacts"}
                      </button>
                      <button
                        onClick={async () => {
                          setActionsOpen(false)
                          setSyncingMessages(true)
                          setMsgSyncResult(null)
                          try {
                            const res = await fetch("/api/actions/sync-openphone-messages", { method: "POST" })
                            const json = await res.json()
                            if (json.success) {
                              setMsgSyncResult({ messages_imported: json.messages_imported, calls_imported: json.calls_imported, partial: json.partial })
                              const refresh = await fetch("/api/customers")
                              const refreshJson = await refresh.json()
                              if (refreshJson.success) {
                                setCustomers(refreshJson.data.customers)
                                setMessages(refreshJson.data.messages)
                                setJobs(refreshJson.data.jobs)
                                setCalls(refreshJson.data.calls)
                                setLeads(refreshJson.data.leads || [])
                                setCleanerPhones(refreshJson.data.cleanerPhones || [])
                              }
                            } else { alert(json.error || "Failed to sync messages") }
                          } catch { alert("Failed to sync message history") }
                          finally { setSyncingMessages(false) }
                        }}
                        disabled={syncingMessages}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700/50 transition-colors disabled:opacity-50"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {syncingMessages ? "Pulling history..." : "Import Message History"}
                      </button>
                      <div className="border-t border-zinc-700/50" />
                      <button
                        onClick={async () => {
                          setActionsOpen(false)
                          try {
                            const res = await fetch("/api/actions/export", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ type: "customers" }),
                            })
                            if (!res.ok) { alert("Export failed"); return }
                            const blob = await res.blob()
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement("a")
                            a.href = url
                            a.download = res.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") || "customers.csv"
                            a.click()
                            URL.revokeObjectURL(url)
                          } catch { alert("Export failed") }
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700/50 transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Export Customers (CSV)
                      </button>
                      <button
                        onClick={async () => {
                          setActionsOpen(false)
                          try {
                            const res = await fetch("/api/actions/export", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ type: "jobs" }),
                            })
                            if (!res.ok) { alert("Export failed"); return }
                            const blob = await res.blob()
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement("a")
                            a.href = url
                            a.download = res.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") || "jobs.csv"
                            a.click()
                            URL.revokeObjectURL(url)
                          } catch { alert("Export failed") }
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700/50 transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Export Jobs (CSV)
                      </button>
                    </div>
                  )}
                </div>
                {syncResult && (
                  <p className="text-xs text-center text-emerald-400">
                    {syncResult.updated} updated, {syncResult.created} new from {syncResult.total_contacts} contacts
                  </p>
                )}
                {msgSyncResult && (
                  <p className="text-xs text-center text-amber-400">
                    {msgSyncResult.messages_imported} msgs + {msgSyncResult.calls_imported} calls
                    {msgSyncResult.partial && " (run again)"}
                  </p>
                )}
              </div>
              <div className="flex-1 overflow-y-auto">
                {filteredCustomers.length === 0 ? (
                  <div className="p-4 text-center text-sm text-zinc-600">No customers found</div>
                ) : (
                  customerRowData.map(({ customer, lastMessage, previewMessage, unreadCount }) => {
                    const isSelected = selectedCustomer?.id === customer.id
                    const name = getCustomerName(customer)

                    return (
                      <button
                        key={customer.id}
                        onClick={() => {
                          setSelectedCustomer(customer)
                          markAsRead(customer.id)
                          if (typeof window !== "undefined") localStorage.setItem("selectedCustomerId", String(customer.id))
                          if (searchQuery.trim()) setPendingScrollSearch(searchQuery.trim().toLowerCase())
                          switchTab("messages")
                        }}
                        className={`w-full text-left px-3 py-2.5 border-b border-zinc-800/50 ${
                          isSelected ? "bg-zinc-800/80" : "hover:bg-zinc-800/40"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Avatar with card-on-file dot + membership ring */}
                          <div className="relative flex-shrink-0 mt-0.5">
                            <div
                              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${
                                isSelected
                                  ? "bg-purple-500/20 text-purple-300"
                                  : "bg-zinc-800 text-zinc-400"
                              }`}
                              style={!isHouseCleaning && getCustomerMembership(customer.id)
                                ? { border: '2px solid rgba(255, 215, 0, 0.7)' }
                                : undefined
                              }
                            >
                              {name.charAt(0).toUpperCase()}
                            </div>
                            {customer.card_on_file_at && (
                              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-zinc-900" title="Card on file" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            {/* Top row: name + badges + timestamp */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className={`text-sm truncate ${unreadCount > 0 ? "font-semibold text-zinc-100" : "font-medium text-zinc-200"}`}>{name}</span>
                                {cleanerPhones.includes(normalizePhone(customer.phone_number)) ? (
                                  <span className="flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 leading-none">Crew</span>
                                ) : (() => {
                                  const srcBadge = getSourceBadge(customer)
                                  if (srcBadge) {
                                    return <span className={`flex-shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full ${srcBadge.className} leading-none`}>{srcBadge.label}</span>
                                  }
                                  return null
                                })()}
                                {customer.card_on_file_at && (
                                  <CreditCard className="flex-shrink-0 w-3 h-3 text-emerald-400" title="Card on file" />
                                )}
                              </div>
                              {lastMessage && (
                                <span className="text-[11px] text-zinc-500 flex-shrink-0">
                                  {formatThreadTimestamp(lastMessage.timestamp)}
                                </span>
                              )}
                            </div>
                            {/* Bottom row: message preview + unread badge */}
                            <div className="flex items-center justify-between gap-2 mt-0.5">
                              <span className="text-xs text-zinc-500 truncate">
                                {previewMessage
                                  ? (() => {
                                      const content = previewMessage.content || ""
                                      const prefix = previewMessage.direction === "outbound" ? "You: " : ""
                                      const lq = searchQuery.trim().toLowerCase()
                                      if (!lq || !content.toLowerCase().includes(lq)) {
                                        return `${prefix}${content}`
                                      }
                                      // Show snippet centered around the match
                                      const idx = content.toLowerCase().indexOf(lq)
                                      const start = Math.max(0, idx - 30)
                                      const end = Math.min(content.length, idx + lq.length + 30)
                                      const snippet = (start > 0 ? "..." : "") + content.slice(start, end) + (end < content.length ? "..." : "")
                                      return `${prefix}${snippet}`
                                    })()
                                  : "No messages yet"}
                              </span>
                              {unreadCount > 0 && (
                                <span className="flex-shrink-0 min-w-[18px] h-[18px] rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                                  {unreadCount > 99 ? "99+" : unreadCount}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </div>

          {/* Customer Detail - Scrollable content area */}
          <div className={`flex-1 flex flex-col gap-2 min-h-0 stagger-2 ${selectedCustomer ? "flex" : "hidden md:flex"}`}>
            {loading ? <CubeLoader /> : selectedCustomer ? (
              <div className="flex flex-col flex-1 min-h-0 gap-2 animate-fade-in">
                {/* Mobile back button */}
                <button
                  onClick={() => setSelectedCustomer(null)}
                  className="md:hidden flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 py-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  Back to customers
                </button>

                {/* Customer Info + Tabs */}
                <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 flex flex-col flex-1 min-h-0">
                  {/* Cleaner banner */}
                  {cleanerPhones.includes(normalizePhone(selectedCustomer.phone_number)) && (
                    <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-xs text-orange-300 flex items-center gap-2">
                      <Crown className="w-3.5 h-3.5 flex-shrink-0" />
                      This person is also a crew member. Auto-retargeting is suppressed.
                    </div>
                  )}

                  {/* Customer header */}
                  <div className="px-5 pt-4 pb-0">
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="w-9 h-9 rounded-full bg-purple-500/20 flex items-center justify-center text-sm font-semibold text-purple-300"
                        style={!isHouseCleaning && getCustomerMembership(selectedCustomer.id)
                          ? { border: '2px solid rgba(255, 215, 0, 0.7)' }
                          : undefined
                        }
                      >
                        {getCustomerName(selectedCustomer).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h2 className="text-base font-semibold text-zinc-100">
                            {getCustomerName(selectedCustomer)}
                          </h2>
                        </div>
                        <p className="text-xs text-zinc-500">
                          {formatPhone(selectedCustomer.phone_number)}
                        </p>
                      </div>
                      {/* Edit Customer */}
                      <button
                        onClick={() => setEditingCustomer({ ...selectedCustomer })}
                        className="p-1.5 rounded text-zinc-500 hover:text-purple-400 hover:bg-purple-400/10 transition-colors"
                        title="Edit customer"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>

                      {/* Payment Links */}
                      <div className="relative" ref={paymentRef}>
                        <button
                          onClick={() => {
                            setPaymentOpen(!paymentOpen)
                            setPaymentType(null)
                            setPaymentResult(null)
                            setPaymentAmount("")
                            setPaymentJobId("")
                            setChargeCardResult(null)
                            setChargeCardDescription("")
                          }}
                          className={`p-1.5 rounded transition-colors ${paymentOpen ? "text-purple-400 bg-purple-400/10" : "text-zinc-500 hover:text-purple-400 hover:bg-purple-400/10"}`}
                          title="Payment links"
                        >
                          <DollarSign className="w-4 h-4" />
                        </button>

                        {paymentOpen && (
                          <>
                          {/* Backdrop for mobile */}
                          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => { setPaymentOpen(false); setPaymentType(null); setPaymentResult(null) }} />
                          <div className="fixed inset-x-4 top-1/4 z-50 w-auto max-w-sm mx-auto bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl md:absolute md:inset-auto md:right-0 md:top-9 md:w-72 md:mx-0">
                            {!paymentType && !paymentResult && !chargeCardResult && (
                              <div className="p-2 space-y-0.5">
                                <p className="px-2 py-1.5 text-xs font-medium text-zinc-400 uppercase tracking-wider">Generate Link</p>
                                {[
                                  { key: "card_on_file", label: "Card on File", desc: "Send link to save card", icon: CreditCard },
                                  { key: "enter_card", label: "Enter Card", desc: "Type in card details", icon: KeyRound },
                                  { key: "payment", label: "Payment Link", desc: "Custom amount", icon: DollarSign },
                                  { key: "deposit", label: "Deposit", desc: "50% + 3% fee", icon: DollarSign },
                                  { key: "invoice", label: "Invoice", desc: "Email invoice", icon: FileText },
                                ].map((opt) => (
                                  <button
                                    key={opt.key}
                                    onClick={() => {
                                      if (opt.key === "enter_card") {
                                        setPaymentType("enter_card")
                                      } else if (opt.key === "payment") {
                                        setPaymentType("payment")
                                      } else if (opt.key === "deposit" || opt.key === "invoice") {
                                        // Need to pick a job first
                                        const custJobs = getCustomerJobs(selectedCustomer.phone_number).filter(j => j.status !== "cancelled")
                                        if (custJobs.length === 0) {
                                          alert("No active jobs found for this customer")
                                          return
                                        }
                                        if (custJobs.length === 1) {
                                          setPaymentJobId(String(custJobs[0].id))
                                        }
                                        setPaymentType(opt.key)
                                      } else {
                                        handleGeneratePaymentLink(opt.key)
                                        setPaymentType(opt.key)
                                      }
                                    }}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-zinc-800 transition-colors"
                                  >
                                    <opt.icon className="w-4 h-4 text-purple-400 flex-shrink-0" />
                                    <div>
                                      <div className="text-sm text-zinc-200">{opt.label}</div>
                                      <div className="text-xs text-zinc-500">{opt.desc}</div>
                                    </div>
                                  </button>
                                ))}
                                {selectedCustomer.card_on_file_at && (
                                  <>
                                    <div className="mx-2 my-1.5 border-t border-zinc-700/50" />
                                    <p className="px-2 py-1.5 text-xs font-medium text-zinc-400 uppercase tracking-wider">Charge</p>
                                    <button
                                      onClick={() => setPaymentType("charge_card")}
                                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-zinc-800 transition-colors"
                                    >
                                      <Zap className="w-4 h-4 text-amber-400 flex-shrink-0" />
                                      <div>
                                        <div className="text-sm text-zinc-200">Charge Card</div>
                                        <div className="text-xs text-zinc-500">Charge saved card</div>
                                      </div>
                                    </button>
                                  </>
                                )}
                              </div>
                            )}

                            {/* Payment Link — amount input */}
                            {paymentType === "payment" && !paymentResult && (
                              <div className="p-4 space-y-3">
                                <p className="text-sm font-medium text-zinc-200">Payment Link</p>
                                <input
                                  type="number"
                                  value={paymentAmount}
                                  onChange={(e) => setPaymentAmount(e.target.value)}
                                  placeholder="Amount ($)"
                                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                                  autoFocus
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => setPaymentType(null)}
                                    className="flex-1 px-3 py-2 text-xs text-zinc-400 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
                                  >
                                    Back
                                  </button>
                                  <button
                                    onClick={() => handleGeneratePaymentLink("payment")}
                                    disabled={paymentLoading || !paymentAmount || parseFloat(paymentAmount) <= 0}
                                    className="flex-1 px-3 py-2 text-xs font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-500 disabled:opacity-50 transition-colors"
                                  >
                                    {paymentLoading ? "Generating..." : "Generate"}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Deposit / Invoice — job picker (if multiple jobs) */}
                            {(paymentType === "deposit" || paymentType === "invoice") && !paymentResult && !paymentJobId && (
                              <div className="p-4 space-y-3">
                                <p className="text-sm font-medium text-zinc-200">Select Job</p>
                                {getCustomerJobs(selectedCustomer.phone_number)
                                  .filter(j => j.status !== "cancelled")
                                  .map((job) => (
                                    <button
                                      key={job.id}
                                      onClick={() => setPaymentJobId(String(job.id))}
                                      className="w-full flex justify-between items-center px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
                                    >
                                      <span className="text-sm text-zinc-200">{job.service_type || "Cleaning"}</span>
                                      <span className="text-xs text-zinc-400">${job.price || 0}</span>
                                    </button>
                                  ))}
                                <button
                                  onClick={() => { setPaymentType(null); setPaymentJobId("") }}
                                  className="w-full px-3 py-2 text-xs text-zinc-400 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
                                >
                                  Back
                                </button>
                              </div>
                            )}

                            {/* Deposit / Invoice — confirm with selected job */}
                            {(paymentType === "deposit" || paymentType === "invoice") && !paymentResult && paymentJobId && (
                              <div className="p-4 space-y-3">
                                <p className="text-sm font-medium text-zinc-200">
                                  {paymentType === "deposit" ? "Generate Deposit Link" : "Send Invoice"}
                                </p>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => { setPaymentType(null); setPaymentJobId("") }}
                                    className="flex-1 px-3 py-2 text-xs text-zinc-400 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
                                  >
                                    Back
                                  </button>
                                  <button
                                    onClick={() => handleGeneratePaymentLink(paymentType)}
                                    disabled={paymentLoading}
                                    className="flex-1 px-3 py-2 text-xs font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-500 disabled:opacity-50 transition-colors"
                                  >
                                    {paymentLoading ? "Generating..." : paymentType === "invoice" ? "Send Invoice" : "Generate"}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Enter Card — Stripe Elements */}
                            {paymentType === "enter_card" && (
                              <StripeCardForm
                                customerId={String(selectedCustomer.id)}
                                onSuccess={() => {
                                  setPaymentType(null)
                                  setPaymentOpen(false)
                                  // Update local customer data to show card badge
                                  selectedCustomer.card_on_file_at = new Date().toISOString()
                                }}
                                onCancel={() => setPaymentType(null)}
                              />
                            )}

                            {/* Charge Card — amount input */}
                            {paymentType === "charge_card" && !chargeCardResult && (
                              <div className="p-4 space-y-3">
                                <p className="text-sm font-medium text-zinc-200">Charge Card on File</p>
                                <input
                                  type="number"
                                  value={paymentAmount}
                                  onChange={(e) => setPaymentAmount(e.target.value)}
                                  placeholder="Amount ($)"
                                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                                  autoFocus
                                />
                                <input
                                  type="text"
                                  value={chargeCardDescription}
                                  onChange={(e) => setChargeCardDescription(e.target.value)}
                                  placeholder="Description (optional)"
                                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => { setPaymentType(null); setPaymentAmount(""); setChargeCardDescription("") }}
                                    className="flex-1 px-3 py-2 text-xs text-zinc-400 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
                                  >
                                    Back
                                  </button>
                                  <button
                                    onClick={handleChargeCard}
                                    disabled={chargeCardLoading || !paymentAmount || parseFloat(paymentAmount) <= 0}
                                    className="flex-1 px-3 py-2 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-500 disabled:opacity-50 transition-colors"
                                  >
                                    {chargeCardLoading ? "Charging..." : `Charge $${paymentAmount || "0"}`}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Charge Card — result */}
                            {chargeCardResult && (
                              <div className="p-4 space-y-3">
                                {chargeCardResult.success ? (
                                  <>
                                    <p className="text-sm font-medium text-emerald-400">Charge Successful!</p>
                                    <p className="text-xs text-zinc-400">
                                      ${chargeCardResult.amount?.toFixed(2)} charged to card on file. SMS receipt sent.
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <p className="text-sm font-medium text-red-400">Charge Failed</p>
                                    <p className="text-xs text-zinc-400">{chargeCardResult.error}</p>
                                  </>
                                )}
                                <button
                                  onClick={() => { setPaymentType(null); setChargeCardResult(null); setPaymentOpen(false); setPaymentAmount(""); setChargeCardDescription("") }}
                                  className="w-full px-3 py-2 text-xs text-zinc-400 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
                                >
                                  Done
                                </button>
                              </div>
                            )}

                            {/* Loading state */}
                            {paymentType === "card_on_file" && !paymentResult && paymentLoading && (
                              <div className="p-4 flex items-center justify-center gap-2 text-sm text-zinc-400">
                                <Loader2 className="w-4 h-4 animate-spin" /> Generating...
                              </div>
                            )}

                            {/* Result — URL + copy/SMS */}
                            {paymentResult && (
                              <div className="p-4 space-y-3">
                                <p className="text-sm font-medium text-emerald-400">
                                  {paymentResult.invoiceId ? "Invoice Sent!" : "Link Generated!"}
                                </p>
                                {paymentResult.url && (
                                  <>
                                    <div className="px-3 py-2 bg-zinc-800 rounded-lg text-xs text-zinc-300 break-all max-h-20 overflow-y-auto">
                                      {paymentResult.url}
                                    </div>
                                    <div className="flex gap-2">
                                      <button
                                        onClick={handlePaymentCopy}
                                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors"
                                      >
                                        {paymentCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                        {paymentCopied ? "Copied" : "Copy"}
                                      </button>
                                      <button
                                        onClick={handlePaymentSms}
                                        disabled={paymentSmsSent}
                                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-purple-600 hover:bg-purple-500 disabled:bg-emerald-600 text-white rounded-lg transition-colors"
                                      >
                                        {paymentSmsSent ? <Check className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                                        {paymentSmsSent ? "Sent" : "Send SMS"}
                                      </button>
                                    </div>
                                  </>
                                )}
                                {paymentResult.invoiceId && !paymentResult.url && (
                                  <p className="text-xs text-zinc-400">Invoice emailed to customer.</p>
                                )}
                                <button
                                  onClick={() => { setPaymentType(null); setPaymentResult(null); setPaymentOpen(false) }}
                                  className="w-full px-3 py-2 text-xs text-zinc-400 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
                                >
                                  Done
                                </button>
                              </div>
                            )}
                          </div>
                          </>
                        )}
                      </div>

                      {/* Copy Transcript */}
                      <button
                        onClick={handleCopyTranscript}
                        className="p-1.5 rounded text-zinc-500 hover:text-purple-400 hover:bg-purple-400/10 transition-colors"
                        title="Copy transcript"
                      >
                        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>

                      {/* Mark as Lost */}
                      <button
                        onClick={handleMarkAsLost}
                        className="p-1.5 rounded text-zinc-500 hover:text-orange-400 hover:bg-orange-400/10 transition-colors"
                        title="Mark as lost (bad experience)"
                      >
                        <Ban className="w-4 h-4" />
                      </button>

                      {/* Delete Customer */}
                      <button
                        onClick={handleDeleteCustomer}
                        disabled={deletingCustomer}
                        className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                        title="Delete customer"
                      >
                        {deletingCustomer ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>

                      {/* SMS Opt-Out Badge */}
                      {selectedCustomer.sms_opt_out && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-red-500/20 text-red-400">
                          SMS Opted Out
                        </span>
                      )}

                      {/* Per-Customer Auto-Response Toggle */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400">Auto-text</span>
                        <button
                          onClick={() => handleToggleCustomerAutoResponse(selectedCustomer)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            selectedCustomer.auto_response_paused
                              ? "bg-zinc-600"
                              : "bg-emerald-500"
                          }`}
                          title={selectedCustomer.auto_response_paused ? "Enable auto-texting for this customer" : "Pause auto-texting for this customer"}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              selectedCustomer.auto_response_paused
                                ? "translate-x-1"
                                : "translate-x-[18px]"
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Tab navigation */}
                    <div className="flex gap-1 border-b border-zinc-800 -mx-5 px-5">
                      {tabs.map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => switchTab(tab.id)}
                          className={`px-3 py-2 text-sm font-medium border-b-2 ${
                            activeTab === tab.id
                              ? "border-purple-400 text-zinc-100"
                              : "border-transparent text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          {tab.label}
                          {tab.count !== undefined && tab.count > 0 && (
                            <span className="ml-1.5 text-xs text-zinc-600">{tab.count}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tab content */}
                  <div className="p-5 flex-1 min-h-0 overflow-hidden flex flex-col">
                    {/* Messages + Calls Timeline */}
                    {activeTab === "messages" && (
                      <div className="flex flex-col flex-1 min-h-0">
                        <div className="flex-1 overflow-y-auto overflow-x-hidden" ref={messagesContainerRef}>
                          {getCustomerTimeline(selectedCustomer).length === 0 ? (
                            <div className="border border-dashed border-zinc-800 rounded-lg p-8 text-center text-sm text-zinc-600">
                              No messages or calls
                            </div>
                          ) : (
                            <div className="border border-zinc-800/50 rounded-lg p-4 space-y-1">
                              {getCustomerTimeline(selectedCustomer).map((item, idx) => {
                                if (item.type === "message") {
                                  const msg = item.data as Message
                                  return (
                                    <div key={`msg-${idx}`} data-msg-content={msg.content}>
                                      <MessageBubble
                                        role={msg.role as "client" | "business" | "assistant" | "system"}
                                        content={msg.content}
                                        timestamp={msg.timestamp}
                                      />
                                    </div>
                                  )
                                } else {
                                  const call = item.data as Call
                                  return <div key={`call-${idx}`} data-msg-content={call.transcript || ""}><CallBubble call={call} /></div>
                                }
                              })}
                              <div ref={messagesEndRef} />
                            </div>
                          )}
                        </div>

                        {/* SMS Input */}
                        <div className="mt-4 pt-4 border-t border-zinc-800">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={smsMessage}
                              onChange={(e) => setSmsMessage(e.target.value)}
                              onKeyDown={handleKeyDown}
                              placeholder="Type a message..."
                              disabled={sendingSms}
                              className="flex-1 px-4 py-2.5 rounded-lg bg-zinc-800/80 border border-zinc-700/50 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
                            />
                            <button
                              onClick={sendSms}
                              disabled={sendingSms || !smsMessage.trim()}
                              className="px-4 py-2.5 rounded-lg bg-purple-500 hover:bg-purple-600 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white text-sm font-medium flex items-center gap-2 transition-colors"
                            >
                              {sendingSms ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Send className="w-4 h-4" />
                              )}
                              Send
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Jobs */}
                    {activeTab === "jobs" && (
                      <div className="space-y-4">
                        {getCustomerJobs(selectedCustomer.phone_number).length === 0 ? (
                          <div className="border border-dashed border-zinc-800 rounded-lg p-8 text-center text-sm text-zinc-600">
                            No jobs found
                          </div>
                        ) : (
                          <div className="divide-y divide-zinc-800/50">
                            {getCustomerJobs(selectedCustomer.phone_number).map((job) => (
                              <div key={job.id} className="flex items-center justify-between py-3">
                                <div>
                                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                                    {job.service_type || "Cleaning"}
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                      job.frequency && job.frequency !== "one-time"
                                        ? "bg-purple-400/10 text-purple-400"
                                        : "bg-zinc-700/50 text-zinc-400"
                                    }`}>
                                      {job.frequency && job.frequency !== "one-time" ? "Recurring" : "One-time"}
                                    </span>
                                    {(() => {
                                      const src = getJobLeadSource(job.id)
                                      if (!src) return null
                                      const cfg = getLeadSourceConfig(src)
                                      return (
                                        <span
                                          style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            padding: "2px 8px",
                                            borderRadius: 8,
                                            fontSize: "0.625rem",
                                            fontWeight: 600,
                                            backgroundColor: cfg.color,
                                            color: "#fff",
                                          }}
                                        >{cfg.label}</span>
                                      )
                                    })()}
                                  </div>
                                  <div className="text-xs text-zinc-500">
                                    {job.date
                                      ? new Date(job.date).toLocaleDateString("en-US", {
                                          month: "short",
                                          day: "numeric",
                                          year: "numeric",
                                        })
                                      : "No date"}
                                    {job.address && ` · ${job.address.slice(0, 30)}...`}
                                  </div>
                                  {/* Property details */}
                                  {(job.bedrooms || job.bathrooms || job.sqft) && (
                                    <div className="text-[11px] text-zinc-500 flex items-center gap-1.5 mt-0.5">
                                      {job.bedrooms != null && <span>{job.bedrooms} bed</span>}
                                      {job.bedrooms != null && job.bathrooms != null && <span>·</span>}
                                      {job.bathrooms != null && <span>{job.bathrooms} bath</span>}
                                      {(job.bedrooms != null || job.bathrooms != null) && job.sqft && <span>·</span>}
                                      {job.sqft && <span>{Number(job.sqft).toLocaleString()} sqft</span>}
                                    </div>
                                  )}
                                  {/* Addons */}
                                  {job.addons && (() => {
                                    try {
                                      const parsed = typeof job.addons === "string" ? JSON.parse(job.addons) : job.addons
                                      if (!Array.isArray(parsed) || parsed.length === 0) return null
                                      return (
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {parsed.map((a: any, i: number) => (
                                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                                              {typeof a === "string" ? a : a.label || a.key || "addon"}
                                            </span>
                                          ))}
                                        </div>
                                      )
                                    } catch { return null }
                                  })()}
                                </div>
                                <div className="flex items-center gap-3">
                                  <span
                                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                      job.status === "completed"
                                        ? "bg-emerald-400/10 text-emerald-400"
                                        : job.status === "cancelled"
                                        ? "bg-red-400/10 text-red-400"
                                        : job.status === "assigned"
                                        ? "bg-purple-400/10 text-purple-400"
                                        : job.status === "scheduled"
                                        ? "bg-blue-400/10 text-blue-400"
                                        : "bg-yellow-400/10 text-yellow-400"
                                    }`}
                                  >
                                    {job.status || "pending"}
                                  </span>
                                  <span className="text-sm font-semibold text-zinc-200">
                                    ${job.price || 0}
                                  </span>
                                  <button
                                    onClick={() => setEditingJob({ ...job })}
                                    className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                                    title="Edit job"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Quotes Tab */}
                    {activeTab === "quotes" && (
                      <div className="space-y-3">
                        {quotesLoading ? (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
                          </div>
                        ) : customerQuotes.length === 0 ? (
                          <div className="border border-dashed border-zinc-800 rounded-lg p-8 text-center text-sm text-zinc-600">
                            No quotes found
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {customerQuotes.map((q: any) => {
                              const isApproved = q.status === "approved"
                              const isPending = q.status === "pending"
                              const statusColor = isApproved
                                ? "bg-emerald-400/10 text-emerald-400"
                                : isPending
                                ? "bg-yellow-400/10 text-yellow-400"
                                : "bg-red-400/10 text-red-400"
                              const addons = Array.isArray(q.selected_addons) ? q.selected_addons : []
                              const baseUrl = typeof window !== "undefined" ? window.location.origin : ""
                              return (
                                <div key={q.id} className="border border-zinc-800 rounded-lg p-3 space-y-2">
                                  {/* Header row */}
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <FileText className="w-4 h-4 text-zinc-500" />
                                      <span className="text-sm font-medium text-zinc-200">
                                        {q.service_category === "move_in_out" ? "Move In/Out Clean" : q.selected_tier ? `${q.selected_tier.charAt(0).toUpperCase() + q.selected_tier.slice(1)} Clean` : "Quote"}
                                      </span>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${statusColor}`}>
                                        {q.status}
                                      </span>
                                    </div>
                                    <span className="text-sm font-semibold text-zinc-200">
                                      ${q.total || q.subtotal || 0}
                                    </span>
                                  </div>

                                  {/* Date + agreement status */}
                                  <div className="text-xs text-zinc-500 flex items-center gap-2">
                                    {q.created_at && new Date(q.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                    {isApproved && q.service_agreement_accepted && (
                                      <span className="text-emerald-400 font-medium">
                                        Agreement signed {q.service_agreement_accepted_at ? new Date(q.service_agreement_accepted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                                      </span>
                                    )}
                                    {isPending && (
                                      <span className="text-yellow-400 font-medium">Awaiting response</span>
                                    )}
                                  </div>

                                  {/* Property details */}
                                  {(q.bedrooms || q.bathrooms || q.square_footage) && (
                                    <div className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                                      {q.bedrooms != null && <span>{q.bedrooms} bed</span>}
                                      {q.bedrooms != null && q.bathrooms != null && <span>·</span>}
                                      {q.bathrooms != null && <span>{q.bathrooms} bath</span>}
                                      {(q.bedrooms != null || q.bathrooms != null) && q.square_footage && <span>·</span>}
                                      {q.square_footage && <span>{Number(q.square_footage).toLocaleString()} sqft</span>}
                                    </div>
                                  )}

                                  {/* Tier */}
                                  {q.selected_tier && (
                                    <div>
                                      <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Tier</span>
                                      <p className="text-sm text-zinc-200 mt-0.5 capitalize">{q.selected_tier}</p>
                                    </div>
                                  )}

                                  {/* Addons */}
                                  {addons.length > 0 && (
                                    <div>
                                      <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Add-ons</span>
                                      <div className="flex flex-wrap gap-1.5 mt-1">
                                        {addons.map((addon: any, i: number) => (
                                          <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
                                            {typeof addon === "string" ? addon : addon.key || "addon"}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Pricing breakdown */}
                                  {(q.subtotal != null || q.discount != null || q.total != null) && (
                                    <div className="grid grid-cols-3 gap-3 text-xs">
                                      {q.subtotal != null && (
                                        <div>
                                          <span className="text-zinc-500">Subtotal</span>
                                          <p className="text-zinc-200 font-medium">${q.subtotal}</p>
                                        </div>
                                      )}
                                      {q.discount != null && Number(q.discount) > 0 && (
                                        <div>
                                          <span className="text-zinc-500">Discount</span>
                                          <p className="text-emerald-400 font-medium">-${q.discount}</p>
                                        </div>
                                      )}
                                      {q.total != null && (
                                        <div>
                                          <span className="text-zinc-500">Total</span>
                                          <p className="text-zinc-200 font-semibold">${q.total}</p>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Membership plan */}
                                  {q.membership_plan && (
                                    <div className="text-xs">
                                      <span className="text-zinc-500">Plan: </span>
                                      <span className="text-purple-400 font-medium capitalize">{q.membership_plan.replace(/_/g, " ")}</span>
                                    </div>
                                  )}

                                  {/* Notes */}
                                  {q.notes && (
                                    <div className="text-xs text-zinc-500 italic">{q.notes}</div>
                                  )}

                                  {/* Quote link */}
                                  {q.token && (
                                    <a
                                      href={`${baseUrl}/quote/${q.token}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                      View Quote Page
                                    </a>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Membership Tab (WinBros only) */}
                    {activeTab === "membership" && !isHouseCleaning && (() => {
                      const custMemberships = getCustomerMemberships(selectedCustomer.id)
                      const activeMembership = custMemberships.find(m => m.status === "active" || m.status === "paused") || null
                      const pastMemberships = custMemberships.filter(m => m.status === "completed" || m.status === "cancelled")

                      return (
                        <div className="space-y-4 overflow-y-auto">
                          {/* Active/Paused Membership */}
                          {activeMembership ? (() => {
                            const plan = activeMembership.service_plans
                            const visitsTotal = plan?.visits_per_year || 1
                            const visitsDone = activeMembership.visits_completed
                            const progressPct = Math.min(100, Math.round((visitsDone / visitsTotal) * 100))
                            const isLoading = membershipActionLoading === activeMembership.id

                            return (
                              <div className="border border-zinc-800 rounded-lg p-4 space-y-4">
                                {/* Plan header */}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Crown className="w-4 h-4 text-amber-400" />
                                    <span className="text-sm font-semibold text-zinc-100">{plan?.name || "Membership"}</span>
                                  </div>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${
                                    activeMembership.status === "active"
                                      ? "bg-green-500/20 text-green-400"
                                      : "bg-amber-500/20 text-amber-400"
                                  }`}>
                                    {activeMembership.status}
                                  </span>
                                </div>

                                {/* Visit progress */}
                                <div>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-xs text-zinc-400">Visit progress</span>
                                    <span className="text-xs font-mono text-zinc-300">{visitsDone}/{visitsTotal}</span>
                                  </div>
                                  <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-amber-500 rounded-full transition-all"
                                      style={{ width: `${progressPct}%` }}
                                    />
                                  </div>
                                </div>

                                {/* Details grid */}
                                <div className="grid grid-cols-2 gap-3 text-xs">
                                  <div>
                                    <span className="text-zinc-500">Discount</span>
                                    <p className="text-zinc-200 font-medium">${plan?.discount_per_visit || 0}/visit</p>
                                  </div>
                                  <div>
                                    <span className="text-zinc-500">Interval</span>
                                    <p className="text-zinc-200 font-medium">Every {plan?.interval_months || 1} month{(plan?.interval_months || 1) > 1 ? "s" : ""}</p>
                                  </div>
                                  <div>
                                    <span className="text-zinc-500">Next visit</span>
                                    <p className="text-zinc-200 font-medium">
                                      {activeMembership.next_visit_at
                                        ? new Date(activeMembership.next_visit_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                                        : "—"}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-zinc-500">Started</span>
                                    <p className="text-zinc-200 font-medium">
                                      {activeMembership.started_at
                                        ? new Date(activeMembership.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                                        : "—"}
                                    </p>
                                  </div>
                                </div>

                                {/* Renewal status */}
                                {activeMembership.renewal_asked_at && (
                                  <div className="flex items-center gap-2 text-xs">
                                    <span className="text-zinc-500">Renewal:</span>
                                    {activeMembership.renewal_choice === "renew" ? (
                                      <span className="text-green-400 font-medium">Renewing</span>
                                    ) : activeMembership.renewal_choice === "cancel" ? (
                                      <span className="text-red-400 font-medium">Declined</span>
                                    ) : (
                                      <span className="text-blue-400 font-medium">Awaiting reply</span>
                                    )}
                                  </div>
                                )}

                                {/* Actions */}
                                <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
                                  {activeMembership.status === "active" && (
                                    <>
                                      <button
                                        onClick={() => handleMembershipAction(activeMembership.id, "pause")}
                                        disabled={isLoading}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg transition-colors disabled:opacity-50"
                                      >
                                        <Pause className="w-3 h-3" /> Pause
                                      </button>
                                      <button
                                        onClick={() => {
                                          if (confirm("Cancel this membership? This cannot be undone.")) {
                                            handleMembershipAction(activeMembership.id, "cancel")
                                          }
                                        }}
                                        disabled={isLoading}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-colors disabled:opacity-50"
                                      >
                                        <XCircle className="w-3 h-3" /> Cancel
                                      </button>
                                    </>
                                  )}
                                  {activeMembership.status === "paused" && (
                                    <>
                                      <button
                                        onClick={() => handleMembershipAction(activeMembership.id, "resume")}
                                        disabled={isLoading}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 rounded-lg transition-colors disabled:opacity-50"
                                      >
                                        <Play className="w-3 h-3" /> Resume
                                      </button>
                                      <button
                                        onClick={() => {
                                          if (confirm("Cancel this membership? This cannot be undone.")) {
                                            handleMembershipAction(activeMembership.id, "cancel")
                                          }
                                        }}
                                        disabled={isLoading}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-colors disabled:opacity-50"
                                      >
                                        <XCircle className="w-3 h-3" /> Cancel
                                      </button>
                                    </>
                                  )}
                                  {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />}
                                </div>
                              </div>
                            )
                          })() : (
                            <div className="border border-dashed border-zinc-800 rounded-lg p-6 text-center space-y-3">
                              <p className="text-sm text-zinc-500">No active membership</p>
                              <button
                                onClick={() => { setCreateMembershipOpen(true); setCreateMembershipPlanSlug(""); setCreateMembershipError("") }}
                                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" /> Create Membership
                              </button>
                            </div>
                          )}

                          {/* Past memberships */}
                          {pastMemberships.length > 0 && (
                            <div>
                              <p className="text-xs text-zinc-500 mb-2">Past memberships</p>
                              <div className="space-y-2">
                                {pastMemberships.map((m) => (
                                  <div key={m.id} className="flex items-center justify-between py-2 px-3 bg-zinc-800/30 rounded-lg">
                                    <div>
                                      <span className="text-xs text-zinc-300">{m.service_plans?.name || "Plan"}</span>
                                      <span className="text-[10px] text-zinc-500 ml-2">
                                        {m.visits_completed}/{m.service_plans?.visits_per_year || "?"} visits
                                      </span>
                                    </div>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                      m.status === "completed"
                                        ? "bg-zinc-600/30 text-zinc-400"
                                        : "bg-red-500/20 text-red-400"
                                    }`}>
                                      {m.status}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })()}

                    {/* Info Tab — all data we have about this customer */}
                    {activeTab === "info" && (() => {
                      const lead = getCustomerLead(selectedCustomer.phone_number)
                      const formData = lead?.form_data
                        ? (typeof lead.form_data === "string" ? (() => { try { return JSON.parse(lead.form_data) } catch { return {} } })() : lead.form_data)
                        : {}
                      const jobs = getCustomerJobs(selectedCustomer.phone_number)
                      const calls = getCustomerCalls(selectedCustomer.phone_number)

                      const infoRows: Array<{ label: string; value: string | null | undefined }> = [
                        { label: "Name", value: [selectedCustomer.first_name, selectedCustomer.last_name].filter(Boolean).join(" ") || null },
                        { label: "Phone", value: selectedCustomer.phone_number },
                        { label: "Email", value: selectedCustomer.email },
                        { label: "Address", value: selectedCustomer.address },
                        { label: "Lead Source", value: selectedCustomer.lead_source || lead?.source || null },
                        { label: "Lead Status", value: lead?.status || null },
                        { label: "Created", value: selectedCustomer.created_at ? new Date(selectedCustomer.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : null },
                        { label: "Lifecycle Stage", value: selectedCustomer.lifecycle_stage || null },
                        { label: "Preferred Frequency", value: selectedCustomer.preferred_frequency || null },
                        { label: "Preferred Day", value: selectedCustomer.preferred_day || null },
                        { label: "Card on File", value: selectedCustomer.card_on_file_at ? "Yes" : "No" },
                        { label: "Stripe Customer", value: selectedCustomer.stripe_customer_id || null },
                        { label: "SMS Opt-Out", value: selectedCustomer.sms_opt_out ? "Yes" : "No" },
                        { label: "Commercial", value: selectedCustomer.is_commercial ? "Yes" : "No" },
                        { label: "Total Jobs", value: String(jobs.length) },
                        { label: "Total Revenue", value: `$${getCustomerRevenue(selectedCustomer.phone_number).toLocaleString()}` },
                        { label: "Total Paid", value: `$${getCustomerPaid(selectedCustomer.phone_number).toLocaleString()}` },
                        { label: "Total Calls", value: String(calls.length) },
                      ]

                      // HCP-specific fields from form_data
                      const hcpFields: Array<{ label: string; value: string | null | undefined }> = []
                      if (formData.hcp_lead_id) hcpFields.push({ label: "HCP Lead ID", value: formData.hcp_lead_id })
                      if (formData.hcp_lead_source) hcpFields.push({ label: "HCP Lead Source", value: formData.hcp_lead_source })
                      if (formData.hcp_work_requested) hcpFields.push({ label: "HCP Work Requested", value: formData.hcp_work_requested })
                      if (formData.already_scheduled_in_hcp) hcpFields.push({ label: "Pre-Scheduled in HCP", value: "Yes" })
                      if (formData.hcp_job_id) hcpFields.push({ label: "HCP Job ID", value: String(formData.hcp_job_id) })

                      // Notes from customer record
                      const notes = selectedCustomer.notes || selectedCustomer.recurring_notes

                      return (
                        <div className="space-y-4 p-1 flex-1 overflow-y-auto min-h-0">
                          {/* Core Info */}
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Customer Details</p>
                            {infoRows.map((row) => (
                              <div key={row.label} className="flex items-start justify-between py-1.5 border-b border-zinc-800/50 last:border-0">
                                <span className="text-xs text-zinc-500 shrink-0">{row.label}</span>
                                <span className="text-xs text-zinc-200 text-right ml-4 break-all">{row.value || "—"}</span>
                              </div>
                            ))}
                          </div>

                          {/* HCP Data */}
                          {hcpFields.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-teal-400 uppercase tracking-wider mb-2">HouseCall Pro</p>
                              {hcpFields.map((row) => (
                                <div key={row.label} className="flex items-start justify-between py-1.5 border-b border-zinc-800/50 last:border-0">
                                  <span className="text-xs text-zinc-500 shrink-0">{row.label}</span>
                                  <span className="text-xs text-zinc-200 text-right ml-4 break-all">{row.value || "—"}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Notes */}
                          {notes && (
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Notes</p>
                              <p className="text-xs text-zinc-300 bg-zinc-800/40 rounded-lg p-3 whitespace-pre-wrap">{notes}</p>
                            </div>
                          )}

                          {/* Raw Lead Form Data (expandable) */}
                          {Object.keys(formData).length > 0 && (
                            <details className="group">
                              <summary className="text-xs font-medium text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-400 transition-colors">
                                Raw Lead Data
                              </summary>
                              <pre className="mt-2 text-[10px] text-zinc-400 bg-zinc-800/40 rounded-lg p-3 overflow-x-auto max-h-60 overflow-y-auto">
                                {JSON.stringify(formData, null, 2)}
                              </pre>
                            </details>
                          )}

                          {/* Activity Logs */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-medium text-amber-400 uppercase tracking-wider">
                                Activity Logs {!logsLoading && customerLogs.length > 0 && <span className="text-zinc-500 normal-case">({customerLogs.length})</span>}
                              </p>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => fetchCustomerLogs(selectedCustomer.phone_number, selectedCustomer.id)}
                                  className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                                  title="Refresh logs"
                                >
                                  <RefreshCw className={`w-3 h-3 ${logsLoading ? "animate-spin" : ""}`} />
                                </button>
                                <button
                                  onClick={() => {
                                    // Copy everything: customer info + conversation + logs
                                    handleCopyTranscript()
                                    setLogsCopied(true)
                                    setTimeout(() => setLogsCopied(false), 2000)
                                  }}
                                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 border border-zinc-700 transition-colors"
                                  title="Copy all customer info, conversation, and logs"
                                >
                                  {logsCopied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                                  {logsCopied ? "Copied!" : "Copy All"}
                                </button>
                              </div>
                            </div>

                            {logsLoading ? (
                              <div className="flex items-center justify-center py-6">
                                <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
                              </div>
                            ) : customerLogs.length === 0 ? (
                              <p className="text-xs text-zinc-600 py-3 text-center">No activity logs</p>
                            ) : (
                              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
                                {customerLogs.map((log, idx) => {
                                  const ts = new Date(log.created_at)
                                  const timeStr = ts.toLocaleString("en-US", {
                                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
                                  })
                                  // Color-code by source
                                  const sourceColors: Record<string, string> = {
                                    openphone: "text-cyan-400",
                                    stripe: "text-purple-400",
                                    vapi: "text-blue-400",
                                    telegram: "text-sky-400",
                                    cron: "text-yellow-400",
                                    system: "text-zinc-400",
                                    actions: "text-green-400",
                                    housecall_pro: "text-teal-400",
                                    housecall_pro_webhook: "text-teal-400",
                                    ghl: "text-indigo-400",
                                    lead_followup: "text-orange-400",
                                    scheduler: "text-amber-400",
                                    lifecycle: "text-emerald-400",
                                    dashboard: "text-violet-400",
                                    complete_job: "text-lime-400",
                                    "complete-job": "text-lime-400",
                                    tip: "text-pink-400",
                                    offers: "text-rose-400",
                                  }
                                  const sourceColor = sourceColors[log.source] || "text-zinc-400"

                                  return (
                                    <details key={log.id} className={`group ${idx > 0 ? "border-t border-zinc-800/50" : ""}`}>
                                      <summary className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-800/40 transition-colors text-[11px] leading-tight">
                                        <span className="text-zinc-600 shrink-0 w-[110px]">{timeStr}</span>
                                        <span className={`shrink-0 font-mono font-medium ${sourceColor}`}>{log.source}</span>
                                        <span className="text-zinc-500 shrink-0">›</span>
                                        <span className="text-zinc-300 break-words min-w-0">{log.event_type}{log.message ? `: ${log.message}` : ""}</span>
                                      </summary>
                                      <div className="px-3 pb-2 md:pl-[130px] space-y-1 overflow-hidden">
                                        <div className="text-[10px] text-zinc-400 space-y-0.5 break-words">
                                          <p><span className="text-zinc-600">Event:</span> {log.event_type}</p>
                                          <p><span className="text-zinc-600">Source:</span> {log.source}</p>
                                          {log.message && <p className="break-words"><span className="text-zinc-600">Message:</span> {log.message}</p>}
                                          {log.job_id && <p><span className="text-zinc-600">Job ID:</span> {log.job_id}</p>}
                                          {log.lead_id && <p><span className="text-zinc-600">Lead ID:</span> {log.lead_id}</p>}
                                          {log.cleaner_id && <p><span className="text-zinc-600">Cleaner ID:</span> {log.cleaner_id}</p>}
                                          {log.metadata && Object.keys(log.metadata).length > 0 && (
                                            <pre className="mt-1 text-[10px] text-zinc-500 bg-zinc-800/60 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                                              {JSON.stringify(log.metadata, null, 2)}
                                            </pre>
                                          )}
                                        </div>
                                      </div>
                                    </details>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })()}

                  </div>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-zinc-800 rounded-xl p-12 text-center flex-1 flex items-center justify-center animate-fade-in">
                <p className="text-sm text-zinc-600">Select a customer to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Customer Modal */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setEditingCustomer(null)}>
          <div className="w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h3 className="text-base font-semibold text-zinc-100">Edit Customer</h3>
              <button onClick={() => setEditingCustomer(null)} className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">First Name</label>
                  <input
                    type="text"
                    value={editingCustomer.first_name || ""}
                    onChange={(e) => setEditingCustomer({ ...editingCustomer, first_name: e.target.value })}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                    placeholder="First name"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Last Name</label>
                  <input
                    type="text"
                    value={editingCustomer.last_name || ""}
                    onChange={(e) => setEditingCustomer({ ...editingCustomer, last_name: e.target.value })}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                    placeholder="Last name"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Phone</label>
                <input
                  type="text"
                  value={editingCustomer.phone_number || ""}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, phone_number: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                  placeholder="+1 (555) 123-4567"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Email</label>
                <input
                  type="email"
                  value={editingCustomer.email || ""}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, email: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                  placeholder="email@example.com"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Address</label>
                <input
                  type="text"
                  value={editingCustomer.address || ""}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, address: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                  placeholder="123 Main St, City, ST 12345"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Notes</label>
                <textarea
                  value={editingCustomer.notes || ""}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, notes: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 resize-none"
                  placeholder="Private notes..."
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-xs text-zinc-400">Commercial Client</label>
                  <p className="text-[10px] text-zinc-500">No SMS reminders for recurring jobs</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingCustomer({ ...editingCustomer, is_commercial: !editingCustomer.is_commercial })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${editingCustomer.is_commercial ? 'bg-purple-600' : 'bg-zinc-700'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${editingCustomer.is_commercial ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-zinc-800">
              <button
                onClick={() => setEditingCustomer(null)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCustomer}
                disabled={savingCustomer}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors disabled:opacity-50"
              >
                {savingCustomer ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Customer Modal */}
      {newCustomerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setNewCustomerOpen(false)}>
          <div className="w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h3 className="text-base font-semibold text-zinc-100">New Customer</h3>
              <button onClick={() => setNewCustomerOpen(false)} className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">First Name</label>
                  <input type="text" value={newCustomerForm.first_name} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, first_name: e.target.value })} className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500" placeholder="First name" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Last Name</label>
                  <input type="text" value={newCustomerForm.last_name} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, last_name: e.target.value })} className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500" placeholder="Last name" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Phone <span className="text-red-400">*</span></label>
                <input type="text" value={newCustomerForm.phone_number} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, phone_number: e.target.value })} className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500" placeholder="+1 (555) 123-4567" />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Email</label>
                <input type="email" value={newCustomerForm.email} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, email: e.target.value })} className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500" placeholder="email@example.com" />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Address</label>
                <input type="text" value={newCustomerForm.address} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, address: e.target.value })} className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500" placeholder="123 Main St, City, ST 12345" />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Notes</label>
                <textarea value={newCustomerForm.notes} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, notes: e.target.value })} rows={3} className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 resize-none" placeholder="Private notes..." />
              </div>
              {isHouseCleaning && (
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs text-zinc-400">Commercial Client</label>
                    <p className="text-[10px] text-zinc-500">No SMS reminders for recurring jobs</p>
                  </div>
                  <button type="button" onClick={() => setNewCustomerForm({ ...newCustomerForm, is_commercial: !newCustomerForm.is_commercial })} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${newCustomerForm.is_commercial ? 'bg-purple-600' : 'bg-zinc-700'}`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${newCustomerForm.is_commercial ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                  </button>
                </div>
              )}
              {newCustomerError && (
                <p className="text-sm text-red-400">{newCustomerError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-zinc-800">
              <button onClick={() => setNewCustomerOpen(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors">
                Cancel
              </button>
              <button onClick={handleCreateCustomer} disabled={savingNewCustomer} className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors disabled:opacity-50">
                {savingNewCustomer ? "Creating..." : "Create Customer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Job Modal */}
      {editingJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setEditingJob(null)}>
          <div className="w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h3 className="text-base font-semibold text-zinc-100">Edit Job</h3>
              <button onClick={() => setEditingJob(null)} className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Service Type</label>
                  <input
                    type="text"
                    value={editingJob.service_type || ""}
                    onChange={(e) => setEditingJob({ ...editingJob, service_type: e.target.value })}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                    placeholder="Window cleaning"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Status</label>
                  <select
                    value={editingJob.status || "scheduled"}
                    onChange={(e) => setEditingJob({ ...editingJob, status: e.target.value })}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-purple-500"
                  >
                    <option value="pending">Pending</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="assigned">Assigned</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Date</label>
                  <input
                    type="date"
                    value={editingJob.date || ""}
                    onChange={(e) => setEditingJob({ ...editingJob, date: e.target.value })}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Time</label>
                  <input
                    type="time"
                    value={editingJob.scheduled_at || ""}
                    onChange={(e) => setEditingJob({ ...editingJob, scheduled_at: e.target.value })}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Price ($)</label>
                  <input
                    type="number"
                    value={editingJob.price ?? ""}
                    onChange={(e) => setEditingJob({ ...editingJob, price: e.target.value ? Number(e.target.value) : undefined })}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Hours</label>
                  <input
                    type="number"
                    step="0.5"
                    value={editingJob.hours ?? ""}
                    onChange={(e) => setEditingJob({ ...editingJob, hours: e.target.value ? Number(e.target.value) : undefined })}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                    placeholder="2"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Address</label>
                <input
                  type="text"
                  value={editingJob.address || ""}
                  onChange={(e) => setEditingJob({ ...editingJob, address: e.target.value })}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                  placeholder="123 Main St, City, ST 12345"
                />
              </div>
              {/* Property details (read-only info) */}
              {(editingJob.bedrooms != null || editingJob.bathrooms != null || editingJob.sqft) && (
                <div className="grid grid-cols-3 gap-3">
                  {editingJob.bedrooms != null && (
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Bedrooms</label>
                      <div className="px-3 py-2 bg-zinc-800/50 border border-zinc-700/50 rounded-lg text-sm text-zinc-300">{editingJob.bedrooms}</div>
                    </div>
                  )}
                  {editingJob.bathrooms != null && (
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Bathrooms</label>
                      <div className="px-3 py-2 bg-zinc-800/50 border border-zinc-700/50 rounded-lg text-sm text-zinc-300">{editingJob.bathrooms}</div>
                    </div>
                  )}
                  {editingJob.sqft && (
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Sqft</label>
                      <div className="px-3 py-2 bg-zinc-800/50 border border-zinc-700/50 rounded-lg text-sm text-zinc-300">{Number(editingJob.sqft).toLocaleString()}</div>
                    </div>
                  )}
                </div>
              )}
              {/* Addons (read-only) */}
              {editingJob.addons && (() => {
                try {
                  const parsed = typeof editingJob.addons === "string" ? JSON.parse(editingJob.addons) : editingJob.addons
                  if (!Array.isArray(parsed) || parsed.length === 0) return null
                  return (
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Add-ons</label>
                      <div className="flex flex-wrap gap-1.5">
                        {parsed.map((a: any, i: number) => (
                          <span key={i} className="text-[11px] px-2 py-1 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">
                            {typeof a === "string" ? a : a.label || a.key || "addon"}
                            {typeof a === "object" && a.price ? ` ($${a.price})` : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                } catch { return null }
              })()}
              {/* Quote link */}
              {editingJob.quote_id && (
                <a
                  href={`/quote/${editingJob.quote_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                  onClick={(e) => {
                    // Find the quote token from customerQuotes
                    const q = customerQuotes.find((q: any) => q.id === editingJob.quote_id)
                    if (q?.token) {
                      e.preventDefault()
                      window.open(`/quote/${q.token}`, "_blank")
                    }
                  }}
                >
                  <ExternalLink className="w-3 h-3" />
                  View Quote
                </a>
              )}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Notes</label>
                <textarea
                  value={editingJob.notes || ""}
                  onChange={(e) => setEditingJob({ ...editingJob, notes: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 resize-none"
                  placeholder="Job notes..."
                />
              </div>
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-zinc-800">
              <button
                onClick={() => {
                  const isRecurringChild = !!editingJob.parent_job_id
                  if (isRecurringChild) {
                    const choice = window.prompt(
                      "This job is part of a recurring series.\n\nType 'all' to delete this and all future jobs, or 'one' to delete just this one.",
                      "one"
                    )
                    if (!choice) return
                    if (choice.toLowerCase() === "all") {
                      handleDeleteJob(true)
                    } else {
                      handleDeleteJob(false)
                    }
                  } else {
                    if (confirm("Delete this job? This cannot be undone.")) {
                      handleDeleteJob(false)
                    }
                  }
                }}
                disabled={deletingJob}
                className="px-3 py-2 text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-colors disabled:opacity-50"
              >
                {deletingJob ? "Deleting..." : "Delete"}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingJob(null)}
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveJob}
                  disabled={savingJob}
                  className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors disabled:opacity-50"
                >
                  {savingJob ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Add Customers Modal */}
      {batchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setBatchOpen(false)}>
          <div className="w-full max-w-2xl mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h3 className="text-base font-semibold text-zinc-100">Batch Add Customers</h3>
              <button onClick={() => setBatchOpen(false)} className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 flex-1 overflow-y-auto space-y-4">
              {!batchParsed && !batchResult && (
                <>
                  <p className="text-sm text-zinc-400">Paste customer info in any format — names, phones, emails, addresses. AI will parse it into structured records.</p>
                  <textarea
                    value={batchText}
                    onChange={(e) => setBatchText(e.target.value)}
                    rows={8}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 resize-none"
                    placeholder={"John Smith 555-123-4567 john@email.com 123 Main St\nJane Doe (555) 987-6543 jane@email.com"}
                  />
                </>
              )}

              {batchParsed && !batchResult && (
                <>
                  <p className="text-sm text-zinc-400">{batchParsed.length} customer{batchParsed.length !== 1 ? "s" : ""} found. Review and edit before creating:</p>
                  <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                    {batchParsed.map((c, i) => (
                      <div key={i} className="grid grid-cols-5 gap-2 text-xs">
                        <input
                          value={c.first_name}
                          onChange={(e) => { const u = [...batchParsed]; u[i] = { ...u[i], first_name: e.target.value }; setBatchParsed(u) }}
                          className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-purple-500"
                          placeholder="First"
                        />
                        <input
                          value={c.last_name}
                          onChange={(e) => { const u = [...batchParsed]; u[i] = { ...u[i], last_name: e.target.value }; setBatchParsed(u) }}
                          className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-purple-500"
                          placeholder="Last"
                        />
                        <input
                          value={c.phone_number}
                          onChange={(e) => { const u = [...batchParsed]; u[i] = { ...u[i], phone_number: e.target.value }; setBatchParsed(u) }}
                          className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-purple-500"
                          placeholder="Phone"
                        />
                        <input
                          value={c.email || ""}
                          onChange={(e) => { const u = [...batchParsed]; u[i] = { ...u[i], email: e.target.value || null }; setBatchParsed(u) }}
                          className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-purple-500"
                          placeholder="Email"
                        />
                        <div className="flex gap-1">
                          <input
                            value={c.address || ""}
                            onChange={(e) => { const u = [...batchParsed]; u[i] = { ...u[i], address: e.target.value || null }; setBatchParsed(u) }}
                            className="flex-1 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-purple-500"
                            placeholder="Address"
                          />
                          <button
                            onClick={() => setBatchParsed(batchParsed.filter((_, j) => j !== i))}
                            className="px-1.5 text-zinc-500 hover:text-red-400"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {batchResult && (
                <div className="space-y-2">
                  <p className="text-sm text-emerald-400">
                    Done! {batchResult.created} created, {batchResult.updated} updated.
                  </p>
                  {batchResult.errors.length > 0 && (
                    <div className="text-xs text-red-400 space-y-1">
                      {batchResult.errors.map((e, i) => <p key={i}>{e}</p>)}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-zinc-800">
              {!batchParsed && !batchResult && (
                <>
                  <button onClick={() => setBatchOpen(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors">Cancel</button>
                  <button
                    onClick={async () => {
                      setBatchParsing(true)
                      try {
                        const res = await fetch("/api/actions/batch-parse-customers", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ text: batchText }),
                        })
                        const json = await res.json()
                        if (json.success && json.customers?.length > 0) {
                          setBatchParsed(json.customers)
                        } else {
                          alert(json.error || "No customers could be parsed from the text")
                        }
                      } catch { alert("Failed to parse") }
                      finally { setBatchParsing(false) }
                    }}
                    disabled={batchParsing || !batchText.trim()}
                    className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {batchParsing ? "Parsing..." : "Parse"}
                  </button>
                </>
              )}

              {batchParsed && !batchResult && (
                <>
                  <button onClick={() => setBatchParsed(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors">Back</button>
                  <button
                    onClick={async () => {
                      setBatchCreating(true)
                      try {
                        const res = await fetch("/api/actions/batch-create-customers", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ customers: batchParsed }),
                        })
                        const json = await res.json()
                        if (json.success) {
                          setBatchResult({ created: json.created, updated: json.updated, errors: json.errors || [] })
                          // Refresh customer list
                          const refresh = await fetch("/api/customers")
                          const refreshJson = await refresh.json()
                          if (refreshJson.success) {
                            setCustomers(refreshJson.data.customers)
                            setMessages(refreshJson.data.messages)
                            setJobs(refreshJson.data.jobs)
                            setCalls(refreshJson.data.calls)
                            setLeads(refreshJson.data.leads || [])
                            setCleanerPhones(refreshJson.data.cleanerPhones || [])
                          }
                        } else {
                          alert(json.error || "Failed to create customers")
                        }
                      } catch { alert("Failed to create customers") }
                      finally { setBatchCreating(false) }
                    }}
                    disabled={batchCreating || batchParsed.length === 0}
                    className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {batchCreating ? "Creating..." : `Create ${batchParsed.length} Customer${batchParsed.length !== 1 ? "s" : ""}`}
                  </button>
                </>
              )}

              {batchResult && (
                <button onClick={() => setBatchOpen(false)} className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors">Done</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Membership Modal (WinBros only) */}
      {createMembershipOpen && !isHouseCleaning && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setCreateMembershipOpen(false)}>
          <div className="w-full max-w-sm mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h3 className="text-base font-semibold text-zinc-100">New Membership</h3>
              <button onClick={() => setCreateMembershipOpen(false)} className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Customer</label>
                <p className="text-sm text-zinc-200">{getCustomerName(selectedCustomer)}</p>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Plan</label>
                <select
                  value={createMembershipPlanSlug}
                  onChange={(e) => setCreateMembershipPlanSlug(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-purple-500"
                >
                  <option value="">Select a plan...</option>
                  {membershipPlans.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name} ({p.visits_per_year} visits, -${p.discount_per_visit}/visit)
                    </option>
                  ))}
                </select>
              </div>
              {createMembershipError && (
                <p className="text-sm text-red-400">{createMembershipError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-zinc-800">
              <button onClick={() => setCreateMembershipOpen(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors">
                Cancel
              </button>
              <button
                onClick={handleCreateMembership}
                disabled={createMembershipSaving || !createMembershipPlanSlug}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors disabled:opacity-50"
              >
                {createMembershipSaving ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
