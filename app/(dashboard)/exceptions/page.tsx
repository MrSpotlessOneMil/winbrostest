"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertTriangle, Beaker, RefreshCcw, Activity, Search, Filter, Check } from "lucide-react"

interface SystemEvent {
  id: number
  source: string
  event_type: string
  message: string
  phone_number?: string
  job_id?: string
  lead_id?: string
  cleaner_id?: string
  metadata?: Record<string, unknown>
  created_at: string
}

async function runScenario(scenario: string) {
  const res = await fetch("/api/demo/seed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario }),
  })
  const json = await res.json()
  if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed")
  return json
}

function getSourceColor(source: string): string {
  const colors: Record<string, string> = {
    vapi: "bg-purple-500/10 text-purple-500 border-purple-500/30",
    openphone: "bg-blue-500/10 text-blue-500 border-blue-500/30",
    stripe: "bg-green-500/10 text-green-500 border-green-500/30",
    telegram: "bg-cyan-500/10 text-cyan-500 border-cyan-500/30",
    scheduler: "bg-orange-500/10 text-orange-500 border-orange-500/30",
    ghl: "bg-pink-500/10 text-pink-500 border-pink-500/30",
    housecall_pro: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30",
    cron: "bg-gray-500/10 text-gray-500 border-gray-500/30",
    system: "bg-red-500/10 text-red-500 border-red-500/30",
  }
  return colors[source] || "bg-muted text-muted-foreground border-border"
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export default function ExceptionsPage() {
  const { isAdmin } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [exceptions, setExceptions] = useState<any[] | null>(null)
  const [exceptionsError, setExceptionsError] = useState<string | null>(null)

  // System Events state
  const [events, setEvents] = useState<SystemEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [eventsTotal, setEventsTotal] = useState(0)
  const [sourceFilter, setSourceFilter] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null)
  const [copiedEventId, setCopiedEventId] = useState<number | null>(null)

  async function refreshExceptions() {
    setExceptionsError(null)
    try {
      const res = await fetch("/api/exceptions?limit=50", { cache: "no-store" })
      const json = await res.json()
      if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed to load exceptions")
      setExceptions(Array.isArray(json?.data) ? json.data : [])
    } catch (e: any) {
      setExceptions(null)
      setExceptionsError(e?.message || "Failed to load exceptions")
    }
  }

  async function refreshEvents() {
    setEventsLoading(true)
    setEventsError(null)
    try {
      const params = new URLSearchParams({ per_page: "200" })
      if (sourceFilter && sourceFilter !== "all") {
        params.set("source", sourceFilter)
      }
      const res = await fetch(`/api/system-events?${params}`, { cache: "no-store" })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "Failed to load events")
      setEvents(Array.isArray(json?.data) ? json.data : [])
      setEventsTotal(json?.total || 0)
    } catch (e: any) {
      setEvents([])
      setEventsError(e?.message || "Failed to load events")
    } finally {
      setEventsLoading(false)
    }
  }

  useEffect(() => {
    refreshExceptions()
    refreshEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    refreshEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter])

  async function handle(scenario: string) {
    setBusy(scenario)
    setError(null)
    try {
      const r = await runScenario(scenario)
      setLastResult(r)
    } catch (e: any) {
      setError(e?.message || "Failed")
    } finally {
      setBusy(null)
    }
  }

  // Filter events by search query
  const filteredEvents = events.filter((event) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      event.message?.toLowerCase().includes(q) ||
      event.event_type?.toLowerCase().includes(q) ||
      event.phone_number?.includes(q) ||
      event.source?.toLowerCase().includes(q)
    )
  })

  // Get unique sources for filter dropdown
  const uniqueSources = Array.from(new Set(events.map((e) => e.source))).sort()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-semibold text-foreground">
          <AlertTriangle className="h-7 w-7 text-warning" />
          Exceptions & Events
        </h1>
        <p className="text-sm text-muted-foreground">Issues requiring attention, system events log, and demo data generator</p>
      </div>

      <Tabs defaultValue="events" className="space-y-4">
        <TabsList>
          <TabsTrigger value="events" className="gap-2">
            <Activity className="h-4 w-4" />
            System Events
          </TabsTrigger>
          <TabsTrigger value="exceptions" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            Exceptions
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="demo" className="gap-2">
              <Beaker className="h-4 w-4" />
              Demonstration
            </TabsTrigger>
          )}
        </TabsList>

        {/* System Events Tab */}
        <TabsContent value="events">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>System Events</CardTitle>
                  <CardDescription>Real-time log of all system activity</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={refreshEvents} disabled={eventsLoading} className="gap-2">
                  <RefreshCcw className={`h-4 w-4 ${eventsLoading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Filters */}
              <div className="mb-4 flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search events..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger className="w-[180px]">
                    <Filter className="mr-2 h-4 w-4" />
                    <SelectValue placeholder="Filter by source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    {uniqueSources.map((source) => (
                      <SelectItem key={source} value={source}>
                        {source}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="text-sm text-muted-foreground mb-3">
                Showing {filteredEvents.length} of {eventsTotal} events
              </div>

              {eventsError && (
                <Alert className="mb-3 border-destructive/30 bg-destructive/5">
                  <AlertTitle className="text-destructive">Failed to load events</AlertTitle>
                  <AlertDescription className="text-muted-foreground">{eventsError}</AlertDescription>
                </Alert>
              )}

              {eventsLoading && filteredEvents.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">Loading events...</div>
              )}

              {!eventsLoading && filteredEvents.length === 0 && !eventsError && (
                <div className="text-center py-8 text-muted-foreground">No events found</div>
              )}

              {filteredEvents.length > 0 && (
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {filteredEvents.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-lg border border-border p-3 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setExpandedEvent(expandedEvent === event.id ? null : event.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className={getSourceColor(event.source)}>
                              {event.source}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {event.event_type}
                            </Badge>
                          </div>
                          <div className="text-sm text-foreground">{event.message}</div>
                          {event.phone_number && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Phone: {event.phone_number}
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatTimestamp(event.created_at)}
                        </div>
                      </div>

                      {/* Expanded metadata */}
                      {expandedEvent === event.id && event.metadata && (
                        <div
                          className="mt-3 pt-3 border-t border-border"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="text-xs font-medium text-muted-foreground mb-1">Metadata:</div>
                          <div
                            className="relative cursor-pointer group"
                            onClick={() => {
                              navigator.clipboard.writeText(JSON.stringify(event.metadata, null, 2))
                              setCopiedEventId(event.id)
                              setTimeout(() => setCopiedEventId(null), 1000)
                            }}
                          >
                            {copiedEventId === event.id && (
                              <div className="absolute top-2 right-2 flex items-center gap-1 text-xs text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-400 px-2 py-1 rounded animate-in fade-in zoom-in duration-200">
                                <Check className="h-3 w-3" />
                                copied
                              </div>
                            )}
                            <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto hover:bg-muted/70 transition-colors">
                              {JSON.stringify(event.metadata, null, 2)}
                            </pre>
                          </div>
                          {(event.job_id || event.lead_id || event.cleaner_id) && (
                            <div className="flex gap-2 mt-2">
                              {event.job_id && (
                                <Badge variant="outline" className="text-xs">Job: {event.job_id}</Badge>
                              )}
                              {event.lead_id && (
                                <Badge variant="outline" className="text-xs">Lead: {event.lead_id}</Badge>
                              )}
                              {event.cleaner_id && (
                                <Badge variant="outline" className="text-xs">Cleaner: {event.cleaner_id}</Badge>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Exceptions Tab */}
        <TabsContent value="exceptions">
          <Card>
            <CardHeader>
              <CardTitle>Exceptions</CardTitle>
              <CardDescription>Derived from recent `system_events` that likely need attention</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {exceptions ? `${exceptions.length} item(s)` : "Loading…"}
                </div>
                <Button variant="outline" size="sm" onClick={refreshExceptions} className="gap-2">
                  <RefreshCcw className="h-4 w-4" />
                  Refresh
                </Button>
              </div>

              {exceptionsError && (
                <Alert className="mt-3 border-destructive/30 bg-destructive/5">
                  <AlertTitle className="text-destructive">Failed to load exceptions</AlertTitle>
                  <AlertDescription className="text-muted-foreground">{exceptionsError}</AlertDescription>
                </Alert>
              )}

              {exceptions && exceptions.length === 0 && !exceptionsError && (
                <p className="mt-3 text-sm text-muted-foreground">All clear.</p>
              )}

              {exceptions && exceptions.length > 0 && (
                <div className="mt-3 space-y-2">
                  {exceptions.map((ex) => (
                    <div key={ex.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">{ex.title}</div>
                          <div className="truncate text-sm text-muted-foreground">{ex.description}</div>
                        </div>
                        <Badge variant="outline">{ex.priority || "low"}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {ex.time || ""} {ex.source ? `• ${ex.source}` : ""} {ex.event_type ? `• ${ex.event_type}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Demo Tab — admin only */}
        {isAdmin && <TabsContent value="demo">
          <Alert className="border-primary/20 bg-primary/5">
            <AlertTitle className="flex items-center gap-2">
              <Beaker className="h-4 w-4 text-primary" />
              Demo mode
            </AlertTitle>
            <AlertDescription className="text-muted-foreground">
              Click buttons below to insert realistic fake records into Supabase (teams/cleaners/jobs/leads/calls/tips/upsells/messages).
              Refresh other pages (Teams, Jobs, Leads, Calls, Earnings, Leaderboard) to watch updates.
              If `OPENAI_API_KEY` is set, some text fields are AI-generated.
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Generate & Insert Data</CardTitle>
                <CardDescription>Writes directly to Supabase via server API</CardDescription>
              </div>
              <Button variant="outline" onClick={() => setLastResult(null)} className="gap-2">
                <RefreshCcw className="h-4 w-4" />
                Clear result
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => handle("seed_all")} disabled={!!busy}>
                  {busy === "seed_all" ? "Seeding…" : "Seed everything"}
                </Button>
                <Button variant="outline" onClick={() => handle("add_team")} disabled={!!busy}>
                  Add team
                </Button>
                <Button variant="outline" onClick={() => handle("add_cleaner")} disabled={!!busy}>
                  Add cleaner
                </Button>
                <Button variant="outline" onClick={() => handle("add_job")} disabled={!!busy}>
                  Add job
                </Button>
                <Button variant="outline" onClick={() => handle("add_lead")} disabled={!!busy}>
                  Add lead
                </Button>
                <Button variant="outline" onClick={() => handle("add_call")} disabled={!!busy}>
                  Add call
                </Button>
                <Button variant="outline" onClick={() => handle("add_tip")} disabled={!!busy}>
                  Add tip
                </Button>
                <Button variant="outline" onClick={() => handle("add_upsell")} disabled={!!busy}>
                  Add upsell
                </Button>
                <Button variant="outline" onClick={() => handle("add_message")} disabled={!!busy}>
                  Add message
                </Button>
              </div>

              {error && (
                <Alert className="border-destructive/30 bg-destructive/5">
                  <AlertTitle className="text-destructive">Demo failed</AlertTitle>
                  <AlertDescription className="text-muted-foreground">{error}</AlertDescription>
                </Alert>
              )}

              {lastResult && (
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant="outline">Result</Badge>
                    <span className="text-xs text-muted-foreground">Inserted into Supabase</span>
                  </div>
                  <pre className="max-h-72 overflow-auto text-xs text-muted-foreground">
{JSON.stringify(lastResult, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>}
      </Tabs>
    </div>
  )
}
