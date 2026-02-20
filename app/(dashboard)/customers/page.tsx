"use client"

import { useState, useEffect, useRef } from "react"
import { MessageBubble } from "@/components/message-bubble"
import { CallBubble } from "@/components/call-bubble"
import { LeadFlowProgress } from "@/components/lead-flow-progress"
import { parseFormData } from "@/lib/utils"
import { Send, Loader2 } from "lucide-react"

// Normalize phone to 10 digits for comparison
function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  let digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1)
  }
  return digits
}

type TabType = "messages" | "jobs" | "invoices"

interface Customer {
  id: number
  phone_number: string
  first_name?: string
  last_name?: string
  email?: string
  address?: string
  notes?: string
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
  price?: number
  status?: string
  paid?: boolean
  payment_status?: string
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

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [calls, setCalls] = useState<Call[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>("messages")
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [smsMessage, setSmsMessage] = useState("")
  const [sendingSms, setSendingSms] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

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
      try {
        const res = await fetch("/api/customers")
        const json = await res.json()
        if (json.success) {
          // Check if there are new messages to trigger scroll
          const prevCount = messages.length
          const newMessages = json.data.messages || []

          // Update customers list - shows new contacts without reload
          const newCustomers = json.data.customers || []
          if (newCustomers.length !== customers.length) {
            setCustomers(newCustomers)
          }
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
  }, [messages.length, customers.length])

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

    // Sort by timestamp ascending
    items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
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
    <div className="h-[calc(100vh-8rem)] flex flex-col overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Main Layout */}
        <div className="flex flex-1 gap-4 min-h-0 overflow-hidden">
          {/* Customer List Sidebar - Fixed height, doesn't scroll with page */}
          <div className="w-72 flex-shrink-0 flex flex-col min-h-0 overflow-hidden">
            <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 flex flex-col h-full overflow-hidden">
              <div className="p-3 border-b border-zinc-800">
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
                          setActiveTab("messages")
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
                            <div className="text-sm font-medium text-zinc-200 truncate">{name}</div>
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
          <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto">
            {selectedCustomer ? (
              <>
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
                      {/* Auto-Response Toggle */}
                      {getCustomerLead(selectedCustomer.phone_number) && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-400">Auto-response</span>
                          <button
                            onClick={() => handleToggleFollowup(!isFollowupPaused(getCustomerLead(selectedCustomer.phone_number)))}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                              isFollowupPaused(getCustomerLead(selectedCustomer.phone_number))
                                ? "bg-zinc-600"
                                : "bg-emerald-500"
                            }`}
                            title={isFollowupPaused(getCustomerLead(selectedCustomer.phone_number)) ? "Enable auto-response" : "Pause auto-response"}
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                                isFollowupPaused(getCustomerLead(selectedCustomer.phone_number))
                                  ? "translate-x-1"
                                  : "translate-x-[18px]"
                              }`}
                            />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Tab navigation */}
                    <div className="flex gap-1 border-b border-zinc-800 -mx-5 px-5">
                      {tabs.map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
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
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
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
    </div>
  )
}
