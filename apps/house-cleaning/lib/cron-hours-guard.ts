/**
 * Cron guards shared across customer-facing crons.
 *
 * Per feedback_cron_safety.md: customer-facing crons MUST have a business-hours guard
 * and must exclude tenants that opt out of automated outreach.
 *
 * - WinBros (Jack) handles his own outreach — exclude from all retargeting/follow-up crons.
 * - Hours: 9am–9pm in the tenant's timezone (same window as process-scheduled-tasks).
 */

export const RETARGETING_EXCLUDED_TENANTS: readonly string[] = ['winbros']

const PERSONAL_HOUR_START = 9
const PERSONAL_HOUR_END = 21

export function isRetargetingExcluded(tenantSlug: string): boolean {
  return RETARGETING_EXCLUDED_TENANTS.includes(tenantSlug)
}

/**
 * Returns true if the current time is within 9am–9pm in the tenant's timezone.
 * Tenants with no timezone fall back to America/Chicago.
 */
export function isInPersonalHours(tenant: { timezone?: string | null } | null | undefined): boolean {
  const tz = tenant?.timezone || 'America/Chicago'
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
  }).format(new Date())
  const rawHour = Number(hourStr)
  const hour = rawHour === 24 ? 0 : rawHour
  return hour >= PERSONAL_HOUR_START && hour < PERSONAL_HOUR_END
}
