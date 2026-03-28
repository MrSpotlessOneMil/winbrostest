"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertTriangle, MessageSquare, CreditCard, UserX, Calendar, FileText,
  Phone, ArrowRight, Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface AttentionItem {
  id: string
  type: 'message' | 'payment' | 'cleaner' | 'unassigned' | 'quote'
  priority: 'high' | 'medium' | 'low'
  title: string
  action: string
  customer_name: string | null
  phone: string | null
  link: string | null
  time: string
}

const TYPE_CONFIG = {
  message: { icon: MessageSquare, color: "text-blue-400", bg: "bg-blue-500/10" },
  payment: { icon: CreditCard, color: "text-red-400", bg: "bg-red-500/10" },
  cleaner: { icon: UserX, color: "text-orange-400", bg: "bg-orange-500/10" },
  unassigned: { icon: Calendar, color: "text-amber-400", bg: "bg-amber-500/10" },
  quote: { icon: FileText, color: "text-violet-400", bg: "bg-violet-500/10" },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function AttentionNeeded() {
  const [items, setItems] = useState<AttentionItem[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch("/api/actions/attention-needed", { cache: "no-store" })
        const json = await res.json()
        if (!cancelled) setItems(json.items || [])
      } catch {
        if (!cancelled) setItems([])
      }
    }
    load()
    const iv = setInterval(load, 60000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  return (
    <Card className={cn(
      "border-2",
      items && items.length > 0 ? "border-red-500/30" : "border-border"
    )}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle className={cn("h-4 w-4", items && items.length > 0 ? "text-red-400" : "text-muted-foreground")} />
          Needs Attention
          {items && items.length > 0 && (
            <span className="ml-auto text-xs font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
              {items.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {items === null ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3 text-center">All clear</p>
        ) : (
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {items.map((item) => {
              const config = TYPE_CONFIG[item.type]
              const Icon = config.icon
              return (
                <a
                  key={item.id}
                  href={item.link || "#"}
                  className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group"
                >
                  <div className={cn("p-1.5 rounded-md shrink-0", config.bg)}>
                    <Icon className={cn("h-3.5 w-3.5", config.color)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-muted-foreground">{item.action}</span>
                      <span className="text-[10px] text-muted-foreground">{timeAgo(item.time)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {item.phone && (
                      <a href={`tel:${item.phone}`} onClick={(e) => e.stopPropagation()} className="p-1 rounded hover:bg-muted">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      </a>
                    )}
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
