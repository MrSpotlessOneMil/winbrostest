"use client"

import { useEffect, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { MessageSquare, Phone, Clock, Bot, User, MapPin, DollarSign } from "lucide-react"
import { cn } from "@/lib/utils"

interface ThreadMessage {
  id: string
  content: string
  timestamp: string
  direction: string
  role: string
  ai_generated: boolean
  source: string
}

interface CustomerInfo {
  id: number
  first_name: string | null
  last_name: string | null
  phone_number: string | null
}

interface CustomerThreadDrawerProps {
  open: boolean
  onClose: () => void
  /** Phone number to look up customer thread */
  phoneNumber?: string | null
  /** Display name for the header */
  displayName?: string
  /** Extra context (service type, address, price, etc.) */
  context?: { label: string; value: string }[]
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

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return phone
}

export function CustomerThreadDrawer({
  open,
  onClose,
  phoneNumber,
  displayName,
  context,
}: CustomerThreadDrawerProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [customer, setCustomer] = useState<CustomerInfo | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open && phoneNumber) {
      fetchThread(phoneNumber)
    }
    if (!open) {
      setMessages([])
      setCustomer(null)
    }
  }, [open, phoneNumber])

  async function fetchThread(phone: string) {
    setLoading(true)
    try {
      const res = await fetch(`/api/actions/inbox?phone=${encodeURIComponent(phone)}`, { cache: "no-store" })
      const json = await res.json()
      setMessages(json.messages || [])
      setCustomer(json.customer || null)
    } catch {
      setMessages([])
      setCustomer(null)
    } finally {
      setLoading(false)
    }
  }

  const customerName = displayName
    || (customer ? [customer.first_name, customer.last_name].filter(Boolean).join(" ") : null)
    || (phoneNumber ? formatPhone(phoneNumber) : "Customer")

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-hidden flex flex-col">
        <SheetHeader>
          <SheetTitle className="text-lg">{customerName}</SheetTitle>
          <SheetDescription>
            {phoneNumber && (
              <span className="flex items-center gap-1.5">
                <Phone className="w-3 h-3" />
                {formatPhone(phoneNumber)}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        {/* Context cards (service type, address, price, etc.) */}
        {context && context.length > 0 && (
          <div className="px-4 pb-2 flex flex-wrap gap-2">
            {context.map((item, i) => (
              <div key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-800/60 border border-zinc-700/50 text-xs">
                <span className="text-zinc-500">{item.label}:</span>
                <span className="text-zinc-300 font-medium">{item.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Messages thread */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2.5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-16">
              <MessageSquare className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
              <p className="text-sm text-zinc-500">No conversation history found</p>
              {phoneNumber && (
                <p className="text-xs text-zinc-600 mt-1">No messages for {formatPhone(phoneNumber)}</p>
              )}
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                    msg.direction === "outbound"
                      ? msg.ai_generated
                        ? "bg-emerald-500/10 text-emerald-200 border border-emerald-500/20"
                        : "bg-blue-500/10 text-blue-200 border border-blue-500/20"
                      : "bg-zinc-800 text-zinc-300 border border-zinc-700/50"
                  )}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    {msg.direction === "outbound" ? (
                      msg.ai_generated ? (
                        <Bot className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <User className="w-3 h-3 text-blue-400" />
                      )
                    ) : (
                      <User className="w-3 h-3 text-zinc-500" />
                    )}
                    <span className="text-[10px] font-medium opacity-70">
                      {msg.direction === "outbound"
                        ? msg.ai_generated
                          ? "AI"
                          : msg.source === "openphone_app"
                          ? "Staff"
                          : "System"
                        : "Customer"}
                    </span>
                    <span className="text-[10px] opacity-40">{timeAgo(msg.timestamp)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
