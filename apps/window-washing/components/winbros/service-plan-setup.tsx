'use client'

/**
 * Service Plan Setup — Onboarding customers to recurring plans
 *
 * Must be dead simple for salesmen and technicians in the field.
 * Flow: Select plan type → Select service months → Set price → Read Agreement → Send
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Calendar, Send, FileText, CheckCircle2 } from 'lucide-react'

type PlanType = 'quarterly' | 'triannual' | 'triannual_exterior' | 'monthly' | 'biannual'

const PLAN_OPTIONS: Array<{ value: PlanType; label: string; description: string }> = [
  { value: 'quarterly', label: 'Quarterly', description: '4 visits per year (every 3 months)' },
  { value: 'triannual', label: 'Triannual', description: '3 visits per year (every 4 months)' },
  { value: 'triannual_exterior', label: 'Triannual Exterior Only', description: '3 exterior-only visits per year' },
  { value: 'monthly', label: 'Monthly', description: '12 visits per year' },
  { value: 'biannual', label: 'Biannual', description: '2 visits per year (every 6 months)' },
]

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

interface ServicePlanSetupProps {
  customerName: string
  onSubmit: (data: {
    plan_type: PlanType
    service_months: number[]
    plan_price: number
    normal_price: number
  }) => Promise<void>
}

export function ServicePlanSetup({ customerName, onSubmit }: ServicePlanSetupProps) {
  const [planType, setPlanType] = useState<PlanType | ''>('')
  const [selectedMonths, setSelectedMonths] = useState<number[]>([])
  const [planPrice, setPlanPrice] = useState('')
  const [normalPrice, setNormalPrice] = useState('')
  const [agreementRead, setAgreementRead] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState(1)

  const toggleMonth = (month: number) => {
    setSelectedMonths(prev =>
      prev.includes(month) ? prev.filter(m => m !== month) : [...prev, month].sort((a, b) => a - b)
    )
  }

  const discount = normalPrice && planPrice
    ? Math.round((1 - parseFloat(planPrice) / parseFloat(normalPrice)) * 100)
    : 0

  async function handleSend() {
    if (!planType || selectedMonths.length === 0 || !planPrice) return
    setSubmitting(true)
    try {
      await onSubmit({
        plan_type: planType as PlanType,
        service_months: selectedMonths,
        plan_price: parseFloat(planPrice),
        normal_price: parseFloat(normalPrice) || parseFloat(planPrice),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="border border-zinc-800 rounded-lg bg-zinc-950 max-w-lg">
      <div className="p-4 border-b border-zinc-800">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          New Service Plan for {customerName}
        </h3>
      </div>

      <div className="p-4 space-y-4">
        {/* Step 1: Plan Type */}
        <div className="space-y-2">
          <Label className="text-zinc-300 text-sm font-medium">1. Plan Type</Label>
          <Select value={planType} onValueChange={(v) => { setPlanType(v as PlanType); setStep(Math.max(step, 2)) }}>
            <SelectTrigger>
              <SelectValue placeholder="Select plan type" />
            </SelectTrigger>
            <SelectContent>
              {PLAN_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div>
                    <span className="font-medium">{opt.label}</span>
                    <span className="text-xs text-zinc-400 ml-2">{opt.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Step 2: Service Months */}
        {step >= 2 && (
          <div className="space-y-2">
            <Label className="text-zinc-300 text-sm font-medium">2. Service Months</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {MONTHS.map((name, i) => {
                const month = i + 1
                const selected = selectedMonths.includes(month)
                return (
                  <button
                    key={month}
                    onClick={() => { toggleMonth(month); setStep(Math.max(step, 3)) }}
                    className={`p-2 rounded text-xs font-medium cursor-pointer transition-colors
                      ${selected
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                      }`}
                  >
                    {name.substring(0, 3)}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Step 3: Pricing */}
        {step >= 3 && selectedMonths.length > 0 && (
          <div className="space-y-2">
            <Label className="text-zinc-300 text-sm font-medium">3. Pricing (per visit)</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-zinc-500">Normal Price</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Regular price"
                  value={normalPrice}
                  onChange={e => setNormalPrice(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-500">Plan Price</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Discounted price"
                  value={planPrice}
                  onChange={e => { setPlanPrice(e.target.value); setStep(Math.max(step, 4)) }}
                  className="mt-1"
                />
              </div>
            </div>
            {discount > 0 && (
              <Badge variant="secondary" className="text-xs bg-green-900/30 text-green-400">
                {discount}% discount
              </Badge>
            )}
          </div>
        )}

        {/* Step 4: Agreement */}
        {step >= 4 && planPrice && (
          <div className="space-y-2">
            <Label className="text-zinc-300 text-sm font-medium">4. Agreement</Label>
            <Button
              variant={agreementRead ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAgreementRead(true)}
              className="cursor-pointer"
            >
              <FileText className="w-3 h-3 mr-1" />
              {agreementRead ? 'Agreement Read' : 'Read Agreement'}
              {agreementRead && <CheckCircle2 className="w-3 h-3 ml-1 text-green-400" />}
            </Button>
          </div>
        )}

        {/* Step 5: Send */}
        {agreementRead && (
          <Button
            onClick={handleSend}
            disabled={submitting}
            className="w-full cursor-pointer"
          >
            <Send className="w-4 h-4 mr-2" />
            {submitting ? 'Sending...' : 'Send to Customer'}
          </Button>
        )}
      </div>
    </div>
  )
}
