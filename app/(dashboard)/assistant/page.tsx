"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { ConversationSidebar, type Conversation } from "@/components/assistant/conversation-sidebar"
import { Send, Loader2, Sparkles, Copy } from "lucide-react"

function AnimatedCheck({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline
        points="4 12 9 17 20 6"
        style={{ strokeDasharray: 28, strokeDashoffset: 28, animation: "checkDraw 0.35s ease-out forwards" }}
      />
    </svg>
  )
}

interface Message {
  role: "user" | "assistant"
  content: string
  timestamp?: string
}

function formatTimestamp(iso?: string) {
  if (!iso) return null
  const date = new Date(iso)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  if (isToday) return time
  return date.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " + time
}

const STORAGE_KEY = "osiris_conversations"

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Conversation[]
    return parsed.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  } catch {
    return []
  }
}

function saveConversations(conversations: Conversation[]) {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
}

function createConversation(): Conversation {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    title: "New Chat",
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}

// ─── Lightweight Markdown Renderer ───────────────────────────────────────────

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className={`p-1 rounded-md transition-colors ${
        copied
          ? "text-green-400 bg-green-500/10"
          : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50"
      } ${className}`}
      title={copied ? "Copied!" : "Copy"}
    >
      {copied ? <AnimatedCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

function AssistantMessageContent({ content }: { content: string }) {
  // Split by code blocks first
  const parts = content.split(/(```[\s\S]*?```)/g)

  return (
    <div className="space-y-2">
      {parts.map((part, i) => {
        // Code block
        if (part.startsWith("```") && part.endsWith("```")) {
          const inner = part.slice(3, -3)
          const newlineIdx = inner.indexOf("\n")
          const code = newlineIdx >= 0 ? inner.slice(newlineIdx + 1) : inner
          return (
            <div key={i} className="relative group/code rounded-lg bg-zinc-900/80 border border-zinc-700/50 overflow-hidden">
              <div className="absolute top-2 right-2 opacity-0 group-hover/code:opacity-100 transition-opacity">
                <CopyButton text={code} />
              </div>
              <pre className="p-3 pr-10 text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap break-words">
                {code}
              </pre>
            </div>
          )
        }

        // Regular text — parse inline markdown
        return <InlineMarkdown key={i} text={part} />
      })}
    </div>
  )
}

function InlineMarkdown({ text }: { text: string }) {
  if (!text.trim()) return null

  const lines = text.split("\n")
  const elements: React.ReactNode[] = []
  let listBuffer: { type: "ul" | "ol"; items: string[] } | null = null

  function flushList() {
    if (!listBuffer) return
    const ListTag = listBuffer.type === "ul" ? "ul" : "ol"
    elements.push(
      <ListTag
        key={`list-${elements.length}`}
        className={`pl-5 space-y-0.5 ${listBuffer.type === "ul" ? "list-disc" : "list-decimal"} marker:text-purple-400`}
      >
        {listBuffer.items.map((item, j) => (
          <li key={j} className="text-sm leading-relaxed">
            <InlineText text={item} />
          </li>
        ))}
      </ListTag>
    )
    listBuffer = null
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]

    // Bullet list item
    const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)/)
    if (bulletMatch) {
      if (listBuffer?.type !== "ul") {
        flushList()
        listBuffer = { type: "ul", items: [] }
      }
      listBuffer!.items.push(bulletMatch[2])
      continue
    }

    // Numbered list item
    const numMatch = line.match(/^(\s*)\d+[.)]\s+(.+)/)
    if (numMatch) {
      if (listBuffer?.type !== "ol") {
        flushList()
        listBuffer = { type: "ol", items: [] }
      }
      listBuffer!.items.push(numMatch[2])
      continue
    }

    // Not a list line — flush any accumulated list
    flushList()

    // Empty line
    if (!line.trim()) {
      elements.push(<div key={`br-${idx}`} className="h-1" />)
      continue
    }

    // Regular paragraph line
    elements.push(
      <p key={`p-${idx}`} className="text-sm leading-relaxed">
        <InlineText text={line} />
      </p>
    )
  }

  flushList()
  return <>{elements}</>
}

function InlineText({ text }: { text: string }) {
  // Parse bold (**text**), inline code (`text`), and URLs (https://...)
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s<>"']+)/g)
  return (
    <>
      {tokens.map((token, i) => {
        if (token.startsWith("**") && token.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold text-zinc-100">
              {token.slice(2, -2)}
            </strong>
          )
        }
        if (token.startsWith("`") && token.endsWith("`")) {
          return (
            <code key={i} className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 text-xs font-mono">
              {token.slice(1, -1)}
            </code>
          )
        }
        if (/^https?:\/\//.test(token)) {
          return (
            <a key={i} href={token} target="_blank" rel="noopener noreferrer" className="text-purple-400 underline break-all hover:text-purple-300">
              {token}
            </a>
          )
        }
        return <span key={i}>{token}</span>
      })}
    </>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────


export default function AssistantPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [copiedChat, setCopiedChat] = useState(false)
  const [memoryEnabled, setMemoryEnabled] = useState(false)
  const [initLoaded, setInitLoaded] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const prevConvIdRef = useRef<string | null>(null)

  function handleCopyMessage(text: string, idx: number) {
    navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  function handleCopyChat() {
    const last100 = messages.slice(-100)
    const formatted = last100
      .map((m) => `[${m.role === "user" ? "You" : "Assistant"}]: ${m.content}`)
      .join("\n\n")
    navigator.clipboard.writeText(formatted)
    setCopiedChat(true)
    setTimeout(() => setCopiedChat(false), 2000)
  }

  // Load conversations on mount — try server first (memory mode), fall back to localStorage
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch("/api/assistant/conversations")
        if (res.ok) {
          const data = await res.json()
          if (data.memoryEnabled) {
            setMemoryEnabled(true)
            const serverConvs: Conversation[] = (data.conversations || []).map((c: any) => ({
              id: c.id,
              title: c.title,
              messages: [],
              createdAt: c.updated_at,
              updatedAt: c.updated_at,
            }))
            if (serverConvs.length > 0) {
              setConversations(serverConvs)
              // Load full messages for the most recent conversation
              const latestId = serverConvs[0].id
              setCurrentId(latestId)
              try {
                const convRes = await fetch(`/api/assistant/conversations/${latestId}`)
                if (convRes.ok) {
                  const convData = await convRes.json()
                  setMessages(convData.conversation?.messages || [])
                }
              } catch { /* ignore, messages will be empty */ }
            } else {
              // Create a new server-side conversation
              const createRes = await fetch("/api/assistant/conversations", { method: "POST" })
              if (createRes.ok) {
                const { id } = await createRes.json()
                const fresh: Conversation = {
                  id,
                  title: "New Chat",
                  messages: [],
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }
                setConversations([fresh])
                setCurrentId(id)
                setMessages([])
              }
            }
            setInitLoaded(true)
            return
          }
        }
      } catch { /* server not available, fall back to localStorage */ }

      // Fallback: localStorage mode
      const loaded = loadConversations()
      if (loaded.length > 0) {
        setConversations(loaded)
        setCurrentId(loaded[0].id)
        setMessages(loaded[0].messages)
      } else {
        const fresh = createConversation()
        setConversations([fresh])
        setCurrentId(fresh.id)
        setMessages([])
      }
      setInitLoaded(true)
    }
    init()
  }, [])

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Focus input on conversation switch
  useEffect(() => {
    inputRef.current?.focus()
  }, [currentId])

  // Persist conversation whenever messages change
  const persistMessages = useCallback(
    (updatedMessages: Message[]) => {
      if (!currentId) return

      // Update local state (title + sort order)
      const firstUserMsg = updatedMessages.find((m) => m.role === "user")
      const title = firstUserMsg
        ? firstUserMsg.content.length > 40
          ? firstUserMsg.content.slice(0, 40) + "..."
          : firstUserMsg.content
        : "New Chat"

      setConversations((prev) => {
        const updated = prev.map((c) => {
          if (c.id !== currentId) return c
          return {
            ...c,
            messages: memoryEnabled ? [] : updatedMessages, // Don't store full messages in state for memory mode
            title,
            updatedAt: new Date().toISOString(),
          }
        })
        const sorted = updated.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        if (!memoryEnabled) {
          saveConversations(sorted)
        }
        return sorted
      })
    },
    [currentId, memoryEnabled]
  )

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { role: "user", content: text, timestamp: new Date().toISOString() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    persistMessages(newMessages)
    setInput("")
    setLoading(true)

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          ...(memoryEnabled && currentId ? { conversationId: currentId } : {}),
        }),
      })

      const data = await res.json()

      if (data.success && data.message) {
        const withReply = [...newMessages, { role: "assistant" as const, content: data.message, timestamp: new Date().toISOString() }]
        setMessages(withReply)
        persistMessages(withReply)
      } else {
        const withError = [
          ...newMessages,
          {
            role: "assistant" as const,
            content: data.error || "Something went wrong. Try again.",
            timestamp: new Date().toISOString(),
          },
        ]
        setMessages(withError)
        persistMessages(withError)
      }
    } catch {
      const withError = [
        ...newMessages,
        { role: "assistant" as const, content: "Connection error. Please try again.", timestamp: new Date().toISOString() },
      ]
      setMessages(withError)
      persistMessages(withError)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function handleNewChat() {
    // Trigger summarization for the conversation we're leaving
    if (memoryEnabled && currentId && messages.length > 1) {
      fetch(`/api/assistant/conversations/${currentId}/summarize`, { method: "POST" }).catch(() => {})
    }

    if (memoryEnabled) {
      try {
        const res = await fetch("/api/assistant/conversations", { method: "POST" })
        if (res.ok) {
          const { id } = await res.json()
          const fresh: Conversation = {
            id,
            title: "New Chat",
            messages: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          setConversations((prev) => [fresh, ...prev])
          setCurrentId(id)
          setMessages([])
          setInput("")
          return
        }
      } catch { /* fall through to localStorage */ }
    }

    const fresh = createConversation()
    setConversations((prev) => {
      const updated = [fresh, ...prev]
      saveConversations(updated)
      return updated
    })
    setCurrentId(fresh.id)
    setMessages([])
    setInput("")
  }

  async function handleSelectConversation(id: string) {
    // Trigger summarization for the conversation we're leaving
    if (memoryEnabled && currentId && currentId !== id && messages.length > 1) {
      fetch(`/api/assistant/conversations/${currentId}/summarize`, { method: "POST" }).catch(() => {})
    }

    if (memoryEnabled) {
      setCurrentId(id)
      setMessages([]) // Clear while loading
      setInput("")
      try {
        const res = await fetch(`/api/assistant/conversations/${id}`)
        if (res.ok) {
          const data = await res.json()
          setMessages(data.conversation?.messages || [])
        }
      } catch { /* ignore */ }
      return
    }

    const conv = conversations.find((c) => c.id === id)
    if (conv) {
      setCurrentId(id)
      setMessages(conv.messages)
      setInput("")
    }
  }

  async function handleDeleteConversation(id: string) {
    if (memoryEnabled) {
      fetch(`/api/assistant/conversations/${id}`, { method: "DELETE" }).catch(() => {})
    }

    const updated = conversations.filter((c) => c.id !== id)

    if (!memoryEnabled) {
      saveConversations(updated)
    }
    setConversations(updated)

    // If we deleted the current conversation, switch to first remaining or create new
    if (id === currentId) {
      if (updated.length > 0) {
        setCurrentId(updated[0].id)
        if (!memoryEnabled) {
          setMessages(updated[0].messages)
        } else {
          setMessages([])
          // Lazy-load messages for the new current conversation
          fetch(`/api/assistant/conversations/${updated[0].id}`)
            .then((res) => res.json())
            .then((data) => setMessages(data.conversation?.messages || []))
            .catch(() => {})
        }
      } else {
        handleNewChat()
      }
    }
  }

  return (
    <div className="relative flex flex-col flex-1 min-h-0 -m-3 md:-m-4 overflow-hidden bg-card">
      {/* Chat with sidebar */}
      <div className="relative flex flex-1 min-h-0">
        {/* Conversation sidebar */}
        <ConversationSidebar
          conversations={conversations}
          currentId={currentId}
          onSelect={handleSelectConversation}
          onNew={handleNewChat}
          onDelete={handleDeleteConversation}
          open={sidebarOpen}
          onToggle={() => setSidebarOpen((o) => !o)}
        />

        {/* Main chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Messages area */}
          <div className="relative flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Floating copy chat button */}
            {messages.length > 0 && (
              <button
                data-no-splat
                onClick={handleCopyChat}
                className={`sticky top-0 z-10 ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium backdrop-blur-sm transition-all duration-200 ${
                  copiedChat
                    ? "bg-green-500/20 text-green-400 border border-green-500/30"
                    : "bg-zinc-800/70 text-zinc-500 border border-zinc-700/40 hover:text-zinc-200 hover:bg-zinc-700/80 active:scale-95"
                }`}
                title="Copy last 100 messages"
              >
                {copiedChat ? <AnimatedCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedChat ? "Copied!" : "Copy Chat"}
              </button>
            )}
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
                <div className="p-4 rounded-2xl bg-purple-500/10 border border-purple-500/20">
                  <Sparkles className="w-10 h-10 text-purple-400" />
                </div>
                <div>
                  <h2 className="text-xl font-medium text-zinc-200 mb-2">How can I help?</h2>
                  <p className="text-sm text-zinc-400 max-w-md">
                    I can look up customers, create jobs, generate payment links, compose messages,
                    manage your team, and more.
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "user" ? (
                  <div className="flex flex-col items-end">
                    <div
                      data-no-splat
                      className="max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap bg-purple-500/20 border border-purple-500/20 text-zinc-100"
                    >
                      {msg.content}
                    </div>
                    {formatTimestamp(msg.timestamp) && (
                      <span className="text-[11px] text-zinc-500 mt-1 mr-1">{formatTimestamp(msg.timestamp)}</span>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-start">
                    <div className="group relative max-w-[80%]">
                      <div
                        data-no-splat
                        className="px-4 py-3 rounded-2xl bg-zinc-800 border border-zinc-700/30 text-zinc-200"
                      >
                        <AssistantMessageContent content={msg.content} />
                      </div>
                      {/* Copy whole message button — visible on hover */}
                      <button
                        onClick={() => handleCopyMessage(msg.content, i)}
                        className={`absolute -top-2 -right-2 p-1.5 rounded-lg border transition-all ${
                          copiedIdx === i
                            ? "opacity-100 bg-green-500/20 border-green-500/30 text-green-400"
                            : "opacity-0 group-hover:opacity-100 bg-zinc-800/80 border-zinc-700/50 text-zinc-400 hover:text-zinc-200"
                        }`}
                        title={copiedIdx === i ? "Copied!" : "Copy message"}
                      >
                        {copiedIdx === i ? (
                          <AnimatedCheck className="w-3.5 h-3.5" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                    {formatTimestamp(msg.timestamp) && (
                      <span className="text-[11px] text-zinc-500 mt-1 ml-1">{formatTimestamp(msg.timestamp)}</span>
                    )}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="px-4 py-3 rounded-2xl bg-zinc-800 border border-zinc-700/30">
                  <div className="flex items-center gap-2 text-zinc-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Thinking...
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="px-6 pb-6 pt-2" data-no-splat>
            <div className="flex items-end gap-3 p-3 rounded-2xl bg-zinc-800 border border-zinc-700/40">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask me anything..."
                rows={1}
                className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none max-h-32"
                style={{ minHeight: "24px" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = "24px"
                  target.style.height = Math.min(target.scrollHeight, 128) + "px"
                }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="p-2 rounded-xl bg-purple-500 hover:bg-purple-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
