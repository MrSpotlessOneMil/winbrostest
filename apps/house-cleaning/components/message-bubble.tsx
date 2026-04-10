"use client"

interface MessageBubbleProps {
  role: "client" | "business" | "assistant" | "system"
  content: string
  timestamp: string
  showTimestamp?: boolean
  sending?: boolean
}

export function MessageBubble({ role, content, timestamp, showTimestamp = true, sending = false }: MessageBubbleProps) {
  const isClient = role === "client"
  const isSystem = role === "system"

  return (
    <div className={`flex ${isClient ? "justify-start" : "justify-end"} mb-2 ${sending ? "animate-bubble-in" : ""}`}>
      <div
        className={`max-w-[75%] px-4 py-3 transition-opacity duration-500 ${
          sending ? "opacity-70" : "opacity-100"
        } ${
          isClient
            ? "bg-zinc-700/80 text-zinc-100 rounded-2xl rounded-bl-md"
            : isSystem
            ? "bg-zinc-600/50 text-zinc-300 rounded-2xl"
            : "bg-purple-500/90 text-white rounded-2xl rounded-br-md"
        }`}
      >
        {/* Role label */}
        <div
          className={`text-[9px] uppercase tracking-wider mb-1 font-medium ${
            isClient
              ? "text-zinc-400"
              : isSystem
              ? "text-zinc-500"
              : "text-purple-200"
          }`}
        >
          {role === "client" ? "Customer" : role === "system" ? "System" : "OSIRIS"}
        </div>

        {/* Message content — break long URLs, make links clickable */}
        <div className="text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word]">
          {content.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
            /^https?:\/\//.test(part) ? (
              <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline text-blue-300 hover:text-blue-200 break-all">
                {part}
              </a>
            ) : part
          )}
        </div>

        {/* Timestamp / Sending indicator */}
        {sending ? (
          <div className="flex items-center gap-1.5 mt-1.5">
            <div className="flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-purple-200/70 animate-bounce [animation-delay:0ms]" />
              <span className="w-1 h-1 rounded-full bg-purple-200/70 animate-bounce [animation-delay:150ms]" />
              <span className="w-1 h-1 rounded-full bg-purple-200/70 animate-bounce [animation-delay:300ms]" />
            </div>
            <span className="text-[10px] text-purple-200/70">Sending</span>
          </div>
        ) : showTimestamp && timestamp ? (
          <div
            className={`text-[10px] mt-1.5 ${
              isClient
                ? "text-zinc-500"
                : isSystem
                ? "text-zinc-600"
                : "text-purple-200/70"
            }`}
          >
            {new Date(timestamp).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
