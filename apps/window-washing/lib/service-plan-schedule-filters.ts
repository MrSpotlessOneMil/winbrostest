/**
 * Service Plan Scheduling — view filters.
 *
 * Phase M (Blake call 2026-04-29): the "Tamara Young appears 12x" bug was
 * caused by the page flattening every unscheduled service_plan_jobs row
 * for the entire year into a single bank. A customer on a quarterly plan
 * (4 future visits) showed up 4×; a monthly plan showed 12×.
 *
 * Fix: bucket per displayed period.
 *  - Week view → show only customers whose `scheduled_month` matches the
 *    month of `weekStart` AND whose `target_week` falls inside this week.
 *  - Month view → show every customer due in the displayed month (no
 *    week filter — admins use this to see "everyone needing service this
 *    month" at a glance).
 *  - Day view → same bucket as week (admin still wants the week's
 *    candidates surfaced when zoomed in to a single day).
 *
 * `weekOfMonth` matches the seeder in `lib/service-plans.ts`: 1-indexed,
 * computed from the day-of-month divided into 7-day chunks.
 */

export type ViewMode = "day" | "week" | "month"

export interface PlanJobFilterable {
  id: number
  customer_id?: number | null
  scheduled_month: number
  scheduled_year?: number | null
  target_week: number
}

export function weekOfMonth(date: Date): number {
  return Math.ceil(date.getDate() / 7)
}

export function filterPlanJobsForView<T extends PlanJobFilterable>(
  jobs: readonly T[],
  view: ViewMode,
  weekStart: Date
): T[] {
  const month = weekStart.getMonth() + 1 // 1-indexed
  const year = weekStart.getFullYear()
  const weekNum = weekOfMonth(weekStart)

  const inDisplayedYear = (j: T): boolean =>
    j.scheduled_year == null || j.scheduled_year === year

  if (view === "month") {
    return jobs.filter((j) => j.scheduled_month === month && inDisplayedYear(j))
  }

  // Week + day → match month + week-of-month.
  return jobs.filter(
    (j) =>
      j.scheduled_month === month &&
      j.target_week === weekNum &&
      inDisplayedYear(j)
  )
}

/**
 * Returns true when a calendar date falls in a different month than the
 * displayed week's start. Used to grey-out cells in week view that would
 * accidentally schedule an April customer into May.
 */
export function isCellOutOfDisplayedMonth(
  cellDate: Date,
  weekStart: Date
): boolean {
  return (
    cellDate.getMonth() !== weekStart.getMonth() ||
    cellDate.getFullYear() !== weekStart.getFullYear()
  )
}
