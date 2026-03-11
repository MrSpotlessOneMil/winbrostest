"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Lightbulb,
  TrendingUp,
  Users,
  Target,
  RefreshCcw,
  Loader2,
  ArrowRight,
  CheckCircle,
  AlertTriangle,
  DollarSign,
  BarChart3,
  Repeat,
  UserX,
  FileQuestion,
  UserCheck,
  TimerOff,
  Zap,
} from "lucide-react"
import Link from "next/link"

interface PipelineStage {
  total: number
  in_sequence: number
  completed_sequence: number
  converted: number
}

interface DailyMetrics {
  date: string
  total_revenue: number
  target_revenue: number
  jobs_completed: number
  jobs_scheduled: number
  leads_in: number
  leads_booked: number
  close_rate: number
}

interface InsightsData {
  pipeline: Record<string, PipelineStage>
  pipelineTotal: number
  metrics: DailyMetrics | null
  weekMetrics: DailyMetrics[]
}

const STAGE_META: Record<string, { label: string; icon: typeof Users; color: string }> = {
  unresponsive: { label: "Unresponsive", icon: UserX, color: "text-red-400" },
  quoted_not_booked: { label: "Quoted, Not Booked", icon: FileQuestion, color: "text-orange-400" },
  one_time: { label: "One-Time", icon: UserCheck, color: "text-yellow-400" },
  lapsed: { label: "Lapsed", icon: TimerOff, color: "text-purple-400" },
}

const RETARGETABLE_STAGES = ["unresponsive", "quoted_not_booked", "one_time", "lapsed"]

export default function InsightsPage() {
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)

  async function fetchInsights() {
    setLoading(true)
    try {
      const [pipelineRes, todayRes, weekRes] = await Promise.all([
        fetch("/api/actions/retargeting-pipeline"),
        fetch("/api/metrics?range=today"),
        fetch("/api/metrics?range=week"),
      ])
      const [pipelineJson, todayJson, weekJson] = await Promise.all([
        pipelineRes.json(),
        todayRes.json(),
        weekRes.json(),
      ])

      setData({
        pipeline: pipelineJson.stages || {},
        pipelineTotal: pipelineJson.total || 0,
        metrics: todayJson.metrics || null,
        weekMetrics: Array.isArray(weekJson.metrics) ? weekJson.metrics : [],
      })
    } catch {
      // Silently fail — data will show as empty
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchInsights() }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const pipeline = data?.pipeline || {}
  const metrics = data?.metrics
  const weekMetrics = data?.weekMetrics || []

  // Compute retargeting stats
  const retargetingStats = RETARGETABLE_STAGES.reduce(
    (acc, key) => {
      const stage = pipeline[key]
      if (!stage) return acc
      acc.totalEligible += stage.total
      acc.inSequence += stage.in_sequence
      acc.completedSequence += stage.completed_sequence
      acc.converted += stage.converted
      acc.notEnrolled += Math.max(0, stage.total - stage.in_sequence - stage.completed_sequence - stage.converted)
      return acc
    },
    { totalEligible: 0, inSequence: 0, completedSequence: 0, converted: 0, notEnrolled: 0 }
  )

  const conversionRate = retargetingStats.completedSequence + retargetingStats.converted > 0
    ? Math.round((retargetingStats.converted / (retargetingStats.completedSequence + retargetingStats.converted)) * 100)
    : 0

  // Pipeline health
  const activeCustomers = (pipeline.active?.total || 0) + (pipeline.repeat?.total || 0)
  const atRiskCustomers = retargetingStats.totalEligible
  const totalCustomers = data?.pipelineTotal || 0
  const healthScore = totalCustomers > 0 ? Math.round((activeCustomers / totalCustomers) * 100) : 0

  // Week revenue
  const weekRevenue = weekMetrics.reduce((sum, d) => sum + (d.total_revenue || 0), 0)
  const weekJobs = weekMetrics.reduce((sum, d) => sum + (d.jobs_completed || 0), 0)
  const weekLeads = weekMetrics.reduce((sum, d) => sum + (d.leads_in || 0), 0)
  const weekBooked = weekMetrics.reduce((sum, d) => sum + (d.leads_booked || 0), 0)
  const weekCloseRate = weekLeads > 0 ? Math.round((weekBooked / weekLeads) * 100) : 0

  // Generate smart recommendations
  const recommendations: { priority: "high" | "medium" | "low"; title: string; description: string; action?: string; link?: string }[] = []

  if (retargetingStats.notEnrolled > 5) {
    recommendations.push({
      priority: "high",
      title: `${retargetingStats.notEnrolled} customers ready for retargeting`,
      description: `You have ${retargetingStats.notEnrolled} customers who aren't in any retargeting sequence. Enrolling them could recover lost revenue — the average conversion rate is ${conversionRate}%.`,
      action: "Start Retargeting",
      link: "/campaigns",
    })
  }

  if ((pipeline.unresponsive?.total || 0) > 10) {
    recommendations.push({
      priority: "high",
      title: `${pipeline.unresponsive?.total} unresponsive customers`,
      description: "These customers were contacted but never replied. The 9-word reactivation sequence has the highest response rate — many of these can be recovered with 3 simple texts.",
      action: "View Unresponsive",
      link: "/campaigns",
    })
  }

  if ((pipeline.quoted_not_booked?.total || 0) > 5) {
    recommendations.push({
      priority: "high",
      title: `${pipeline.quoted_not_booked?.total} quoted but never booked`,
      description: "These customers asked for a quote and showed interest but didn't follow through. A 4-step follow-up sequence can close many of these.",
      action: "View Quoted",
      link: "/campaigns",
    })
  }

  if ((pipeline.one_time?.total || 0) > 5) {
    recommendations.push({
      priority: "medium",
      title: `${pipeline.one_time?.total} one-time customers to win back`,
      description: "Customers who booked once but haven't returned. A \"we miss you\" sequence over 14 days can turn one-timers into repeat customers.",
      action: "View One-Time",
      link: "/campaigns",
    })
  }

  if ((pipeline.lapsed?.total || 0) > 3) {
    recommendations.push({
      priority: "medium",
      title: `${pipeline.lapsed?.total} lapsed customers`,
      description: "Previously active customers who haven't booked in 60+ days. A feedback + incentive sequence can bring them back.",
      action: "View Lapsed",
      link: "/campaigns",
    })
  }

  if (conversionRate > 0 && conversionRate >= 15) {
    recommendations.push({
      priority: "low",
      title: `Retargeting is working — ${conversionRate}% conversion rate`,
      description: `${retargetingStats.converted} customers booked a job after receiving retargeting messages. Keep enrolling new customers to maintain this pipeline.`,
    })
  }

  if (weekCloseRate > 0 && weekCloseRate < 30) {
    recommendations.push({
      priority: "medium",
      title: `Lead close rate is ${weekCloseRate}% this week`,
      description: `Only ${weekBooked} of ${weekLeads} leads booked this week. Consider following up faster or adjusting your qualification process.`,
    })
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-amber-400" />
            Insights
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Performance metrics and smart recommendations for your business</p>
        </div>
        <Button variant="ghost" size="icon" onClick={fetchInsights} disabled={loading}>
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Key Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <DollarSign className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">${weekRevenue.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Revenue this week</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <BarChart3 className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{weekJobs}</p>
                <p className="text-xs text-muted-foreground">Jobs completed this week</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Zap className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{weekLeads}</p>
                <p className="text-xs text-muted-foreground">Leads this week</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Target className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{weekCloseRate}%</p>
                <p className="text-xs text-muted-foreground">Close rate this week</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Retargeting Performance + Pipeline Health */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Retargeting Performance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-5 w-5 text-blue-400" />
              Retargeting Performance
            </CardTitle>
            <CardDescription>How your retargeting sequences are performing</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <p className="text-2xl font-bold text-blue-400">{retargetingStats.inSequence}</p>
                <p className="text-xs text-muted-foreground">Currently in sequence</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <p className="text-2xl font-bold text-green-400">{retargetingStats.converted}</p>
                <p className="text-xs text-muted-foreground">Converted (booked)</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-zinc-500/10 border border-zinc-500/20">
                <p className="text-2xl font-bold">{retargetingStats.completedSequence}</p>
                <p className="text-xs text-muted-foreground">Sequence completed</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <p className="text-2xl font-bold text-amber-400">{retargetingStats.notEnrolled}</p>
                <p className="text-xs text-muted-foreground">Not yet enrolled</p>
              </div>
            </div>
            {(retargetingStats.completedSequence + retargetingStats.converted) > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted-foreground">Conversion Rate</span>
                  <span className="text-sm font-bold text-green-400">{conversionRate}%</span>
                </div>
                <Progress value={conversionRate} className="h-2" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pipeline Health */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-5 w-5 text-emerald-400" />
              Customer Pipeline Health
            </CardTitle>
            <CardDescription>{totalCustomers} total customers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">Health Score (active + repeat / total)</span>
                <span className={`text-sm font-bold ${healthScore >= 50 ? "text-green-400" : healthScore >= 25 ? "text-amber-400" : "text-red-400"}`}>{healthScore}%</span>
              </div>
              <Progress value={healthScore} className="h-2" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-500" />
                  <span>Active / Repeat</span>
                </div>
                <span className="font-medium">{activeCustomers}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-amber-500" />
                  <span>At Risk (retargetable)</span>
                </div>
                <span className="font-medium">{atRiskCustomers}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span>New Leads</span>
                </div>
                <span className="font-medium">{pipeline.new_lead?.total || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-zinc-500" />
                  <span>Lost</span>
                </div>
                <span className="font-medium">{pipeline.lost?.total || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Retargeting by Stage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5 text-blue-400" />
            Retargeting by Stage
          </CardTitle>
          <CardDescription>Breakdown of each retargeting sequence performance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {RETARGETABLE_STAGES.map((key) => {
              const stage = pipeline[key]
              if (!stage) return null
              const meta = STAGE_META[key]
              const Icon = meta.icon
              const stageConversion = stage.completed_sequence + stage.converted > 0
                ? Math.round((stage.converted / (stage.completed_sequence + stage.converted)) * 100)
                : 0
              const notEnrolled = Math.max(0, stage.total - stage.in_sequence - stage.completed_sequence - stage.converted)

              return (
                <div key={key} className="p-3 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 ${meta.color}`} />
                      <span className="text-sm font-medium">{meta.label}</span>
                      <Badge variant="outline" className="text-xs">{stage.total}</Badge>
                    </div>
                    {stageConversion > 0 && (
                      <Badge className="text-xs bg-green-500/20 text-green-400 border-green-500/30">
                        {stageConversion}% conversion
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <p className="text-lg font-semibold text-amber-400">{notEnrolled}</p>
                      <p className="text-[10px] text-muted-foreground">Not enrolled</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-blue-400">{stage.in_sequence}</p>
                      <p className="text-[10px] text-muted-foreground">In sequence</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{stage.completed_sequence}</p>
                      <p className="text-[10px] text-muted-foreground">Completed</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-green-400">{stage.converted}</p>
                      <p className="text-[10px] text-muted-foreground">Converted</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Smart Recommendations */}
      {recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-5 w-5 text-amber-400" />
              Recommendations
            </CardTitle>
            <CardDescription>Actions to improve your business performance</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recommendations.map((rec, i) => (
              <div
                key={i}
                className={`p-4 rounded-lg border ${
                  rec.priority === "high"
                    ? "border-red-500/30 bg-red-500/5"
                    : rec.priority === "medium"
                    ? "border-amber-500/30 bg-amber-500/5"
                    : "border-green-500/30 bg-green-500/5"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {rec.priority === "high" ? (
                        <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                      ) : rec.priority === "medium" ? (
                        <TrendingUp className="h-4 w-4 text-amber-400 shrink-0" />
                      ) : (
                        <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />
                      )}
                      <span className="text-sm font-medium">{rec.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground ml-6">{rec.description}</p>
                  </div>
                  {rec.link && (
                    <Link href={rec.link}>
                      <Button size="sm" variant="outline" className="h-7 text-xs shrink-0">
                        {rec.action} <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
