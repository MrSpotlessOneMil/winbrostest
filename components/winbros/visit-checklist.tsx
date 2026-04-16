'use client'

/**
 * Visit Checklist — Per-visit checklist that blocks job closure
 *
 * - Items loaded from checklist template or custom per-visit
 * - Must ALL be completed before Close Job is allowed
 * - Examples: Arrival confirmed, Before photos, After photos, job-specific steps
 */

import { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ClipboardCheck, Plus, CheckCircle2, Circle } from 'lucide-react'

interface ChecklistItem {
  id: number
  item_text: string
  is_completed: boolean
  completed_at: string | null
}

interface VisitChecklistProps {
  items: ChecklistItem[]
  onToggle: (itemId: number, completed: boolean) => Promise<void>
  onAddItem: (text: string) => Promise<void>
  disabled?: boolean
}

export function VisitChecklist({ items, onToggle, onAddItem, disabled }: VisitChecklistProps) {
  const [newItem, setNewItem] = useState('')
  const [adding, setAdding] = useState(false)

  const completedCount = items.filter(i => i.is_completed).length
  const totalCount = items.length
  const allComplete = totalCount > 0 && completedCount === totalCount

  async function handleAddItem() {
    if (!newItem.trim()) return
    setAdding(true)
    try {
      await onAddItem(newItem.trim())
      setNewItem('')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="border border-zinc-800 rounded-lg bg-zinc-950">
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-semibold text-zinc-300">Visit Checklist</h3>
          </div>
          <div className={`text-xs font-medium ${allComplete ? 'text-green-400' : 'text-zinc-500'}`}>
            {completedCount}/{totalCount}
          </div>
        </div>
        {!allComplete && totalCount > 0 && (
          <p className="text-xs text-amber-400 mt-1">
            Complete all items to unlock job closure
          </p>
        )}
        {allComplete && (
          <p className="text-xs text-green-400 mt-1">
            Checklist complete
          </p>
        )}
      </div>

      <div className="p-4 space-y-2">
        {items.length === 0 && (
          <p className="text-xs text-zinc-500">No checklist items. Add items below.</p>
        )}

        {items.map(item => (
          <label
            key={item.id}
            className={`flex items-center gap-3 p-2 rounded transition-colors cursor-pointer
              ${item.is_completed ? 'bg-zinc-900' : 'hover:bg-zinc-900/50'}`}
          >
            <Checkbox
              checked={item.is_completed}
              onCheckedChange={(checked) => onToggle(item.id, checked as boolean)}
              disabled={disabled}
            />
            <span className={`text-sm ${item.is_completed ? 'text-zinc-500 line-through' : 'text-white'}`}>
              {item.item_text}
            </span>
            {item.is_completed ? (
              <CheckCircle2 className="w-3 h-3 text-green-500 ml-auto" />
            ) : (
              <Circle className="w-3 h-3 text-zinc-700 ml-auto" />
            )}
          </label>
        ))}

        {/* Add item */}
        <div className="flex gap-2 pt-2 border-t border-zinc-800">
          <Input
            placeholder="Add checklist item..."
            value={newItem}
            onChange={e => setNewItem(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddItem()}
            className="text-sm"
            disabled={disabled}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddItem}
            disabled={adding || !newItem.trim() || disabled}
            className="cursor-pointer"
          >
            <Plus className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}
