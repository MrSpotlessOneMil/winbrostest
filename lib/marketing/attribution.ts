// Lead-source attribution: normalize the many raw source signals we capture
// (leads.source, form_data.source_detail, UTMs, LSA markers) into ONE canonical
// marketing channel, so the channel-P&L scoreboard can compute cost-per-booked-job.
//
// Why this exists: the website webhook pins `leads.source = 'website'` (DB CHECK
// constraint), and stashes the granular detail ("area-santa-monica", UTMs) in
// form_data. So the real channel must be DERIVED at report time. This module is the
// single source of truth for that derivation — pure + unit-tested, no DB/IO.

export type Channel =
  | 'lsa' // Google Local Services Ads
  | 'seo' // organic city/service pages (spotlessscrubbers.org/areas/*, /services/*)
  | 'gbp' // Google Business Profile / Maps
  | 'social' // Instagram / Facebook / TikTok
  | 'paid_search' // Google/Bing paid search (non-LSA)
  | 'email' // cold email / email marketing
  | 'referral' // another site referred them
  | 'phone' // inbound call not tied to LSA (branded/direct call)
  | 'direct' // came straight to the site (branded / typed URL / untagged)
  | 'other'

export interface NormalizedSource {
  channel: Channel
  /** sub-detail, e.g. the SEO city ("santa-monica") or social platform ("instagram") */
  detail?: string
  /** human label for dashboards */
  label: string
}

export interface RawLeadSignals {
  /** leads.source column (e.g. "website", "google_lsa", "phone") */
  source?: string | null
  /** leads.form_data jsonb (may contain source/source_detail + utm_*) */
  formData?: Record<string, unknown> | null
  /** customers.lead_source, used as a fallback */
  customerLeadSource?: string | null
}

const CHANNEL_LABELS: Record<Channel, string> = {
  lsa: 'Google LSA',
  seo: 'Organic SEO',
  gbp: 'Google Business Profile',
  social: 'Social',
  paid_search: 'Paid Search',
  email: 'Cold Email',
  referral: 'Referral',
  phone: 'Phone (direct)',
  direct: 'Direct / Branded',
  other: 'Other',
}

const SOCIAL_PLATFORMS: Record<string, string> = {
  ig: 'instagram', instagram: 'instagram',
  fb: 'facebook', facebook: 'facebook', meta: 'facebook',
  tt: 'tiktok', tiktok: 'tiktok',
  yt: 'youtube', youtube: 'youtube',
  li: 'linkedin', linkedin: 'linkedin',
}

function s(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : ''
}

/** City/service slug out of a source_detail like "area-santa-monica" or "service-deep-cleaning/venice". */
function seoDetail(sourceDetail: string): string | undefined {
  const m = sourceDetail.match(/^area-(.+)$/)
  if (m) return m[1]
  const sm = sourceDetail.match(/^service-(.+)$/)
  if (sm) return sm[1]
  return undefined
}

function make(channel: Channel, detail?: string): NormalizedSource {
  return { channel, detail, label: CHANNEL_LABELS[channel] }
}

/**
 * Collapse all raw signals into one canonical channel. Priority order matters:
 * explicit paid/LSA first, then UTM-declared channels, then site-path heuristics,
 * then fallbacks. Pure function — safe to unit test and reuse anywhere.
 */
export function normalizeChannel(raw: RawLeadSignals): NormalizedSource {
  const src = s(raw.source)
  const fd = raw.formData ?? {}
  const detail = s(fd.source_detail) || s(fd.source)
  const utmSource = s(fd.utm_source)
  const utmMedium = s(fd.utm_medium)
  const utmCampaign = s(fd.utm_campaign)
  const custSrc = s(raw.customerLeadSource)

  // 1. LSA — the poll job sets leads.source='google_lsa' (and updates matched phone leads)
  if (src === 'google_lsa' || custSrc === 'google_lsa' || 'lsa_lead_id' in fd || 'lsa_lead_type' in fd) {
    return make('lsa')
  }

  // 2. Explicit UTM-declared channels (most trustworthy signal for website leads)
  if (utmMedium === 'cpc' || utmMedium === 'ppc' || utmMedium === 'paid' || utmSource === 'google-ads' || utmSource === 'bing-ads') {
    return make('paid_search')
  }
  if (utmSource === 'gbp' || utmSource === 'gmb' || utmSource === 'google-business' || utmSource === 'google_business' || utmCampaign.includes('gbp') || utmCampaign.includes('gmb') || detail === 'gbp') {
    return make('gbp')
  }
  if (utmMedium === 'email' || utmSource === 'instantly' || utmSource === 'coldemail' || utmSource === 'cold-email' || detail.startsWith('coldemail') || detail.startsWith('email')) {
    return make('email')
  }
  const socialKey = SOCIAL_PLATFORMS[utmSource] || SOCIAL_PLATFORMS[detail.replace(/^social[-:]/, '')]
  if (utmMedium === 'social' || utmMedium === 'social-organic' || socialKey || detail.startsWith('social')) {
    return make('social', socialKey || undefined)
  }

  // 3. Site-path heuristics from the granular source_detail the BookingForm sends.
  //    "area-<city>" and "service-<...>" are our 636 organic SEO pages.
  const seo = seoDetail(detail)
  if (seo) return make('seo', seo)

  // 4. Referral (a real referring host in form_data.referrer, not our own site)
  const referrer = s(fd.referrer)
  if (referrer && !referrer.includes('spotlessscrubbers') && /^https?:\/\//.test(referrer)) {
    if (referrer.includes('google.') || referrer.includes('bing.')) return make('seo') // organic search referral
    return make('referral')
  }

  // 5. Plain phone lead not tied to LSA
  if (src === 'phone') return make('phone')

  // 6. Fallbacks: bare website/book/home visits with no campaign data = direct/branded.
  if (src === 'website' || detail === 'website' || detail === 'book' || detail === 'home' || detail === 'contact' || detail === 'offer' || !src) {
    return make('direct')
  }

  return make('other', src || undefined)
}

/** Compact key for grouping in the scoreboard (channel + detail). */
export function channelKey(n: NormalizedSource): string {
  return n.detail ? `${n.channel}:${n.detail}` : n.channel
}
