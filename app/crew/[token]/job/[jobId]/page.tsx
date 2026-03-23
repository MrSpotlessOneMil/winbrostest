"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  User,
  Phone,
  CheckCircle,
  Circle,
  Loader2,
  AlertCircle,
  Navigation,
  Home as HomeIcon,
  CreditCard,
  DollarSign,
  Send,
  MessageCircle,
} from "lucide-react"

interface JobDetail {
  id: number
  date: string
  scheduled_at: string | null
  address: string | null
  service_type: string | null
  status: string
  notes: string | null
  bedrooms: number | null
  bathrooms: number | null
  sqft: number | null
  hours: number | null
  cleaner_pay: number | null
  total_hours: number | null
  hours_per_cleaner: number | null
  num_cleaners: number | null
  paid: boolean
  payment_status: string | null
  cleaner_omw_at: string | null
  cleaner_arrived_at: string | null
  payment_method: string | null
  card_on_file: boolean
}

interface ChecklistItem {
  id: number
  text: string
  order: number
  required: boolean
  completed: boolean
  completed_at: string | null
}

interface Message {
  id: string
  content: string
  direction: string
  role: string
  timestamp: string
  source: string
  is_mine: boolean
}

interface JobData {
  job: JobDetail
  assignment: { id: string; status: string }
  customer: { first_name: string | null; last_name: string | null; phone?: string | null }
  checklist: ChecklistItem[]
  tenant: { name: string; slug: string }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
}

function formatTime(timeStr: string | null): string {
  if (!timeStr) return "TBD"
  try {
    const [h, m] = timeStr.split(":").map(Number)
    const ampm = h >= 12 ? "PM" : "AM"
    const hour12 = h % 12 || 12
    return `${hour12}:${m.toString().padStart(2, "0")} ${ampm}`
  } catch {
    return timeStr
  }
}

function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function JobDetailPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string
  const jobId = params.jobId as string

  const [data, setData] = useState<JobData | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [messageText, setMessageText] = useState("")
  const [sendingMessage, setSendingMessage] = useState(false)
  const [showMessages, setShowMessages] = useState(false)
  const [charging, setCharging] = useState(false)
  const [chargeResult, setChargeResult] = useState<{ success: boolean; amount?: number; error?: string } | null>(null)
  const [sendingTipLink, setSendingTipLink] = useState(false)
  const [tipLinkSent, setTipLinkSent] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const apiBase = `/api/crew/${token}/job/${jobId}`

  const fetchData = useCallback(() => {
    fetch(apiBase)
      .then((res) => {
        if (!res.ok) throw new Error("Not found")
        return res.json()
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [apiBase])

  const fetchMessages = useCallback(() => {
    fetch(`${apiBase}/messages`)
      .then((res) => res.json())
      .then((d) => setMessages(d.messages || []))
      .catch(() => {})
  }, [apiBase])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    if (showMessages) {
      fetchMessages()
      const interval = setInterval(fetchMessages, 15000) // Poll every 15s
      return () => clearInterval(interval)
    }
  }, [showMessages, fetchMessages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function updateStatus(status: string) {
    setUpdating(status)
    try {
      const res = await fetch(apiBase, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const err = await res.json()
        alert(err.error || "Failed to update")
        return
      }
      fetchData() // Refresh
    } catch {
      alert("Network error")
    } finally {
      setUpdating(null)
    }
  }

  async function updateChecklist(itemId: number, completed: boolean) {
    try {
      await fetch(apiBase, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checklist_item_id: itemId, completed }),
      })
      // Optimistic update
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          checklist: prev.checklist.map((item) =>
            item.id === itemId
              ? { ...item, completed, completed_at: completed ? new Date().toISOString() : null }
              : item
          ),
        }
      })
    } catch {}
  }

  async function updatePayment(method: string) {
    try {
      await fetch(apiBase, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_method: method }),
      })
      setData((prev) => {
        if (!prev) return prev
        return { ...prev, job: { ...prev.job, payment_method: method } }
      })
    } catch {}
  }

  async function handleCancelAccepted() {
    if (!confirm("Are you sure you can't make this job? It will be reassigned to another cleaner.")) return
    setUpdating("cancel")
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_accepted" }),
      })
      if (!res.ok) {
        const err = await res.json()
        alert(err.error || "Failed to cancel")
        return
      }
      router.push(`/crew/${token}`)
    } catch {
      alert("Network error")
    } finally {
      setUpdating(null)
    }
  }

  async function handleAcceptDecline(action: "accept" | "decline") {
    setUpdating(action)
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const err = await res.json()
        alert(err.error || "Failed")
        return
      }
      fetchData()
    } catch {
      alert("Network error")
    } finally {
      setUpdating(null)
    }
  }

  async function chargeCard() {
    if (charging) return
    setCharging(true)
    setChargeResult(null)
    try {
      const res = await fetch(`${apiBase}/charge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const json = await res.json()
      if (!res.ok) {
        setChargeResult({ success: false, error: json.error || "Charge failed" })
      } else {
        setChargeResult({ success: true, amount: json.amount })
        fetchData() // Refresh to update paid status
      }
    } catch {
      setChargeResult({ success: false, error: "Network error" })
    } finally {
      setCharging(false)
    }
  }

  async function sendTipLink() {
    if (sendingTipLink) return
    setSendingTipLink(true)
    try {
      const res = await fetch(`${apiBase}/tip-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      if (res.ok) {
        setTipLinkSent(true)
      } else {
        const json = await res.json()
        alert(json.error || "Failed to send tip link")
      }
    } catch {
      alert("Network error")
    } finally {
      setSendingTipLink(false)
    }
  }

  async function sendMessage() {
    if (!messageText.trim()) return
    setSendingMessage(true)
    try {
      const res = await fetch(`${apiBase}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: messageText.trim() }),
      })
      if (!res.ok) {
        const err = await res.json()
        alert(err.error || "Failed to send")
        return
      }
      setMessageText("")
      fetchMessages()
    } catch {
      alert("Network error")
    } finally {
      setSendingMessage(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="size-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center">
          <AlertCircle className="size-12 text-red-400 mx-auto mb-3" />
          <h1 className="text-xl font-semibold text-slate-800">Job Not Found</h1>
          <p className="text-slate-500 mt-1">This job doesn't exist or you don't have access.</p>
          <button
            onClick={() => router.push(`/crew/${token}`)}
            className="mt-4 text-blue-500 text-sm"
          >
            Back to Portal
          </button>
        </div>
      </div>
    )
  }

  const { job, assignment, customer, checklist, tenant } = data
  const isPending = assignment.status === "pending"
  const isCancelled = assignment.status === "cancelled" || assignment.status === "declined"
  const isActive = ["scheduled", "in_progress"].includes(job.status)
  const isCompleted = job.status === "completed"

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Cancelled/declined banner */}
      {isCancelled && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-center">
          <p className="text-amber-800 font-semibold text-sm">This assignment has been cancelled</p>
          <p className="text-amber-600 text-xs mt-0.5">You can view the details but no actions are available.</p>
        </div>
      )}
      {/* Header */}
      <div className="bg-blue-600 text-white px-4 py-4">
        <button
          onClick={() => router.push(`/crew/${token}`)}
          className="flex items-center gap-1 text-blue-200 text-sm mb-2"
        >
          <ArrowLeft className="size-4" />
          Back to Portal
        </button>
        <p className="text-blue-200 text-sm">{tenant.name}</p>
        <h1 className="text-lg font-bold">
          {job.service_type ? humanize(job.service_type) : "Job"} #{job.id}
        </h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Job Info Card — always shown first so cleaner sees details before acting */}
        <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Calendar className="size-4" />
            <span className="font-medium">{formatDate(job.date)}</span>
            <Clock className="size-4 ml-2" />
            <span>{formatTime(job.scheduled_at)}</span>
          </div>

          {job.address && (
            <div className="flex items-start gap-2 text-sm text-slate-600">
              <MapPin className="size-4 mt-0.5 shrink-0" />
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 underline"
              >
                {job.address}
              </a>
            </div>
          )}

          {(customer.first_name || customer.last_name) && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <User className="size-4" />
              <span>{[customer.first_name, customer.last_name].filter(Boolean).join(" ")}</span>
            </div>
          )}

          {customer.phone && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Phone className="size-4" />
              <a href={`tel:${customer.phone}`} className="text-blue-500 underline">
                {customer.phone}
              </a>
            </div>
          )}

          {(job.bedrooms || job.bathrooms || job.sqft) && (
            <div className="flex gap-4 text-sm text-slate-500 pt-1 border-t border-slate-100">
              {job.bedrooms != null && <span>{job.bedrooms} bed</span>}
              {job.bathrooms != null && <span>{job.bathrooms} bath</span>}
              {job.sqft != null && <span>{job.sqft} sqft</span>}
            </div>
          )}

          {/* Hours & Cleaners */}
          {(job.total_hours || job.num_cleaners || job.hours) && (
            <div className="flex gap-4 text-sm text-slate-500 pt-1 border-t border-slate-100">
              {(job.total_hours || job.hours) && (
                <span>{job.total_hours ?? job.hours}h estimated</span>
              )}
              {job.num_cleaners && <span>{job.num_cleaners} cleaner{job.num_cleaners > 1 ? "s" : ""}</span>}
              {job.hours_per_cleaner && <span>{job.hours_per_cleaner}h each</span>}
            </div>
          )}

          {/* Cleaner Pay — prominent */}
          {job.cleaner_pay != null && (
            <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
              <DollarSign className="size-4 text-green-600" />
              <span className="text-sm font-semibold text-green-700">
                Your pay: ${Number(job.cleaner_pay).toFixed(2)}
              </span>
            </div>
          )}

          {/* Special Instructions — inline in the info card */}
          {job.notes && (
            <div className="pt-1 border-t border-slate-100">
              <p className="font-medium text-slate-700 text-sm mb-1">Notes</p>
              <NotesDisplay notes={job.notes} />
            </div>
          )}
        </div>

        {/* Accept/Decline (pending assignments) */}
        {isPending && (
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h3 className="font-semibold text-slate-800 mb-3">New Job Assignment</h3>
            <div className="flex gap-3">
              <button
                onClick={() => handleAcceptDecline("accept")}
                disabled={!!updating}
                className="flex-1 bg-green-500 text-white py-2.5 rounded-lg font-medium hover:bg-green-600 disabled:opacity-50"
              >
                {updating === "accept" ? "..." : "Accept"}
              </button>
              <button
                onClick={() => handleAcceptDecline("decline")}
                disabled={!!updating}
                className="flex-1 bg-red-500 text-white py-2.5 rounded-lg font-medium hover:bg-red-600 disabled:opacity-50"
              >
                {updating === "decline" ? "..." : "Decline"}
              </button>
            </div>
          </div>
        )}

        {/* Status Buttons (OMW → HERE → DONE) */}
        {isActive && !isPending && (
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-800 mb-3">Status Update</h3>
            <div className="flex gap-2">
              <StatusButton
                label="OMW"
                icon={<Navigation className="size-4" />}
                active={!!job.cleaner_omw_at}
                disabled={!!job.cleaner_omw_at || !!updating}
                loading={updating === "omw"}
                onClick={() => updateStatus("omw")}
                color="indigo"
              />
              <StatusButton
                label="HERE"
                icon={<HomeIcon className="size-4" />}
                active={!!job.cleaner_arrived_at}
                disabled={!job.cleaner_omw_at || !!job.cleaner_arrived_at || !!updating}
                loading={updating === "here"}
                onClick={() => updateStatus("here")}
                color="blue"
              />
              <StatusButton
                label="DONE"
                icon={<CheckCircle className="size-4" />}
                active={isCompleted}
                disabled={!job.cleaner_arrived_at || isCompleted || !!updating}
                loading={updating === "done"}
                onClick={() => updateStatus("done")}
                color="green"
              />
            </div>
          </div>
        )}

        {/* Can't Make It — only for accepted/confirmed jobs before OMW */}
        {isActive && !isPending && !job.cleaner_omw_at && (
          <div className="bg-white rounded-lg border border-red-200 p-4">
            <button
              onClick={handleCancelAccepted}
              disabled={!!updating}
              className="w-full text-red-500 text-sm font-medium py-2 hover:text-red-600 disabled:opacity-50"
            >
              {updating === "cancel" ? "Cancelling..." : "Can't Make It"}
            </button>
          </div>
        )}

        {/* Checklist */}
        {checklist.length > 0 && !isPending && (
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800">Checklist</h3>
              <span className="text-xs text-slate-400">
                {checklist.filter((i) => i.completed).length}/{checklist.length}
              </span>
            </div>
            <div className="space-y-2">
              {checklist.map((item) => (
                <button
                  key={item.id}
                  onClick={() => updateChecklist(item.id, !item.completed)}
                  className="flex items-center gap-3 w-full text-left py-1"
                >
                  {item.completed ? (
                    <CheckCircle className="size-5 text-green-500 shrink-0" />
                  ) : (
                    <Circle className="size-5 text-slate-300 shrink-0" />
                  )}
                  <span
                    className={`text-sm ${
                      item.completed ? "text-slate-400 line-through" : "text-slate-700"
                    }`}
                  >
                    {item.text}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Payment Method */}
        {isActive && !isPending && (
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-800 mb-3">Payment Method</h3>
            <div className="grid grid-cols-2 gap-2">
              {(["card", "cash", "check", "venmo"] as const).map((method) => (
                <button
                  key={method}
                  onClick={() => updatePayment(method)}
                  className={`py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                    job.payment_method === method
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {method === "card" && <CreditCard className="size-4 inline mr-1.5" />}
                  {method === "cash" && <DollarSign className="size-4 inline mr-1.5" />}
                  {method.charAt(0).toUpperCase() + method.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Charge Card (completed jobs with card on file) */}
        {isCompleted && job.card_on_file && !job.paid && (
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-800 mb-2">Charge Card on File</h3>
            <p className="text-sm text-slate-500 mb-3">
              Charge customer&apos;s saved card for this job.
            </p>
            {chargeResult?.success && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3 flex items-center gap-2">
                <CheckCircle className="size-4 text-green-500" />
                <span className="text-sm text-green-700">Charged ${chargeResult.amount?.toFixed(2)}</span>
              </div>
            )}
            {chargeResult && !chargeResult.success && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3 flex items-center gap-2">
                <AlertCircle className="size-4 text-red-500" />
                <span className="text-sm text-red-700">{chargeResult.error}</span>
              </div>
            )}
            <button
              onClick={chargeCard}
              disabled={charging}
              className="w-full bg-green-500 text-white py-2.5 rounded-lg font-medium hover:bg-green-600 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {charging ? (
                <><Loader2 className="size-4 animate-spin" /> Charging...</>
              ) : (
                <><CreditCard className="size-4" /> Charge Customer</>
              )}
            </button>
          </div>
        )}

        {/* Already paid indicator */}
        {isCompleted && job.paid && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle className="size-5 text-green-500" />
            <div>
              <p className="font-semibold text-green-800 text-sm">Payment Collected</p>
              <p className="text-green-600 text-xs">Paid via {job.payment_method || "card"}</p>
            </div>
          </div>
        )}

        {/* Send Tip Link (completed jobs) */}
        {isCompleted && (
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-800 mb-2">Tip Link</h3>
            {tipLinkSent ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                <CheckCircle className="size-4 text-green-500" />
                <span className="text-sm text-green-700">Tip link sent to customer!</span>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-500 mb-3">Send the customer a link to leave a tip.</p>
                <button
                  onClick={sendTipLink}
                  disabled={sendingTipLink}
                  className="w-full bg-blue-500 text-white py-2.5 rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {sendingTipLink ? (
                    <><Loader2 className="size-4 animate-spin" /> Sending...</>
                  ) : (
                    <><DollarSign className="size-4" /> Send Tip Link</>
                  )}
                </button>
              </>
            )}
          </div>
        )}

        {/* Message Client */}
        {!isPending && (
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <button
              onClick={() => setShowMessages(!showMessages)}
              className="flex items-center justify-between w-full"
            >
              <div className="flex items-center gap-2">
                <MessageCircle className="size-5 text-blue-500" />
                <h3 className="font-semibold text-slate-800">Message Client</h3>
              </div>
              <span className="text-xs text-slate-400">{showMessages ? "Hide" : "Show"}</span>
            </button>

            {showMessages && (
              <div className="mt-3">
                {/* Message thread */}
                <div className="max-h-64 overflow-y-auto space-y-2 mb-3 p-2 bg-slate-50 rounded-lg">
                  {messages.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-4">No messages yet</p>
                  ) : (
                    messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${
                          msg.direction === "outbound" ? "justify-end" : "justify-start"
                        }`}
                      >
                        <div
                          className={`max-w-[80%] px-3 py-2 rounded-lg text-[15px] leading-relaxed ${
                            msg.direction === "outbound"
                              ? msg.is_mine
                                ? "bg-blue-500 text-white"
                                : "bg-slate-300 text-slate-800"
                              : "bg-white border border-slate-200 text-slate-700"
                          }`}
                        >
                          <p>{msg.content}</p>
                          <p
                            className={`text-[10px] mt-1 ${
                              msg.direction === "outbound" && msg.is_mine
                                ? "text-blue-200"
                                : "text-slate-400"
                            }`}
                          >
                            {new Date(msg.timestamp).toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Send input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                    placeholder="Type a message..."
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-400"
                    maxLength={1000}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!messageText.trim() || sendingMessage}
                    className="bg-blue-500 text-white p-2 rounded-lg hover:bg-blue-600 disabled:opacity-50"
                  >
                    {sendingMessage ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Parse pipe-separated + asterisk-bulleted notes into clean sections */
function NotesDisplay({ notes }: { notes: string }) {
  // Split on | or newlines, trim each segment
  const segments = notes
    .split(/\||\n/)
    .map((s) => s.trim())
    .filter(Boolean)

  // Separate: lines starting with * are bullet items, rest are description
  const description: string[] = []
  const bullets: string[] = []

  for (const seg of segments) {
    if (seg.startsWith("*")) {
      bullets.push(seg.replace(/^\*\s*/, ""))
    } else {
      description.push(seg)
    }
  }

  return (
    <div className="text-sm text-amber-900 space-y-2">
      {description.length > 0 && (
        <p>{description.join(" — ")}</p>
      )}
      {bullets.length > 0 && (
        <ul className="space-y-1 ml-1">
          {bullets.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-amber-500 mt-0.5 shrink-0">&#x2022;</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatusButton({
  label,
  icon,
  active,
  disabled,
  loading,
  onClick,
  color,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  disabled: boolean
  loading: boolean
  onClick: () => void
  color: string
}) {
  const colors: Record<string, { active: string; inactive: string }> = {
    indigo: {
      active: "bg-indigo-500 text-white border-indigo-500",
      inactive: "border-slate-200 text-slate-600 hover:border-indigo-300",
    },
    blue: {
      active: "bg-blue-500 text-white border-blue-500",
      inactive: "border-slate-200 text-slate-600 hover:border-blue-300",
    },
    green: {
      active: "bg-green-500 text-white border-green-500",
      inactive: "border-slate-200 text-slate-600 hover:border-green-300",
    },
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border font-medium text-sm transition-all disabled:opacity-50 ${
        active ? colors[color].active : colors[color].inactive
      }`}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {label}
    </button>
  )
}
