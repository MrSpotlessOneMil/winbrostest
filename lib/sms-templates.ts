/**
 * SMS Message Templates for Lead Automation System
 *
 * All templates are designed to be concise (under 160 chars when possible)
 * and maintain a professional yet friendly tone.
 */

/**
 * Initial follow-up after a new lead comes in
 */
export function leadFollowupInitial(name: string, businessName: string): string {
  return `Hi ${name}! Thanks for reaching out to ${businessName}. We'd love to help with your cleaning needs. When works best for a quick call?`
}

/**
 * Second follow-up text for leads who haven't responded
 */
export function leadFollowupSecond(name: string): string {
  return `Hey ${name}, just checking in! Still interested in getting a cleaning quote? Reply YES and we'll get you scheduled right away.`
}

/**
 * Payment link message with amount and secure link
 */
export function paymentLink(name: string, amount: number, link: string): string {
  const formattedAmount = amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
  return `Hi ${name}, your invoice of ${formattedAmount} is ready. Pay securely here: ${link}`
}

/**
 * Notify customer that a cleaner has been assigned to their job
 */
export function cleanerAssigned(
  customerName: string,
  cleanerName: string,
  date: string,
  time: string
): string {
  return `Hi ${customerName}! ${cleanerName} will be your cleaner on ${date} at ${time}. See you soon!`
}

/**
 * Apology message when no cleaners are available for the requested date
 */
export function noCleanersAvailable(name: string, date: string): string {
  return `Hi ${name}, we're sorry but we don't have availability for ${date}. Can we find you another date that works? Reply with your preferred times.`
}

/**
 * Post-cleaning review request
 */
export function postCleaningReview(name: string, reviewLink: string): string {
  return `Hi ${name}! We hope you loved your clean. Would you mind leaving us a quick review? It really helps! ${reviewLink}`
}

/**
 * Post-cleaning recurring offer
 */
export function postCleaningRecurring(name: string, discount: string): string {
  return `Hey ${name}! A lot of our customers love setting up recurring cleanings — you get ${discount} off each visit and never have to think about scheduling. Would that be something you'd be interested in?`
}

/**
 * Post-cleaning tip prompt
 */
export function postCleaningTip(cleanerName: string, tipLink: string): string {
  return `Happy with ${cleanerName}'s work? Leave a tip to show your appreciation: ${tipLink} - 100% goes to your cleaner!`
}

/**
 * Combined post-job follow-up (review + recurring + tip)
 * Sent 2 hours after job completion
 */
export function postJobFollowup(
  customerName: string,
  cleanerName: string,
  reviewLink: string,
  tipLink?: string,
  recurringDiscount?: string
): string {
  return `Hi ${customerName}! We hope everything looks amazing. If ${cleanerName} did a great job, we'd really appreciate a quick review — it means a lot to us: ${reviewLink}`
}

/**
 * Monthly re-engagement offer with discount
 */
export function monthlyFollowup(name: string, discount: string): string {
  return `Hey ${name}! It's been a while. Ready for another sparkle? Book this month and get ${discount} off. Reply BOOK to schedule!`
}

/**
 * Monthly re-engagement with specific last service date
 */
export function monthlyReengagement(name: string, discount: string, daysSince: number): string {
  return `Hi ${name}! It's been ${daysSince} days since your last cleaning. Ready for a refresh? Book now and get ${discount} off! Reply YES to schedule.`
}

/**
 * Seasonal reminder with tenant-customized message
 * Customer name is prepended to the tenant's campaign message
 */
export function seasonalReminder(name: string, campaignMessage: string): string {
  return `Hi ${name}! ${campaignMessage}`
}

/**
 * Review-only follow-up (when no invoice/payment exists for the job)
 */
export function reviewOnlyFollowup(customerName: string, reviewLink: string): string {
  return `Hi ${customerName}! Thanks for choosing us. A quick review really helps our small business grow: ${reviewLink}`
}

/**
 * Service frequency nudge for returning customers
 */
export function frequencyNudge(name: string, daysSince: number, businessName: string): string {
  return `Hi ${name}! It's been about ${Math.round(daysSince / 7)} weeks since your last ${businessName} visit. Ready for another? Reply YES to book!`
}

/**
 * Payment failed notification — sent to customer when their card is declined
 */
export function paymentFailed(paymentUrl: string): string {
  return `Your recent payment didn't go through. Please try again or update your card here: ${paymentUrl}`
}

/**
 * Payment retry — sent when admin manually retries or auto-retry triggers
 */
export function paymentRetry(businessName: string, amount: number, paymentUrl: string): string {
  const formattedAmount = amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
  return `Hi! Your remaining balance of ${formattedAmount} with ${businessName} is still outstanding. Pay securely here: ${paymentUrl}`
}

/**
 * All SMS templates exported as a single object
 */
export const SMS_TEMPLATES = {
  leadFollowupInitial,
  leadFollowupSecond,
  paymentLink,
  cleanerAssigned,
  noCleanersAvailable,
  postCleaningReview,
  postCleaningRecurring,
  postCleaningTip,
  postJobFollowup,
  monthlyFollowup,
  monthlyReengagement,
  seasonalReminder,
  reviewOnlyFollowup,
  frequencyNudge,
  paymentFailed,
  paymentRetry,
} as const
