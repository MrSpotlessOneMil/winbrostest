/**
 * Address parsing helpers for the WinBros UI.
 *
 * The schedule rendering surfaces (e.g. /team-schedules) display a tight
 * "City ZIP" line under each booked job so a salesman can cluster work
 * geographically before promising a new date. The address strings stored
 * on `jobs.address` are free-form US single-line forms like:
 *
 *   "123 Main St, Peoria, IL 61603"
 *   "123 Main St, Peoria, IL 61603-1234"
 *   "Peoria, IL"
 *   ""
 *
 * `parseCityZip` is intentionally lenient: it does NOT validate, it
 * extracts what it can and returns empty strings when the field is
 * missing, so the UI can collapse cleanly.
 */

export interface CityZip {
  city: string
  zip: string
}

export function parseCityZip(address: string | null | undefined): CityZip {
  if (!address) return { city: "", zip: "" }
  const zipMatch = address.match(/\b(\d{5})(?:-\d{4})?\b/)
  const zip = zipMatch?.[1] ?? ""
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return { city: "", zip }

  // Most US single-line forms put STATE+ZIP in the last comma-segment
  // ("STREET, CITY, STATE ZIP"), so city = parts[len-2]. If the last
  // segment is a bare ZIP ("STREET, CITY, STATE, ZIP"), skip back one.
  const last = parts[parts.length - 1]
  const lastIsZipOnly = /^\d{5}(-\d{4})?$/.test(last)
  const cityIdx = lastIsZipOnly ? parts.length - 3 : parts.length - 2
  const city = cityIdx >= 0 ? parts[cityIdx] : ""
  return { city, zip }
}
