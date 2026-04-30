import { describe, it, expect } from "vitest"
import { formatTimeRange } from "@/apps/window-washing/lib/format-time-range"

/**
 * Phase L (Blake call 2026-04-29) — schedule cards must read like
 * "8 to 10" not "08:00–10:00". Pin the formatter so a refactor can't
 * accidentally regress it back to military.
 */
describe("formatTimeRange", () => {
  it("ISO timestamp, 2hr block, same meridian (am)", () => {
    expect(formatTimeRange("2026-04-29T08:00:00", 120)).toBe("8 to 10am")
  })

  it("HH:MM string, 2hr block", () => {
    expect(formatTimeRange("09:00", 120)).toBe("9 to 11am")
  })

  it("cross-meridian range keeps both suffixes", () => {
    expect(formatTimeRange("2026-04-29T11:00:00", 120)).toBe("11am to 1pm")
  })

  it("zero/missing duration → just the start label with suffix", () => {
    expect(formatTimeRange("2026-04-29T08:00:00", 0)).toBe("8am")
    expect(formatTimeRange("2026-04-29T13:30:00", null)).toBe("1:30pm")
  })

  it("non-hour-aligned start retains the minute portion", () => {
    expect(formatTimeRange("2026-04-29T08:30:00", 90)).toBe("8:30 to 10am")
  })

  it("noon and midnight render as 12, with correct meridian", () => {
    expect(formatTimeRange("2026-04-29T12:00:00", 60)).toBe("12 to 1pm")
    expect(formatTimeRange("2026-04-29T00:00:00", 60)).toBe("12 to 1am")
  })

  it("null / empty start → TBD", () => {
    expect(formatTimeRange(null, 60)).toBe("TBD")
    expect(formatTimeRange(undefined, 60)).toBe("TBD")
    expect(formatTimeRange("", 60)).toBe("TBD")
  })

  it("garbled input → TBD (never throws, never NaN)", () => {
    expect(formatTimeRange("not-a-date", 60)).toBe("TBD")
  })
})
