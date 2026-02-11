"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { FluidBackground } from "@/components/assistant/fluid-background"
import { ConversationSidebar, type Conversation } from "@/components/assistant/conversation-sidebar"
import { Send, Loader2, Sparkles } from "lucide-react"

interface Message {
  role: "user" | "assistant"
  content: string
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

export default function AssistantPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load conversations on mount
  useEffect(() => {
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
      setConversations((prev) => {
        const updated = prev.map((c) => {
          if (c.id !== currentId) return c
          const firstUserMsg = updatedMessages.find((m) => m.role === "user")
          const title = firstUserMsg
            ? firstUserMsg.content.length > 40
              ? firstUserMsg.content.slice(0, 40) + "..."
              : firstUserMsg.content
            : "New Chat"
          return {
            ...c,
            messages: updatedMessages,
            title,
            updatedAt: new Date().toISOString(),
          }
        })
        const sorted = updated.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        saveConversations(sorted)
        return sorted
      })
    },
    [currentId]
  )

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { role: "user", content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    persistMessages(newMessages)
    setInput("")
    setLoading(true)

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      })

      const data = await res.json()

      if (data.success && data.message) {
        const withReply = [...newMessages, { role: "assistant" as const, content: data.message }]
        setMessages(withReply)
        persistMessages(withReply)
      } else {
        const withError = [
          ...newMessages,
          {
            role: "assistant" as const,
            content: data.error || "Something went wrong. Try again.",
          },
        ]
        setMessages(withError)
        persistMessages(withError)
      }
    } catch {
      const withError = [
        ...newMessages,
        { role: "assistant" as const, content: "Connection error. Please try again." },
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

  function handleNewChat() {
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

  function handleSelectConversation(id: string) {
    const conv = conversations.find((c) => c.id === id)
    if (conv) {
      setCurrentId(id)
      setMessages(conv.messages)
      setInput("")
    }
  }

  function handleDeleteConversation(id: string) {
    setConversations((prev) => {
      const updated = prev.filter((c) => c.id !== id)

      // If we deleted the current conversation, switch to first remaining or create new
      if (id === currentId) {
        if (updated.length > 0) {
          setCurrentId(updated[0].id)
          setMessages(updated[0].messages)
        } else {
          const fresh = createConversation()
          updated.push(fresh)
          setCurrentId(fresh.id)
          setMessages([])
        }
      }

      saveConversations(updated)
      return updated
    })
  }

  return (
    <div className="relative flex flex-col h-full -m-4 overflow-hidden">
      {/* Fluid simulation background */}
      <FluidBackground className="z-0" />

      {/* Chat overlay with sidebar */}
      <div className="relative z-10 flex h-full">
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
          {/* Header */}
          <div className={`flex items-center gap-3 px-6 py-4 ${!sidebarOpen ? "pl-16" : ""}`}>
            <div className="p-2 rounded-lg bg-purple-500/20 backdrop-blur-sm">
              <Sparkles className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-zinc-100">Assistant</h1>
              <p className="text-xs text-zinc-400">
                Reset customers, generate links, manage your system
              </p>
            </div>
          </div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
                <div className="p-4 rounded-2xl bg-purple-500/10 backdrop-blur-sm border border-purple-500/20">
                  <Sparkles className="w-10 h-10 text-purple-400" />
                </div>
                <div>
                  <h2 className="text-xl font-medium text-zinc-200 mb-2">How can I help?</h2>
                  <p className="text-sm text-zinc-400 max-w-md">
                    I can reset customer data, generate Stripe payment links, or toggle your
                    business system on/off.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                  {[
                    "Reset customer (424) 555-0123",
                    "Generate a Stripe link for a customer",
                    "Turn off the system",
                    "Turn on the system",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setInput(suggestion)
                        inputRef.current?.focus()
                      }}
                      className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800/60 backdrop-blur-sm border border-zinc-700/40 text-zinc-300 hover:bg-zinc-700/60 hover:text-zinc-100 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-purple-500/30 backdrop-blur-md border border-purple-500/20 text-zinc-100"
                      : "bg-zinc-800/60 backdrop-blur-md border border-zinc-700/30 text-zinc-200"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="px-4 py-3 rounded-2xl bg-zinc-800/60 backdrop-blur-md border border-zinc-700/30">
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
          <div className="px-6 pb-6 pt-2">
            <div className="flex items-end gap-3 p-3 rounded-2xl bg-zinc-800/60 backdrop-blur-md border border-zinc-700/40">
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
