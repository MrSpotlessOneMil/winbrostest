import pricingData from './pricing-data.json'
import { getClientConfig } from './client-config'

export type PricingTier = 'standard' | 'deep' | 'move'
export type AddOnKey =
  | 'inside_fridge'
  | 'inside_oven'
  | 'inside_cabinets'
  | 'windows_interior'
  | 'windows_exterior'
  | 'windows_both'
  | 'pet_fee'
  | 'free_couch_cleaning'

export type PricingRow = {
  bedrooms: number
  bathrooms: number
  max_sq_ft: number
  price: number
  price_min: number
  price_max: number
  labor_hours: number
  cleaners: number
  hours_per_cleaner: number
}

export type AddOnDefinition = {
  key: AddOnKey
  label: string
  minutes: number
  flat_price?: number
  price_multiplier?: number
  included_in?: PricingTier[]
  keywords: string[]
}

export type AddOnDetectionOptions = {
  includeFreeCouchCleaning?: boolean
}

export type NoteOverrides = {
  bedrooms?: number
  bathrooms?: number
  squareFootage?: number
}

export type NotePaymentTotals = {
  depositPaid?: number
  addOnPaid?: number
}

export type NoteEstimate = {
  totalHours?: number
  hoursPerCleaner?: number
  cleaners?: number
  cleanerPay?: number
}

export const PRICING_TABLE = pricingData as { standard: PricingRow[]; deep: PricingRow[] }

export const ADD_ONS: AddOnDefinition[] = [
  {
    key: 'inside_fridge',
    label: 'Inside fridge',
    minutes: 30,
    included_in: ['move'],
    keywords: ['inside fridge', 'fridge interior', 'clean fridge', 'inside the fridge', 'fridge cleaning'],
  },
  {
    key: 'inside_oven',
    label: 'Inside oven',
    minutes: 30,
    included_in: ['move'],
    keywords: ['inside oven', 'oven interior', 'clean oven', 'inside the oven', 'oven cleaning'],
  },
  {
    key: 'inside_cabinets',
    label: 'Inside cabinets',
    minutes: 60,
    included_in: ['move'],
    keywords: ['inside cabinets', 'inside cabinet', 'inside cupboards', 'inside the cabinets', 'inside pantry'],
  },
  {
    key: 'windows_interior',
    label: 'Interior windows',
    minutes: 30,
    flat_price: 50,
    keywords: ['interior windows', 'inside windows', 'window interior'],
  },
  {
    key: 'windows_exterior',
    label: 'Exterior windows',
    minutes: 60,
    flat_price: 100,
    keywords: ['exterior windows', 'outside windows', 'window exterior'],
  },
  {
    key: 'windows_both',
    label: 'Interior + exterior windows',
    minutes: 90,
    flat_price: 150,
    keywords: ['both windows', 'interior and exterior windows', 'inside and outside windows'],
  },
  {
    key: 'pet_fee',
    label: 'Pet fee',
    minutes: 0,
    flat_price: 25,
    keywords: ['pet fee', 'pets', 'dog', 'dogs', 'cat', 'cats', 'puppy', 'puppies', 'kitten', 'kittens'],
  },
  {
    key: 'free_couch_cleaning',
    label: 'Free couch cleaning',
    minutes: 30,
    flat_price: 0,
    keywords: [
      'free couch cleaning',
      'couch cleaning',
      'sofa cleaning',
      'sectional cleaning',
      'upholstery cleaning',
      'clean my couch',
      'clean the couch',
      'clean our couch',
      'clean my sofa',
      'clean the sofa',
      'clean my sectional',
      'clean the sectional',
      'clean the upholstery',
    ],
  },
]

export function getAddOnDefinition(key: AddOnKey): AddOnDefinition | undefined {
  return ADD_ONS.find(addon => addon.key === key)
}

export function getAddOnLabel(key: AddOnKey): string {
  return getAddOnDefinition(key)?.label || key
}

function shouldIncludeFreeCouchCleaning(options?: AddOnDetectionOptions): boolean {
  if (typeof options?.includeFreeCouchCleaning === 'boolean') {
    return options.includeFreeCouchCleaning
  }
  return getClientConfig().features.freeCouchCleaning
}

export function detectAddOnsFromText(
  text: string,
  options?: AddOnDetectionOptions
): AddOnKey[] {
  const lower = text.toLowerCase()
  const found = new Set<AddOnKey>()
  const allowFreeCouchCleaning = shouldIncludeFreeCouchCleaning(options)

  if (lower.includes('window')) {
    const hasInterior = lower.includes('interior') || lower.includes('inside')
    const hasExterior = lower.includes('exterior') || lower.includes('outside')
    const hasBoth = lower.includes('both')

    if (hasBoth || (hasInterior && hasExterior)) {
      found.add('windows_both')
    } else if (hasExterior) {
      found.add('windows_exterior')
    } else {
      found.add('windows_interior')
    }
  }

  if (/\b(pet|pets|dog|dogs|cat|cats|puppy|puppies|kitten|kittens)\b/i.test(lower)) {
    found.add('pet_fee')
  }

  for (const addon of ADD_ONS) {
    if (addon.key.startsWith('windows_') || addon.key === 'pet_fee') {
      continue
    }
    if (addon.key === 'free_couch_cleaning' && !allowFreeCouchCleaning) {
      continue
    }
    if (addon.keywords.some(keyword => lower.includes(keyword))) {
      found.add(addon.key)
    }
  }

  return Array.from(found)
}

export function getAddOnsFromNotes(notes?: string | null): AddOnKey[] {
  if (!notes) return []

  const allowFreeCouchCleaning = shouldIncludeFreeCouchCleaning()
  const found = new Set<AddOnKey>()
  const tagRegex = /add[-\s]?on:\s*([a-z_]+)/gi
  let match: RegExpExecArray | null

  while ((match = tagRegex.exec(notes)) !== null) {
    const key = match[1]?.toLowerCase() as AddOnKey
    if (key === 'free_couch_cleaning' && !allowFreeCouchCleaning) {
      continue
    }
    if (getAddOnDefinition(key)) {
      found.add(key)
    }
  }

  detectAddOnsFromText(notes, { includeFreeCouchCleaning: allowFreeCouchCleaning })
    .forEach(key => found.add(key))

  return Array.from(found)
}

export function mergeAddOnsIntoNotes(
  notes: string | null | undefined,
  addOns: AddOnKey[]
): string {
  const allowFreeCouchCleaning = shouldIncludeFreeCouchCleaning()
  const filteredAddOns = allowFreeCouchCleaning
    ? addOns
    : addOns.filter(key => key !== 'free_couch_cleaning')

  const existing = new Set(getAddOnsFromNotes(notes || ''))
  const toAdd = filteredAddOns.filter(key => !existing.has(key))

  if (toAdd.length === 0) {
    return notes || ''
  }

  const base = notes ? `${notes}\n` : ''
  const tagLines = toAdd.map(key => `ADD-ON: ${key}`).join('\n')
  return `${base}${tagLines}`
}

export function getOverridesFromNotes(notes?: string | null): NoteOverrides {
  if (!notes) return {}
  const overrides: NoteOverrides = {}
  const regex = /override:\s*([a-z_]+)\s*=\s*([0-9.]+)/gi

  let match: RegExpExecArray | null
  while ((match = regex.exec(notes)) !== null) {
    const key = match[1]?.toLowerCase()
    const value = Number(match[2])
    if (!Number.isFinite(value) || value <= 0) continue

    if (key === 'bedrooms') {
      overrides.bedrooms = value
    } else if (key === 'bathrooms') {
      overrides.bathrooms = value
    } else if (key === 'square_footage' || key === 'squarefootage') {
      overrides.squareFootage = value
    }
  }

  return overrides
}

export function mergeOverridesIntoNotes(
  notes: string | null | undefined,
  overrides: NoteOverrides
): string {
  const entries: Array<[string, number]> = []
  if (typeof overrides.bedrooms === 'number') {
    entries.push(['bedrooms', overrides.bedrooms])
  }
  if (typeof overrides.bathrooms === 'number') {
    entries.push(['bathrooms', overrides.bathrooms])
  }
  if (typeof overrides.squareFootage === 'number') {
    entries.push(['square_footage', overrides.squareFootage])
  }

  if (entries.length === 0) {
    return notes || ''
  }

  const lines = notes ? notes.split('\n') : []

  for (const [key, value] of entries) {
    const tag = `OVERRIDE: ${key}=`
    const nextValue = `${tag}${value}`
    let replaced = false

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (line.trim().toLowerCase().startsWith(tag.toLowerCase())) {
        lines[i] = nextValue
        replaced = true
        break
      }
    }

    if (!replaced) {
      lines.push(nextValue)
    }
  }

  return lines.join('\n')
}

export function getPaymentTotalsFromNotes(notes?: string | null): NotePaymentTotals {
  if (!notes) return {}
  const totals: NotePaymentTotals = {}
  const regex = /payment:\s*([a-z_]+)\s*=\s*([0-9.]+)/gi

  let match: RegExpExecArray | null
  while ((match = regex.exec(notes)) !== null) {
    const key = match[1]?.toLowerCase()
    const value = Number(match[2])
    if (!Number.isFinite(value) || value < 0) continue

    if (key === 'deposit_paid') {
      totals.depositPaid = value
    } else if (key === 'addon_paid') {
      totals.addOnPaid = value
    }
  }

  return totals
}

export function mergePaymentTotalsIntoNotes(
  notes: string | null | undefined,
  totals: NotePaymentTotals
): string {
  const entries: Array<[string, number]> = []
  if (typeof totals.depositPaid === 'number') {
    entries.push(['deposit_paid', totals.depositPaid])
  }
  if (typeof totals.addOnPaid === 'number') {
    entries.push(['addon_paid', totals.addOnPaid])
  }

  if (entries.length === 0) {
    return notes || ''
  }

  const lines = notes ? notes.split('\n') : []

  for (const [key, value] of entries) {
    const tag = `PAYMENT: ${key}=`
    const nextValue = `${tag}${Math.round(value * 100) / 100}`
    let replaced = false

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (line.trim().toLowerCase().startsWith(tag.toLowerCase())) {
        lines[i] = nextValue
        replaced = true
        break
      }
    }

    if (!replaced) {
      lines.push(nextValue)
    }
  }

  return lines.join('\n')
}

export function mergeEstimateIntoNotes(
  notes: string | null | undefined,
  estimate: NoteEstimate
): string {
  const entries: Array<[string, number]> = []
  if (typeof estimate.totalHours === 'number') {
    entries.push(['total', estimate.totalHours])
  }
  if (typeof estimate.hoursPerCleaner === 'number') {
    entries.push(['per_cleaner', estimate.hoursPerCleaner])
  }
  if (typeof estimate.cleaners === 'number') {
    entries.push(['cleaners', estimate.cleaners])
  }
  if (typeof estimate.cleanerPay === 'number') {
    entries.push(['cleaner_pay', estimate.cleanerPay])
  }

  if (entries.length === 0) {
    return notes || ''
  }

  const lines = notes ? notes.split('\n') : []

  for (const [key, value] of entries) {
    const prefix = key === 'cleaner_pay' ? 'PAY' : 'HOURS'
    const tag = `${prefix}: ${key}=`
    const rounded = Math.round(value * 100) / 100
    const nextValue = `${tag}${rounded}`
    let replaced = false

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (line.trim().toLowerCase().startsWith(tag.toLowerCase())) {
        lines[i] = nextValue
        replaced = true
        break
      }
    }

    if (!replaced) {
      lines.push(nextValue)
    }
  }

  return lines.join('\n')
}

export function getEstimateFromNotes(notes?: string | null): NoteEstimate {
  if (!notes) return {}
  const estimate: NoteEstimate = {}

  // Extract HOURS tags
  const hoursRegex = /HOURS:\s*([a-z_]+)\s*=\s*([0-9.]+)/gi
  let match: RegExpExecArray | null
  while ((match = hoursRegex.exec(notes)) !== null) {
    const key = match[1]?.toLowerCase()
    const value = Number(match[2])
    if (!Number.isFinite(value)) continue

    if (key === 'total') {
      estimate.totalHours = value
    } else if (key === 'per_cleaner') {
      estimate.hoursPerCleaner = value
    } else if (key === 'cleaners') {
      estimate.cleaners = value
    }
  }

  // Extract PAY tag
  const payRegex = /PAY:\s*cleaner_pay\s*=\s*([0-9.]+)/i
  const payMatch = payRegex.exec(notes)
  if (payMatch) {
    const value = Number(payMatch[1])
    if (Number.isFinite(value)) {
      estimate.cleanerPay = value
    }
  }

  return estimate
}

export function splitBathroomCount(
  value?: number | null
): { stored?: number; override?: number } {
  if (value === null || value === undefined) {
    return {}
  }
  const raw = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(raw) || raw <= 0) {
    return {}
  }

  const normalized = Math.round(raw * 2) / 2
  const stored = Math.floor(normalized)
  if (stored <= 0) {
    return {}
  }
  if (normalized !== stored) {
    return { stored, override: normalized }
  }
  return { stored: normalized }
}
