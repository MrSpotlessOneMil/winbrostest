"use client"

import { useEffect, useState } from "react"
import {
  AlertTriangle, MessageSquare, CreditCard, UserX, Calendar, FileText,
  Phone, ArrowRight, Loader2, CheckCircle2,
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
  message: { icon: MessageSquare, color: "text-blue-400", bg: "bg-blue-500/10", ring: "ring-blue-500/20" },
  payment: { icon: CreditCard, color: "text-red-400", bg: "bg-red-500/10", ring: "ring-red-500/20" },
  cleaner: { icon: UserX, color: "text-orange-400", bg: "bg-orange-500/10", ring: "ring-orange-500/20" },
  unassigned: { icon: Calendar, color: "text-amber-400", bg: "bg-amber-500/10", ring: "ring-amber-500/20" },
  quote: { icon: FileText, color: "text-violet-400", bg: "bg-violet-500/10", ring: "ring-violet-500/20" },
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

  // Loading state — skeleton
  if (items === null) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-14 rounded-xl bg-muted/50 animate-pulse" />
        ))}
      </div>
    )
  }

  // All clear — minimal green banner
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4">
        <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-foreground">All clear</p>
          <p className="text-xs text-muted-foreground">No items need your attention right now</p>
        </div>
      </div>
    )
  }

  // Items exist — hero treatment, no card wrapper
  return (
    <div className="space-y-2">
      {/* Section header with pulsing indicator */}
      <div className="flex items-center gap-2.5 mb-1">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
        </span>
        <span className="text-sm font-semibold text-foreground">
          {items.length} item{items.length !== 1 ? "s" : ""} need{items.length === 1 ? "s" : ""} attention
        </span>
      </div>

      {/* Items — large touch targets, first item highlighted */}
      <div className="space-y-1.5">
        {items.map((item, idx) => {
          const config = TYPE_CONFIG[item.type as keyof typeof TYPE_CONFIG] || { icon: AlertTriangle, color: "text-zinc-400", bg: "bg-zinc-500/10", ring: "ring-zinc-500/20" }
          const Icon = config.icon
          const isFirst = idx === 0

          return (
            <a
              key={item.id}
              href={item.link || "#"}
              className={cn(
                "flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all cursor-pointer group min-h-[56px]",
                "hover:bg-muted/60",
                isFirst
                  ? "bg-red-500/[0.06] border border-red-500/15 ring-1 ring-red-500/10"
                  : "bg-card/50 border border-border/50"
              )}
            >
              <div className={cn("p-2 rounded-lg shrink-0", config.bg)}>
                <Icon className={cn("h-4 w-4", config.color)} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">{item.action}</span>
                  <span className="text-[10px] text-muted-foreground/70">{timeAgo(item.time)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {item.phone && (
                  <a
                    href={`tel:${item.phone}`}
                    onClick={(e) => e.stopPropagation()}
                    className="p-2 rounded-lg hover:bg-muted transition-colors"
                  >
                    <Phone className="h-4 w-4 text-muted-foreground" />
                  </a>
                )}
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </a>
          )
        })}
      </div>
    </div>
  )
}
