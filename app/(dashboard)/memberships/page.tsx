"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Plus, Search, Pause, Play, XCircle, Loader2, Clock, RefreshCw } from "lucide-react"

interface Membership {
  id: string
  status: "active" | "paused" | "cancelled" | "completed"
  visits_completed: number
  next_visit_at: string | null
  started_at: string | null
  renewal_choice: string | null
  renewal_asked_at: string | null
  created_at: string
  customers: {
    id: string
    first_name: string | null
    last_name: string | null
    phone_number: string | null
    email: string | null
  } | null
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

type FilterStatus = "all" | "active" | "paused" | "cancelled" | "completed"

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-green-500/20 text-green-400 border-green-500/30" },
  paused: { label: "Paused", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  cancelled: { label: "Cancelled", className: "bg-red-500/20 text-red-400 border-red-500/30" },
  completed: { label: "Completed", className: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
}

function customerName(c: Membership["customers"]): string {
  if (!c) return "Unknown"
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ")
  return name || c.phone_number || "Unknown"
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export default function MembershipsPage() {
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterStatus>("all")
  const [search, setSearch] = useState("")
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [createPhone, setCreatePhone] = useState("")
  const [createCustomerId, setCreateCustomerId] = useState("")
  const [createCustomerName, setCreateCustomerName] = useState("")
  const [createPlanSlug, setCreatePlanSlug] = useState("")
  const [servicePlans, setServicePlans] = useState<ServicePlan[]>([])
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState("")

  const fetchMemberships = async () => {
    try {
      const params = new URLSearchParams()
      if (filter !== "all") params.set("status", filter)
      params.set("limit", "200")
      const res = await fetch(`/api/actions/memberships?${params}`)
      const data = await res.json()
      if (data.memberships) setMemberships(data.memberships)
    } catch {
      console.error("Failed to load memberships")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMemberships()
  }, [filter])

  // Fetch service plans for create modal
  useEffect(() => {
    if (!createOpen) return
    fetch("/api/service-plans")
      .then((r) => r.json())
      .then((data) => {
        if (data.plans) setServicePlans(data.plans)
      })
      .catch(() => {})
  }, [createOpen])

  // Customer lookup for create modal
  useEffect(() => {
    if (!createOpen) return
    const digits = createPhone.replace(/\D/g, "")
    if (digits.length < 10) {
      setCreateCustomerId("")
      setCreateCustomerName("")
      return
    }
    const timer = setTimeout(() => {
      fetch(`/api/customers/lookup?phone=${encodeURIComponent(digits)}`)
        .then((r) => r.json())
        .then((res) => {
          if (res.success && res.data?.length) {
            const c = res.data[0]
            setCreateCustomerId(c.id)
            setCreateCustomerName([c.first_name, c.last_name].filter(Boolean).join(" ") || c.phone_number)
          } else {
            setCreateCustomerId("")
            setCreateCustomerName("")
          }
        })
        .catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [createPhone, createOpen])

  const handleAction = async (membershipId: string, action: "pause" | "resume" | "cancel") => {
    setActionLoading(membershipId)
    try {
      const res = await fetch("/api/actions/memberships", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_id: membershipId, action }),
      })
      const data = await res.json()
      if (data.success) {
        await fetchMemberships()
      }
    } catch {
      console.error(`Failed to ${action} membership`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleCreate = async () => {
    if (!createCustomerId || !createPlanSlug) {
      setCreateError("Select a customer and plan")
      return
    }
    setCreateSaving(true)
    setCreateError("")
    try {
      const res = await fetch("/api/actions/memberships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: createCustomerId, plan_slug: createPlanSlug }),
      })
      const data = await res.json()
      if (!data.success) {
        setCreateError(data.error || "Failed to create membership")
        return
      }
      setCreateOpen(false)
      setCreatePhone("")
      setCreateCustomerId("")
      setCreateCustomerName("")
      setCreatePlanSlug("")
      await fetchMemberships()
    } catch {
      setCreateError("Connection error")
    } finally {
      setCreateSaving(false)
    }
  }

  const filtered = memberships.filter((m) => {
    if (!search) return true
    const name = customerName(m.customers).toLowerCase()
    const phone = m.customers?.phone_number || ""
    const plan = m.service_plans?.name?.toLowerCase() || ""
    const q = search.toLowerCase()
    return name.includes(q) || phone.includes(q) || plan.includes(q)
  })

  const counts = {
    all: memberships.length,
    active: memberships.filter((m) => m.status === "active").length,
    paused: memberships.filter((m) => m.status === "paused").length,
    completed: memberships.filter((m) => m.status === "completed").length,
  }

  return (
    <div className="space-y-4 p-4 md:p-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Memberships</h1>
          <p className="text-muted-foreground text-sm">
            {counts.active} active, {counts.paused} paused, {counts.completed} completed
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="mr-1 h-4 w-4" /> New Membership
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, phone, or plan..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-1">
              {(["all", "active", "paused", "cancelled", "completed"] as FilterStatus[]).map((s) => (
                <Button
                  key={s}
                  variant={filter === s ? "default" : "outline"}
                  size="sm"
                  onClick={() => { setFilter(s); setLoading(true) }}
                  className="capitalize"
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No memberships found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Visits</TableHead>
                  <TableHead>Next Visit</TableHead>
                  <TableHead>Renewal</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m) => {
                  const badge = STATUS_BADGE[m.status] || STATUS_BADGE.active
                  const plan = m.service_plans
                  const isLoading = actionLoading === m.id
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="font-medium">{customerName(m.customers)}</div>
                        <div className="text-xs text-muted-foreground">{m.customers?.phone_number || ""}</div>
                      </TableCell>
                      <TableCell>
                        <div>{plan?.name || "—"}</div>
                        {plan?.discount_per_visit ? (
                          <div className="text-xs text-muted-foreground">-${plan.discount_per_visit}/visit</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={badge.className}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">
                          {m.visits_completed}/{plan?.visits_per_year || "?"}
                        </span>
                      </TableCell>
                      <TableCell>{formatDate(m.next_visit_at)}</TableCell>
                      <TableCell>
                        {m.renewal_asked_at && !m.renewal_choice && m.status === "active" ? (
                          <Badge variant="outline" className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                            <Clock className="mr-1 h-3 w-3" /> Awaiting reply
                          </Badge>
                        ) : m.renewal_choice === "renew" ? (
                          <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30">
                            <RefreshCw className="mr-1 h-3 w-3" /> Renewing
                          </Badge>
                        ) : m.renewal_choice === "cancel" ? (
                          <span className="text-xs text-muted-foreground">Declined</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {m.status === "active" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isLoading}
                                onClick={() => handleAction(m.id, "pause")}
                                title="Pause"
                              >
                                <Pause className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isLoading}
                                onClick={() => handleAction(m.id, "cancel")}
                                title="Cancel"
                              >
                                <XCircle className="h-4 w-4 text-red-400" />
                              </Button>
                            </>
                          )}
                          {m.status === "paused" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isLoading}
                                onClick={() => handleAction(m.id, "resume")}
                                title="Resume"
                              >
                                <Play className="h-4 w-4 text-green-400" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isLoading}
                                onClick={() => handleAction(m.id, "cancel")}
                                title="Cancel"
                              >
                                <XCircle className="h-4 w-4 text-red-400" />
                              </Button>
                            </>
                          )}
                          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Membership Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Membership</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Customer Phone</label>
              <Input
                placeholder="(555) 123-4567"
                value={createPhone}
                onChange={(e) => setCreatePhone(e.target.value)}
              />
              {createCustomerName && (
                <p className="text-sm text-green-400 mt-1">Found: {createCustomerName}</p>
              )}
              {createPhone.replace(/\D/g, "").length >= 10 && !createCustomerId && (
                <p className="text-sm text-amber-400 mt-1">Customer not found — create them first</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Plan</label>
              <Select value={createPlanSlug} onValueChange={setCreatePlanSlug}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a plan" />
                </SelectTrigger>
                <SelectContent>
                  {servicePlans.map((p) => (
                    <SelectItem key={p.slug} value={p.slug}>
                      {p.name} ({p.visits_per_year} visits, -${p.discount_per_visit}/visit)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {createError && (
              <p className="text-sm text-red-400">{createError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createSaving || !createCustomerId || !createPlanSlug}>
                {createSaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
