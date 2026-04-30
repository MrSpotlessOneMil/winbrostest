/**
 * Service-plan price formulas (Phase J — Blake call 2026-04-28).
 *
 * A service_plan_templates row carries a `pricing_formula` JSONB. The
 * QuoteBuilder calls `computePlanPrice` whenever the salesman attaches
 * a plan or edits the exterior-windows line, so the recurring price
 * stays in sync with the quote's exterior-window total.
 *
 * Two shapes today; admin-editable later via Control Center:
 *   - { kind: "flat" } → use template.recurring_price as-is
 *   - { kind: "exterior_multiplier", factor: number } → factor ×
 *     (sum of all exterior_windows line items on the quote)
 *
 * Unknown kinds fall back to `flat` so a future formula type doesn't
 * crash the builder. Negative or non-finite results clamp to 0.
 */

export type PricingFormula =
  | { kind: "flat" }
  | { kind: "exterior_multiplier"; factor: number }

export interface ExteriorWindowsLine {
  price: number
  quantity?: number | null
  kind: "exterior_windows" | "standard"
}

export function exteriorWindowsTotal(lines: readonly ExteriorWindowsLine[]): number {
  let total = 0
  for (const li of lines) {
    if (li.kind !== "exterior_windows") continue
    const qty = Number(li.quantity ?? 1) || 0
    const price = Number(li.price) || 0
    total += qty * price
  }
  return Math.round(total * 100) / 100
}

export function computePlanPrice(args: {
  templateRecurringPrice: number
  formula: PricingFormula | null | undefined
  lines: readonly ExteriorWindowsLine[]
}): number {
  const f = args.formula ?? { kind: "flat" }
  if (f.kind === "exterior_multiplier") {
    const factor = Number(f.factor)
    if (!Number.isFinite(factor) || factor <= 0) return 0
    const ext = exteriorWindowsTotal(args.lines)
    return Math.round(ext * factor * 100) / 100
  }
  // flat (or unknown — safe default)
  const flat = Number(args.templateRecurringPrice)
  if (!Number.isFinite(flat) || flat < 0) return 0
  return Math.round(flat * 100) / 100
}
