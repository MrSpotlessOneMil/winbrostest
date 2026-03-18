"use client"

import { useEffect, useState } from "react"
import CubeLoader from "@/components/ui/cube-loader"
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
  MessageSquare,
  HardHat,
  Bot,
  User,
} from "lucide-react"
import Link from "next/link"
import { RevenueChart } from "@/components/dashboard/revenue-chart"
import { LeadSourceChart } from "@/components/dashboard/lead-source-chart"
import { FunnelSummary } from "@/components/dashboard/funnel-summary"
import { EarningsSummary } from "@/components/dashboard/earnings-summary"
import { TopPerformer } from "@/components/dashboard/top-performer"
import { TeamStatus } from "@/components/dashboard/team-status"

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

interface CleanerPerf {
  id: string
  name: string
  jobsCompleted: number
  revenue: number
}

interface MessageAnalytics {
  totalInbound: number
  totalOutbound: number
  aiMessages: number
  manualMessages: number
  uniqueConversations: number
  period: string
}

interface InsightsData {
  pipeline: Record<string, PipelineStage>
  pipelineTotal: number
  metrics: DailyMetrics | null
  weekMetrics: DailyMetrics[]
  prevWeekMetrics: DailyMetrics[]
  cleanerPerformance: CleanerPerf[]
  messageAnalytics: MessageAnalytics | null
  leadsBySource: Record<string, { total: number; booked: number }>
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
      // Compute last week's end date (7 days ago) for week-over-week comparison
      const lastWeekDate = new Date()
      lastWeekDate.setDate(lastWeekDate.getDate() - 7)
      const lastWeekDateStr = lastWeekDate.toISOString().slice(0, 10)

      const [pipelineRes, todayRes, weekRes, prevWeekRes, insightsRes] = await Promise.all([
        fetch("/api/actions/retargeting-pipeline"),
        fetch("/api/metrics?range=today"),
        fetch("/api/metrics?range=week"),
        fetch(`/api/metrics?range=week&date=${lastWeekDateStr}`),
        fetch("/api/actions/insights-data"),
      ])
      const [pipelineJson, todayJson, weekJson, prevWeekJson, insightsJson] = await Promise.all([
        pipelineRes.json(),
        todayRes.json(),
        weekRes.json(),
        prevWeekRes.json(),
        insightsRes.json(),
      ])

      // Support both .metrics and .data response shapes
      const weekData = weekJson.metrics || weekJson.data
      const prevWeekData = prevWeekJson.metrics || prevWeekJson.data

      setData({
        pipeline: pipelineJson.stages || {},
        pipelineTotal: pipelineJson.total || 0,
        metrics: todayJson.metrics || null,
        weekMetrics: Array.isArray(weekData) ? weekData : [],
        prevWeekMetrics: Array.isArray(prevWeekData) ? prevWeekData : [],
        cleanerPerformance: insightsJson.cleanerPerformance || [],
        messageAnalytics: insightsJson.messageAnalytics || null,
        leadsBySource: insightsJson.leadsBySource || {},
      })
    } catch {
      // Silently fail -- data will show as empty
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchInsights() }, [])

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

  // Previous week metrics for week-over-week comparison
  const prevWeekMetrics = data?.prevWeekMetrics || []
  const prevWeekRevenue = prevWeekMetrics.reduce((sum, d) => sum + (d.total_revenue || 0), 0)
  const prevWeekJobs = prevWeekMetrics.reduce((sum, d) => sum + (d.jobs_completed || 0), 0)
  const prevWeekLeads = prevWeekMetrics.reduce((sum, d) => sum + (d.leads_in || 0), 0)
  const prevWeekBooked = prevWeekMetrics.reduce((sum, d) => sum + (d.leads_booked || 0), 0)
  const prevWeekCloseRate = prevWeekLeads > 0 ? Math.round((prevWeekBooked / prevWeekLeads) * 100) : 0

  // Compute percentage deltas (null if no previous data to compare)
  function computeDelta(current: number, previous: number): number | null {
    if (previous === 0 && current === 0) return 0
    if (previous === 0) return current > 0 ? 100 : null
    return Math.round(((current - previous) / previous) * 100)
  }

  const revenueDelta = prevWeekMetrics.length > 0 ? computeDelta(weekRevenue, prevWeekRevenue) : null
  const jobsDelta = prevWeekMetrics.length > 0 ? computeDelta(weekJobs, prevWeekJobs) : null
  const leadsDelta = prevWeekMetrics.length > 0 ? computeDelta(weekLeads, prevWeekLeads) : null
  const closeRateDelta = prevWeekMetrics.length > 0 ? computeDelta(weekCloseRate, prevWeekCloseRate) : null

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

  // Brain-powered recommendations using week-over-week data
  if (weekRevenue > 0 && revenueDelta !== null && revenueDelta < 0) {
    recommendations.push({
      priority: "high",
      title: `Revenue dropped ${Math.abs(revenueDelta)}% this week`,
      description: `Revenue dropped ${Math.abs(revenueDelta)}% this week. Check if lead volume or close rate is the bottleneck.`,
      action: "View Leads",
      link: "/leads",
    })
  }

  const aiAutomationRate = data?.messageAnalytics && data.messageAnalytics.totalOutbound > 0
    ? Math.round((data.messageAnalytics.aiMessages / data.messageAnalytics.totalOutbound) * 100)
    : null
  if (aiAutomationRate !== null && aiAutomationRate < 50) {
    recommendations.push({
      priority: "medium",
      title: `AI automation rate is only ${aiAutomationRate}%`,
      description: `Your AI is handling only ${aiAutomationRate}% of messages. Review the inbox for patterns the AI could handle.`,
      action: "View Inbox",
      link: "/inbox",
    })
  }

  const idleCleaners = (data?.cleanerPerformance || []).filter(c => c.jobsCompleted === 0)
  if (idleCleaners.length > 0) {
    recommendations.push({
      priority: "medium",
      title: `${idleCleaners.length} crew member${idleCleaners.length > 1 ? 's have' : ' has'} no completed jobs`,
      description: `${idleCleaners.length} crew member${idleCleaners.length > 1 ? 's have' : ' has'} no completed jobs. Consider reassigning or checking availability.`,
      action: "View Crew",
      link: "/cleaners",
    })
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between stagger-1">
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

      {loading ? <CubeLoader /> : <>
      {/* Key Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="stagger-2">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <DollarSign className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">${weekRevenue.toLocaleString()}</p>
                {revenueDelta !== null && (
                  <p className={`text-xs font-medium ${revenueDelta > 0 ? 'text-green-400' : revenueDelta < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                    {revenueDelta > 0 ? '↑' : revenueDelta < 0 ? '↓' : '—'} {revenueDelta === 0 ? 'Same' : `${Math.abs(revenueDelta)}%`} vs last week
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Revenue this week</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="stagger-3">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <BarChart3 className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{weekJobs}</p>
                {jobsDelta !== null && (
                  <p className={`text-xs font-medium ${jobsDelta > 0 ? 'text-green-400' : jobsDelta < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                    {jobsDelta > 0 ? '↑' : jobsDelta < 0 ? '↓' : '—'} {jobsDelta === 0 ? 'Same' : `${Math.abs(jobsDelta)}%`} vs last week
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Jobs completed this week</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="stagger-4">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Zap className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{weekLeads}</p>
                {leadsDelta !== null && (
                  <p className={`text-xs font-medium ${leadsDelta > 0 ? 'text-green-400' : leadsDelta < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                    {leadsDelta > 0 ? '↑' : leadsDelta < 0 ? '↓' : '—'} {leadsDelta === 0 ? 'Same' : `${Math.abs(leadsDelta)}%`} vs last week
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Leads this week</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="stagger-5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Target className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{weekCloseRate}%</p>
                {closeRateDelta !== null && (
                  <p className={`text-xs font-medium ${closeRateDelta > 0 ? 'text-green-400' : closeRateDelta < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                    {closeRateDelta > 0 ? '↑' : closeRateDelta < 0 ? '↓' : '—'} {closeRateDelta === 0 ? 'Same' : `${Math.abs(closeRateDelta)}%`} vs last week
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Close rate this week</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Revenue & Lead Source Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <RevenueChart />
        <LeadSourceChart />
      </div>

      {/* Funnel, Earnings, Top Performer, Team */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FunnelSummary />
        <EarningsSummary />
        <TopPerformer />
      </div>

      <TeamStatus />

      {/* Retargeting Performance + Pipeline Health */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Retargeting Performance */}
        <Card className="stagger-6">
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
        <Card className="stagger-7">
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
      <Card className="stagger-8">
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

      {/* Cleaner Performance + Message Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Cleaner Performance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HardHat className="h-5 w-5 text-teal-400" />
              Crew Performance
            </CardTitle>
            <CardDescription>Last 90 days - jobs completed and revenue per crew member</CardDescription>
          </CardHeader>
          <CardContent>
            {(data?.cleanerPerformance || []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No crew data available</p>
            ) : (
              <div className="space-y-3">
                {(data?.cleanerPerformance || []).map((cleaner, i) => {
                  const maxJobs = Math.max(...(data?.cleanerPerformance || []).map(c => c.jobsCompleted), 1)
                  return (
                    <div key={cleaner.id} className="flex items-center gap-3">
                      <div className="w-6 text-center">
                        <span className={`text-xs font-bold ${i === 0 ? "text-amber-400" : "text-zinc-500"}`}>#{i + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate">{cleaner.name}</span>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>{cleaner.jobsCompleted} jobs</span>
                            <span className="text-green-400 font-medium">${cleaner.revenue.toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-teal-500/60 transition-all"
                            style={{ width: `${(cleaner.jobsCompleted / maxJobs) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Message Analytics */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-5 w-5 text-blue-400" />
              Message Analytics
            </CardTitle>
            <CardDescription>Last 30 days - SMS volume and AI automation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data?.messageAnalytics ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <p className="text-2xl font-bold text-blue-400">{data.messageAnalytics.totalInbound}</p>
                    <p className="text-xs text-muted-foreground">Inbound</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                    <p className="text-2xl font-bold text-purple-400">{data.messageAnalytics.totalOutbound}</p>
                    <p className="text-xs text-muted-foreground">Outbound</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Bot className="h-3.5 w-3.5 text-violet-400" />
                      <span>AI-generated</span>
                    </div>
                    <span className="font-medium text-violet-400">{data.messageAnalytics.aiMessages}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-zinc-400" />
                      <span>Manual / scheduled</span>
                    </div>
                    <span className="font-medium">{data.messageAnalytics.manualMessages}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Unique conversations</span>
                    </div>
                    <span className="font-medium text-emerald-400">{data.messageAnalytics.uniqueConversations}</span>
                  </div>
                </div>
                {data.messageAnalytics.totalOutbound > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground">AI Automation Rate</span>
                      <span className="text-sm font-bold text-violet-400">
                        {Math.round((data.messageAnalytics.aiMessages / data.messageAnalytics.totalOutbound) * 100)}%
                      </span>
                    </div>
                    <Progress value={(data.messageAnalytics.aiMessages / data.messageAnalytics.totalOutbound) * 100} className="h-2" />
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">No message data available</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lead Source ROI */}
      {Object.keys(data?.leadsBySource || {}).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-5 w-5 text-cyan-400" />
              Lead Source Performance
            </CardTitle>
            <CardDescription>Last 30 days - which sources convert best</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(data?.leadsBySource || {})
                .sort(([, a], [, b]) => b.total - a.total)
                .map(([source, stats]) => {
                  const convRate = stats.total > 0 ? Math.round((stats.booked / stats.total) * 100) : 0
                  const sourceLabels: Record<string, string> = {
                    phone: "Phone / VAPI", vapi: "VAPI", meta: "Meta Ads", website: "Website",
                    sms: "SMS", ghl: "GoHighLevel", manual: "Manual", housecall_pro: "HouseCall Pro",
                  }
                  return (
                    <div key={source} className="flex items-center justify-between p-2 rounded-lg border border-zinc-800">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{sourceLabels[source] || source}</span>
                        <Badge variant="outline" className="text-xs">{stats.total} leads</Badge>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{stats.booked} booked</span>
                        <Badge className={`text-xs ${convRate >= 30 ? "bg-green-500/20 text-green-400" : convRate >= 15 ? "bg-amber-500/20 text-amber-400" : "bg-zinc-500/20 text-zinc-400"}`}>
                          {convRate}%
                        </Badge>
                      </div>
                    </div>
                  )
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Smart Recommendations */}
      {recommendations.length > 0 && (
        <Card className="stagger-9">
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
      </>}
    </div>
  )
}
