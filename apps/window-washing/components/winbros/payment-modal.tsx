'use client'

/**
 * Payment Collection Modal for WinBros
 *
 * Options:
 * 1. Charge saved card (full amount)
 * 2. Enter new card + charge
 * 3. Mark cash/check + record amount
 *
 * Also records tip amount.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { CreditCard, Banknote, FileText, DollarSign } from 'lucide-react'

type PaymentType = 'card' | 'cash' | 'check'

interface PaymentModalProps {
  open: boolean
  onClose: () => void
  totalAmount: number
  onSubmit: (data: {
    payment_type: PaymentType
    payment_amount: number
    tip_amount: number
  }) => Promise<void>
  hasSavedCard?: boolean
}

export function PaymentModal({
  open,
  onClose,
  totalAmount,
  onSubmit,
  hasSavedCard,
}: PaymentModalProps) {
  const [paymentType, setPaymentType] = useState<PaymentType | null>(null)
  const [amount, setAmount] = useState(totalAmount.toFixed(2))
  const [tipAmount, setTipAmount] = useState('0')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (!paymentType) return
    setSubmitting(true)
    try {
      await onSubmit({
        payment_type: paymentType,
        payment_amount: parseFloat(amount),
        tip_amount: parseFloat(tipAmount) || 0,
      })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-950 border-zinc-800 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Collect Payment</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Total due: ${totalAmount.toFixed(2)}
          </DialogDescription>
        </DialogHeader>

        {/* Payment type selection */}
        <div className="space-y-3">
          <Label className="text-zinc-300 text-sm">Payment Method</Label>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => { setPaymentType('card'); setAmount(totalAmount.toFixed(2)) }}
              className={`flex flex-col items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors
                ${paymentType === 'card'
                  ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                }`}
            >
              <CreditCard className="w-5 h-5" />
              <span className="text-xs font-medium">Card</span>
            </button>
            <button
              onClick={() => setPaymentType('cash')}
              className={`flex flex-col items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors
                ${paymentType === 'cash'
                  ? 'border-green-500 bg-green-500/10 text-green-400'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                }`}
            >
              <Banknote className="w-5 h-5" />
              <span className="text-xs font-medium">Cash</span>
            </button>
            <button
              onClick={() => setPaymentType('check')}
              className={`flex flex-col items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors
                ${paymentType === 'check'
                  ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                }`}
            >
              <FileText className="w-5 h-5" />
              <span className="text-xs font-medium">Check</span>
            </button>
          </div>
        </div>

        {paymentType && (
          <>
            {/* Amount */}
            <div className="space-y-2">
              <Label className="text-zinc-300 text-sm">Amount</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <Input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            {/* Tip */}
            <div className="space-y-2">
              <Label className="text-zinc-300 text-sm">Tip Amount</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <Input
                  type="number"
                  step="0.01"
                  value={tipAmount}
                  onChange={e => setTipAmount(e.target.value)}
                  className="pl-8"
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Total summary */}
            <div className="bg-zinc-900 rounded-lg p-3 space-y-1">
              <div className="flex justify-between text-sm text-zinc-400">
                <span>Service Total</span>
                <span>${parseFloat(amount).toFixed(2)}</span>
              </div>
              {parseFloat(tipAmount) > 0 && (
                <div className="flex justify-between text-sm text-zinc-400">
                  <span>Tip</span>
                  <span>${parseFloat(tipAmount).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold text-white pt-1 border-t border-zinc-800">
                <span>Grand Total</span>
                <span>${(parseFloat(amount) + (parseFloat(tipAmount) || 0)).toFixed(2)}</span>
              </div>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={submitting || !amount}
              className="w-full cursor-pointer"
            >
              {submitting ? 'Processing...' : `Collect $${(parseFloat(amount) + (parseFloat(tipAmount) || 0)).toFixed(2)}`}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
