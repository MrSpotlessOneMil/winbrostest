"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, Phone, CreditCard, UserX, Clock, MessageSquare } from "lucide-react"
import Link from "next/link"

interface AttentionItem {
  id: string
  icon: typeof AlertTriangle
  label: string
  count: number
  color: string
  href: string
}

export function AttentionNeeded() {
  const [items, setItems] = useState<AttentionItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        // Fetch multiple sources in parallel
        const [exceptionsRes, callTasksRes, leadsRes] = await Promise.all([
          fetch("/api/exceptions?limit=50", { cache: "no-store" }),
          fetch("/api/call-tasks", { cache: "no-store" }),
          fetch("/api/leads?page=1&per_page=200&status=escalated", { cache: "no-store" }),
        ])
        const [exceptionsJson, callTasksJson, leadsJson] = await Promise.all([
          exceptionsRes.json(),
          callTasksRes.json(),
          leadsRes.json(),
        ])

        if (cancelled) return

        const exceptions = Array.isArray(exceptionsJson?.data) ? exceptionsJson.data : []
        const callTasks = Array.isArray(callTasksJson?.data) ? callTasksJson.data : []
        const escalatedLeads = Array.isArray(leadsJson?.data) ? leadsJson.data : []

        // Count by type
        const paymentFailures = exceptions.filter((e: any) =>
          e.type === "high-value" || e.title?.toLowerCase().includes("payment")
        ).length
        const pendingCalls = callTasks.length
        const escalatedCount = escalatedLeads.filter((l: any) => l.status === "escalated").length
        const highPriorityExceptions = exceptions.filter((e: any) => e.priority === "high").length

        const result: AttentionItem[] = []

        if (pendingCalls > 0) {
          result.push({
            id: "calls",
            icon: Phone,
            label: "Calls to make",
            count: pendingCalls,
            color: "text-violet-400",
            href: "/calls",
          })
        }
        if (paymentFailures > 0) {
          result.push({
            id: "payments",
            icon: CreditCard,
            label: "Payment issues",
            count: paymentFailures,
            color: "text-red-400",
            href: "/customers",
          })
        }
        if (escalatedCount > 0) {
          result.push({
            id: "escalated",
            icon: UserX,
            label: "Escalated leads",
            count: escalatedCount,
            color: "text-orange-400",
            href: "/leads",
          })
        }
        if (highPriorityExceptions > 0) {
          result.push({
            id: "exceptions",
            icon: AlertTriangle,
            label: "High priority issues",
            count: highPriorityExceptions,
            color: "text-amber-400",
            href: "#exceptions",
          })
        }

        setItems(result)
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading || items.length === 0) return null

  return (
    <Card className="border-amber-500/20 bg-amber-500/5">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Needs Attention
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className="flex flex-wrap gap-3">
          {items.map((item) => (
            <Link key={item.id} href={item.href}>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer">
                <item.icon className={`h-3.5 w-3.5 ${item.color}`} />
                <span className="text-sm text-zinc-300">{item.label}</span>
                <Badge variant="outline" className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold">
                  {item.count}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
