"use client"

import { useState, useEffect, useRef } from "react"
import { MessageBubble } from "@/components/message-bubble"
import { CallBubble } from "@/components/call-bubble"
import { LeadFlowProgress } from "@/components/lead-flow-progress"
import { parseFormData } from "@/lib/utils"
import { useAuth } from "@/lib/auth-context"
import { Send, Loader2, Trash2, Copy, Check, Pencil, X, Repeat, Pause, Play, SkipForward, XCircle, DollarSign, CreditCard, FileText, UserPlus } from "lucide-react"

// Normalize phone to 10 digits for comparison
function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  let digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1)
  }
  return digits
}

type TabType = "messages" | "jobs" | "invoices" | "recurring"

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

interface TimelineItem {
  type: "message" | "call"
  timestamp: string
  data: Message | Call
}

function RecurringTab({ jobs, customer }: { jobs: Job[]; customer: Customer }) {
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [localJobs, setLocalJobs] = useState(jobs)

  useEffect(() => { setLocalJobs(jobs) }, [jobs])

  const parentJobs = localJobs.filter(
    (j) => j.frequency && j.frequency !== "one-time" && !j.parent_job_id
  )

  const getNextDate = (parentId: number) => {
    const today = new Date().toISOString().split("T")[0]
    const children = localJobs
      .filter((j) => j.parent_job_id === parentId && j.date && j.date >= today && j.status !== "cancelled")
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    return children[0]?.date || null
  }

  const handleAction = async (action: string, parentJobId: number, extra?: Record<string, string>) => {
    setActionLoading(`${action}-${parentJobId}`)
    try {
      const res = await fetch("/api/actions/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, parent_job_id: parentJobId, ...extra }),
      })
      const json = await res.json()
      if (!json.success) {
        alert(json.error || `Failed to ${action}`)
        return
      }
      // Optimistic updates
      if (action === "pause") {
        setLocalJobs((prev) =>
          prev.map((j) => (j.id === parentJobId ? { ...j, paused_at: new Date().toISOString() } : j))
        )
      } else if (action === "resume") {
        setLocalJobs((prev) =>
          prev.map((j) => (j.id === parentJobId ? { ...j, paused_at: null } : j))
        )
      } else if (action === "cancel") {
        setLocalJobs((prev) =>
          prev.map((j) =>
            j.id === parentJobId
              ? { ...j, status: "cancelled", frequency: "one-time" }
              : j.parent_job_id === parentJobId ? { ...j, status: "cancelled" } : j
          )
        )
      } else if (action === "skip-next") {
        if (json.skipped_job_id) {
          setLocalJobs((prev) =>
            prev.map((j) => (j.id === json.skipped_job_id ? { ...j, status: "cancelled" } : j))
          )
        }
      } else if (action === "change-frequency" && extra?.frequency) {
        setLocalJobs((prev) =>
          prev.map((j) =>
            j.id === parentJobId || j.parent_job_id === parentJobId
              ? { ...j, frequency: extra.frequency }
              : j
          )
        )
      }
    } catch {
      alert(`Failed to ${action}`)
    } finally {
      setActionLoading(null)
    }
  }

  if (parentJobs.length === 0) {
    return (
      <div className="space-y-3">
        <div className="border border-dashed border-zinc-800 rounded-lg p-8 text-center text-sm text-zinc-600">
          No recurring series
        </div>
        {customer.preferred_frequency && (
          <div className="px-3 py-2 rounded-lg bg-purple-500/5 border border-purple-500/10 text-xs text-purple-300">
            Detected preference: <strong>{customer.preferred_frequency}</strong>
            {customer.preferred_day && <> on <strong>{customer.preferred_day}</strong></>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {customer.preferred_frequency && (
        <div className="px-3 py-2 rounded-lg bg-purple-500/5 border border-purple-500/10 text-xs text-purple-300">
          Detected preference: <strong>{customer.preferred_frequency}</strong>
          {customer.preferred_day && <> on <strong>{customer.preferred_day}</strong></>}
        </div>
      )}
      {parentJobs.map((job) => {
        const nextDate = getNextDate(job.id)
        const isPaused = !!job.paused_at
        const childCount = localJobs.filter((j) => j.parent_job_id === job.id && j.status !== "cancelled").length

        return (
          <div key={job.id} className="border border-zinc-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Repeat className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-sm font-medium text-zinc-200">
                    {job.service_type || "Cleaning"}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-400/10 text-purple-400 font-medium">
                    {(job.frequency || "").replace("-", "-")}
                  </span>
                  {isPaused && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-400/10 text-yellow-400 font-medium">
                      Paused
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  ${job.price || 0}/visit · {childCount} upcoming
                  {nextDate && (
                    <> · Next: {new Date(nextDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {/* Change frequency */}
              <select
                className="text-xs px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-zinc-300 focus:outline-none focus:border-purple-500"
                value={job.frequency || ""}
                onChange={(e) => handleAction("change-frequency", job.id, { frequency: e.target.value })}
                disabled={!!actionLoading}
              >
                <option value="weekly">Weekly</option>
                <option value="bi-weekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
              </select>

              <button
                onClick={() => handleAction("skip-next", job.id)}
                disabled={!!actionLoading}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors disabled:opacity-50"
                title="Skip next instance"
              >
                <SkipForward className="w-3 h-3" />
                Skip next
              </button>

              {isPaused ? (
                <button
                  onClick={() => handleAction("resume", job.id)}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  <Play className="w-3 h-3" />
                  Resume
                </button>
              ) : (
                <button
                  onClick={() => handleAction("pause", job.id)}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
                >
                  <Pause className="w-3 h-3" />
                  Pause
                </button>
              )}

              <button
                onClick={() => {
                  if (confirm("Cancel this entire recurring series? All future instances will be cancelled.")) {
                    handleAction("cancel", job.id)
                  }
                }}
                disabled={!!actionLoading}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                <XCircle className="w-3 h-3" />
                Cancel series
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function CustomersPage() {
  const { user } = useAuth()
  const isHouseCleaning = user?.tenantSlug !== "winbros"
  const [customers, setCustomers] = useState<Customer[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [calls, setCalls] = useState<Call[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("customers_active_tab")
      if (saved === "messages" || saved === "jobs" || saved === "invoices" || saved === "recurring") return saved
    }
    return "messages"
  })
  const switchTab = (tab: TabType) => {
    setActiveTab(tab)
    localStorage.setItem("customers_active_tab", tab)
  }
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [smsMessage, setSmsMessage] = useState("")
  const [sendingSms, setSendingSms] = useState(false)
  const [deletingCustomer, setDeletingCustomer] = useState(false)
  const deletingRef = useRef(false) // ref to skip polling during delete
  const [copied, setCopied] = useState(false)
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

  // Payment popover state
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentType, setPaymentType] = useState<string | null>(null)
  const [paymentAmount, setPaymentAmount] = useState("")
  const [paymentJobId, setPaymentJobId] = useState<string>("")
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentResult, setPaymentResult] = useState<{ url?: string; invoiceId?: string } | null>(null)
  const [paymentCopied, setPaymentCopied] = useState(false)
  const [paymentSmsSent, setPaymentSmsSent] = useState(false)
  const paymentRef = useRef<HTMLDivElement>(null)

  // Cleaner phones for badge
  const [cleanerPhones, setCleanerPhones] = useState<string[]>([])

  // Batch add state
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchText, setBatchText] = useState("")
  const [batchParsing, setBatchParsing] = useState(false)
  const [batchParsed, setBatchParsed] = useState<Array<{ first_name: string; last_name: string; phone_number: string; email: string | null; address: string | null }> | null>(null)
  const [batchCreating, setBatchCreating] = useState(false)
  const [batchResult, setBatchResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null)

  // Initial data fetch
  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/customers")
        const json = await res.json()
        if (json.success) {
          setCustomers(json.data.customers)
          setMessages(json.data.messages)
          setJobs(json.data.jobs)
          setCalls(json.data.calls)
          setLeads(json.data.leads || [])
          setScheduledTasks(json.data.scheduledTasks || [])
          setCleanerPhones(json.data.cleanerPhones || [])
          if (json.data.customers.length > 0) {
            const savedId = typeof window !== "undefined" ? localStorage.getItem("selectedCustomerId") : null
            const restored = savedId ? json.data.customers.find((c: Customer) => String(c.id) === savedId) : null
            setSelectedCustomer(restored || json.data.customers[0])
          }
        }
      } catch (error) {
        console.error("Failed to fetch customers:", error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  // Poll for new messages and updates every 3 seconds
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      // Skip polling while a delete is in progress to avoid race conditions
      if (deletingRef.current) return
      try {
        const res = await fetch("/api/customers")
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
  }, [messages.length])

  const getCustomerName = (customer: Customer) => {
    if (customer.first_name || customer.last_name) {
      return [customer.first_name, customer.last_name].filter(Boolean).join(" ")
    }
    return formatPhone(customer.phone_number)
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

  const handlePaymentSms = async () => {
    if (!paymentResult?.url || !selectedCustomer) return
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
    }
  }

  const handleCopyTranscript = () => {
    if (!selectedCustomer) return
    const customerName = getCustomerName(selectedCustomer)
    const timeline = getCustomerTimeline(selectedCustomer)
    const lines = timeline.map((item) => {
      if (item.type === "message") {
        const msg = item.data as Message
        let sender: string
        if (msg.role === "client") sender = customerName
        else if (msg.role === "assistant") sender = "Mary (AI)"
        else if (msg.role === "business") sender = "WinBros"
        else sender = "System"
        return `${sender}: ${msg.content}`
      } else {
        const call = item.data as Call
        const dir = call.direction === "inbound" ? "Inbound" : "Outbound"
        const dur = call.duration_seconds ? ` (${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s)` : ""
        let text = `[${dir} Call${dur}]`
        if (call.transcript) text += `\n${call.transcript}`
        return text
      }
    })
    navigator.clipboard.writeText(lines.join("\n\n"))
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
        { id: "recurring", label: "Recurring", count: getCustomerJobs(selectedCustomer.phone_number).filter(j => j.frequency && j.frequency !== "one-time" && !j.parent_job_id).length },
      ]
    : []

  const filteredCustomers = customers.filter((customer) => {
    const name = getCustomerName(customer).toLowerCase()
    const q = searchQuery.toLowerCase()
    return name.includes(q) || customer.phone_number.includes(searchQuery)
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <div className="text-sm text-zinc-500">Loading customers...</div>
      </div>
    )
  }

  return (
    <div className="h-[calc(100dvh-8rem)] flex flex-col overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Main Layout */}
        <div className="flex flex-1 gap-4 min-h-0 overflow-hidden">
          {/* Customer List Sidebar - Hidden on mobile when a customer is selected */}
          <div className={`w-full md:w-72 flex-shrink-0 flex flex-col min-h-0 overflow-hidden ${selectedCustomer ? "hidden md:flex" : "flex"}`}>
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
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700/50 text-sm text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                  />
                </div>
                <button
                  onClick={() => { setNewCustomerOpen(true); setNewCustomerError("") }}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-purple-600/20 border border-purple-500/30 text-purple-300 text-sm font-medium hover:bg-purple-600/30 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  New Customer
                </button>
                <button
                  onClick={() => { setBatchOpen(true); setBatchText(""); setBatchParsed(null); setBatchResult(null) }}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 rounded-lg transition-colors"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Batch Add
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {filteredCustomers.length === 0 ? (
                  <div className="p-4 text-center text-sm text-zinc-600">No customers found</div>
                ) : (
                  filteredCustomers.map((customer) => {
                    const revenue = getCustomerRevenue(customer.phone_number)
                    const jobCount = getCustomerJobs(customer.phone_number).length
                    const isSelected = selectedCustomer?.id === customer.id
                    const name = getCustomerName(customer)

                    return (
                      <button
                        key={customer.id}
                        onClick={() => {
                          setSelectedCustomer(customer)
                          if (typeof window !== "undefined") localStorage.setItem("selectedCustomerId", String(customer.id))
                          switchTab("messages")
                        }}
                        className={`w-full text-left px-4 py-3 border-b border-zinc-800/50 ${
                          isSelected ? "bg-zinc-800/80" : "hover:bg-zinc-800/40"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
                              isSelected
                                ? "bg-purple-500/20 text-purple-300"
                                : "bg-zinc-800 text-zinc-400"
                            }`}
                          >
                            {name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-zinc-200 truncate">{name}</span>
                              {isHouseCleaning && (
                                <>
                                  {customer.is_commercial ? (
                                    <span title="Commercial" className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/15 text-blue-400 border border-blue-500/20">
                                      🏢
                                    </span>
                                  ) : (
                                    <span title="Residential" className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
                                      🏠
                                    </span>
                                  )}
                                  {getCustomerJobs(customer.phone_number).some((j: any) => j.frequency && j.frequency !== "one-time") && (
                                    <span title="Recurring" className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/15 text-purple-400 border border-purple-500/20">
                                      🔁
                                    </span>
                                  )}
                                </>
                              )}
                              {customer.card_on_file_at && (
                                <span title="Card on file" className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
                                  Card
                                </span>
                              )}
                              {cleanerPhones.length > 0 && cleanerPhones.includes(normalizePhone(customer.phone_number)) && (
                                <span title="Also a cleaner" className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-500/15 text-teal-400 border border-teal-500/20">
                                  🧹
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-zinc-500">
                              {jobCount} {jobCount === 1 ? "job" : "jobs"} · ${revenue.toLocaleString()}
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
          <div className={`flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto ${selectedCustomer ? "flex" : "hidden md:flex"}`}>
            {selectedCustomer ? (
              <>
                {/* Mobile back button */}
                <button
                  onClick={() => setSelectedCustomer(null)}
                  className="md:hidden flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 py-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  Back to customers
                </button>

                {/* Lead Flow Progress */}
                <LeadFlowProgress
                  lead={getCustomerLead(selectedCustomer.phone_number)}
                  customerName={getCustomerName(selectedCustomer)}
                  scheduledTasks={scheduledTasks}
                  followupPaused={isFollowupPaused(getCustomerLead(selectedCustomer.phone_number))}
                  onMoveToStage={handleMoveToStage}
                />

                {/* Customer Info + Tabs */}
                <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 flex flex-col flex-1 min-h-0">
                  {/* Customer header */}
                  <div className="px-5 pt-4 pb-0">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-9 h-9 rounded-full bg-purple-500/20 flex items-center justify-center text-sm font-semibold text-purple-300">
                        {getCustomerName(selectedCustomer).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <h2 className="text-base font-semibold text-zinc-100">
                          {getCustomerName(selectedCustomer)}
                        </h2>
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
                          <div className="fixed inset-x-4 top-1/4 z-50 w-auto max-w-sm mx-auto bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden md:absolute md:inset-auto md:right-0 md:top-9 md:w-72 md:mx-0">
                            {!paymentType && !paymentResult && (
                              <div className="p-2 space-y-0.5">
                                <p className="px-2 py-1.5 text-xs font-medium text-zinc-400 uppercase tracking-wider">Generate Link</p>
                                {[
                                  { key: "card_on_file", label: "Card on File", desc: "Save card for later", icon: CreditCard },
                                  { key: "payment", label: "Payment Link", desc: "Custom amount", icon: DollarSign },
                                  { key: "deposit", label: "Deposit", desc: "50% + 3% fee", icon: DollarSign },
                                  { key: "invoice", label: "Invoice", desc: "Email invoice", icon: FileText },
                                ].map((opt) => (
                                  <button
                                    key={opt.key}
                                    onClick={() => {
                                      if (opt.key === "payment") {
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

                      {/* Delete Customer */}
                      <button
                        onClick={handleDeleteCustomer}
                        disabled={deletingCustomer}
                        className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                        title="Delete customer"
                      >
                        {deletingCustomer ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>

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
                  <div className="p-5 flex-1 overflow-hidden flex flex-col">
                    {/* Messages + Calls Timeline */}
                    {activeTab === "messages" && (
                      <div className="flex flex-col flex-1 min-h-0">
                        <div className="flex-1 overflow-y-auto">
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
                                    <MessageBubble
                                      key={`msg-${idx}`}
                                      role={msg.role as "client" | "business" | "assistant" | "system"}
                                      content={msg.content}
                                      timestamp={msg.timestamp}
                                    />
                                  )
                                } else {
                                  const call = item.data as Call
                                  return <CallBubble key={`call-${idx}`} call={call} />
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
                                  <div className="text-sm font-medium text-zinc-200">
                                    {job.service_type || "Cleaning"}
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

                    {/* Recurring Series */}
                    {activeTab === "recurring" && (
                      <RecurringTab
                        jobs={getCustomerJobs(selectedCustomer.phone_number)}
                        customer={selectedCustomer}
                      />
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="border border-dashed border-zinc-800 rounded-xl p-12 text-center flex-1 flex items-center justify-center">
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
    </div>
  )
}
