/**
 * SMS templates for HC follow-up ghost chase + retargeting win-back.
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md (Build 2)
 * Source spec: clean_machine_rebuild/04_FOLLOW_UPS.md §6 + 07_RETARGETING.md §8
 *
 * Templates are pre-written by Dominic and rendered with simple `{{var}}` substitution.
 * AI has zero authority to deviate from these — discounts/offers come ONLY from
 * tenant_settings.workflow_config.followup_cadence and retargeting_offer_pool config.
 */

export interface TemplateContext {
  customerFirstName: string | null
  tenantName: string
  /** Optional currency-formatted offer string already passed through formatTenantCurrency */
  offerLabel?: string
  /** Bedrooms + bathrooms for retargeting follow-up references */
  bedrooms?: number | null
  bathrooms?: number | null
}

export type TemplateKey =
  // Ghost chase (pre-quote OR post-quote — same cadence per 04_FOLLOW_UPS.md §1)
  | 'still_there'
  | 'small_followup'
  | 'followup_with_offer'
  | 'soft_poke'
  | 'last_chance_offer'
  // Structured retargeting (16-week phase per 07_RETARGETING.md §2)
  | 'recurring_seed_20'
  | 'open_slots_this_week'
  | 'monthly_offer_15'
  | 'monthly_offer_20'
  // Evergreen retargeting pool (forever phase per 07_RETARGETING.md §3)
  | 'evergreen_pct_15_recurring'
  | 'evergreen_pct_20_recurring'
  | 'evergreen_pct_25_single'
  | 'evergreen_dollar_20'
  | 'evergreen_dollar_40'
  | 'evergreen_free_addon_fridge'
  | 'evergreen_free_addon_oven'
  | 'evergreen_referral'
  | 'evergreen_seasonal'
  // Unsubscribe TCPA confirmation
  | 'unsubscribe_confirmation'

const FALLBACK_NAME = 'there'

function name(ctx: TemplateContext): string {
  return ctx.customerFirstName || FALLBACK_NAME
}

/**
 * Render a template by key. Returns null if the key has no built-in template
 * (caller must supply via tenant override).
 */
export function renderTemplate(key: TemplateKey, ctx: TemplateContext): string | null {
  const n = name(ctx)
  const t = ctx.tenantName
  const offer = ctx.offerLabel || ''

  switch (key) {
    // ── Ghost chase ────────────────────────────────────────────────────────
    case 'still_there':
      return `Hey ${n}, just making sure you got my last message. Still want that quote?`
    case 'small_followup':
      return `${n === 'there' ? 'Hey' : n}, takes 30 seconds to wrap your quote. Want me to send it over?`
    case 'followup_with_offer':
      return offer
        ? `${n === 'there' ? 'Hey' : n}, hate for you to miss this — first-time customers get ${offer} this week. Want to lock in your slot?`
        : `${n === 'there' ? 'Hey' : n}, just bumping this back to the top — want me to lock in a slot for you?`
    case 'soft_poke':
      return `${n === 'there' ? 'Hey' : n}, quick check-in. Still need a clean? Just hit me back yes or no.`
    case 'last_chance_offer':
      return offer
        ? `${n === 'there' ? 'Hey' : n}, last call from me on this one. The ${offer} is still good if you want it. Otherwise no worries — just let me know.`
        : `${n === 'there' ? 'Hey' : n}, last nudge from me. If now's not the time no worries — just text me back when it is.`

    // ── Structured retargeting ─────────────────────────────────────────────
    case 'recurring_seed_20':
      return `Hey ${n}, thanks for booking with ${t}. Quick heads up — recurring clients save 20% every clean. Want to lock in a schedule?`
    case 'open_slots_this_week':
      return `${n === 'there' ? 'Hey' : n}, we've got open slots this week. Perfect chance to get on a regular schedule. Want me to grab one?`
    case 'monthly_offer_15':
      return offer
        ? `Hey ${n} — ${offer} on your next ${t} clean if you book in the next 7 days. ${ctx.bedrooms && ctx.bathrooms ? `Still ${ctx.bedrooms}BR/${ctx.bathrooms}BA?` : 'Want to lock in?'}`
        : `Hey ${n} — ${t} has open slots this week. ${ctx.bedrooms && ctx.bathrooms ? `Still ${ctx.bedrooms}BR/${ctx.bathrooms}BA?` : 'Want to lock in?'}`
    case 'monthly_offer_20':
      return offer
        ? `${n === 'there' ? 'Hey' : n}, it's been a minute. Here's ${offer} on your next clean. Want it this week?`
        : `${n === 'there' ? 'Hey' : n}, it's been a minute. Want to get back on the schedule this week?`

    // ── Evergreen pool ─────────────────────────────────────────────────────
    case 'evergreen_pct_15_recurring':
      return offer
        ? `Hey ${n} — ${offer} on every recurring clean if you sign up this month with ${t}. Worth a shot?`
        : `Hey ${n} — recurring cleans with ${t} save you every visit. Want to set one up?`
    case 'evergreen_pct_20_recurring':
      return offer
        ? `${n === 'there' ? 'Hey' : n} — ${offer} every visit on a recurring schedule with ${t}. Want me to grab a slot?`
        : `${n === 'there' ? 'Hey' : n} — recurring with ${t} saves you on every visit. Want to grab a slot?`
    case 'evergreen_pct_25_single':
      return offer
        ? `Hey ${n} — ${offer} on your next single clean from ${t} if you book this week. Worth a shot?`
        : `Hey ${n} — ${t} has slots this week. Want me to grab one?`
    case 'evergreen_dollar_20':
      return offer
        ? `${n === 'there' ? 'Hey' : n} — ${offer} on your next clean from ${t} if you book this week. Still here when you're ready.`
        : `${n === 'there' ? 'Hey' : n} — ${t} has slots this week. Want one?`
    case 'evergreen_dollar_40':
      return offer
        ? `Hey ${n} — ${offer} on your next clean from ${t} this week only. Want me to grab a slot?`
        : `Hey ${n} — ${t} would love to have you back. Slots open this week.`
    case 'evergreen_free_addon_fridge':
      return `${n === 'there' ? 'Hey' : n} — free inside-fridge clean on your next booking with ${t}. Want it?`
    case 'evergreen_free_addon_oven':
      return `Hey ${n} — free inside-oven clean on your next booking with ${t}. Worth a shot?`
    case 'evergreen_referral':
      return `Hey ${n} — refer a friend to ${t} and you both get $25 off your next clean. Worth a shot?`
    case 'evergreen_seasonal':
      // Seasonal copy is dynamically picked by offer-engine based on date —
      // this fallback string is used only if seasonal selection fails.
      return `Hey ${n} — ${t} has open slots this week. Want one?`

    // ── Compliance ─────────────────────────────────────────────────────────
    case 'unsubscribe_confirmation':
      return `Got it — you're unsubscribed from ${t}. Text BACK if you ever want in again.`

    default: {
      const _exhaustive: never = key
      return _exhaustive
    }
  }
}
