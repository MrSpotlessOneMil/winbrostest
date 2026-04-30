/**
 * Human-readable time range formatter.
 *
 * Phase L (Blake call 2026-04-29). Blake explicitly called out that
 * military time on schedule cards is hard to read at a glance — wants
 * "8 to 10" not "08:00–10:00". Used by `/schedule` and `/team-schedules`
 * job cards.
 *
 * Inputs are flexible because the schedule grid stores time in several
 * forms across the codebase:
 *   - ISO timestamp (`scheduled_at`)
 *   - `HH:MM` string (legacy crew-day fields)
 *   - `null` / undefined (no time set yet)
 *
 * Output drops the `:00` and the leading zero so "9 to 11" reads cleanly.
 * `am`/`pm` only appears when both ends fall in the same half (so `8 to
 * 10am` not `8am to 10am`); cross-meridian ranges keep both ("11am to 1pm").
 */

export function formatTimeRange(
  start: string | null | undefined,
  durationMinutes: number | null | undefined
): string {
  if (!start) return "TBD"
  const startDate = parseTime(start)
  if (!startDate) return "TBD"

  const minutes = Math.max(0, Math.round(Number(durationMinutes ?? 0)))
  const endDate = new Date(startDate.getTime() + minutes * 60_000)

  const startLabel = formatHour(startDate)
  const endLabel = formatHour(endDate)

  // No duration → render only the start.
  if (minutes <= 0) return `${startLabel}${suffix(startDate)}`

  const startSuffix = suffix(startDate)
  const endSuffix = suffix(endDate)

  // Same meridian → only suffix the end (e.g. "8 to 10am").
  if (startSuffix === endSuffix) {
    return `${startLabel} to ${endLabel}${endSuffix}`
  }
  // Cross-meridian → both ends keep their suffix (e.g. "11am to 1pm").
  return `${startLabel}${startSuffix} to ${endLabel}${endSuffix}`
}

function parseTime(input: string): Date | null {
  if (/^\d{1,2}:\d{2}/.test(input)) {
    const [h, m] = input.split(":").map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return null
    const d = new Date()
    d.setHours(h, m, 0, 0)
    return d
  }
  const d = new Date(input)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatHour(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes()
  const twelve = h % 12 === 0 ? 12 : h % 12
  if (m === 0) return `${twelve}`
  return `${twelve}:${String(m).padStart(2, "0")}`
}

function suffix(d: Date): "am" | "pm" {
  return d.getHours() >= 12 ? "pm" : "am"
}
