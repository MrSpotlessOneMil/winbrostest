"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Phone,
  MessageSquare,
  CreditCard,
  Users,
  CalendarCheck,
  Star,
  AlertTriangle,
  Globe,
  Bot,
  Truck,
  RefreshCw,
  ChevronRight,
  Clock,
  DollarSign,
  UserPlus,
  Send,
  CheckCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"

type ActivityItem = {
  id: number
  icon: typeof Phone
  iconColor: string
  title: string
  description: string
  time: string
  source: string
  sourceColor: string
}

// Event types worth showing in the activity feed (user-facing events)
const FEED_EVENT_TYPES = new Set([
  "CALL_COMPLETED",
  "SMS_RECEIVED",
  "INVOICE_SENT",
  "INVOICE_PAID",
  "PAYMENT_FAILED",
  "DEPOSIT_PAID",
  "ADDON_PAID",
  "FINAL_PAID",
  "CARD_ON_FILE_SAVED",
  "CLEANER_BROADCAST",
  "CLEANER_ACCEPTED",
  "CLEANER_DECLINED",
  "CLEANER_AWARDED",
  "JOB_COMPLETED",
  "REVIEW_REQUEST_SENT",
  "RESCHEDULE_REQUESTED",
  "RESCHEDULE_CONFIRMED",
  "VAPI_CALL_RECEIVED",
  "LEAD_CREATED_FROM_CALL",
  "JOB_CREATED_FROM_CALL",
  "LEAD_CREATED_FROM_SMS",
  "AUTO_RESPONSE_SENT",
  "GHL_LEAD_RECEIVED",
  "HCP_LEAD_RECEIVED",
  "WEBSITE_LEAD_RECEIVED",
  "SMS_BOOKING_COMPLETED",
  "EMAIL_BOOKING_COMPLETED",
  "QUOTE_DEPOSIT_PAID",
  "QUOTE_CARD_ON_FILE",
  "POST_JOB_SATISFACTION_POSITIVE",
  "POST_JOB_SATISFACTION_NEGATIVE",
  "MEMBERSHIP_RENEWED",
  "MEMBERSHIP_COMPLETED",
  "OWNER_ACTION_REQUIRED",
  "CUSTOMER_NOTIFIED",
  "AUTO_SCHEDULE_DISPATCHED",
  "CLEANING_JOB_CREATED_FROM_ESTIMATE",
])

const eventConfig: Record<string, { icon: typeof Phone; iconColor: string; label: string }> = {
  // Calls
  CALL_COMPLETED: { icon: Phone, iconColor: "text-blue-400", label: "Call completed" },
  VAPI_CALL_RECEIVED: { icon: Bot, iconColor: "text-purple-400", label: "AI call received" },
  LEAD_CREATED_FROM_CALL: { icon: UserPlus, iconColor: "text-green-400", label: "Lead from call" },
  JOB_CREATED_FROM_CALL: { icon: CalendarCheck, iconColor: "text-green-400", label: "Job booked from call" },
  // SMS
  SMS_RECEIVED: { icon: MessageSquare, iconColor: "text-blue-400", label: "SMS received" },
  LEAD_CREATED_FROM_SMS: { icon: UserPlus, iconColor: "text-green-400", label: "Lead from SMS" },
  AUTO_RESPONSE_SENT: { icon: Bot, iconColor: "text-purple-400", label: "AI response sent" },
  CUSTOMER_NOTIFIED: { icon: Send, iconColor: "text-blue-400", label: "Customer notified" },
  // Payments
  INVOICE_SENT: { icon: Send, iconColor: "text-amber-400", label: "Invoice sent" },
  INVOICE_PAID: { icon: DollarSign, iconColor: "text-green-400", label: "Invoice paid" },
  PAYMENT_FAILED: { icon: AlertTriangle, iconColor: "text-red-400", label: "Payment failed" },
  DEPOSIT_PAID: { icon: DollarSign, iconColor: "text-green-400", label: "Deposit paid" },
  ADDON_PAID: { icon: DollarSign, iconColor: "text-green-400", label: "Add-on paid" },
  FINAL_PAID: { icon: DollarSign, iconColor: "text-green-400", label: "Final payment received" },
  CARD_ON_FILE_SAVED: { icon: CreditCard, iconColor: "text-green-400", label: "Card saved" },
  QUOTE_DEPOSIT_PAID: { icon: DollarSign, iconColor: "text-green-400", label: "Quote deposit paid" },
  QUOTE_CARD_ON_FILE: { icon: CreditCard, iconColor: "text-green-400", label: "Card saved from quote" },
  // Cleaners
  CLEANER_BROADCAST: { icon: Users, iconColor: "text-blue-400", label: "Job broadcast to cleaners" },
  CLEANER_ACCEPTED: { icon: CheckCircle, iconColor: "text-green-400", label: "Cleaner accepted" },
  CLEANER_DECLINED: { icon: Users, iconColor: "text-red-400", label: "Cleaner declined" },
  CLEANER_AWARDED: { icon: Users, iconColor: "text-green-400", label: "Cleaner awarded job" },
  AUTO_SCHEDULE_DISPATCHED: { icon: Truck, iconColor: "text-blue-400", label: "Auto-dispatched" },
  // Jobs
  JOB_COMPLETED: { icon: CheckCircle, iconColor: "text-green-400", label: "Job completed" },
  CLEANING_JOB_CREATED_FROM_ESTIMATE: { icon: CalendarCheck, iconColor: "text-green-400", label: "Job created from estimate" },
  SMS_BOOKING_COMPLETED: { icon: CalendarCheck, iconColor: "text-green-400", label: "Booking confirmed" },
  EMAIL_BOOKING_COMPLETED: { icon: CalendarCheck, iconColor: "text-green-400", label: "Booking confirmed" },
  RESCHEDULE_REQUESTED: { icon: RefreshCw, iconColor: "text-amber-400", label: "Reschedule requested" },
  RESCHEDULE_CONFIRMED: { icon: RefreshCw, iconColor: "text-green-400", label: "Reschedule confirmed" },
  // Reviews & Post-job
  REVIEW_REQUEST_SENT: { icon: Star, iconColor: "text-amber-400", label: "Review request sent" },
  POST_JOB_SATISFACTION_POSITIVE: { icon: Star, iconColor: "text-green-400", label: "Positive feedback" },
  POST_JOB_SATISFACTION_NEGATIVE: { icon: Star, iconColor: "text-red-400", label: "Negative feedback" },
  // Leads
  GHL_LEAD_RECEIVED: { icon: Globe, iconColor: "text-pink-400", label: "Meta lead received" },
  HCP_LEAD_RECEIVED: { icon: Globe, iconColor: "text-blue-400", label: "HCP lead received" },
  WEBSITE_LEAD_RECEIVED: { icon: Globe, iconColor: "text-green-400", label: "Website lead received" },
  // Memberships
  MEMBERSHIP_RENEWED: { icon: RefreshCw, iconColor: "text-green-400", label: "Membership renewed" },
  MEMBERSHIP_COMPLETED: { icon: CheckCircle, iconColor: "text-blue-400", label: "Membership completed" },
  // Alerts
  OWNER_ACTION_REQUIRED: { icon: AlertTriangle, iconColor: "text-red-400", label: "Action required" },
}

const sourceColors: Record<string, string> = {
  vapi: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  openphone: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  stripe: "bg-green-500/10 text-green-400 border-green-500/20",
  cron: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  actions: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  system: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  ghl: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  housecall_pro: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  job_updates: "bg-green-500/10 text-green-400 border-green-500/20",
  lead_followup: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  scheduler: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  lead_actions: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  website: "bg-green-500/10 text-green-400 border-green-500/20",
  sam: "bg-orange-500/10 text-orange-400 border-orange-500/20",
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return "--"
  const diffMs = Date.now() - t
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max - 1) + "..."
}

interface RawEvent {
  id: number
  event_type: string
  source: string
  message: string
  created_at: string
  phone_number?: string
  job_id?: string
  metadata?: Record<string, unknown>
}

function mapEvent(ev: RawEvent): ActivityItem | null {
  if (!FEED_EVENT_TYPES.has(ev.event_type)) return null

  const config = eventConfig[ev.event_type] || {
    icon: Clock,
    iconColor: "text-zinc-400",
    label: ev.event_type.replace(/_/g, " ").toLowerCase(),
  }

  return {
    id: ev.id,
    icon: config.icon,
    iconColor: config.iconColor,
    title: config.label,
    description: truncate(ev.message, 100),
    time: timeAgo(ev.created_at),
    source: ev.source,
    sourceColor: sourceColors[ev.source] || sourceColors.system,
  }
}

export function ActivityFeed() {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/system-events?per_page=50", { cache: "no-store" })
      const json = await res.json()
      const events: RawEvent[] = json.data || []
      const mapped = events
        .map(mapEvent)
        .filter((x): x is ActivityItem => x !== null)
        .slice(0, 20)
      setItems(mapped)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-400" />
            Recent Activity
          </CardTitle>
          <CardDescription>Live feed of what's happening</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          Refresh
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-start gap-3 p-2">
                <div className="skeleton-circle w-8 h-8 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton-line w-32" />
                  <div className="skeleton-line w-48" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800/60">
              <Clock className="h-6 w-6 text-zinc-500" />
            </div>
            <p className="mt-3 font-medium text-zinc-300">No recent activity</p>
            <p className="text-sm text-zinc-500">Events will appear here as they happen</p>
          </div>
        )}
        {!loading && items.length > 0 && (
          <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
            {items.map((item) => {
              const Icon = item.icon
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-muted/50"
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800/60",
                    )}
                  >
                    <Icon className={cn("h-4 w-4", item.iconColor)} />
                  </div>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{item.title}</span>
                      <span className="text-[10px] text-zinc-500 whitespace-nowrap">{item.time}</span>
                    </div>
                    <p className="text-xs text-zinc-500 truncate">{item.description}</p>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", item.sourceColor)}>
                      {item.source.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
