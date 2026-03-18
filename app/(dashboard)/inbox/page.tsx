"use client"

import { useEffect, useState, useCallback } from "react"
import CubeLoader from "@/components/ui/cube-loader"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Flame,
  AlertCircle,
  Bot,
  User,
  Clock,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Hand,
  RotateCcw,
  CheckCircle,
  MessageSquare,
} from "lucide-react"

type Priority = "hot_lead" | "needs_attention" | "human_active" | "ai_handling" | "waiting"
type Handler = "ai" | "human" | "none"

interface Conversation {
  id: number
  name: string
  phone: string
  priority: Priority
  handler: Handler
  lastInbound: { content: string; timestamp: string } | null
  lastOutbound: { content: string; timestamp: string; aiGenerated: boolean; source: string } | null
  context: string
  unresponded: boolean
  minutesSinceLastInbound: number
  messagesCount: number
  optedOut: boolean
}

interface ThreadMessage {
  id: string
  content: string
  timestamp: string
  direction: string
  role: string
  ai_generated: boolean
  source: string
}

const PRIORITY_CONFIG: Record<Priority, { label: string; bg: string; text: string; border: string; Icon: typeof Flame }> = {
  hot_lead:        { label: "Hot Lead",        bg: "bg-red-500/15",     text: "text-red-400",     border: "border-red-500/30",     Icon: Flame },
  needs_attention: { label: "Needs Attention", bg: "bg-amber-500/15",   text: "text-amber-400",   border: "border-amber-500/30",   Icon: AlertCircle },
  human_active:    { label: "Human Active",    bg: "bg-blue-500/15",    text: "text-blue-400",    border: "border-blue-500/30",    Icon: User },
  ai_handling:     { label: "AI Handling",     bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30", Icon: Bot },
  waiting:         { label: "Waiting",         bg: "bg-zinc-500/15",    text: "text-zinc-400",    border: "border-zinc-500/30",    Icon: Clock },
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return "-"
  const diffMs = Date.now() - t
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return phone || ""
  return "***" + phone.slice(-4)
}

export default function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<"all" | Priority>("all")
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [thread, setThread] = useState<ThreadMessage[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<number | null>(null)

  const fetchConversations = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const res = await fetch("/api/actions/inbox", { cache: "no-store" })
      const json = await res.json()
      setConversations(json.conversations || [])
    } catch {
      setConversations([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchConversations()
    const interval = setInterval(() => fetchConversations(true), 30000)
    return () => clearInterval(interval)
  }, [fetchConversations])

  const fetchThread = async (customerId: number) => {
    setThreadLoading(true)
    try {
      const res = await fetch(`/api/actions/inbox?thread=${customerId}`, { cache: "no-store" })
      const json = await res.json()
      setThread(json.messages || [])
    } catch {
      setThread([])
    } finally {
      setThreadLoading(false)
    }
  }

  const toggleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null)
      setThread([])
    } else {
      setExpandedId(id)
      fetchThread(id)
    }
  }

  const handleAction = async (customerId: number, action: string) => {
    setActionLoading(customerId)
    try {
      await fetch("/api/actions/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, customerId }),
      })
      await fetchConversations(true)
    } catch (err) {
      console.error("Action failed:", err)
    } finally {
      setActionLoading(null)
    }
  }

  const filtered = filter === "all"
    ? conversations
    : conversations.filter(c => c.priority === filter)

  const counts: Record<string, number> = {
    all: conversations.length,
    hot_lead: conversations.filter(c => c.priority === "hot_lead").length,
    needs_attention: conversations.filter(c => c.priority === "needs_attention").length,
    human_active: conversations.filter(c => c.priority === "human_active").length,
    ai_handling: conversations.filter(c => c.priority === "ai_handling").length,
    waiting: conversations.filter(c => c.priority === "waiting").length,
  }

  if (loading) return <CubeLoader />

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inbox</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {conversations.length} active conversation{conversations.length !== 1 ? "s" : ""} in the last 7 days
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchConversations(true)}
          disabled={refreshing}
          className="border-zinc-700"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Priority filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {([
          { key: "all", label: "All" },
          { key: "hot_lead", label: "Hot Leads" },
          { key: "needs_attention", label: "Needs Attention" },
          { key: "human_active", label: "Human Active" },
          { key: "ai_handling", label: "AI Handling" },
          { key: "waiting", label: "Waiting" },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              filter === tab.key
                ? "bg-purple-500/15 text-purple-300 border border-purple-500/30"
                : "bg-zinc-800/50 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-800 hover:text-zinc-300"
            }`}
          >
            {tab.label}
            {counts[tab.key] > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
                filter === tab.key ? "bg-purple-500/25" : "bg-zinc-700/50"
              }`}>
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Conversation list */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-zinc-500">
            <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-50" />
            <p>No conversations in this category</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(convo => (
            <ConversationRow
              key={convo.id}
              convo={convo}
              isExpanded={expandedId === convo.id}
              isActioning={actionLoading === convo.id}
              thread={expandedId === convo.id ? thread : []}
              threadLoading={expandedId === convo.id && threadLoading}
              onToggle={() => toggleExpand(convo.id)}
              onAction={(action) => handleAction(convo.id, action)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ConversationRow({
  convo,
  isExpanded,
  isActioning,
  thread,
  threadLoading,
  onToggle,
  onAction,
}: {
  convo: Conversation
  isExpanded: boolean
  isActioning: boolean
  thread: ThreadMessage[]
  threadLoading: boolean
  onToggle: () => void
  onAction: (action: string) => void
}) {
  const config = PRIORITY_CONFIG[convo.priority]
  const PriorityIcon = config.Icon

  return (
    <Card className="overflow-hidden">
      {/* Main row */}
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-start gap-3 text-left hover:bg-zinc-800/30 transition-colors"
      >
        {/* Expand chevron */}
        <div className="pt-0.5 shrink-0">
          {isExpanded
            ? <ChevronDown className="w-4 h-4 text-zinc-500" />
            : <ChevronRight className="w-4 h-4 text-zinc-500" />
          }
        </div>

        {/* Priority icon */}
        <div className={`shrink-0 w-8 h-8 rounded-md flex items-center justify-center ${config.bg}`}>
          <PriorityIcon className={`w-4 h-4 ${config.text}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-medium text-zinc-200">{convo.name}</span>
            <span className="text-xs text-zinc-600">{maskPhone(convo.phone)}</span>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${config.bg} ${config.text} ${config.border}`}>
              {config.label}
            </Badge>
            {convo.handler === "ai" && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                AI
              </Badge>
            )}
            {convo.handler === "human" && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-blue-500/10 text-blue-400 border-blue-500/30">
                Human
              </Badge>
            )}
            {convo.optedOut && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-red-500/10 text-red-400 border-red-500/30">
                Opted Out
              </Badge>
            )}
          </div>

          {/* Last inbound */}
          {convo.lastInbound && (
            <p className="text-sm text-zinc-400 truncate">
              <span className="text-zinc-500 font-medium">Customer:</span>{" "}
              {convo.lastInbound.content}
            </p>
          )}
          {/* Last outbound */}
          {convo.lastOutbound && (
            <p className="text-sm text-zinc-500 truncate mt-0.5">
              <span className="text-zinc-600 font-medium">
                {convo.lastOutbound.aiGenerated ? "AI:" : "Staff:"}
              </span>{" "}
              {convo.lastOutbound.content}
            </p>
          )}
        </div>

        {/* Right side: time + context */}
        <div className="shrink-0 text-right min-w-[70px]">
          <div className="text-xs text-zinc-500">
            {convo.lastInbound ? timeAgo(convo.lastInbound.timestamp) : "-"}
          </div>
          <div className="text-[10px] text-zinc-600 mt-1">{convo.context}</div>
          <div className="text-[10px] text-zinc-600">{convo.messagesCount} msgs</div>
        </div>
      </button>

      {/* Expanded thread + actions */}
      {isExpanded && (
        <div className="border-t border-zinc-800/60">
          {/* Actions bar */}
          <div className="px-4 py-2.5 flex gap-2 border-b border-zinc-800/40 bg-zinc-900/30">
            {convo.handler !== "human" && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                disabled={isActioning}
                onClick={(e) => { e.stopPropagation(); onAction("take_over") }}
              >
                <Hand className="w-3 h-3 mr-1.5" />
                Take Over
              </Button>
            )}
            {convo.handler === "human" && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                disabled={isActioning}
                onClick={(e) => { e.stopPropagation(); onAction("release") }}
              >
                <RotateCcw className="w-3 h-3 mr-1.5" />
                Release to AI
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7 border-zinc-600 text-zinc-400 hover:bg-zinc-800"
              disabled={isActioning}
              onClick={(e) => { e.stopPropagation(); onAction("resolve") }}
            >
              <CheckCircle className="w-3 h-3 mr-1.5" />
              Resolve
            </Button>
          </div>

          {/* Message thread */}
          <div className="px-4 py-3 max-h-96 overflow-y-auto space-y-2.5">
            {threadLoading ? (
              <div className="text-center py-8">
                <div className="w-5 h-5 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto" />
              </div>
            ) : thread.length === 0 ? (
              <p className="text-sm text-zinc-600 text-center py-6">No messages found</p>
            ) : (
              thread.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    msg.direction === "outbound"
                      ? msg.ai_generated
                        ? "bg-emerald-500/10 text-emerald-200 border border-emerald-500/20"
                        : "bg-blue-500/10 text-blue-200 border border-blue-500/20"
                      : "bg-zinc-800 text-zinc-300 border border-zinc-700/50"
                  }`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-medium opacity-70">
                        {msg.direction === "outbound"
                          ? msg.ai_generated ? "AI" : (msg.source === "openphone_app" ? "Staff" : "System")
                          : "Customer"
                        }
                      </span>
                      <span className="text-[10px] opacity-40">{timeAgo(msg.timestamp)}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
