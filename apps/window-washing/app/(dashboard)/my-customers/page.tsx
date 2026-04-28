"use client"

/**
 * /my-customers — Per-customer chat inbox for techs and salesmen.
 *
 * Tech / team-lead: customers whose jobs they're running today + tomorrow.
 * Salesman: every customer they own across leads / quotes / open jobs.
 *
 * Click a row → opens the shared CustomerThreadDrawer (full conversation
 * history + composer that posts via /api/actions/send-sms with role-aware
 * "From tech FirstName: " prefix).
 */

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { CustomerThreadDrawer } from "@/components/dashboard/customer-thread-drawer"
import { Loader2, MapPin, MessageSquare, Phone } from "lucide-react"

interface MyCustomer {
  id: number
  first_name: string | null
  last_name: string | null
  phone_number: string | null
  address: string | null
  relation: 'job_today' | 'job_tomorrow' | 'lead' | 'quote' | 'job_open'
  most_recent_at: string | null
  summary: string
}

const RELATION_LABELS: Record<MyCustomer['relation'], { label: string; color: string }> = {
  job_today: { label: "TODAY", color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  job_tomorrow: { label: "TOMORROW", color: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  job_open: { label: "OPEN JOB", color: "bg-zinc-700/40 text-zinc-300 border-zinc-700" },
  quote: { label: "QUOTE", color: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  lead: { label: "LEAD", color: "bg-purple-500/15 text-purple-300 border-purple-500/30" },
}

function formatPhone(phone: string | null): string {
  if (!phone) return "—"
  const digits = phone.replace(/\D/g, "")
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return phone
}

export default function MyCustomersPage() {
  const { isAdmin, portalToken, employeeType } = useAuth()
  const [customers, setCustomers] = useState<MyCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [threadCustomer, setThreadCustomer] = useState<MyCustomer | null>(null)

  const isSalesman = employeeType === "salesman"

  const fetchCustomers = useCallback(async () => {
    if (!portalToken) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/crew/${portalToken}/customers`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || `HTTP ${res.status}`)
        setCustomers([])
        return
      }
      const body = await res.json()
      setCustomers((body.customers ?? []) as MyCustomer[])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error")
    } finally {
      setLoading(false)
    }
  }, [portalToken])

  useEffect(() => { fetchCustomers() }, [fetchCustomers])

  if (isAdmin) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
        <div className="mx-auto max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h1 className="text-xl font-semibold mb-2">My Customers</h1>
          <p className="text-sm text-zinc-400">
            This view is built for techs, team leads, and salesmen. As an
            owner, see <a href="/customers" className="text-teal-400 hover:underline">/customers</a> for the full list.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">My Customers</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              {isSalesman
                ? "Everyone in your pipeline that hasn't closed yet — leads, quotes, open jobs."
                : "Today and tomorrow's customers. Tap to text them."}
            </p>
          </div>
          <button
            onClick={fetchCustomers}
            disabled={loading}
            className="text-xs text-zinc-400 hover:text-zinc-100 disabled:opacity-60"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          </div>
        ) : customers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-10 text-center">
            <MessageSquare className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
            <p className="text-sm text-zinc-400">
              {isSalesman
                ? "Nobody in your pipeline right now. Check back after the next round of leads."
                : "No customers on your plate today or tomorrow yet."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {customers.map((c) => {
              const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Customer"
              const tag = RELATION_LABELS[c.relation]
              return (
                <button
                  key={c.id}
                  onClick={() => setThreadCustomer(c)}
                  data-testid="my-customer-row"
                  disabled={!c.phone_number}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 p-4 text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-zinc-100 truncate">{name}</span>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${tag.color}`}>
                          {tag.label}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-1">{c.summary}</p>
                      {c.address && (
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate">{c.address}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-1 text-xs text-zinc-400 justify-end">
                        <Phone className="w-3 h-3" />
                        {formatPhone(c.phone_number)}
                      </div>
                      <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-blue-400">
                        <MessageSquare className="w-3 h-3" />
                        Text
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <CustomerThreadDrawer
        open={threadCustomer !== null}
        onClose={() => setThreadCustomer(null)}
        phoneNumber={threadCustomer?.phone_number}
        displayName={
          threadCustomer
            ? [threadCustomer.first_name, threadCustomer.last_name].filter(Boolean).join(" ") || undefined
            : undefined
        }
        context={
          threadCustomer
            ? [
                ...(threadCustomer.address ? [{ label: "Address", value: threadCustomer.address }] : []),
                { label: "Status", value: RELATION_LABELS[threadCustomer.relation].label },
              ]
            : []
        }
      />
    </div>
  )
}
