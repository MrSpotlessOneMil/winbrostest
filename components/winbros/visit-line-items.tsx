'use client'

/**
 * Visit Line Items — Shows original quote services (locked) + technician upsells
 *
 * Two sections:
 * 1. Original Quote Services — locked, credited to salesman
 * 2. Technician Upsells — addable via + button during active visit, credited to technician
 *
 * Upsells can ONLY be added when visit status is "in_progress".
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, Lock, User, Wrench } from 'lucide-react'

interface LineItem {
  id: number
  service_name: string
  description: string | null
  price: number
  revenue_type: 'original_quote' | 'technician_upsell'
  added_by_cleaner_id: number | null
}

interface VisitLineItemsProps {
  items: LineItem[]
  canAddUpsell: boolean
  onAddUpsell: (data: { service_name: string; price: number; description?: string }) => Promise<void>
}

export function VisitLineItems({ items, canAddUpsell, onAddUpsell }: VisitLineItemsProps) {
  const [showForm, setShowForm] = useState(false)
  const [newService, setNewService] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [adding, setAdding] = useState(false)

  const originalItems = items.filter(i => i.revenue_type === 'original_quote')
  const upsellItems = items.filter(i => i.revenue_type === 'technician_upsell')

  const originalTotal = originalItems.reduce((sum, i) => sum + Number(i.price), 0)
  const upsellTotal = upsellItems.reduce((sum, i) => sum + Number(i.price), 0)
  const grandTotal = originalTotal + upsellTotal

  async function handleAddUpsell() {
    if (!newService.trim() || !newPrice) return
    setAdding(true)
    try {
      await onAddUpsell({
        service_name: newService.trim(),
        price: parseFloat(newPrice),
      })
      setNewService('')
      setNewPrice('')
      setShowForm(false)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="border border-zinc-800 rounded-lg bg-zinc-950">
      {/* Original Quote Services */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center gap-2 mb-3">
          <Lock className="w-4 h-4 text-zinc-500" />
          <h3 className="text-sm font-semibold text-zinc-300">Original Quote Services</h3>
          <Badge variant="secondary" className="text-xs bg-zinc-800 text-zinc-400">
            <User className="w-3 h-3 mr-1" />
            Salesman
          </Badge>
        </div>
        {originalItems.length === 0 ? (
          <p className="text-xs text-zinc-500">No quote services</p>
        ) : (
          <div className="space-y-2">
            {originalItems.map(item => (
              <div key={item.id} className="flex justify-between items-center py-1.5">
                <div>
                  <span className="text-sm text-white">{item.service_name}</span>
                  {item.description && (
                    <span className="text-xs text-zinc-500 ml-2">{item.description}</span>
                  )}
                </div>
                <span className="text-sm font-medium text-white">
                  ${Number(item.price).toFixed(2)}
                </span>
              </div>
            ))}
            <div className="flex justify-between pt-2 border-t border-zinc-800">
              <span className="text-xs text-zinc-400">Quote Subtotal</span>
              <span className="text-sm font-semibold text-white">${originalTotal.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Technician Upsells */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-semibold text-zinc-300">Technician Upsells</h3>
            <Badge variant="secondary" className="text-xs bg-zinc-800 text-zinc-400">
              <Wrench className="w-3 h-3 mr-1" />
              Tech
            </Badge>
          </div>
          {canAddUpsell && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowForm(true)}
              className="text-xs cursor-pointer"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Upsell
            </Button>
          )}
        </div>

        {!canAddUpsell && upsellItems.length === 0 && (
          <p className="text-xs text-zinc-500">
            {canAddUpsell ? 'No upsells yet' : 'Upsells can only be added during an active visit'}
          </p>
        )}

        {upsellItems.length > 0 && (
          <div className="space-y-2">
            {upsellItems.map(item => (
              <div key={item.id} className="flex justify-between items-center py-1.5">
                <div>
                  <span className="text-sm text-white">{item.service_name}</span>
                  <Badge variant="outline" className="text-[10px] ml-2 border-amber-700 text-amber-500">
                    UPSELL
                  </Badge>
                </div>
                <span className="text-sm font-medium text-white">
                  ${Number(item.price).toFixed(2)}
                </span>
              </div>
            ))}
            <div className="flex justify-between pt-2 border-t border-zinc-800">
              <span className="text-xs text-zinc-400">Upsell Subtotal</span>
              <span className="text-sm font-semibold text-amber-400">${upsellTotal.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Add upsell form */}
        {showForm && canAddUpsell && (
          <div className="mt-3 p-3 bg-zinc-900 rounded-lg space-y-2">
            <Input
              placeholder="Service name"
              value={newService}
              onChange={e => setNewService(e.target.value)}
              className="text-sm"
            />
            <Input
              placeholder="Price"
              type="number"
              step="0.01"
              value={newPrice}
              onChange={e => setNewPrice(e.target.value)}
              className="text-sm"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleAddUpsell}
                disabled={adding || !newService || !newPrice}
                className="cursor-pointer"
              >
                {adding ? 'Adding...' : 'Add'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowForm(false)}
                className="cursor-pointer"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Grand Total */}
      <div className="flex justify-between p-4 border-t border-zinc-700 bg-zinc-900 rounded-b-lg">
        <span className="text-sm font-semibold text-white">Total</span>
        <span className="text-lg font-bold text-white">${grandTotal.toFixed(2)}</span>
      </div>
    </div>
  )
}
