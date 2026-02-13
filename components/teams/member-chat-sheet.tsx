"use client"

import { useEffect, useRef, useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { MessageBubble } from "@/components/message-bubble"
import { VelocityFluidBackground } from "./velocity-fluid-background"
import { Phone } from "lucide-react"

interface MemberChatSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: { id: string; name: string; phone: string } | null
}

interface Message {
  id: string
  phone_number: string
  direction: string
  body: string
  timestamp: string
  status: string
}

export function MemberChatSheet({ open, onOpenChange, member }: MemberChatSheetProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !member?.phone) {
      setMessages([])
      return
    }
    let cancelled = false
    async function fetchMessages() {
      setLoading(true)
      try {
        const res = await fetch(`/api/teams/messages?phone=${encodeURIComponent(member!.phone)}&limit=200`)
        const json = await res.json()
        if (!cancelled && json.success) setMessages(json.data || [])
      } catch {
        if (!cancelled) setMessages([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchMessages()
    return () => { cancelled = true }
  }, [open, member?.phone])

  useEffect(() => {
    if (messages.length > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg bg-black border-purple-500/20 p-0 overflow-hidden"
      >
        <VelocityFluidBackground className="z-0" />

        <div className="relative z-10 flex flex-col h-full">
          <SheetHeader className="p-4 backdrop-blur-md bg-black/40 border-b border-purple-500/10">
            <SheetTitle className="text-white">{member?.name || "Team Member"}</SheetTitle>
            <SheetDescription className="flex items-center gap-1 text-purple-300/70">
              <Phone className="h-3 w-3" />
              {member?.phone || "No phone"}
            </SheetDescription>
          </SheetHeader>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-1">
            {loading && (
              <p className="text-center text-sm text-purple-300/50 py-8">Loading messages...</p>
            )}
            {!loading && messages.length === 0 && (
              <p className="text-center text-sm text-purple-300/50 py-8">No messages found.</p>
            )}
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                role={msg.direction === "inbound" ? "client" : "assistant"}
                content={msg.body}
                timestamp={msg.timestamp}
              />
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
