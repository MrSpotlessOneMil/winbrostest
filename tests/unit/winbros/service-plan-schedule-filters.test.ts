import { describe, it, expect } from "vitest"
import {
  filterPlanJobsForView,
  isCellOutOfDisplayedMonth,
  weekOfMonth,
  type PlanJobFilterable,
  type ViewMode,
} from "@/apps/window-washing/lib/service-plan-schedule-filters"

/**
 * Phase M (Blake call 2026-04-29) — the "Tamara Young 12x" bug must
 * not regress. Pin the filter so a refactor of the bank rendering can't
 * accidentally re-flatten the year into a single bucket.
 */
describe("filterPlanJobsForView", () => {
  // April 27 2026 is a Monday — week 4 of April.
  const aprWeek4Start = new Date(2026, 3, 27)
  // May 4 2026 is a Monday — week 1 of May.
  const mayWeek1Start = new Date(2026, 4, 4)

  function jobs(): PlanJobFilterable[] {
    return [
      // Tamara — quarterly plan, 4 future visits.
      { id: 1, customer_id: 100, scheduled_month: 4, scheduled_year: 2026, target_week: 4 },
      { id: 2, customer_id: 100, scheduled_month: 7, scheduled_year: 2026, target_week: 4 },
      { id: 3, customer_id: 100, scheduled_month: 10, scheduled_year: 2026, target_week: 4 },
      { id: 4, customer_id: 100, scheduled_month: 1, scheduled_year: 2027, target_week: 4 },
      // Daniel — triannual, week 2 of his months.
      { id: 5, customer_id: 200, scheduled_month: 4, scheduled_year: 2026, target_week: 2 },
      { id: 6, customer_id: 200, scheduled_month: 8, scheduled_year: 2026, target_week: 2 },
      // Brad — monthly plan, week 4 of every month from April.
      { id: 7, customer_id: 300, scheduled_month: 4, scheduled_year: 2026, target_week: 4 },
      { id: 8, customer_id: 300, scheduled_month: 5, scheduled_year: 2026, target_week: 4 },
      { id: 9, customer_id: 300, scheduled_month: 6, scheduled_year: 2026, target_week: 4 },
    ]
  }

  it("week view of April week 4 → only shows customers due that week (Tamara, Brad)", () => {
    const out = filterPlanJobsForView(jobs(), "week", aprWeek4Start)
    expect(out.map((j) => j.id).sort()).toEqual([1, 7])
  })

  it("week view of May week 1 → empty (nobody is on a week-1 cadence in May)", () => {
    const out = filterPlanJobsForView(jobs(), "week", mayWeek1Start)
    expect(out).toEqual([])
  })

  it("day view buckets the same as week (admin still wants the week's candidates)", () => {
    const week = filterPlanJobsForView(jobs(), "week", aprWeek4Start)
    const day = filterPlanJobsForView(jobs(), "day", aprWeek4Start)
    expect(day.map((j) => j.id).sort()).toEqual(week.map((j) => j.id).sort())
  })

  it("month view of April → everyone due in April regardless of target_week", () => {
    const out = filterPlanJobsForView(jobs(), "month", aprWeek4Start)
    // Tamara (1, week 4), Daniel (5, week 2), Brad (7, week 4) — all in April 2026.
    expect(out.map((j) => j.id).sort()).toEqual([1, 5, 7])
  })

  it("month view of May → just Brad (id 8)", () => {
    const out = filterPlanJobsForView(jobs(), "month", mayWeek1Start)
    expect(out.map((j) => j.id)).toEqual([8])
  })

  it("ignores jobs from a different scheduled_year", () => {
    // Tamara id 4 is January 2027 — must never appear in 2026 views.
    const out = filterPlanJobsForView(
      jobs(),
      "month",
      new Date(2026, 0, 5) // January 2026
    )
    expect(out.map((j) => j.id)).toEqual([])
  })
})

describe("weekOfMonth", () => {
  it("days 1-7 = week 1, 8-14 = 2, 22-28 = 4, 29-31 = 5", () => {
    expect(weekOfMonth(new Date(2026, 3, 1))).toBe(1)
    expect(weekOfMonth(new Date(2026, 3, 7))).toBe(1)
    expect(weekOfMonth(new Date(2026, 3, 8))).toBe(2)
    expect(weekOfMonth(new Date(2026, 3, 27))).toBe(4)
    expect(weekOfMonth(new Date(2026, 3, 30))).toBe(5)
  })
})

describe("isCellOutOfDisplayedMonth", () => {
  // Week of April 27 2026 spans April 27 → May 3.
  const weekStart = new Date(2026, 3, 27)

  it("April cell is in-month", () => {
    expect(isCellOutOfDisplayedMonth(new Date(2026, 3, 30), weekStart)).toBe(false)
  })

  it("May cell crossing into the next week is out-of-month", () => {
    expect(isCellOutOfDisplayedMonth(new Date(2026, 4, 1), weekStart)).toBe(true)
    expect(isCellOutOfDisplayedMonth(new Date(2026, 4, 3), weekStart)).toBe(true)
  })

  it("April cell in the next year is out-of-month", () => {
    expect(isCellOutOfDisplayedMonth(new Date(2027, 3, 28), weekStart)).toBe(true)
  })
})
