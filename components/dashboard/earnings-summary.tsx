"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Gift, Sparkles } from "lucide-react"
import { useEffect, useState } from "react"

export function EarningsSummary() {
  const [data, setData] = useState<{ totalTips: number; totalUpsells: number } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/earnings?range=week`, { cache: "no-store" })
        const json = await res.json()
        if (!cancelled) setData(json.data || null)
      } catch {
        if (!cancelled) setData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const totalTips = Number(data?.totalTips || 0)
  const totalUpsells = Number(data?.totalUpsells || 0)
  const total = totalTips + totalUpsells

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">Weekly Earnings</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                  <Gift className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tips</p>
                  <p className="text-xl font-semibold text-success">${totalTips}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Upsells</p>
                  <p className="text-xl font-semibold text-primary">${totalUpsells}</p>
                </div>
              </div>
            </div>
            <div className="pt-3 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total This Week</span>
                <span className="text-lg font-bold">${total}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
