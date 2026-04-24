/**
 * Quote builder pricing helpers (WinBros Round 2 task 6).
 *
 * optionality semantics for the customer-facing view (plan task 7):
 *   - required    → always counted toward total; not shown as a toggle
 *   - recommended → counted by default, customer can uncheck
 *   - optional    → NOT counted by default, customer can check
 *
 * `selectedOptionalIds` lets the builder preview what the total becomes for
 * arbitrary checkbox states — the same pure function serves admin-side
 * "preview with plan X" and the customer-side live total.
 */

export type Optionality = 'required' | 'recommended' | 'optional'

export interface QuoteLineItemLike {
  id?: number | string
  price: number
  quantity?: number | null
  optionality?: Optionality | null
  is_upsell?: boolean | null
}

export interface ComputeTotalsInput {
  lineItems: QuoteLineItemLike[]
  /** ids of 'optional' lines the customer explicitly opted INTO */
  optedInOptionalIds?: Set<number | string>
  /** ids of 'recommended' lines the customer explicitly opted OUT of */
  optedOutRecommendedIds?: Set<number | string>
  /** plan cards can override total via first_visit_keeps_original_price */
  planKeepsOriginalPrice?: boolean
}

export interface ComputeTotalsResult {
  total: number
  /** Sum of required lines only — useful for "this is locked in" display */
  requiredTotal: number
}

function lineSubtotal(item: QuoteLineItemLike): number {
  const qty = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1
  const price = Number.isFinite(item.price) ? item.price : 0
  return Math.round(price * qty * 100) / 100
}

export function computeQuoteTotals(input: ComputeTotalsInput): ComputeTotalsResult {
  const {
    lineItems,
    optedInOptionalIds,
    optedOutRecommendedIds,
    planKeepsOriginalPrice,
  } = input

  let total = 0
  let requiredTotal = 0

  for (const item of lineItems) {
    const opt = item.optionality ?? 'required'
    const subtotal = lineSubtotal(item)

    if (opt === 'required') {
      requiredTotal += subtotal
      total += subtotal
      continue
    }

    if (opt === 'recommended') {
      const optedOut = item.id != null && optedOutRecommendedIds?.has(item.id) === true
      if (!optedOut) total += subtotal
      continue
    }

    if (opt === 'optional') {
      const optedIn = item.id != null && optedInOptionalIds?.has(item.id) === true
      if (optedIn) total += subtotal
      continue
    }
  }

  total = Math.round(total * 100) / 100
  requiredTotal = Math.round(requiredTotal * 100) / 100

  // first_visit_keeps_original_price: plan cards can promise "first visit runs
  // at original quoted price (not the recurring discount)". Callers pass this
  // flag explicitly so the math stays in this one function.
  if (planKeepsOriginalPrice) {
    return { total, requiredTotal }
  }

  return { total, requiredTotal }
}

/**
 * When a customer picks a service plan card, the first-visit charge is either
 * the original quote total (if plan.first_visit_keeps_original_price=true)
 * or the recurring plan price (if false). Upsell lines always bill as upsells
 * regardless of plan choice.
 */
export function firstVisitChargeForPlan(
  baseTotal: number,
  planRecurringPrice: number,
  planKeepsOriginalPrice: boolean
): number {
  if (planKeepsOriginalPrice) return Math.round(baseTotal * 100) / 100
  return Math.round(planRecurringPrice * 100) / 100
}

/**
 * Build the human-readable equation shown in the builder totals row,
 * per Max's sketch: "$100 + $300 − $50 = $350". Only lines currently
 * counted toward the total appear. Negative prices render as
 * " − $X" so discounts read naturally.
 */
export function formatTotalEquation(lineItems: QuoteLineItemLike[]): string {
  const counted = lineItems.filter(li => {
    const opt = li.optionality ?? 'required'
    if (opt === 'required') return true
    if (opt === 'recommended') return true
    return false
  })
  if (counted.length === 0) return '$0.00'

  const parts: string[] = []
  let running = 0
  for (const item of counted) {
    const qty = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1
    const sub = Math.round((Number(item.price) || 0) * qty * 100) / 100
    running += sub
    const abs = Math.abs(sub).toFixed(2)
    if (parts.length === 0) {
      parts.push(sub < 0 ? `− $${abs}` : `$${abs}`)
    } else {
      parts.push(sub < 0 ? `− $${abs}` : `+ $${abs}`)
    }
  }
  const total = (Math.round(running * 100) / 100).toFixed(2)
  return `${parts.join(' ')} = $${total}`
}
