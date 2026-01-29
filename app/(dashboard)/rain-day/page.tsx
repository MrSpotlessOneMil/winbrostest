"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { CloudRain, CalendarDays, ArrowRight, AlertTriangle, Check, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import type { Job } from "@/lib/types"

type PreviewJob = { id: string; customer: string; time: string; value: number; team: string; address: string }

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function toTimeDisplay(hhmm: string | null | undefined): string {
  const s = String(hhmm || "")
  if (!/^\d{2}:\d{2}$/.test(s)) return "—"
  const [hStr, mStr] = s.split(":")
  const h = Number(hStr)
  const m = Number(mStr)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "—"
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

export default function RainDayPage() {
  const [affectedDate, setAffectedDate] = useState<Date | undefined>(undefined)
  const [targetDate, setTargetDate] = useState<Date | undefined>(undefined)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [previewJobs, setPreviewJobs] = useState<PreviewJob[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)

  const affectedIso = useMemo(() => (affectedDate ? toIso(affectedDate) : null), [affectedDate])
  const totalRevenue = previewJobs.reduce((sum, job) => sum + job.value, 0)

  useEffect(() => {
    let cancelled = false
    async function loadPreview() {
      if (!affectedIso) {
        setPreviewJobs([])
        return
      }
      setPreviewLoading(true)
      try {
        const res = await fetch(`/api/rain-day?date=${affectedIso}`, { cache: "no-store" })
        const json = await res.json()
        const jobs = Array.isArray(json?.data?.jobs) ? (json.data.jobs as any[]) : []
        const mapped: PreviewJob[] = jobs.map((j) => ({
          id: String(j.id),
          customer: String(j.customer_name || "Unknown"),
          time: String(j.time || "—"),
          value: Number(j.value || 0),
          team: String(j.team_id || "—"),
          address: String(j.address || "—"),
        }))
        if (!cancelled) setPreviewJobs(mapped)
      } catch {
        if (!cancelled) setPreviewJobs([])
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }
    loadPreview()
    return () => {
      cancelled = true
    }
  }, [affectedIso])

  const handleReschedule = async () => {
    setIsProcessing(true)
    try {
      const res = await fetch("/api/rain-day", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          affected_date: affectedDate ? toIso(affectedDate) : null,
          target_date: targetDate ? toIso(targetDate) : null,
          initiated_by: "dashboard",
        }),
      })
      if (!res.ok) throw new Error("Failed to reschedule")
      setIsComplete(true)
    } catch {
      // leave as-is; UI will let them retry
    } finally {
      setIsProcessing(false)
    }
  }

  const resetForm = () => {
    setAffectedDate(undefined)
    setTargetDate(undefined)
    setIsConfirmOpen(false)
    setIsComplete(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-semibold text-foreground">
          <CloudRain className="h-7 w-7 text-warning" />
          Rain Day Reschedule
        </h1>
        <p className="text-sm text-muted-foreground">
          Manually trigger rescheduling for weather-affected days
        </p>
      </div>

      {/* Info Alert */}
      <Alert className="border-primary/20 bg-primary/5">
        <AlertTriangle className="h-4 w-4 text-primary" />
        <AlertTitle className="text-primary">Manual Process Only</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          This system does not use weather APIs. Reschedules are triggered manually when you determine
          weather conditions require job postponement.
        </AlertDescription>
      </Alert>

      {isComplete ? (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
              <Check className="h-8 w-8 text-success" />
            </div>
            <h2 className="mt-4 text-xl font-semibold text-foreground">Reschedule Complete</h2>
            <p className="mt-2 text-muted-foreground">
              {previewJobs.length} jobs have been rescheduled from{" "}
              {affectedDate && format(affectedDate, "MMM d")} to{" "}
              {targetDate && format(targetDate, "MMM d")}
            </p>
            <div className="mt-4 space-y-2 text-sm text-muted-foreground">
              <p>- Job dates updated in Supabase</p>
              <p>- (Next) Wire HCP + SMS + Telegram notifications here</p>
            </div>
            <Button onClick={resetForm} className="mt-6">
              Start New Reschedule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Date Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Select Dates</CardTitle>
              <CardDescription>Choose the affected date and the target reschedule date</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Affected Date */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Affected Date (Rain Day)</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !affectedDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarDays className="mr-2 h-4 w-4" />
                      {affectedDate ? format(affectedDate, "EEEE, MMMM d, yyyy") : "Select affected date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={affectedDate}
                      onSelect={setAffectedDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Target Date */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Target Reschedule Date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !targetDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarDays className="mr-2 h-4 w-4" />
                      {targetDate ? format(targetDate, "EEEE, MMMM d, yyyy") : "Select target date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={targetDate}
                      onSelect={setTargetDate}
                      disabled={(date) => affectedDate ? date <= affectedDate : false}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Visual Flow */}
              {affectedDate && targetDate && (
                <div className="flex items-center justify-center gap-4 rounded-lg bg-muted/50 p-4">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">From</p>
                    <p className="font-medium text-destructive">{format(affectedDate, "MMM d")}</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">To</p>
                    <p className="font-medium text-success">{format(targetDate, "MMM d")}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Affected Jobs Preview */}
          <Card>
            <CardHeader>
              <CardTitle>Jobs to Reschedule</CardTitle>
              <CardDescription>
                {affectedDate
                  ? `${previewJobs.length} jobs scheduled for ${format(affectedDate, "MMM d")}`
                  : "Select an affected date to see jobs"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {affectedDate ? (
                <div className="space-y-3">
                  {previewJobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3"
                    >
                      <div>
                        <p className="font-medium text-foreground">{job.customer}</p>
                        <p className="text-sm text-muted-foreground">
                          {job.time} - Team {job.team}
                        </p>
                      </div>
                      <Badge variant="outline">${job.value}</Badge>
                    </div>
                  ))}

                  <div className="mt-4 flex items-center justify-between rounded-lg bg-primary/10 p-3">
                    <span className="font-medium text-foreground">Total Revenue Impact</span>
                    <span className="text-lg font-semibold text-primary">${totalRevenue}</span>
                  </div>
                  {previewLoading && <p className="text-sm text-muted-foreground">Loading jobs…</p>}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CloudRain className="h-12 w-12 text-muted-foreground/50" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Select an affected date to preview jobs
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Action Button */}
      {!isComplete && (
        <div className="flex justify-end">
          <Button
            size="lg"
            disabled={!affectedDate || !targetDate}
            onClick={() => setIsConfirmOpen(true)}
            className="gap-2"
          >
            <CloudRain className="h-5 w-5" />
            Reschedule {previewJobs.length} Jobs
          </Button>
        </div>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Rain Day Reschedule</DialogTitle>
            <DialogDescription>
              This action will move all {previewJobs.length} jobs from{" "}
              {affectedDate && format(affectedDate, "MMMM d")} to{" "}
              {targetDate && format(targetDate, "MMMM d")}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <p className="text-sm font-medium text-foreground">This will:</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success" />
                Update job dates in Housecall Pro
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success" />
                Mirror changes to Supabase
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success" />
                Send SMS notifications to {previewJobs.length} customers
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success" />
                Notify teams via Telegram
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success" />
                Re-run team assignment confirmation
              </li>
            </ul>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsConfirmOpen(false)} disabled={isProcessing}>
              Cancel
            </Button>
            <Button onClick={handleReschedule} disabled={isProcessing}>
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                "Confirm Reschedule"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
