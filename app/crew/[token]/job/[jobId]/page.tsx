"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, Calendar, Clock, MapPin, User, Phone,
  CheckCircle2, Circle, Loader2, AlertCircle,
  Navigation, Home as HomeIcon, CreditCard, DollarSign,
  Send, MessageCircle, Bed, Bath, Ruler, Timer, Users,
  ChevronDown, ChevronUp, PartyPopper, Sparkles, Car, Flag,
} from "lucide-react"

// ── Types ──
interface JobDetail {
  id: number; date: string; scheduled_at: string | null; address: string | null
  service_type: string | null; status: string; notes: string | null
  bedrooms: number | null; bathrooms: number | null; sqft: number | null
  hours: number | null; cleaner_pay: number | null; currency: string; total_hours: number | null
  hours_per_cleaner: number | null; num_cleaners: number | null
  paid: boolean; payment_status: string | null
  cleaner_omw_at: string | null; cleaner_arrived_at: string | null
  payment_method: string | null; card_on_file: boolean
}
interface ChecklistItem { id: number | string; text: string; order: number; required: boolean; completed: boolean; completed_at: string | null }
interface Message { id: string; content: string; direction: string; role: string; timestamp: string; source: string; is_mine: boolean }
interface JobData {
  job: JobDetail; assignment: { id: string; status: string }
  customer: { first_name: string | null; last_name: string | null; phone?: string | null }
  checklist: ChecklistItem[]; tenant: { name: string; slug: string }
}

function formatDate(d: string) { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) }
function formatTime(t: string | null) {
  if (!t) return "TBD"
  try { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}` } catch { return t }
}
function humanize(v: string) { return v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) }
function fmtPay(amount: number, currency = "usd") {
  const cur = (currency || "usd").toUpperCase()
  return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount)
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
  const [showConfetti, setShowConfetti] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const apiBase = `/api/crew/${token}/job/${jobId}`

  const fetchData = useCallback(() => {
    fetch(apiBase).then(r => { if (!r.ok) throw new Error("Not found"); return r.json() })
      .then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [apiBase])
  const fetchMessages = useCallback(() => {
    fetch(`${apiBase}/messages`).then(r => r.json()).then(d => setMessages(d.messages || [])).catch(() => {})
  }, [apiBase])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    if (showMessages) { fetchMessages(); const iv = setInterval(fetchMessages, 15000); return () => clearInterval(iv) }
  }, [showMessages, fetchMessages])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])

  async function updateStatus(status: string) {
    setUpdating(status)
    try {
      const res = await fetch(apiBase, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) })
      if (!res.ok) { const err = await res.json(); alert(err.error || "Failed"); return }
      if (status === "done") { setShowConfetti(true); setTimeout(() => setShowConfetti(false), 3000) }
      fetchData()
    } catch { alert("Network error") } finally { setUpdating(null) }
  }
  async function updateChecklist(itemId: number | string, completed: boolean) {
    try {
      await fetch(apiBase, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checklist_item_id: itemId, completed }) })
      setData(prev => prev ? { ...prev, checklist: prev.checklist.map(i => i.id === itemId ? { ...i, completed, completed_at: completed ? new Date().toISOString() : null } : i) } : prev)
    } catch {}
  }
  async function updatePayment(method: string) {
    try {
      await fetch(apiBase, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_method: method }) })
      setData(prev => prev ? { ...prev, job: { ...prev.job, payment_method: method } } : prev)
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
      const res = await fetch(apiBase, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) })
      if (!res.ok) { const err = await res.json(); alert(err.error || "Failed"); return }
      fetchData()
    } catch { alert("Network error") } finally { setUpdating(null) }
  }
  async function chargeCard() {
    if (charging) return; setCharging(true); setChargeResult(null)
    try {
      const res = await fetch(`${apiBase}/charge`, { method: "POST", headers: { "Content-Type": "application/json" } })
      const json = await res.json()
      if (!res.ok) setChargeResult({ success: false, error: json.error || "Charge failed" })
      else { setChargeResult({ success: true, amount: json.amount }); fetchData() }
    } catch { setChargeResult({ success: false, error: "Network error" }) } finally { setCharging(false) }
  }
  async function sendTipLink() {
    if (sendingTipLink) return; setSendingTipLink(true)
    try {
      const res = await fetch(`${apiBase}/tip-link`, { method: "POST", headers: { "Content-Type": "application/json" } })
      if (res.ok) setTipLinkSent(true)
      else { const json = await res.json(); alert(json.error || "Failed") }
    } catch { alert("Network error") } finally { setSendingTipLink(false) }
  }
  async function sendMessage() {
    if (!messageText.trim()) return; setSendingMessage(true)
    try {
      const res = await fetch(`${apiBase}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: messageText.trim() }) })
      if (!res.ok) { const err = await res.json(); alert(err.error || "Failed"); return }
      setMessageText(""); fetchMessages()
    } catch { alert("Network error") } finally { setSendingMessage(false) }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#f7f5f0" }}>
      <Loader2 className="size-8 animate-spin text-emerald-500" />
    </div>
  )
  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#f7f5f0" }}>
      <div className="text-center">
        <AlertCircle className="size-12 text-red-400 mx-auto mb-3" />
        <h1 className="text-xl font-bold text-slate-800">Job Not Found</h1>
        <p className="text-slate-500 mt-1 text-sm">Not found or no access.</p>
        <button onClick={() => router.push(`/crew/${token}`)} className="mt-4 text-sm font-bold text-emerald-600">Back to Portal</button>
      </div>
    </div>
  )

  const { job, assignment, customer, checklist, tenant } = data
  const isPending = assignment.status === "pending"
  const isCancelled = assignment.status === "cancelled" || assignment.status === "declined"
  const isActive = ["scheduled", "in_progress"].includes(job.status)
  const isCompleted = job.status === "completed"
  const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(" ")
  const completedCount = checklist.filter(i => i.completed).length
  const allChecked = checklist.length > 0 && completedCount === checklist.length

  // Step tracker data
  const steps = [
    { key: "omw", label: "On My Way", icon: <Car className="size-5" />, done: !!job.cleaner_omw_at, color: "#ff9600" },
    { key: "here", label: "Arrived", icon: <HomeIcon className="size-5" />, done: !!job.cleaner_arrived_at, color: "#1cb0f6" },
    { key: "done", label: "Complete", icon: <Flag className="size-5" />, done: isCompleted, color: "#58cc02" },
  ]

  return (
    <div className="min-h-screen pb-8" style={{ background: "#f7f5f0", fontFamily: "Inter, system-ui, sans-serif" }}>
      <style>{`
        @keyframes popIn { 0% { opacity:0; transform: scale(0.85) translateY(8px); } 60% { transform: scale(1.02); } 100% { opacity:1; transform: scale(1); } }
        @keyframes slideUp { from { opacity:0; transform: translateY(16px); } to { opacity:1; transform: translateY(0); } }
        @keyframes checkPop { 0% { transform: scale(0); } 60% { transform: scale(1.3); } 100% { transform: scale(1); } }
        @keyframes confettiFall { 0% { transform: translateY(-100vh) rotate(0deg); opacity:1; } 100% { transform: translateY(100vh) rotate(720deg); opacity:0; } }
        @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(88,204,2,0.4); } 50% { box-shadow: 0 0 0 8px rgba(88,204,2,0); } }
        .pop-in { animation: popIn 0.5s cubic-bezier(0.34,1.56,0.64,1) both; }
        .slide-up { animation: slideUp 0.4s ease-out both; }
        .check-pop { animation: checkPop 0.3s cubic-bezier(0.34,1.56,0.64,1); }
      `}</style>

      {/* Confetti overlay */}
      {showConfetti && (
        <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden">
          {Array.from({ length: 40 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-sm"
              style={{
                width: 8 + Math.random() * 8,
                height: 8 + Math.random() * 8,
                background: ["#58cc02", "#ff9600", "#1cb0f6", "#ff4b4b", "#ce82ff", "#ffd700"][i % 6],
                left: `${Math.random() * 100}%`,
                animation: `confettiFall ${1.5 + Math.random() * 2}s linear ${Math.random() * 0.5}s both`,
              }}
            />
          ))}
        </div>
      )}

      {/* Cancelled banner */}
      {isCancelled && (
        <div className="px-4 py-3 text-center text-sm font-bold text-white" style={{ background: "#ff4b4b" }}>
          This assignment was cancelled
        </div>
      )}

      {/* ═══ HEADER (inline, no colored bar) ═══ */}
      <div className="max-w-lg mx-auto px-5 pt-5">
        <button onClick={() => router.push(`/crew/${token}`)} className="flex items-center gap-1.5 text-slate-400 text-sm mb-4 hover:text-slate-600 transition-colors">
          <ArrowLeft className="size-4" /> Back
        </button>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-0.5">{tenant.name}</p>
        <h1 className="text-xl font-black text-slate-800">
          {job.service_type ? humanize(job.service_type) : "Job"} #{job.id}
        </h1>
      </div>

      <div className="max-w-lg mx-auto px-4 space-y-4 mt-4">

        {/* ═══ JOB INFO CARD ═══ */}
        <div className="bg-white rounded-2xl p-5 pop-in" style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
          {/* Date/Time hero */}
          <div className="flex items-center gap-3 mb-4">
            <div className="size-12 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #58cc02, #89e219)" }}>
              <Calendar className="size-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">{formatDate(job.date)}</p>
              <p className="text-sm text-slate-500 flex items-center gap-1"><Clock className="size-3.5" /> {formatTime(job.scheduled_at)}</p>
            </div>
          </div>

          {/* Address */}
          {job.address && (
            <a href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2.5 py-2.5 px-3 rounded-xl mb-3 transition-colors"
              style={{ background: "#f0f9ff", border: "1.5px solid #bae6fd" }}>
              <MapPin className="size-4 text-sky-500 shrink-0" />
              <span className="text-sm font-medium text-sky-700 truncate">{job.address}</span>
            </a>
          )}

          {/* Customer + Phone */}
          <div className="space-y-2">
            {customerName && (
              <div className="flex items-center gap-2.5 text-sm text-slate-600">
                <User className="size-4 text-slate-400" /> <span className="font-medium">{customerName}</span>
              </div>
            )}
            {customer.phone && (
              <div className="flex items-center gap-2.5 text-sm">
                <Phone className="size-4 text-slate-400" />
                <a href={`tel:${customer.phone}`} className="font-medium text-emerald-600">{customer.phone}</a>
              </div>
            )}
          </div>

          {/* Property pills */}
          {(job.bedrooms || job.bathrooms || job.sqft) && (
            <div className="flex flex-wrap gap-2 mt-4">
              {job.bedrooms != null && <InfoPill icon={<Bed className="size-3.5" />} text={`${job.bedrooms} bed`} />}
              {job.bathrooms != null && <InfoPill icon={<Bath className="size-3.5" />} text={`${job.bathrooms} bath`} />}
              {job.sqft != null && <InfoPill icon={<Ruler className="size-3.5" />} text={`${job.sqft} sqft`} />}
              {(job.total_hours || job.hours) && <InfoPill icon={<Timer className="size-3.5" />} text={`${job.total_hours ?? job.hours}h`} />}
              {job.num_cleaners && <InfoPill icon={<Users className="size-3.5" />} text={`${job.num_cleaners} crew`} />}
            </div>
          )}

          {/* Pay — big and prominent */}
          {job.cleaner_pay != null && (
            <div className="mt-4 flex items-center gap-3">
              <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: "#dcfce7" }}>
                <DollarSign className="size-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xl font-black text-emerald-600">{fmtPay(Number(job.cleaner_pay), job.currency)}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Your Pay</p>
              </div>
            </div>
          )}

          {/* Notes */}
          {job.notes && (
            <div className="mt-4">
              <NotesDisplay notes={job.notes} />
            </div>
          )}
        </div>

        {/* ═══ ACCEPT / DECLINE ═══ */}
        {isPending && (
          <div className="bg-white rounded-2xl p-5 pop-in" style={{ boxShadow: "0 0 0 2px #ff9600, 0 4px 15px rgba(255,150,0,0.15)", animationDelay: "0.1s" }}>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="size-5 text-amber-500" />
              <p className="font-bold text-slate-800">New Job Assignment</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => handleAcceptDecline("accept")}
                disabled={!!updating}
                className="flex-1 py-3.5 rounded-2xl font-black text-sm text-white active:scale-95 transition-all disabled:opacity-50"
                style={{ background: "#58cc02", boxShadow: "0 4px 0 #46a302" }}
              >
                {updating === "accept" ? <Loader2 className="size-4 animate-spin mx-auto" /> : "ACCEPT"}
              </button>
              <button
                onClick={() => handleAcceptDecline("decline")}
                disabled={!!updating}
                className="flex-1 py-3.5 rounded-2xl font-black text-sm text-white active:scale-95 transition-all disabled:opacity-50"
                style={{ background: "#ff4b4b", boxShadow: "0 4px 0 #d63c3c" }}
              >
                {updating === "decline" ? <Loader2 className="size-4 animate-spin mx-auto" /> : "DECLINE"}
              </button>
            </div>
          </div>
        )}

        {/* ═══ STEP TRACKER (OMW → HERE → DONE) ═══ */}
        {isActive && !isPending && (
          <div className="bg-white rounded-2xl p-5 slide-up" style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.06)", animationDelay: "0.15s" }}>
            <p className="font-bold text-slate-800 mb-5 text-sm">Job Progress</p>

            {/* Action button — only show the NEXT step as one big button */}
            {(() => {
              const nextStep = !job.cleaner_omw_at ? steps[0] :
                !job.cleaner_arrived_at ? steps[1] :
                !isCompleted ? steps[2] : null
              if (!nextStep) return null
              return (
                <button
                  onClick={() => updateStatus(nextStep.key)}
                  disabled={!!updating}
                  className="w-full py-4 rounded-2xl font-black text-base text-white active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{
                    background: nextStep.color,
                    boxShadow: `0 4px 0 ${nextStep.color}90, 0 6px 20px ${nextStep.color}30`,
                  }}
                >
                  {updating === nextStep.key
                    ? <Loader2 className="size-5 animate-spin" />
                    : <>{nextStep.icon} {nextStep.label.toUpperCase()}</>
                  }
                </button>
              )
            })()}
          </div>
        )}

        {/* Can't Make It */}
        {isActive && !isPending && !job.cleaner_omw_at && (
          <button onClick={handleCancelAccepted} disabled={!!updating}
            className="w-full py-3 rounded-2xl text-sm font-bold text-red-500 active:scale-[0.97] transition-all disabled:opacity-50"
            style={{ background: "#fff5f5", border: "2px solid #fecaca" }}>
            {updating === "cancel" ? "Cancelling..." : "Can't Make It"}
          </button>
        )}

        {/* ═══ CHECKLIST (CLIPBOARD) ═══ */}
        {checklist.length > 0 && !isPending && (
          <div className="relative slide-up" style={{ animationDelay: "0.2s" }}>
            {/* Clip */}
            <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10">
              <div className="w-16 h-5 rounded-b-lg relative" style={{ background: "linear-gradient(180deg, #a8a29e, #78716c)", boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}>
                <div className="absolute top-1 left-1/2 -translate-x-1/2 size-3 rounded-full" style={{ background: "linear-gradient(135deg, #e7e5e4, #d6d3d1)", border: "1.5px solid #a8a29e" }} />
              </div>
            </div>

            <div className="bg-white rounded-2xl pt-8 pb-5 px-5 relative overflow-hidden" style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
              {/* Ruled lines */}
              <div className="absolute inset-0 pointer-events-none" style={{ opacity: 0.04 }}>
                {Array.from({ length: 15 }).map((_, i) => (
                  <div key={i} className="w-full absolute" style={{ top: `${50 + i * 36}px`, height: 1, background: "#1e40af" }} />
                ))}
              </div>
              {/* Red margin line */}
              <div className="absolute top-0 bottom-0 left-12 w-[1px] pointer-events-none" style={{ background: "rgba(239,68,68,0.12)" }} />

              <div className="relative z-10">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-bold text-slate-800 text-sm">Checklist</p>
                  <span className="text-xs font-black px-2.5 py-1 rounded-full" style={{
                    background: allChecked ? "#dcfce7" : "#fef3c7",
                    color: allChecked ? "#16a34a" : "#d97706",
                  }}>
                    {allChecked ? "ALL DONE!" : `${completedCount}/${checklist.length}`}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="h-2 rounded-full mb-4" style={{ background: "#f1ede6" }}>
                  <div className="h-full rounded-full transition-all duration-500 ease-out" style={{
                    width: `${(completedCount / checklist.length) * 100}%`,
                    background: allChecked ? "#58cc02" : "linear-gradient(90deg, #ff9600, #ffb347)",
                    boxShadow: `0 0 8px ${allChecked ? "rgba(88,204,2,0.4)" : "rgba(255,150,0,0.3)"}`,
                  }} />
                </div>

                <div className="space-y-1">
                  {checklist.map(item => (
                    <button
                      key={item.id}
                      onClick={() => updateChecklist(item.id, !item.completed)}
                      className="flex items-center gap-3 w-full text-left py-2.5 px-2 rounded-xl active:scale-[0.98] transition-all group"
                    >
                      <div className={`size-6 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200 ${item.completed ? "check-pop" : ""}`}
                        style={{
                          background: item.completed ? "#58cc02" : "transparent",
                          border: item.completed ? "none" : "2.5px solid #d6d3d1",
                          boxShadow: item.completed ? "0 2px 8px rgba(88,204,2,0.3)" : "none",
                        }}>
                        {item.completed && (
                          <svg viewBox="0 0 12 12" className="size-3.5" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 6L5 9L10 3" />
                          </svg>
                        )}
                      </div>
                      <span className={`text-sm font-medium transition-all ${item.completed ? "line-through text-slate-400" : "text-slate-700"}`}>
                        {item.text}
                      </span>
                    </button>
                  ))}
                </div>

                {allChecked && (
                  <div className="mt-4 flex items-center justify-center gap-2 py-3 rounded-xl" style={{ background: "#f0fdf4" }}>
                    <PartyPopper className="size-5 text-emerald-500" />
                    <span className="text-sm font-bold text-emerald-600">Everything done! Nice work!</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══ PAYMENT ═══ (hidden when card on file — auto-charge handles it) */}
        {isActive && !isPending && !job.card_on_file && (
          <div className="bg-white rounded-2xl p-5 slide-up" style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.06)", animationDelay: "0.25s" }}>
            <p className="font-bold text-slate-800 text-sm mb-3">Payment Method</p>
            <div className="grid grid-cols-2 gap-2">
              {(["card", "cash", "check", "venmo"] as const).map(method => {
                const selected = job.payment_method === method
                return (
                  <button key={method} onClick={() => updatePayment(method)}
                    className="py-3 px-3 rounded-xl text-sm font-bold active:scale-95 transition-all"
                    style={{
                      background: selected ? "#58cc02" : "#f7f5f0",
                      color: selected ? "#fff" : "#78716c",
                      boxShadow: selected ? "0 3px 0 #46a302" : "0 2px 0 #e2ddd5",
                      border: selected ? "none" : "1.5px solid #e2ddd5",
                    }}>
                    {method === "card" && <CreditCard className="size-4 inline mr-1" />}
                    {method === "cash" && <DollarSign className="size-4 inline mr-1" />}
                    {method.charAt(0).toUpperCase() + method.slice(1)}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ═══ CHARGE CARD ═══ */}
        {isCompleted && job.card_on_file && !job.paid && (
          <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
            <p className="font-bold text-slate-800 text-sm mb-1">Charge Card</p>
            <p className="text-xs text-slate-400 mb-3">Charge the customer&apos;s saved card</p>
            {chargeResult?.success && (
              <div className="rounded-xl p-3 mb-3 flex items-center gap-2 bg-emerald-50 border-2 border-emerald-200">
                <CheckCircle2 className="size-4 text-emerald-500" />
                <span className="text-sm font-bold text-emerald-600">Charged ${chargeResult.amount?.toFixed(2)}</span>
              </div>
            )}
            {chargeResult && !chargeResult.success && (
              <div className="rounded-xl p-3 mb-3 flex items-center gap-2 bg-red-50 border-2 border-red-200">
                <AlertCircle className="size-4 text-red-500" />
                <span className="text-sm font-bold text-red-600">{chargeResult.error}</span>
              </div>
            )}
            <button onClick={chargeCard} disabled={charging}
              className="w-full py-3 rounded-2xl font-black text-sm text-white flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
              style={{ background: "#58cc02", boxShadow: "0 4px 0 #46a302" }}>
              {charging ? <Loader2 className="size-4 animate-spin" /> : <><CreditCard className="size-4" /> CHARGE CUSTOMER</>}
            </button>
          </div>
        )}

        {/* Paid */}
        {isCompleted && job.paid && (
          <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: "#dcfce7", border: "2px solid #86efac" }}>
            <CheckCircle2 className="size-6 text-emerald-500" />
            <div>
              <p className="font-bold text-emerald-700 text-sm">Payment Collected</p>
              <p className="text-xs text-emerald-600">Paid via {job.payment_method || "card"}</p>
            </div>
          </div>
        )}

        {/* Tip Link */}
        {isCompleted && (
          <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
            <p className="font-bold text-slate-800 text-sm mb-2">Tip Link</p>
            {tipLinkSent ? (
              <div className="rounded-xl p-3 flex items-center gap-2 bg-emerald-50 border-2 border-emerald-200">
                <CheckCircle2 className="size-4 text-emerald-500" />
                <span className="text-sm font-bold text-emerald-600">Sent!</span>
              </div>
            ) : (
              <button onClick={sendTipLink} disabled={sendingTipLink}
                className="w-full py-3 rounded-2xl font-black text-sm text-white flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
                style={{ background: "#1cb0f6", boxShadow: "0 4px 0 #1499d6" }}>
                {sendingTipLink ? <Loader2 className="size-4 animate-spin" /> : <><DollarSign className="size-4" /> SEND TIP LINK</>}
              </button>
            )}
          </div>
        )}

        {/* ═══ MESSAGES ═══ */}
        {!isPending && (
          <div className="bg-white rounded-2xl p-5 slide-up" style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.06)", animationDelay: "0.3s" }}>
            <button onClick={() => setShowMessages(!showMessages)} className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: "#eff6ff" }}>
                  <MessageCircle className="size-4 text-blue-500" />
                </div>
                <span className="text-sm font-bold text-slate-800">Message Client</span>
              </div>
              {showMessages ? <ChevronUp className="size-4 text-slate-400" /> : <ChevronDown className="size-4 text-slate-400" />}
            </button>

            {showMessages && (
              <div className="mt-4">
                <div className="max-h-64 overflow-y-auto space-y-2 mb-3 p-3 rounded-xl" style={{ background: "#f7f5f0" }}>
                  {messages.length === 0
                    ? <p className="text-sm text-center py-6 text-slate-400">No messages yet</p>
                    : messages.map(msg => (
                        <div key={msg.id} className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                          <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed"
                            style={{
                              background: msg.direction === "outbound" ? (msg.is_mine ? "#58cc02" : "#d1d5db") : "#ffffff",
                              color: msg.direction === "outbound" && msg.is_mine ? "#fff" : "#1e293b",
                              border: msg.direction !== "outbound" ? "1.5px solid #e2ddd5" : "none",
                            }}>
                            <p>{msg.content}</p>
                            <p className="text-[10px] mt-1" style={{ opacity: 0.5 }}>
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                            </p>
                          </div>
                        </div>
                      ))
                  }
                  <div ref={messagesEndRef} />
                </div>
                <div className="flex gap-2">
                  <input type="text" value={messageText} onChange={e => setMessageText(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                    placeholder="Type a message..."
                    className="flex-1 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none"
                    style={{ background: "#f7f5f0", border: "1.5px solid #e2ddd5" }} maxLength={1000} />
                  <button onClick={sendMessage} disabled={!messageText.trim() || sendingMessage}
                    className="p-2.5 rounded-xl text-white disabled:opacity-30 active:scale-90 transition-all"
                    style={{ background: "#58cc02" }}>
                    {sendingMessage ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
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

function InfoPill({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-xl" style={{ background: "#f7f5f0", color: "#78716c" }}>
      {icon} {text}
    </span>
  )
}

function NotesDisplay({ notes }: { notes: string }) {
  const INTERNAL = /^(PROMO:|NORMAL_PRICE:|__SYS)/i
  const segments = notes.split(/\||\n/).map(s => s.trim()).filter(s => s && !INTERNAL.test(s))
  const desc: string[] = []; const bullets: string[] = []
  for (const seg of segments) { if (seg.startsWith("*")) bullets.push(seg.replace(/^\*\s*/, "")); else desc.push(seg) }
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Notes</p>
      {desc.length > 0 && <p className="text-sm text-slate-600">{desc.join(" — ")}</p>}
      {bullets.length > 0 && (
        <ul className="space-y-1.5">
          {bullets.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
              <span className="mt-1.5 size-2 rounded-full shrink-0" style={{ background: "#ff9600" }} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
