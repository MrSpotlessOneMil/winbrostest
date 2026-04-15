/**
 * service-scope.ts — Single source of truth for tier definitions
 *
 * Defines what tasks are included in each cleaning tier (standard, deep, move).
 * Every UI surface, pricing engine, and cleaner portal imports from here.
 */

// ---------------------------------------------------------------------------
// 1. Standard base tasks — included in EVERY cleaning (standard, deep, move)
//    These are NOT add-ons. They should never appear in paid addon lists.
// ---------------------------------------------------------------------------

export interface BaseTask {
  key: string
  label: string
}

export const STANDARD_BASE_TASKS: readonly BaseTask[] = [
  { key: 'kitchen_surfaces', label: 'Kitchen surfaces & countertops' },
  { key: 'bathroom_sanitize', label: 'Bathroom cleaning & sanitization' },
  { key: 'vacuum_mop', label: 'Vacuum & mop all floors' },
  { key: 'dusting', label: 'Dusting surfaces & furniture' },
  { key: 'trash_removal', label: 'Trash removal & bag replacement' },
] as const

// ---------------------------------------------------------------------------
// 2. Tier upgrades — additional addon keys each tier includes beyond standard
// ---------------------------------------------------------------------------

export const TIER_UPGRADES: Record<string, string[]> = {
  deep: [
    'inside_fridge',
    'inside_oven',
    'inside_microwave',
    'baseboards',
    'ceiling_fans',
    'light_fixtures',
    'window_sills',
  ],
  move: [
    'inside_fridge',
    'inside_oven',
    'inside_microwave',
    'inside_cabinets',
    'inside_dishwasher',
    'range_hood',
    'baseboards',
    'ceiling_fans',
    'light_fixtures',
    'window_sills',
    'wall_cleaning',
  ],
}

// ---------------------------------------------------------------------------
// 3. Derived sets for fast lookups
// ---------------------------------------------------------------------------

export const STANDARD_BASE_KEYS: Set<string> = new Set(
  STANDARD_BASE_TASKS.map((t) => t.key)
)

// ---------------------------------------------------------------------------
// 4. isIncludedInTier — true if key is a base task OR in the tier's upgrades
// ---------------------------------------------------------------------------

export function isIncludedInTier(addonKey: string, tier: string): boolean {
  if (STANDARD_BASE_KEYS.has(addonKey)) return true
  const upgrades = TIER_UPGRADES[tier]
  if (!upgrades) return false
  return upgrades.includes(addonKey)
}

// ---------------------------------------------------------------------------
// 5. getPaidAddons — filters out base tasks and tier-included items
//    Handles both string[] and {key: string, quantity?: number}[] formats
// ---------------------------------------------------------------------------

type AddonInput = string | { key: string; quantity?: number; [k: string]: unknown }

export function getPaidAddons<T extends AddonInput>(
  selectedAddons: T[],
  tier: string
): T[] {
  return selectedAddons.filter((addon) => {
    const key = typeof addon === 'string' ? addon : addon.key
    return !isIncludedInTier(key, tier)
  })
}

// ---------------------------------------------------------------------------
// 6. getBaseChecklist — returns base checklist items for cleaner portal
//    Includes standard base tasks + tier upgrade items with labels
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  key: string
  label: string
  source: 'base' | 'tier_upgrade'
}

/** Addon key → human-readable label for tier upgrades shown in cleaner checklists */
const UPGRADE_LABELS: Record<string, string> = {
  inside_fridge: 'Inside fridge',
  inside_oven: 'Inside oven',
  inside_microwave: 'Inside microwave',
  inside_cabinets: 'Inside cabinets',
  inside_dishwasher: 'Inside dishwasher',
  range_hood: 'Range hood',
  baseboards: 'Baseboards',
  ceiling_fans: 'Ceiling fans',
  light_fixtures: 'Light fixtures',
  window_sills: 'Window sills',
  wall_cleaning: 'Wall cleaning',
}

export function getBaseChecklist(tier: string): ChecklistItem[] {
  const items: ChecklistItem[] = STANDARD_BASE_TASKS.map((t) => ({
    key: t.key,
    label: t.label,
    source: 'base' as const,
  }))

  const upgrades = TIER_UPGRADES[tier]
  if (upgrades) {
    for (const key of upgrades) {
      items.push({
        key,
        label: UPGRADE_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        source: 'tier_upgrade' as const,
      })
    }
  }

  return items
}
