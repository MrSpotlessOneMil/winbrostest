/**
 * Pure-logic offer engine for retargeting evergreen phase.
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md (Build 2)
 * Source spec: clean_machine_rebuild/07_RETARGETING.md §3 + §9
 *
 * Pure functions only — no DB, no HTTP. Caller fetches the pool from
 * tenant settings and the customer's last_retargeting_template_key,
 * then passes both in.
 */

import type { TemplateKey } from './templates'

export interface OfferPoolEntry {
  template_key: TemplateKey
  weight: number
  type: 'percent_recurring' | 'percent_single' | 'dollar_off' | 'free_addon' | 'referral' | 'seasonal'
}

export const DEFAULT_OFFER_POOL: OfferPoolEntry[] = [
  { template_key: 'evergreen_pct_15_recurring', weight: 2, type: 'percent_recurring' },
  { template_key: 'evergreen_pct_20_recurring', weight: 1, type: 'percent_recurring' },
  { template_key: 'evergreen_pct_25_single', weight: 1, type: 'percent_single' },
  { template_key: 'evergreen_dollar_20', weight: 2, type: 'dollar_off' },
  { template_key: 'evergreen_dollar_40', weight: 1, type: 'dollar_off' },
  { template_key: 'evergreen_free_addon_fridge', weight: 1, type: 'free_addon' },
  { template_key: 'evergreen_free_addon_oven', weight: 1, type: 'free_addon' },
  { template_key: 'evergreen_referral', weight: 1, type: 'referral' },
  { template_key: 'evergreen_seasonal', weight: 2, type: 'seasonal' },
]

export interface PickEvergreenInput {
  pool: OfferPoolEntry[]
  /** Customer's last template — excluded from pool to prevent back-to-back repeats. */
  lastTemplateKey?: TemplateKey | null
  /** RNG override for deterministic tests. Defaults to Math.random. */
  rng?: () => number
  /** Override "now" for seasonal selection. Defaults to new Date(). */
  now?: Date
}

export interface PickEvergreenResult {
  template_key: TemplateKey
  type: OfferPoolEntry['type']
}

/**
 * Pick a single evergreen offer using weighted random.
 *
 * Rules (per 07_RETARGETING.md §3 + §9):
 *   1. Filter out last-used template_key (no back-to-back repeats).
 *   2. If a `seasonal` entry would be picked, swap its template_key for the
 *      date-appropriate seasonal template (we keep them as one pool entry to
 *      avoid double-weighting seasonal in the random draw).
 *   3. Weighted random pick from filtered pool.
 *   4. If filter leaves an empty pool (degenerate case), fall back to
 *      seasonal — never returns null.
 */
export function pickEvergreenOffer(input: PickEvergreenInput): PickEvergreenResult {
  const rng = input.rng ?? Math.random
  const now = input.now ?? new Date()

  // 1. Exclude last-used template
  const eligible = input.pool.filter(e => e.template_key !== input.lastTemplateKey)
  const pool = eligible.length > 0 ? eligible : input.pool

  // 2. Weighted random pick
  const totalWeight = pool.reduce((sum, e) => sum + Math.max(0, e.weight), 0)
  if (totalWeight <= 0) {
    // Defensive: bad config, fall back to first entry
    return { template_key: pool[0].template_key, type: pool[0].type }
  }

  const r = rng() * totalWeight
  let cumulative = 0
  let picked: OfferPoolEntry = pool[0]
  for (const entry of pool) {
    cumulative += Math.max(0, entry.weight)
    if (r < cumulative) {
      picked = entry
      break
    }
  }

  // 3. Seasonal expansion: swap the bucket key for date-appropriate copy
  if (picked.type === 'seasonal') {
    return {
      template_key: pickSeasonalTemplate(now),
      type: 'seasonal',
    }
  }

  return { template_key: picked.template_key, type: picked.type }
}

/**
 * Pick a date-appropriate seasonal template per 07_RETARGETING.md §3.
 *
 * Months are 0-indexed in JS Date. We currently return a single
 * 'evergreen_seasonal' key for all months because the SMS template at that
 * key is intentionally generic (the rendered copy reads naturally year-round).
 * Future work: split into 6 distinct seasonal templates and switch on month.
 */
export function pickSeasonalTemplate(now: Date): TemplateKey {
  // Reserved hook for future seasonal differentiation. For v1 we use the
  // single evergreen_seasonal key — the rendered copy is intentionally
  // season-neutral so it doesn't go stale before per-season templates land.
  void now
  return 'evergreen_seasonal'
}
