import { describe, expect, it } from "vitest"
import { parseCityZip } from "@/apps/window-washing/lib/address-utils"

/**
 * PRD #13 — /team-schedules renders "City ZIP" under each booked
 * job card. The schedule API hands back free-form address strings,
 * so the parser must be lenient.
 */
describe("parseCityZip", () => {
  it("returns empty object for empty / null / undefined input", () => {
    expect(parseCityZip("")).toEqual({ city: "", zip: "" })
    expect(parseCityZip(null)).toEqual({ city: "", zip: "" })
    expect(parseCityZip(undefined)).toEqual({ city: "", zip: "" })
  })

  it("extracts city and 5-digit zip from a full US address", () => {
    expect(parseCityZip("123 Main St, Peoria, IL 61603")).toEqual({
      city: "Peoria",
      zip: "61603",
    })
  })

  it("strips the +4 portion of an extended ZIP", () => {
    expect(parseCityZip("123 Main St, Peoria, IL 61603-1234")).toEqual({
      city: "Peoria",
      zip: "61603",
    })
  })

  it("falls back to the second-to-last part when only city,state present", () => {
    expect(parseCityZip("Peoria, IL")).toEqual({
      city: "Peoria",
      zip: "",
    })
  })

  it("returns empty city when only a single token is present", () => {
    expect(parseCityZip("Peoria")).toEqual({
      city: "",
      zip: "",
    })
  })

  it("ignores stray digits that aren't 5-long ZIPs", () => {
    expect(parseCityZip("Apt 4, 22 Pine, Morton, IL")).toEqual({
      city: "Morton",
      zip: "",
    })
  })

  it("handles extra whitespace and empty comma-segments", () => {
    expect(parseCityZip("  123 Main St ,  Peoria , IL 61603  ")).toEqual({
      city: "Peoria",
      zip: "61603",
    })
  })
})
