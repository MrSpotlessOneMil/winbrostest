"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Trophy, Crown } from "lucide-react"
import { useEffect, useState } from "react"

type Entry = { rank: number; name: string; team: string; value: number; change: string }

export function TopPerformer() {
  const [topPerformers, setTopPerformers] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/leaderboard?range=month`, { cache: "no-store" })
        const json = await res.json()
        const data = json?.data || {}
        const tips = Array.isArray(data.tips) ? data.tips.slice(0, 3) : []
        if (!cancelled) setTopPerformers(tips)
      } catch {
        if (!cancelled) setTopPerformers([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-yellow-500" />
          <CardTitle className="text-base font-medium">Top Performers</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : topPerformers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data yet</p>
        ) : (
          <div className="space-y-3">
            {topPerformers.map((entry, index) => (
              <div
                key={entry.rank}
                className={`flex items-center gap-3 rounded-lg p-2 ${
                  index === 0
                    ? "bg-yellow-500/10 border border-yellow-500/20"
                    : index === 1
                    ? "bg-zinc-500/10 border border-zinc-500/20"
                    : index === 2
                    ? "bg-amber-600/10 border border-amber-600/20"
                    : ""
                }`}
              >
                <div className="flex h-8 w-8 items-center justify-center">
                  {index === 0 ? (
                    <Crown className="h-5 w-5 text-yellow-500" />
                  ) : (
                    <span className="text-sm font-bold text-muted-foreground">#{entry.rank}</span>
                  )}
                </div>
                <Avatar className="h-8 w-8">
                  <AvatarFallback className={index === 0 ? "bg-yellow-500/20 text-yellow-600" : "bg-muted"}>
                    {entry.name.split(" ").map((n) => n[0]).join("")}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{entry.name}</p>
                  <p className="text-xs text-muted-foreground">Team {entry.team}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold ${index === 0 ? "text-yellow-500" : ""}`}>
                    ${entry.value}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
