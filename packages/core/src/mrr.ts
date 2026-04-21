/**
 * MRR computation — pure functions with no Supabase dependency so they can
 * be unit-tested cheaply and reused on any code path that needs monthly
 * recurring revenue projection.
 *
 * Only three cadences are supported today, matching the `jobs.frequency`
 * enum in production (`weekly` / `bi-weekly` / `monthly` / `one-time`).
 * One-time jobs and any unknown cadence are excluded from MRR.
 */

export const CADENCE_FACTOR: Record<string, number> = {
  weekly: 4.333,
  "bi-weekly": 2.167,
  monthly: 1.0,
}

export interface RecurringSeries {
  id?: string | number
  price: number | string | null
  frequency: string | null
  created_at?: string | Date | null
  paused_at?: string | Date | null
  /**
   * Only parent rows are passed in for MRR math (parent_job_id IS NULL).
   * Callers must filter before handing the array to computeMrr / computeMrrTrend.
   */
}

/**
 * Current canonical MRR: sum of (price * cadence factor) across active
 * recurring parent series.
 */
export function computeMrr(series: RecurringSeries[]): {
  mrr: number
  activeCount: number
} {
  let mrr = 0
  let active = 0
  for (const s of series) {
    const factor = s.frequency ? CADENCE_FACTOR[s.frequency] : undefined
    if (!factor) continue
    if (s.paused_at) continue // excluded even without asOf — paused is paused
    const price = Number(s.price || 0)
    if (!price) continue
    mrr += price * factor
    active++
  }
  return { mrr: Math.round(mrr), activeCount: active }
}

/**
 * MRR as-of a point in time. A series counts only when it existed
 * (`created_at <= asOf`) and wasn't paused by that date
 * (`paused_at == null || paused_at > asOf`).
 */
export function mrrAsOf(series: RecurringSeries[], asOf: Date): number {
  let mrr = 0
  for (const s of series) {
    const factor = s.frequency ? CADENCE_FACTOR[s.frequency] : undefined
    if (!factor) continue
    const createdAt = s.created_at ? new Date(s.created_at) : null
    if (!createdAt || createdAt > asOf) continue
    const pausedAt = s.paused_at ? new Date(s.paused_at) : null
    if (pausedAt && pausedAt <= asOf) continue
    const price = Number(s.price || 0)
    mrr += price * factor
  }
  return Math.round(mrr)
}

export interface MrrTrendPoint {
  month: string // YYYY-MM
  label: string // "Apr 26"
  mrr: number
  momGrowth: number | null
}

/**
 * Build a trend of the last N month-end MRRs. Month boundary is inclusive —
 * we use end-of-month at 23:59:59.999 UTC so the comparison is stable
 * across server timezones.
 */
export function computeMrrTrend(
  series: RecurringSeries[],
  months: number,
  now: Date = new Date()
): MrrTrendPoint[] {
  const points: MrrTrendPoint[] = []
  let prev: number | null = null
  // Anchor on UTC year/month of `now` so results are deterministic.
  const anchorYear = now.getUTCFullYear()
  const anchorMonth = now.getUTCMonth() // 0-indexed
  for (let i = months - 1; i >= 0; i--) {
    // Day 0 of (anchorMonth - i + 1) = last day of (anchorMonth - i)
    const end = new Date(Date.UTC(anchorYear, anchorMonth - i + 1, 0, 23, 59, 59, 999))
    const key = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}`
    const label = end.toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    })
    const mrr = mrrAsOf(series, end)
    const momGrowth =
      prev != null && prev > 0 ? Math.round(((mrr - prev) / prev) * 1000) / 10 : null
    points.push({ month: key, label, mrr, momGrowth })
    prev = mrr
  }
  return points
}
