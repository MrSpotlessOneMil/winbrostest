"use client"

import { Phone } from "lucide-react"

interface Call {
  id: number
  phone_number?: string
  caller_name?: string
  direction?: string
  duration_seconds?: number
  outcome?: string
  transcript?: string
  created_at: string
}

interface CallBubbleProps {
  call: Call
}

export function CallBubble({ call }: CallBubbleProps) {
  const isOutbound = call.direction === "outbound"

  const formatTime = (seconds: number) => {
    if (!seconds || !isFinite(seconds)) return "0:00"
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  return (
    <div className={`flex ${isOutbound ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[80%] min-w-[220px] ${
          isOutbound
            ? "bg-purple-500/15 border-purple-500/30"
            : "bg-zinc-700/60 border-zinc-600/40"
        } border rounded-2xl ${isOutbound ? "rounded-br-md" : "rounded-bl-md"} px-4 py-3`}
      >
        {/* Call header */}
        <div
          className={`text-[10px] uppercase tracking-wider mb-2 font-medium flex items-center gap-1.5 ${
            isOutbound ? "text-purple-300" : "text-zinc-400"
          }`}
        >
          <Phone className="w-3 h-3" />
          {isOutbound ? "Outbound Call" : "Inbound Call"}
        </div>

        {/* Call info */}
        <div className="space-y-1">
          {call.duration_seconds !== undefined && call.duration_seconds > 0 && (
            <div className="text-sm text-zinc-300">
              Duration: {formatTime(call.duration_seconds)}
            </div>
          )}
          {call.outcome && (
            <div className="flex items-center gap-2">
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  call.outcome === "booked"
                    ? "bg-emerald-400/10 text-emerald-400"
                    : call.outcome === "voicemail"
                    ? "bg-yellow-400/10 text-yellow-400"
                    : "bg-zinc-600/50 text-zinc-400"
                }`}
              >
                {call.outcome}
              </span>
            </div>
          )}
        </div>

        {/* Transcript preview */}
        {call.transcript && (
          <div className="mt-2 text-xs text-zinc-500 line-clamp-2">
            {call.transcript.slice(0, 100)}
            {call.transcript.length > 100 && "..."}
          </div>
        )}

        {/* Call time */}
        <div className={`text-[10px] mt-2 ${isOutbound ? "text-purple-300/60" : "text-zinc-500"}`}>
          {new Date(call.created_at).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  )
}
