"use client"

import { useState, useEffect, useRef } from "react"
import { MessageBubble } from "@/components/message-bubble"
import { CallBubble } from "@/components/call-bubble"
import { Send, Loader2 } from "lucide-react"

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
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>("messages")
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [smsMessage, setSmsMessage] = useState("")
  const [sendingSms, setSendingSms] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

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
          if (json.data.customers.length > 0) {
            setSelectedCustomer(json.data.customers[0])
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

  const getCustomerName = (customer: Customer) => {
    if (customer.first_name || customer.last_name) {
      return [customer.first_name, customer.last_name].filter(Boolean).join(" ")
    }
    return formatPhone(customer.phone_number)
  }

  const getCustomerMessages = (phoneNumber: string) =>
    messages.filter((m) => m.phone_number === phoneNumber)

  const getCustomerJobs = (phoneNumber: string) =>
    jobs.filter((j) => j.phone_number === phoneNumber)

  const getCustomerCalls = (phoneNumber: string) =>
    calls.filter((c) => c.phone_number === phoneNumber)

  const getCustomerRevenue = (phoneNumber: string) =>
    getCustomerJobs(phoneNumber).reduce((sum, j) => sum + (j.price || 0), 0)

  const getCustomerPaid = (phoneNumber: string) =>
    getCustomerJobs(phoneNumber)
      .filter((j) => j.paid)
      .reduce((sum, j) => sum + (j.price || 0), 0)

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
    <div className="h-full flex flex-col">
      <div className="flex flex-col flex-1 min-h-0">
        {/* Main Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0">
          {/* Customer List Sidebar */}
          <div className="lg:col-span-3 flex flex-col min-h-0">
            <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 flex flex-col flex-1 min-h-0">
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

          {/* Customer Detail */}
          <div className="lg:col-span-9 flex flex-col gap-4 min-h-0">
            {selectedCustomer ? (
              <>
                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-3">
                    <div className="text-xs font-medium text-zinc-500 mb-1">Revenue</div>
                    <div className="text-lg font-bold text-zinc-100">
                      ${getCustomerRevenue(selectedCustomer.phone_number).toLocaleString()}
                    </div>
                  </div>
                  <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-3">
                    <div className="text-xs font-medium text-zinc-500 mb-1">Paid</div>
                    <div className="text-lg font-bold text-emerald-400">
                      ${getCustomerPaid(selectedCustomer.phone_number).toLocaleString()}
                    </div>
                  </div>
                  <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-3">
                    <div className="text-xs font-medium text-zinc-500 mb-1">Calls</div>
                    <div className="text-lg font-bold text-zinc-100">
                      {getCustomerCalls(selectedCustomer.phone_number).length}
                    </div>
                  </div>
                  <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-3">
                    <div className="text-xs font-medium text-zinc-500 mb-1">Messages</div>
                    <div className="text-lg font-bold text-zinc-100">
                      {getCustomerMessages(selectedCustomer.phone_number).length}
                    </div>
                  </div>
                  <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-3">
                    <div className="text-xs font-medium text-zinc-500 mb-1">Jobs</div>
                    <div className="text-lg font-bold text-zinc-100">
                      {getCustomerJobs(selectedCustomer.phone_number).length}
                    </div>
                  </div>
                </div>

                {/* Customer Info + Tabs */}
                <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 flex flex-col flex-1 min-h-0">
                  {/* Customer header */}
                  <div className="px-5 pt-4 pb-0">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-9 h-9 rounded-full bg-purple-500/20 flex items-center justify-center text-sm font-semibold text-purple-300">
                        {getCustomerName(selectedCustomer).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-zinc-100">
                          {getCustomerName(selectedCustomer)}
                        </h2>
                        <p className="text-xs text-zinc-500">
                          {formatPhone(selectedCustomer.phone_number)}
                        </p>
                      </div>
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
