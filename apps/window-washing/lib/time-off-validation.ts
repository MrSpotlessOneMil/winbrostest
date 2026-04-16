/**
 * Time-Off Validation for WinBros
 *
 * Rules:
 * - Days off must be requested at least 14 days in advance
 * - If less than 14 days, they must text their manager
 * - Technicians/salesmen cannot confirm/deny assignments — admin just assigns
 */

const MINIMUM_ADVANCE_DAYS = 14

/**
 * Validate a time-off request.
 * Returns error message if invalid, null if valid.
 */
export function validateTimeOffRequest(
  requestedDate: string,
  currentDate?: string
): string | null {
  const now = currentDate ? new Date(currentDate + 'T12:00:00') : new Date()
  const requested = new Date(requestedDate + 'T12:00:00')

  // Date must be in the future
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const reqDay = new Date(requested.getFullYear(), requested.getMonth(), requested.getDate())

  if (reqDay <= today) {
    return 'Cannot request time off for today or past dates'
  }

  // Must be at least 14 days in advance
  const diffMs = reqDay.getTime() - today.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < MINIMUM_ADVANCE_DAYS) {
    return `Time off must be requested at least ${MINIMUM_ADVANCE_DAYS} days in advance. Contact your manager for last-minute schedule changes.`
  }

  return null
}

/**
 * Get the minimum date that can be requested off.
 */
export function getMinimumTimeOffDate(currentDate?: string): string {
  const now = currentDate ? new Date(currentDate + 'T12:00:00') : new Date()
  now.setDate(now.getDate() + MINIMUM_ADVANCE_DAYS)
  return now.toISOString().split('T')[0]
}
