"use client"

import { MessageSquare, Plus, Trash2, PanelLeft, PanelLeftClose } from "lucide-react"

export interface Conversation {
  id: string
  title: string
  messages: { role: "user" | "assistant"; content: string }[]
  createdAt: string
  updatedAt: string
}

interface Props {
  conversations: Conversation[]
  currentId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  open: boolean
  onToggle: () => void
}

function groupByDate(conversations: Conversation[]) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 7 * 86400000)
  const monthAgo = new Date(today.getTime() - 30 * 86400000)

  const groups: { label: string; items: Conversation[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 Days", items: [] },
    { label: "Previous 30 Days", items: [] },
    { label: "Older", items: [] },
  ]

  for (const conv of conversations) {
    const date = new Date(conv.updatedAt)
    if (date >= today) groups[0].items.push(conv)
    else if (date >= yesterday) groups[1].items.push(conv)
    else if (date >= weekAgo) groups[2].items.push(conv)
    else if (date >= monthAgo) groups[3].items.push(conv)
    else groups[4].items.push(conv)
  }

  return groups.filter((g) => g.items.length > 0)
}

export function ConversationSidebar({
  conversations,
  currentId,
  onSelect,
  onNew,
  onDelete,
  open,
  onToggle,
}: Props) {
  const groups = groupByDate(conversations)

  return (
    <>
      {/* Toggle button - always visible */}
      {!open && (
        <button
          onClick={onToggle}
          className="absolute top-4 left-4 z-20 p-2 rounded-lg bg-zinc-800/60 backdrop-blur-sm border border-zinc-700/40 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60 transition-colors"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      )}

      {/* Sidebar panel */}
      <div
        className={`${
          open ? "w-64" : "w-0"
        } transition-all duration-200 overflow-hidden flex-shrink-0 h-full`}
      >
        <div className="w-64 h-full flex flex-col bg-zinc-900/70 backdrop-blur-md border-r border-zinc-700/30">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-3 border-b border-zinc-700/30">
            <button
              onClick={onNew}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-300 hover:bg-purple-500/30 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New Chat
            </button>
            <button
              onClick={onToggle}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/50 transition-colors"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto py-2 px-2 space-y-3">
            {conversations.length === 0 && (
              <p className="text-xs text-zinc-500 text-center py-4">No conversations yet</p>
            )}

            {groups.map((group) => (
              <div key={group.label}>
                <p className="px-2 py-1 text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((conv) => (
                    <div
                      key={conv.id}
                      className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
                        conv.id === currentId
                          ? "bg-purple-500/15 text-zinc-100"
                          : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                      }`}
                      onClick={() => onSelect(conv.id)}
                    >
                      <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                      <span className="flex-1 text-sm truncate">{conv.title}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(conv.id)
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-500 hover:text-red-400 transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
