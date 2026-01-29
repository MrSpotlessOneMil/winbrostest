"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, Beaker, RefreshCcw } from "lucide-react"

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

export default function ExceptionsPage() {
  const [busy, setBusy] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [exceptions, setExceptions] = useState<any[] | null>(null)
  const [exceptionsError, setExceptionsError] = useState<string | null>(null)

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

  useEffect(() => {
    refreshExceptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-semibold text-foreground">
          <AlertTriangle className="h-7 w-7 text-warning" />
          Exceptions
        </h1>
        <p className="text-sm text-muted-foreground">Issues requiring attention + a demo data generator</p>
      </div>

      <Tabs defaultValue="exceptions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="exceptions" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            Exceptions
          </TabsTrigger>
          <TabsTrigger value="demo" className="gap-2">
            <Beaker className="h-4 w-4" />
            Demonstration
          </TabsTrigger>
        </TabsList>

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

        <TabsContent value="demo">
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
        </TabsContent>
      </Tabs>
    </div>
  )
}

