/**
 * Recurring Intent Detection — Pure pattern matching
 * Detects when customers express interest in recurring cleaning services via SMS or calls.
 */

export type RecurringIntent = {
  frequency: "weekly" | "bi-weekly" | "monthly" | null
  preferredDay: string | null
  raw: string
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
const DAY_PATTERN = DAYS.join("|")

const FREQUENCY_PATTERNS: { pattern: RegExp; frequency: "weekly" | "bi-weekly" | "monthly" }[] = [
  // Bi-weekly must come before weekly to avoid false matches
  { pattern: /\b(bi[\s-]?weekly|every\s+(other|2)\s+week|twice\s+a\s+month|every\s+two\s+weeks?)\b/i, frequency: "bi-weekly" },
  { pattern: /\b(weekly|every\s+week|once\s+a\s+week|each\s+week)\b/i, frequency: "weekly" },
  { pattern: new RegExp(`\\bevery\\s+(${DAY_PATTERN})\\b`, "i"), frequency: "weekly" },
  { pattern: /\b(monthly|once\s+a\s+month|every\s+month|each\s+month)\b/i, frequency: "monthly" },
  { pattern: /\b(regular(ly)?|recurring|ongoing|on\s+a\s+schedule)\b/i, frequency: "bi-weekly" }, // default ambiguous to bi-weekly (most common for cleaning)
]

const DAY_REGEX = new RegExp(`\\b(${DAY_PATTERN})s?\\b`, "i")

export function detectRecurringIntent(text: string): RecurringIntent {
  if (!text || text.length < 4) {
    return { frequency: null, preferredDay: null, raw: text || "" }
  }

  const lower = text.toLowerCase()
  let frequency: RecurringIntent["frequency"] = null
  let preferredDay: string | null = null

  // Check frequency patterns
  for (const { pattern, frequency: freq } of FREQUENCY_PATTERNS) {
    if (pattern.test(lower)) {
      frequency = freq
      break
    }
  }

  // Extract preferred day
  const dayMatch = lower.match(DAY_REGEX)
  if (dayMatch) {
    preferredDay = dayMatch[1].toLowerCase()
  }

  // "every {day}" implies weekly
  if (preferredDay && !frequency) {
    const everyDayPattern = new RegExp(`every\\s+${preferredDay}`, "i")
    if (everyDayPattern.test(lower)) {
      frequency = "weekly"
    }
  }

  return { frequency, preferredDay, raw: text }
}
