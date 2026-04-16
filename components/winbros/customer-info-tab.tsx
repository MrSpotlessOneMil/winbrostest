'use client'

/**
 * Customer Info Tab — Persistent client data for WinBros
 *
 * - Tags (CORE — drives payroll, scheduling, service plans)
 * - Notes (client/property details)
 * - Client History (past visits with date + summary)
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tag, StickyNote, History, Plus, X, Save, User,
  Wrench, Calendar, Users
} from 'lucide-react'

interface CustomerTag {
  id: number
  tag_type: string
  tag_value: string
}

interface VisitSummary {
  id: number
  visit_date: string
  status: string
  services: string[]
  total: number
}

interface CustomerInfoTabProps {
  customerId: number
  tags: CustomerTag[]
  notes: string
  visits: VisitSummary[]
  availableTags: Array<{ tag_type: string; tag_value: string; color: string }>
  onAddTag: (type: string, value: string) => Promise<void>
  onRemoveTag: (tagId: number) => Promise<void>
  onSaveNotes: (notes: string) => Promise<void>
  onVisitClick: (visitId: number) => void
}

const TAG_TYPE_ICONS: Record<string, React.ElementType> = {
  salesman: User,
  technician: Wrench,
  team_lead: Users,
  service_plan: Calendar,
  service_months: Calendar,
  custom: Tag,
}

const TAG_TYPE_LABELS: Record<string, string> = {
  salesman: 'Salesman',
  technician: 'Technician',
  team_lead: 'Team Lead',
  service_plan: 'Service Plan',
  service_months: 'Service Months',
  custom: 'Custom',
}

export function CustomerInfoTab({
  customerId,
  tags,
  notes: initialNotes,
  visits,
  availableTags,
  onAddTag,
  onRemoveTag,
  onSaveNotes,
  onVisitClick,
}: CustomerInfoTabProps) {
  const [editNotes, setEditNotes] = useState(initialNotes)
  const [notesDirty, setNotesDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [addingTag, setAddingTag] = useState(false)
  const [selectedType, setSelectedType] = useState('')
  const [selectedValue, setSelectedValue] = useState('')

  async function handleSaveNotes() {
    setSaving(true)
    try {
      await onSaveNotes(editNotes)
      setNotesDirty(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleAddTag() {
    if (!selectedType || !selectedValue) return
    await onAddTag(selectedType, selectedValue)
    setSelectedType('')
    setSelectedValue('')
    setAddingTag(false)
  }

  // Group tags by type
  const tagsByType: Record<string, CustomerTag[]> = {}
  for (const tag of tags) {
    if (!tagsByType[tag.tag_type]) tagsByType[tag.tag_type] = []
    tagsByType[tag.tag_type].push(tag)
  }

  // Filter available tags for selected type
  const availableForType = availableTags.filter(t =>
    t.tag_type === selectedType && !tags.some(existing =>
      existing.tag_type === t.tag_type && existing.tag_value === t.tag_value
    )
  )

  return (
    <div className="space-y-6">
      {/* Tags Section */}
      <div className="border border-zinc-800 rounded-lg bg-zinc-950">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-semibold text-zinc-300">Tags</h3>
            <span className="text-xs text-zinc-500">Drives payroll, scheduling, and service plans</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddingTag(true)}
            className="cursor-pointer"
          >
            <Plus className="w-3 h-3 mr-1" />
            Add Tag
          </Button>
        </div>

        <div className="p-4">
          {Object.keys(tagsByType).length === 0 && !addingTag && (
            <p className="text-xs text-zinc-500">No tags assigned</p>
          )}

          {Object.entries(tagsByType).map(([type, typeTags]) => {
            const Icon = TAG_TYPE_ICONS[type] || Tag
            return (
              <div key={type} className="mb-3">
                <div className="flex items-center gap-1 mb-1.5">
                  <Icon className="w-3 h-3 text-zinc-500" />
                  <span className="text-xs font-medium text-zinc-400 uppercase">
                    {TAG_TYPE_LABELS[type] || type}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {typeTags.map(tag => (
                    <Badge
                      key={tag.id}
                      variant="secondary"
                      className="text-xs bg-zinc-800 text-zinc-200 flex items-center gap-1"
                    >
                      {tag.tag_value}
                      <button
                        onClick={() => onRemoveTag(tag.id)}
                        className="ml-0.5 hover:text-red-400 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )
          })}

          {/* Add tag form */}
          {addingTag && (
            <div className="mt-3 p-3 bg-zinc-900 rounded-lg space-y-2">
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Tag type" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TAG_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedType && (
                <Select value={selectedValue} onValueChange={setSelectedValue}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Select value" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableForType.map(t => (
                      <SelectItem key={t.tag_value} value={t.tag_value}>{t.tag_value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddTag} disabled={!selectedType || !selectedValue} className="cursor-pointer">
                  Add
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setAddingTag(false)} className="cursor-pointer">
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Notes Section */}
      <div className="border border-zinc-800 rounded-lg bg-zinc-950">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StickyNote className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-semibold text-zinc-300">Notes</h3>
          </div>
          {notesDirty && (
            <Button size="sm" onClick={handleSaveNotes} disabled={saving} className="cursor-pointer">
              <Save className="w-3 h-3 mr-1" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
          )}
        </div>
        <div className="p-4">
          <Textarea
            value={editNotes}
            onChange={e => { setEditNotes(e.target.value); setNotesDirty(true) }}
            placeholder="Client notes, property details, access instructions..."
            className="min-h-[100px] text-sm"
          />
        </div>
      </div>

      {/* Client History */}
      <div className="border border-zinc-800 rounded-lg bg-zinc-950">
        <div className="p-4 border-b border-zinc-800 flex items-center gap-2">
          <History className="w-4 h-4 text-zinc-500" />
          <h3 className="text-sm font-semibold text-zinc-300">Visit History</h3>
          <span className="text-xs text-zinc-500">{visits.length} visits</span>
        </div>
        <div className="p-4">
          {visits.length === 0 ? (
            <p className="text-xs text-zinc-500">No visit history</p>
          ) : (
            <div className="space-y-2">
              {visits.map(visit => (
                <button
                  key={visit.id}
                  onClick={() => onVisitClick(visit.id)}
                  className="w-full flex items-center justify-between p-3 bg-zinc-900 rounded-lg hover:bg-zinc-800/70 transition-colors cursor-pointer"
                >
                  <div className="text-left">
                    <div className="text-sm text-white">
                      {new Date(visit.visit_date + 'T12:00:00').toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric'
                      })}
                    </div>
                    <div className="flex gap-1 mt-1">
                      {visit.services.map((s, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] border-zinc-700">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-medium text-white">${visit.total.toFixed(2)}</span>
                    <Badge
                      variant="secondary"
                      className={`block mt-1 text-[10px] ${
                        visit.status === 'closed' ? 'bg-green-900/30 text-green-400' : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {visit.status}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
