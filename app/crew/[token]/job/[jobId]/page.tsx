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
  Bed,
  Bath,
  Ruler,
  Timer,
  Users,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react"

// ── Themes ──────────────────────────────────────────────
const THEMES: Record<number, Theme> = {
  1: { // Midnight Luxe
    bg: "#0a0a0f",
    cardBg: "rgba(255,255,255,0.03)",
    cardBorder: "rgba(255,255,255,0.06)",
    cardHover: "rgba(255,255,255,0.06)",
    headerBg: "transparent",
    headerGradient: "linear-gradient(135deg, #ffffff 0%, #a78bfa 100%)",
    text: "#e2e8f0",
    textMuted: "rgba(255,255,255,0.4)",
    textFaint: "rgba(255,255,255,0.2)",
    accent: "#8b5cf6",
    accentRgb: "139,92,246",
    accentLight: "rgba(139,92,246,0.15)",
    success: "#4ade80",
    successBg: "rgba(34,197,94,0.12)",
    successBorder: "rgba(34,197,94,0.25)",
    danger: "#f87171",
    dangerBg: "rgba(248,113,113,0.12)",
    dangerBorder: "rgba(248,113,113,0.25)",
    payGradient: "linear-gradient(90deg, #f59e0b, #fbbf24)",
    inputBg: "rgba(255,255,255,0.05)",
    inputBorder: "rgba(255,255,255,0.1)",
    inputText: "#e2e8f0",
    divider: "rgba(255,255,255,0.06)",
    msgMine: "#8b5cf6",
    msgTheirs: "rgba(255,255,255,0.05)",
    msgTheirsBorder: "rgba(255,255,255,0.08)",
    glass: true,
    dark: true,
    orbs: true,
  },
  2: { // Aurora
    bg: "#fafafa",
    cardBg: "#ffffff",
    cardBorder: "transparent",
    cardHover: "#ffffff",
    headerBg: "linear-gradient(135deg, #9333ea 0%, #3b82f6 50%, #2dd4bf 100%)",
    headerGradient: "",
    text: "#1e293b",
    textMuted: "#64748b",
    textFaint: "#94a3b8",
    accent: "#3b82f6",
    accentRgb: "59,130,246",
    accentLight: "#eff6ff",
    success: "#22c55e",
    successBg: "#f0fdf4",
    successBorder: "#bbf7d0",
    danger: "#ef4444",
    dangerBg: "#fef2f2",
    dangerBorder: "#fecaca",
    payGradient: "",
    inputBg: "#ffffff",
    inputBorder: "#e2e8f0",
    inputText: "#1e293b",
    divider: "#f1f5f9",
    msgMine: "#3b82f6",
    msgTheirs: "#f8fafc",
    msgTheirsBorder: "#e2e8f0",
    glass: false,
    dark: false,
    orbs: false,
  },
  3: { // Mono
    bg: "#ffffff",
    cardBg: "#f8f8f8",
    cardBorder: "transparent",
    cardHover: "#f4f4f4",
    headerBg: "transparent",
    headerGradient: "",
    text: "#0f172a",
    textMuted: "#64748b",
    textFaint: "#cbd5e1",
    accent: "#4f46e5",
    accentRgb: "79,70,229",
    accentLight: "#eef2ff",
    success: "#22c55e",
    successBg: "#f0fdf4",
    successBorder: "#bbf7d0",
    danger: "#ef4444",
    dangerBg: "#fef2f2",
    dangerBorder: "#fecaca",
    payGradient: "",
    inputBg: "#ffffff",
    inputBorder: "#e2e8f0",
    inputText: "#0f172a",
    divider: "#f1f5f9",
    msgMine: "#4f46e5",
    msgTheirs: "#f8f8f8",
    msgTheirsBorder: "#e5e7eb",
    glass: false,
    dark: false,
    orbs: false,
  },
  4: { // Neon
    bg: "#000000",
    cardBg: "#0a0a0a",
    cardBorder: "#27272a",
    cardHover: "#111111",
    headerBg: "transparent",
    headerGradient: "",
    text: "#fafafa",
    textMuted: "#a1a1aa",
    textFaint: "#52525b",
    accent: "#22d3ee",
    accentRgb: "34,211,238",
    accentLight: "rgba(34,211,238,0.1)",
    success: "#4ade80",
    successBg: "rgba(74,222,128,0.1)",
    successBorder: "rgba(74,222,128,0.25)",
    danger: "#f87171",
    dangerBg: "rgba(248,113,113,0.1)",
    dangerBorder: "rgba(248,113,113,0.25)",
    payGradient: "",
    inputBg: "#0a0a0a",
    inputBorder: "#27272a",
    inputText: "#fafafa",
    divider: "#27272a",
    msgMine: "#22d3ee",
    msgTheirs: "#0a0a0a",
    msgTheirsBorder: "#27272a",
    glass: false,
    dark: true,
    orbs: false,
  },
  5: { // Warm
    bg: "#faf8f5",
    cardBg: "#ffffff",
    cardBorder: "rgba(251,191,36,0.15)",
    cardHover: "rgba(255,247,237,0.5)",
    headerBg: "linear-gradient(135deg, rgba(146,64,14,0.9) 0%, rgba(124,45,18,0.8) 100%)",
    headerGradient: "",
    text: "#292524",
    textMuted: "#78716c",
    textFaint: "#a8a29e",
    accent: "#b45309",
    accentRgb: "180,83,9",
    accentLight: "#fffbeb",
    success: "#059669",
    successBg: "#ecfdf5",
    successBorder: "#a7f3d0",
    danger: "#dc2626",
    dangerBg: "#fef2f2",
    dangerBorder: "#fecaca",
    payGradient: "",
    inputBg: "#ffffff",
    inputBorder: "rgba(251,191,36,0.2)",
    inputText: "#292524",
    divider: "rgba(251,191,36,0.1)",
    msgMine: "#b45309",
    msgTheirs: "#faf8f5",
    msgTheirsBorder: "rgba(251,191,36,0.15)",
    glass: false,
    dark: false,
    orbs: false,
  },
}

interface Theme {
  bg: string; cardBg: string; cardBorder: string; cardHover: string
  headerBg: string; headerGradient: string
  text: string; textMuted: string; textFaint: string
  accent: string; accentRgb: string; accentLight: string
  success: string; successBg: string; successBorder: string
  danger: string; dangerBg: string; dangerBorder: string
  payGradient: string
  inputBg: string; inputBorder: string; inputText: string
  divider: string
  msgMine: string; msgTheirs: string; msgTheirsBorder: string
  glass: boolean; dark: boolean; orbs: boolean
}

// ── Types ──────────────────────────────────────────────
interface JobDetail {
  id: number; date: string; scheduled_at: string | null; address: string | null
  service_type: string | null; status: string; notes: string | null
  bedrooms: number | null; bathrooms: number | null; sqft: number | null
  hours: number | null; cleaner_pay: number | null; total_hours: number | null
  hours_per_cleaner: number | null; num_cleaners: number | null
  paid: boolean; payment_status: string | null
  cleaner_omw_at: string | null; cleaner_arrived_at: string | null
  payment_method: string | null; card_on_file: boolean
}
interface ChecklistItem { id: number; text: string; order: number; required: boolean; completed: boolean; completed_at: string | null }
interface Message { id: string; content: string; direction: string; role: string; timestamp: string; source: string; is_mine: boolean }
interface JobData {
  job: JobDetail
  assignment: { id: string; status: string }
  customer: { first_name: string | null; last_name: string | null; phone?: string | null }
  checklist: ChecklistItem[]
  tenant: { name: string; slug: string }
}

function formatDate(d: string) { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) }
function formatTime(t: string | null) {
  if (!t) return "TBD"
  try { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}` } catch { return t }
}
function humanize(v: string) { return v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) }

// ── Main Component ──────────────────────────────────────
export default function JobDetailPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string
  const jobId = params.jobId as string

  // Read design from localStorage
  const [designNum, setDesignNum] = useState(5)
  useEffect(() => {
    try {
      const stored = localStorage.getItem("crew-design")
      if (stored) { const n = parseInt(stored, 10); if (n >= 1 && n <= 5) setDesignNum(n) }
    } catch {}
  }, [])
  const t = THEMES[designNum] || THEMES[2]

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
      if (!res.ok) { const err = await res.json(); alert(err.error || "Failed to update"); return }
      fetchData()
    } catch { alert("Network error") } finally { setUpdating(null) }
  }

  async function updateChecklist(itemId: number, completed: boolean) {
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
      const res = await fetch(apiBase, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel_accepted" }) })
      if (!res.ok) { const err = await res.json(); alert(err.error || "Failed to cancel"); return }
      router.push(`/crew/${token}`)
    } catch { alert("Network error") } finally { setUpdating(null) }
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
      else { const json = await res.json(); alert(json.error || "Failed to send tip link") }
    } catch { alert("Network error") } finally { setSendingTipLink(false) }
  }

  async function sendMessage() {
    if (!messageText.trim()) return; setSendingMessage(true)
    try {
      const res = await fetch(`${apiBase}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: messageText.trim() }) })
      if (!res.ok) { const err = await res.json(); alert(err.error || "Failed to send"); return }
      setMessageText(""); fetchMessages()
    } catch { alert("Network error") } finally { setSendingMessage(false) }
  }

  // ── Loading ──
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: t.bg }}>
      <Loader2 className="size-8 animate-spin" style={{ color: t.accent }} />
    </div>
  )

  // ── Error ──
  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: t.bg }}>
      <div className="text-center">
        <AlertCircle className="size-12 mx-auto mb-3" style={{ color: t.danger }} />
        <h1 className="text-xl font-semibold" style={{ color: t.text }}>Job Not Found</h1>
        <p className="mt-1 text-sm" style={{ color: t.textMuted }}>This job doesn&apos;t exist or you don&apos;t have access.</p>
        <button onClick={() => router.push(`/crew/${token}`)} className="mt-4 text-sm font-medium" style={{ color: t.accent }}>Back to Portal</button>
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

  // Step progress for status buttons
  const steps = [
    { done: !!job.cleaner_omw_at, label: "OMW" },
    { done: !!job.cleaner_arrived_at, label: "HERE" },
    { done: isCompleted, label: "DONE" },
  ]
  const currentStep = steps.filter(s => s.done).length

  return (
    <div className="min-h-screen pb-8" style={{ background: t.bg, color: t.text }}>
      {/* Ambient orbs for Midnight Luxe */}
      {t.orbs && (
        <>
          <div className="fixed pointer-events-none" style={{ width: 400, height: 400, borderRadius: "50%", background: "rgba(139,92,246,0.12)", filter: "blur(100px)", top: "-5%", right: "-10%", zIndex: 0 }} />
          <div className="fixed pointer-events-none" style={{ width: 300, height: 300, borderRadius: "50%", background: "rgba(6,182,212,0.08)", filter: "blur(80px)", bottom: "10%", left: "-5%", zIndex: 0 }} />
        </>
      )}

      <div className="relative z-10">
        {/* ── Cancelled Banner ── */}
        {isCancelled && (
          <div className="px-4 py-3 text-center text-sm" style={{ background: t.dangerBg, borderBottom: `1px solid ${t.dangerBorder}`, color: t.danger }}>
            This assignment has been cancelled
          </div>
        )}

        {/* ── Header ── */}
        <div
          className="px-5 pt-5 pb-6"
          style={{
            background: t.headerBg || "transparent",
            borderRadius: t.headerBg && !t.dark ? "0 0 1.5rem 1.5rem" : undefined,
          }}
        >
          <button
            onClick={() => router.push(`/crew/${token}`)}
            className="flex items-center gap-1.5 text-sm mb-4 transition-opacity hover:opacity-80"
            style={{ color: t.headerBg ? "rgba(255,255,255,0.7)" : t.textMuted }}
          >
            <ArrowLeft className="size-4" />
            Back
          </button>
          <p className="text-xs mb-1" style={{ color: t.headerBg ? "rgba(255,255,255,0.6)" : t.textFaint }}>
            {tenant.name}
          </p>
          <h1
            className="text-xl font-bold"
            style={t.headerGradient ? {
              background: t.headerGradient,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            } : { color: t.headerBg ? "#ffffff" : t.text }}
          >
            {job.service_type ? humanize(job.service_type) : "Job"} #{job.id}
          </h1>
        </div>

        <div className="max-w-lg mx-auto px-4 space-y-4" style={{ marginTop: t.headerBg && !t.dark ? "-0.5rem" : undefined }}>

          {/* ── Job Info Card ── */}
          <Card t={t}>
            {/* Date & Time — hero row */}
            <div className="flex items-center gap-5 mb-4">
              <div className="flex items-center gap-2">
                <div className="size-9 rounded-xl flex items-center justify-center" style={{ background: t.accentLight }}>
                  <Calendar className="size-4" style={{ color: t.accent }} />
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: t.text }}>{formatDate(job.date)}</p>
                  <p className="text-xs" style={{ color: t.textMuted }}>{formatTime(job.scheduled_at)}</p>
                </div>
              </div>
            </div>

            <Divider t={t} />

            {/* Address */}
            {job.address && (
              <InfoRow icon={<MapPin className="size-4" />} t={t}>
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                  style={{ color: t.accent }}
                >
                  {job.address}
                </a>
              </InfoRow>
            )}

            {/* Customer */}
            {customerName && <InfoRow icon={<User className="size-4" />} t={t}><span>{customerName}</span></InfoRow>}
            {customer.phone && (
              <InfoRow icon={<Phone className="size-4" />} t={t}>
                <a href={`tel:${customer.phone}`} className="underline underline-offset-2" style={{ color: t.accent }}>{customer.phone}</a>
              </InfoRow>
            )}

            {/* Property Details — pills */}
            {(job.bedrooms || job.bathrooms || job.sqft) && (
              <>
                <Divider t={t} />
                <div className="flex flex-wrap gap-2">
                  {job.bedrooms != null && <Pill icon={<Bed className="size-3.5" />} text={`${job.bedrooms} bed`} t={t} />}
                  {job.bathrooms != null && <Pill icon={<Bath className="size-3.5" />} text={`${job.bathrooms} bath`} t={t} />}
                  {job.sqft != null && <Pill icon={<Ruler className="size-3.5" />} text={`${job.sqft} sqft`} t={t} />}
                </div>
              </>
            )}

            {/* Hours & Cleaners */}
            {(job.total_hours || job.num_cleaners || job.hours) && (
              <div className="flex flex-wrap gap-2 mt-1">
                {(job.total_hours || job.hours) && <Pill icon={<Timer className="size-3.5" />} text={`${job.total_hours ?? job.hours}h`} t={t} />}
                {job.num_cleaners && <Pill icon={<Users className="size-3.5" />} text={`${job.num_cleaners} cleaner${job.num_cleaners > 1 ? "s" : ""}`} t={t} />}
              </div>
            )}

            {/* Pay */}
            {job.cleaner_pay != null && (
              <>
                <Divider t={t} />
                <div className="flex items-center gap-2.5">
                  <div className="size-9 rounded-xl flex items-center justify-center" style={{ background: t.successBg }}>
                    <DollarSign className="size-4" style={{ color: t.success }} />
                  </div>
                  <span
                    className="text-lg font-bold"
                    style={t.payGradient ? {
                      background: t.payGradient,
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    } : { color: t.success }}
                  >
                    ${Number(job.cleaner_pay).toFixed(2)}
                  </span>
                  <span className="text-xs" style={{ color: t.textFaint }}>Your pay</span>
                </div>
              </>
            )}

            {/* Notes */}
            {job.notes && (
              <>
                <Divider t={t} />
                <NotesDisplay notes={job.notes} t={t} />
              </>
            )}
          </Card>

          {/* ── Accept / Decline ── */}
          {isPending && (
            <Card t={t}>
              <p className="text-sm font-semibold mb-3" style={{ color: t.text }}>New Job Assignment</p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleAcceptDecline("accept")}
                  disabled={!!updating}
                  className="flex-1 py-3 rounded-xl font-semibold text-sm text-white transition-all active:scale-[0.97] disabled:opacity-50"
                  style={{ background: t.success }}
                >
                  {updating === "accept" ? "..." : "Accept"}
                </button>
                <button
                  onClick={() => handleAcceptDecline("decline")}
                  disabled={!!updating}
                  className="flex-1 py-3 rounded-xl font-semibold text-sm text-white transition-all active:scale-[0.97] disabled:opacity-50"
                  style={{ background: t.danger }}
                >
                  {updating === "decline" ? "..." : "Decline"}
                </button>
              </div>
            </Card>
          )}

          {/* ── Status Progress (OMW → HERE → DONE) ── */}
          {isActive && !isPending && (
            <Card t={t}>
              <p className="text-sm font-semibold mb-4" style={{ color: t.text }}>Job Progress</p>
              {/* Progress bar */}
              <div className="flex items-center gap-1 mb-4">
                {steps.map((step, i) => (
                  <div key={i} className="flex-1 flex items-center gap-1">
                    <div
                      className="h-1.5 flex-1 rounded-full transition-all duration-500"
                      style={{
                        background: step.done ? t.accent : t.dark ? "rgba(255,255,255,0.08)" : "#e2e8f0",
                        boxShadow: step.done ? `0 0 8px rgba(${t.accentRgb},0.3)` : "none",
                      }}
                    />
                  </div>
                ))}
              </div>
              {/* Buttons */}
              <div className="flex gap-2">
                <StatusBtn
                  label="OMW" icon={<Navigation className="size-4" />}
                  active={!!job.cleaner_omw_at}
                  disabled={!!job.cleaner_omw_at || !!updating}
                  loading={updating === "omw"}
                  onClick={() => updateStatus("omw")}
                  t={t}
                />
                <StatusBtn
                  label="HERE" icon={<HomeIcon className="size-4" />}
                  active={!!job.cleaner_arrived_at}
                  disabled={!job.cleaner_omw_at || !!job.cleaner_arrived_at || !!updating}
                  loading={updating === "here"}
                  onClick={() => updateStatus("here")}
                  t={t}
                />
                <StatusBtn
                  label="DONE" icon={<CheckCircle className="size-4" />}
                  active={isCompleted}
                  disabled={!job.cleaner_arrived_at || isCompleted || !!updating}
                  loading={updating === "done"}
                  onClick={() => updateStatus("done")}
                  t={t}
                />
              </div>
            </Card>
          )}

          {/* ── Can't Make It ── */}
          {isActive && !isPending && !job.cleaner_omw_at && (
            <button
              onClick={handleCancelAccepted}
              disabled={!!updating}
              className="w-full py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
              style={{
                background: t.dangerBg,
                color: t.danger,
                border: `1px solid ${t.dangerBorder}`,
              }}
            >
              {updating === "cancel" ? "Cancelling..." : "Can't Make It"}
            </button>
          )}

          {/* ── Checklist (Clipboard Style) ── */}
          {checklist.length > 0 && !isPending && (
            <div className="relative">
              {/* Clipboard clip at top center */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                <div
                  className="w-20 h-6 rounded-b-lg relative"
                  style={{
                    background: t.dark ? "#3f3f46" : "#a8a29e",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                  }}
                >
                  {/* Metal circle on clip */}
                  <div
                    className="absolute top-1 left-1/2 -translate-x-1/2 size-3.5 rounded-full"
                    style={{
                      background: t.dark
                        ? "linear-gradient(135deg, #52525b, #71717a)"
                        : "linear-gradient(135deg, #d6d3d1, #e7e5e4)",
                      border: `1.5px solid ${t.dark ? "#71717a" : "#a8a29e"}`,
                    }}
                  />
                </div>
              </div>

              {/* Clipboard body */}
              <div
                className="rounded-2xl pt-8 pb-5 px-5 relative overflow-hidden"
                style={{
                  background: t.dark ? "rgba(255,255,255,0.03)" : "#fffdf7",
                  border: `1.5px solid ${t.dark ? "rgba(255,255,255,0.06)" : "rgba(180,83,9,0.12)"}`,
                  boxShadow: t.dark ? "none" : "0 2px 12px rgba(120,53,15,0.06), inset 0 1px 0 rgba(255,255,255,0.8)",
                  backdropFilter: t.glass ? "blur(24px)" : undefined,
                }}
              >
                {/* Faint ruled lines */}
                <div className="absolute inset-0 pointer-events-none" style={{ opacity: t.dark ? 0.03 : 0.06 }}>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="w-full absolute" style={{ top: `${52 + i * 38}px`, height: 1, background: t.dark ? "#ffffff" : "#b45309" }} />
                  ))}
                </div>

                {/* Header row */}
                <div className="flex items-center justify-between mb-4 relative z-10">
                  <p className="text-sm font-semibold tracking-wide" style={{ color: t.text }}>
                    Checklist
                  </p>
                  <span
                    className="text-xs font-bold px-2.5 py-1 rounded-full"
                    style={{ background: t.accentLight, color: t.accent }}
                  >
                    {completedCount}/{checklist.length}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 rounded-full mb-5 relative z-10" style={{ background: t.dark ? "rgba(255,255,255,0.06)" : "rgba(180,83,9,0.08)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: `${(completedCount / checklist.length) * 100}%`,
                      background: t.dark ? t.accent : "linear-gradient(90deg, #b45309, #d97706)",
                      boxShadow: `0 0 10px rgba(${t.accentRgb},0.3)`,
                    }}
                  />
                </div>

                {/* Items */}
                <div className="space-y-0.5 relative z-10">
                  {checklist.map((item, idx) => (
                    <button
                      key={item.id}
                      onClick={() => updateChecklist(item.id, !item.completed)}
                      className="flex items-center gap-3 w-full text-left py-2.5 px-2 rounded-lg transition-all group"
                      style={{
                        animationDelay: `${idx * 40}ms`,
                      }}
                    >
                      {/* Custom checkbox */}
                      <div
                        className="size-5 rounded-md flex items-center justify-center shrink-0 transition-all duration-200"
                        style={{
                          background: item.completed ? t.success : "transparent",
                          border: item.completed ? "none" : `2px solid ${t.dark ? "rgba(255,255,255,0.15)" : "#d6d3d1"}`,
                          boxShadow: item.completed ? `0 0 8px rgba(34,197,94,0.25)` : "none",
                        }}
                      >
                        {item.completed && (
                          <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2.5 6L5 8.5L9.5 3.5" />
                          </svg>
                        )}
                      </div>
                      <span
                        className={`text-sm transition-all duration-200 ${item.completed ? "line-through" : ""}`}
                        style={{ color: item.completed ? t.textFaint : t.text }}
                      >
                        {item.text}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Payment Method ── */}
          {isActive && !isPending && (
            <Card t={t}>
              <p className="text-sm font-semibold mb-3" style={{ color: t.text }}>Payment</p>
              <div className="grid grid-cols-2 gap-2">
                {(["card", "cash", "check", "venmo"] as const).map(method => (
                  <button
                    key={method}
                    onClick={() => updatePayment(method)}
                    className="py-2.5 px-3 rounded-xl text-sm font-medium transition-all"
                    style={{
                      background: job.payment_method === method ? t.accentLight : "transparent",
                      border: `1.5px solid ${job.payment_method === method ? t.accent : t.dark ? "rgba(255,255,255,0.08)" : "#e2e8f0"}`,
                      color: job.payment_method === method ? t.accent : t.textMuted,
                    }}
                  >
                    {method === "card" && <CreditCard className="size-4 inline mr-1.5" />}
                    {method === "cash" && <DollarSign className="size-4 inline mr-1.5" />}
                    {method.charAt(0).toUpperCase() + method.slice(1)}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* ── Charge Card ── */}
          {isCompleted && job.card_on_file && !job.paid && (
            <Card t={t}>
              <p className="text-sm font-semibold mb-1" style={{ color: t.text }}>Charge Card on File</p>
              <p className="text-xs mb-3" style={{ color: t.textMuted }}>Charge customer&apos;s saved card</p>
              {chargeResult?.success && (
                <div className="rounded-xl p-3 mb-3 flex items-center gap-2" style={{ background: t.successBg, border: `1px solid ${t.successBorder}` }}>
                  <CheckCircle className="size-4" style={{ color: t.success }} />
                  <span className="text-sm" style={{ color: t.success }}>Charged ${chargeResult.amount?.toFixed(2)}</span>
                </div>
              )}
              {chargeResult && !chargeResult.success && (
                <div className="rounded-xl p-3 mb-3 flex items-center gap-2" style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}` }}>
                  <AlertCircle className="size-4" style={{ color: t.danger }} />
                  <span className="text-sm" style={{ color: t.danger }}>{chargeResult.error}</span>
                </div>
              )}
              <ActionButton onClick={chargeCard} disabled={charging} loading={charging} t={t} color="success">
                <CreditCard className="size-4" /> Charge Customer
              </ActionButton>
            </Card>
          )}

          {/* ── Paid ── */}
          {isCompleted && job.paid && (
            <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: t.successBg, border: `1px solid ${t.successBorder}` }}>
              <CheckCircle className="size-5" style={{ color: t.success }} />
              <div>
                <p className="font-semibold text-sm" style={{ color: t.success }}>Payment Collected</p>
                <p className="text-xs" style={{ color: t.success, opacity: 0.7 }}>Paid via {job.payment_method || "card"}</p>
              </div>
            </div>
          )}

          {/* ── Tip Link ── */}
          {isCompleted && (
            <Card t={t}>
              <p className="text-sm font-semibold mb-2" style={{ color: t.text }}>Tip Link</p>
              {tipLinkSent ? (
                <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: t.successBg, border: `1px solid ${t.successBorder}` }}>
                  <CheckCircle className="size-4" style={{ color: t.success }} />
                  <span className="text-sm" style={{ color: t.success }}>Tip link sent!</span>
                </div>
              ) : (
                <>
                  <p className="text-xs mb-3" style={{ color: t.textMuted }}>Send the customer a link to leave a tip</p>
                  <ActionButton onClick={sendTipLink} disabled={sendingTipLink} loading={sendingTipLink} t={t} color="accent">
                    <DollarSign className="size-4" /> Send Tip Link
                  </ActionButton>
                </>
              )}
            </Card>
          )}

          {/* ── Messages ── */}
          {!isPending && (
            <Card t={t}>
              <button onClick={() => setShowMessages(!showMessages)} className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <MessageCircle className="size-5" style={{ color: t.accent }} />
                  <span className="text-sm font-semibold" style={{ color: t.text }}>Message Client</span>
                </div>
                {showMessages ? <ChevronUp className="size-4" style={{ color: t.textFaint }} /> : <ChevronDown className="size-4" style={{ color: t.textFaint }} />}
              </button>

              {showMessages && (
                <div className="mt-4">
                  <div className="max-h-64 overflow-y-auto space-y-2 mb-3 p-3 rounded-xl" style={{ background: t.dark ? "rgba(255,255,255,0.02)" : "#f8fafc" }}>
                    {messages.length === 0
                      ? <p className="text-sm text-center py-6" style={{ color: t.textFaint }}>No messages yet</p>
                      : messages.map(msg => (
                          <div key={msg.id} className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                            <div
                              className="max-w-[80%] px-3.5 py-2.5 rounded-2xl text-[15px] leading-relaxed"
                              style={{
                                background: msg.direction === "outbound"
                                  ? (msg.is_mine ? t.msgMine : (t.dark ? "rgba(255,255,255,0.08)" : "#d1d5db"))
                                  : t.msgTheirs,
                                color: msg.direction === "outbound" && msg.is_mine ? "#ffffff" : t.text,
                                border: msg.direction !== "outbound" ? `1px solid ${t.msgTheirsBorder}` : "none",
                              }}
                            >
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
                    <input
                      type="text"
                      value={messageText}
                      onChange={e => setMessageText(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                      placeholder="Type a message..."
                      className="flex-1 rounded-xl px-4 py-2.5 text-base focus:outline-none transition-colors"
                      style={{
                        background: t.inputBg,
                        border: `1.5px solid ${t.inputBorder}`,
                        color: t.inputText,
                      }}
                      maxLength={1000}
                    />
                    <button
                      onClick={sendMessage}
                      disabled={!messageText.trim() || sendingMessage}
                      className="p-2.5 rounded-xl text-white disabled:opacity-40 transition-all active:scale-95"
                      style={{ background: t.accent }}
                    >
                      {sendingMessage ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    </button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Subcomponents ─────────────────────────────────────

function Card({ t, children }: { t: Theme; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: t.cardBg,
        border: `1px solid ${t.cardBorder}`,
        boxShadow: t.glass ? "none" : (t.dark ? "none" : "0 1px 3px rgba(0,0,0,0.04)"),
        backdropFilter: t.glass ? "blur(24px)" : undefined,
        WebkitBackdropFilter: t.glass ? "blur(24px)" : undefined,
      }}
    >
      {children}
    </div>
  )
}

function Divider({ t }: { t: Theme }) {
  return <div className="my-3" style={{ height: 1, background: t.divider }} />
}

function InfoRow({ icon, t, children }: { icon: React.ReactNode; t: Theme; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 text-sm" style={{ color: t.textMuted }}>
      <span style={{ color: t.textFaint }}>{icon}</span>
      {children}
    </div>
  )
}

function Pill({ icon, text, t }: { icon: React.ReactNode; text: string; t: Theme }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg"
      style={{ background: t.dark ? "rgba(255,255,255,0.05)" : "#f1f5f9", color: t.textMuted }}
    >
      {icon} {text}
    </span>
  )
}

function StatusBtn({ label, icon, active, disabled, loading, onClick, t }: {
  label: string; icon: React.ReactNode; active: boolean; disabled: boolean; loading: boolean; onClick: () => void; t: Theme
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 active:scale-[0.97]"
      style={{
        background: active ? t.accent : "transparent",
        border: `1.5px solid ${active ? t.accent : (t.dark ? "rgba(255,255,255,0.1)" : "#e2e8f0")}`,
        color: active ? "#ffffff" : t.textMuted,
        boxShadow: active ? `0 0 12px rgba(${t.accentRgb},0.3)` : "none",
      }}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {label}
    </button>
  )
}

function ActionButton({ onClick, disabled, loading, t, color, children }: {
  onClick: () => void; disabled: boolean; loading: boolean; t: Theme; color: "success" | "accent"; children: React.ReactNode
}) {
  const bg = color === "success" ? t.success : t.accent
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full py-3 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50 active:scale-[0.97]"
      style={{ background: bg }}
    >
      {loading ? <><Loader2 className="size-4 animate-spin" /> Loading...</> : children}
    </button>
  )
}

function NotesDisplay({ notes, t }: { notes: string; t: Theme }) {
  const segments = notes.split(/\||\n/).map(s => s.trim()).filter(Boolean)
  const description: string[] = []
  const bullets: string[] = []
  for (const seg of segments) {
    if (seg.startsWith("*")) bullets.push(seg.replace(/^\*\s*/, ""))
    else description.push(seg)
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: t.textFaint }}>Notes</p>
      {description.length > 0 && <p className="text-sm" style={{ color: t.textMuted }}>{description.join(" — ")}</p>}
      {bullets.length > 0 && (
        <ul className="space-y-1.5 ml-1">
          {bullets.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm" style={{ color: t.textMuted }}>
              <span className="mt-1 shrink-0 size-1.5 rounded-full" style={{ background: t.accent }} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
