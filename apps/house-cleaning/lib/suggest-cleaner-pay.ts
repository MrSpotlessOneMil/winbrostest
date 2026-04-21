/**
 * Client-side cleaner-pay suggestion helper.
 *
 * Wraps the per-tenant pay rules stored in `workflow_config.cleaner_pay_*`
 * (the Service Editor settings page writes these via /api/actions/settings).
 * Returns both a suggested amount and a human-readable description string
 * so the Create/Edit Job form can show "(auto: $140 — 35% of job price)".
 *
 * Mirrors the logic of `calculateCleanerPay` in packages/core/src/tenant.ts
 * but consumes only the nested API shape (`{ model, percentage,
 * hourly_standard, hourly_deep }`) that /api/actions/settings returns — so
 * this helper is safe to call in a client component without pulling in the
 * full Tenant type.
 */

export type CleanerPayConfig = {
  model: 'percentage' | 'hourly' | null
  percentage: number | null
  hourly_standard: number | null
  hourly_deep: number | null
}

export type PaySuggestion = {
  amount: number | null
  ruleDescription: string | null
}

function isDeepOrMove(serviceType?: string): boolean {
  if (!serviceType) return false
  const s = serviceType.toLowerCase()
  return s.includes('deep') || s.includes('move')
}

export function suggestCleanerPay(
  config: CleanerPayConfig | null | undefined,
  input: { price?: number | string; serviceType?: string; hours?: number | string }
): PaySuggestion {
  if (!config) return { amount: null, ruleDescription: null }

  const price = typeof input.price === 'string' ? parseFloat(input.price) : input.price
  const hours = typeof input.hours === 'string' ? parseFloat(input.hours) : input.hours

  // Infer model when `model` is null but percentage is populated (legacy rows)
  const model = config.model || (config.percentage ? 'percentage' : null)

  if (model === 'percentage' && config.percentage && price && price > 0) {
    const amount = Math.round(price * (config.percentage / 100))
    return {
      amount,
      ruleDescription: `${config.percentage}% of job price`,
    }
  }

  if (model === 'hourly' && hours && hours > 0) {
    const deep = isDeepOrMove(input.serviceType)
    const rate = deep
      ? (config.hourly_deep ?? config.hourly_standard ?? null)
      : (config.hourly_standard ?? null)
    if (!rate) return { amount: null, ruleDescription: null }
    const amount = Math.round(hours * rate)
    const tierLabel = deep ? 'deep' : 'standard'
    return {
      amount,
      ruleDescription: `${hours}hr × $${rate}/hr ${tierLabel}`,
    }
  }

  return { amount: null, ruleDescription: null }
}
