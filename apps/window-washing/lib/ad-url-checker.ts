/**
 * Ad URL Checker — shared helper for detecting broken landing-page URLs
 * on Meta ad creatives.
 *
 * Called by /api/cron/ad-url-health (runs every 6h). Would have caught the
 * 2026-04-20 incident where 7 ads were created with /spotless/-prefixed URLs
 * that 404'd on spotlessscrubbers.org and bled ~$24 before a human noticed.
 *
 * Pure function: takes (accountId, token), returns {broken, checked}. No
 * DB writes, no SMS sends, no Meta mutations. The caller decides how to
 * react.
 */

const META_API_BASE = 'https://graph.facebook.com/v21.0'

export interface BrokenAd {
  ad_id: string
  ad_name: string
  campaign_id: string | null
  adset_id: string | null
  link: string
  http_status: number | 'timeout' | 'error'
  error_message?: string
}

export interface AdUrlCheckResult {
  account_id: string
  ads_checked: number
  broken: BrokenAd[]
  skipped: Array<{ ad_id: string; reason: string }>
}

class MetaAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetaAuthError'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function metaGet<T>(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<T> {
  const url = new URL(`${META_API_BASE}/${path}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await fetch(url.toString(), { signal: controller.signal })
      if (res.ok) return (await res.json()) as T
      const body = await res.text()
      if (res.status === 401 || res.status === 403) {
        throw new MetaAuthError(`Meta ${res.status}: ${body.slice(0, 200)}`)
      }
      if (res.status >= 500 || res.status === 429) {
        lastError = new Error(`Meta ${res.status}: ${body.slice(0, 200)}`)
        await sleep(500 * Math.pow(2, attempt))
        continue
      }
      throw new Error(`Meta ${res.status}: ${body.slice(0, 300)}`)
    } catch (err) {
      if (err instanceof MetaAuthError) throw err
      lastError = err
      if (attempt < 2) await sleep(500 * Math.pow(2, attempt))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Meta GET failed after retries')
}

export { MetaAuthError }

/**
 * Probe a single URL. Prefers HEAD; falls back to GET on 405/403 since some
 * frameworks (Next.js, Cloudflare) return those for HEAD. Follows redirects.
 */
async function probeUrl(url: string): Promise<{ status: number | 'timeout' | 'error'; error?: string }> {
  const doFetch = async (method: 'HEAD' | 'GET'): Promise<{ status: number; error?: string }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          // Meta referrer is what the ad link actually produces in the wild.
          'User-Agent': 'OsirisAdUrlChecker/1.0 (+https://cleanmachine.live)',
        },
      })
      return { status: res.status }
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    const head = await doFetch('HEAD')
    // Some hosts return 405/403/501 for HEAD even though GET is fine.
    if (head.status === 405 || head.status === 403 || head.status === 501) {
      const get = await doFetch('GET')
      return get
    }
    return head
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'AbortError') return { status: 'timeout', error: 'HEAD/GET timed out after 10s' }
    return { status: 'error', error: err instanceof Error ? err.message : 'unknown fetch error' }
  }
}

interface MetaAd {
  id: string
  name: string
  campaign_id?: string
  adset_id?: string
  creative?: {
    id?: string
    object_story_spec?: {
      link_data?: {
        link?: string
      }
      video_data?: {
        call_to_action?: { value?: { link?: string } }
      }
    }
    asset_feed_spec?: {
      link_urls?: Array<{ website_url?: string }>
    }
    link_url?: string
  }
}

/**
 * Extract the landing URL from every shape Meta uses to store it.
 * Returns null when no URL is set (unusual — usually means lead-gen form).
 */
function extractLink(ad: MetaAd): string | null {
  const c = ad.creative
  if (!c) return null

  const linkData = c.object_story_spec?.link_data?.link
  if (linkData) return linkData

  const ctaVideo = c.object_story_spec?.video_data?.call_to_action?.value?.link
  if (ctaVideo) return ctaVideo

  const feed = c.asset_feed_spec?.link_urls?.[0]?.website_url
  if (feed) return feed

  if (c.link_url) return c.link_url

  return null
}

/**
 * Pull every ACTIVE ad in the given Meta ad account (status + effective_status
 * both ACTIVE — skips ads whose parent campaign/adset is paused even if the
 * ad row itself is ACTIVE). For each, extract the link URL and probe it.
 *
 * Returns a summary: every ad whose URL did not return 200 is in `broken[]`.
 * Ads with no URL are in `skipped[]` (usually lead-gen forms).
 */
export async function checkAdAccountUrls(
  accountId: string,
  token: string,
): Promise<AdUrlCheckResult> {
  const normalizedAccount = accountId.startsWith('act_') ? accountId : `act_${accountId}`

  const adsResp = await metaGet<{ data: MetaAd[] }>(
    `${normalizedAccount}/ads`,
    {
      fields:
        'id,name,campaign_id,adset_id,effective_status,creative{id,object_story_spec,asset_feed_spec,link_url}',
      effective_status: JSON.stringify(['ACTIVE']),
      limit: '200',
    },
    token,
  )

  const ads = adsResp.data || []
  const broken: BrokenAd[] = []
  const skipped: Array<{ ad_id: string; reason: string }> = []

  // Probe in parallel but cap concurrency at 5 to avoid hammering our own site.
  const CONCURRENCY = 5
  const queue = [...ads]
  async function worker() {
    while (queue.length) {
      const ad = queue.shift()
      if (!ad) break
      const link = extractLink(ad)
      if (!link) {
        skipped.push({ ad_id: ad.id, reason: 'no-link-url' })
        continue
      }
      const { status, error } = await probeUrl(link)
      if (status !== 200) {
        broken.push({
          ad_id: ad.id,
          ad_name: ad.name || '(unnamed)',
          campaign_id: ad.campaign_id ?? null,
          adset_id: ad.adset_id ?? null,
          link,
          http_status: status,
          error_message: error,
        })
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ads.length) }, () => worker()),
  )

  return {
    account_id: normalizedAccount,
    ads_checked: ads.length,
    broken,
    skipped,
  }
}

/**
 * Pause a single ad via the Meta Graph API. Returns true on success.
 * Errors are swallowed & logged — caller decides whether a partial failure
 * is fatal.
 */
export async function pauseAd(adId: string, token: string): Promise<boolean> {
  const url = `${META_API_BASE}/${adId}`
  const body = new URLSearchParams({ access_token: token, status: 'PAUSED' })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
