import { describe, it, expect } from "vitest"
import {
  computePlanPrice,
  exteriorWindowsTotal,
  type ExteriorWindowsLine,
} from "@/apps/window-washing/lib/quote-plan-pricing"

const flat: ExteriorWindowsLine[] = [
  { kind: "standard", price: 200, quantity: 1 },
  { kind: "exterior_windows", price: 400, quantity: 1 },
]

const multiPanes: ExteriorWindowsLine[] = [
  { kind: "exterior_windows", price: 4, quantity: 30 }, // $4 × 30 panes = $120
  { kind: "standard", price: 100, quantity: 1 },
]

describe("exteriorWindowsTotal", () => {
  it("sums only exterior_windows rows × their quantity", () => {
    expect(exteriorWindowsTotal(flat)).toBe(400)
    expect(exteriorWindowsTotal(multiPanes)).toBe(120)
  })

  it("returns 0 when there are no exterior_windows rows", () => {
    expect(exteriorWindowsTotal([{ kind: "standard", price: 200, quantity: 1 }])).toBe(0)
  })

  it("treats missing quantity as 1", () => {
    expect(
      exteriorWindowsTotal([{ kind: "exterior_windows", price: 250, quantity: null }])
    ).toBe(250)
  })

  it("rounds to cents", () => {
    expect(
      exteriorWindowsTotal([{ kind: "exterior_windows", price: 33.333, quantity: 3 }])
    ).toBe(100)
  })
})

describe("computePlanPrice — flat formula", () => {
  it("uses template recurring price as-is", () => {
    expect(
      computePlanPrice({
        templateRecurringPrice: 99,
        formula: { kind: "flat" },
        lines: flat,
      })
    ).toBe(99)
  })

  it("null/undefined formula defaults to flat", () => {
    expect(
      computePlanPrice({
        templateRecurringPrice: 225,
        formula: null,
        lines: flat,
      })
    ).toBe(225)
  })

  it("negative recurring price clamps to 0", () => {
    expect(
      computePlanPrice({
        templateRecurringPrice: -10,
        formula: { kind: "flat" },
        lines: flat,
      })
    ).toBe(0)
  })
})

describe("computePlanPrice — exterior_multiplier formula", () => {
  it("multiplies exterior windows total by factor (Quarterly default 0.5)", () => {
    expect(
      computePlanPrice({
        templateRecurringPrice: 0,
        formula: { kind: "exterior_multiplier", factor: 0.5 },
        lines: flat,
      })
    ).toBe(200)
  })

  it("supports pane-priced exterior windows", () => {
    expect(
      computePlanPrice({
        templateRecurringPrice: 0,
        formula: { kind: "exterior_multiplier", factor: 0.7 },
        lines: multiPanes,
      })
    ).toBe(84)
  })

  it("returns 0 if there's no exterior windows line", () => {
    expect(
      computePlanPrice({
        templateRecurringPrice: 0,
        formula: { kind: "exterior_multiplier", factor: 0.5 },
        lines: [{ kind: "standard", price: 200, quantity: 1 }],
      })
    ).toBe(0)
  })

  it("negative or non-finite factor returns 0", () => {
    expect(
      computePlanPrice({
        templateRecurringPrice: 0,
        formula: { kind: "exterior_multiplier", factor: -0.5 },
        lines: flat,
      })
    ).toBe(0)
    expect(
      computePlanPrice({
        templateRecurringPrice: 0,
        formula: { kind: "exterior_multiplier", factor: NaN },
        lines: flat,
      })
    ).toBe(0)
  })

  it("rounds the multiplied result to cents", () => {
    // 333.33 × 0.333 = 110.99889 → 110.99 (truncate via round)
    expect(
      computePlanPrice({
        templateRecurringPrice: 0,
        formula: { kind: "exterior_multiplier", factor: 0.333 },
        lines: [{ kind: "exterior_windows", price: 333.33, quantity: 1 }],
      })
    ).toBeCloseTo(110.999, 2)
  })
})
