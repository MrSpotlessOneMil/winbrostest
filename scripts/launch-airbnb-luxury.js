/**
 * One-shot: launches Airbnb Luxury campaign for Spotless.
 *
 * Creates:
 *  - 1 new campaign: "Spotless - Airbnb Luxury - LA"
 *  - 1 adset with narrow LA luxury geo + STR host interests, $8/day
 *  - 3 ad images uploaded to the account
 *  - 3 ad creatives (5.0 Stars / By Invitation / Hotel Standard)
 *  - 3 ads
 *
 * Starts PAUSED. Prints the IDs. Caller unpauses when ready.
 */

require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const AD_ACCOUNT = 'act_2746942098983588'
const PAGE_ID = '188655040992479'
const PIXEL_ID = '5023947941164989'
const LANDING_URL = 'https://spotlessscrubbers.org/spotless/airbnb'
const META = 'https://graph.facebook.com/v21.0'
const MARKETING_DIR = path.join(__dirname, '..', 'public', 'images', 'marketing')

async function g(url) {
  const r = await fetch(url)
  const j = await r.json()
  if (!r.ok) throw new Error(`GET ${url.split('?')[0]}: ${JSON.stringify(j).slice(0, 300)}`)
  return j
}
async function p(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
  const j = await r.json()
  if (!r.ok) throw new Error(`POST ${url.split('?')[0]}: ${JSON.stringify(j).slice(0, 400)}`)
  return j
}

async function uploadImage(token, filename) {
  const fullPath = path.join(MARKETING_DIR, filename)
  if (!fs.existsSync(fullPath)) throw new Error('missing image: ' + fullPath)
  const bytes = fs.readFileSync(fullPath)
  const b64 = bytes.toString('base64')
  const body = new URLSearchParams({ access_token: token, bytes: b64 })
  const r = await fetch(`${META}/${AD_ACCOUNT}/adimages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`image upload ${filename}: ${JSON.stringify(j).slice(0, 300)}`)
  const key = Object.keys(j.images || {})[0]
  return j.images?.[key]?.hash || null
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const t = await sb.from('tenants').select('workflow_config').eq('slug', 'spotless-scrubbers').single()
  const token = t.data.workflow_config.meta_ads_access_token
  if (!token) throw new Error('no token')

  console.log('[1/6] Creating campaign...')
  const camp = await p(
    `${META}/${AD_ACCOUNT}/campaigns`,
    new URLSearchParams({
      access_token: token,
      name: 'Spotless - Airbnb Luxury - LA',
      objective: 'OUTCOME_LEADS',
      status: 'PAUSED',
      special_ad_categories: JSON.stringify([]),
      buying_type: 'AUCTION',
      is_adset_budget_sharing_enabled: 'false',
    })
  )
  console.log('  campaign:', camp.id)

  console.log('[2/6] Uploading 3 creative images...')
  const hash1 = await uploadImage(token, 'airbnb-bedroom-clean.jpg')
  const hash2 = await uploadImage(token, 'clean-bedroom.jpg')
  const hash3 = await uploadImage(token, 'airbnb-cleaning.jpg')
  console.log('  hashes:', hash1?.slice(0, 8), hash2?.slice(0, 8), hash3?.slice(0, 8))

  console.log('[3/6] Creating adset (narrow geo + STR interests)...')
  const zips = [
    '90210', '90211', '90212', '90046', '90048', '90069',
    '90028', '90068', '90291', '90292', '90401', '90402', '90403', '90404', '90405',
    '90263', '90264', '90265', '90272', '90049', '90077',
  ].map((z) => ({ key: 'US:' + z }))

  // Resolve "Airbnb" only — others are too noisy or deprecated
  let airbnbInterest = null
  try {
    const j = await g(`${META}/search?type=adinterest&q=Airbnb&access_token=${encodeURIComponent(token)}&limit=10`)
    airbnbInterest = (j.data || []).find((d) => d.name.toLowerCase() === 'airbnb')
  } catch {}
  console.log('  interest:', airbnbInterest?.name || '(none — relying on geo + advantage+)')

  const targeting = {
    geo_locations: { zips, location_types: ['home', 'recent'] },
    age_min: 25,
    age_max: 65,
    flexible_spec: airbnbInterest ? [{ interests: [{ id: airbnbInterest.id, name: airbnbInterest.name }] }] : undefined,
    targeting_automation: { advantage_audience: 1 },
  }

  const adset = await p(
    `${META}/${AD_ACCOUNT}/adsets`,
    new URLSearchParams({
      access_token: token,
      name: 'Airbnb Luxury — LA (zips)',
      campaign_id: camp.id,
      daily_budget: '800',
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      destination_type: 'WEBSITE',
      promoted_object: JSON.stringify({ pixel_id: PIXEL_ID, custom_event_type: 'LEAD' }),
      targeting: JSON.stringify(targeting),
      status: 'PAUSED',
      start_time: new Date().toISOString(),
    })
  )
  console.log('  adset:', adset.id)

  const variants = [
    {
      name: 'V1 — 5.0 Stars',
      hash: hash1,
      headline: 'The Difference Between 4.8 and 5.0.',
      description: 'Hotel-grade turnovers. Same team. Invitation only.',
      message:
        "Your guests won't remember if check-in was easy. They will remember if the bathroom was perfect.\n\nThe difference between 4.8 and 5.0 stars is in the details - the fold on the towels, the shine on the chrome, the way the bed is made. We do that.\n\nWhite-glove turnovers for LA's most-reviewed listings.",
    },
    {
      name: 'V2 — By Invitation',
      hash: hash2,
      headline: 'For SuperHosts. By Invitation.',
      description: 'White-glove turnovers. Consistent crew.',
      message:
        "We clean for dozens of LA's most-booked short-term rentals. We're not for everyone.\n\nIf your listing commands $400+ a night, your cleaning team should match. Consistent crew. Photo-ready every turnover. Zero surprises.\n\nAccepting a limited number of new properties this spring.",
    },
    {
      name: 'V3 — Hotel Standard',
      hash: hash3,
      headline: 'Cleaned Like a Five-Star Hotel.',
      description: 'White-glove turnovers for LA SuperHosts.',
      message:
        "Guests pay hotel prices for your listing. They expect hotel cleanliness.\n\nWe turnover LA short-term rentals the way a Ritz-Carlton turns over a suite. Fold-marked towels. Sealed bathroom. Every pillow in its place.\n\nReady when you are. Same team. Every time.",
    },
  ]

  const adIds = []
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]
    console.log(`[4/6] Creating creative ${v.name}...`)
    if (!v.hash) {
      console.log('  skipping — no image hash')
      continue
    }
    const linkUrl = `${LANDING_URL}?utm_source=meta&utm_medium=paid&utm_campaign=airbnb_luxury&utm_content=${encodeURIComponent(v.name.toLowerCase().replace(/\s+/g, '_'))}`
    const objectStorySpec = {
      page_id: PAGE_ID,
      link_data: {
        link: linkUrl,
        message: v.message,
        name: v.headline,
        description: v.description,
        call_to_action: { type: 'LEARN_MORE', value: { link: linkUrl } },
        image_hash: v.hash,
      },
    }
    const creative = await p(
      `${META}/${AD_ACCOUNT}/adcreatives`,
      new URLSearchParams({
        access_token: token,
        name: `Airbnb Luxury — ${v.name}`,
        object_story_spec: JSON.stringify(objectStorySpec),
      })
    )
    console.log('  creative:', creative.id)

    console.log(`[5/6] Creating ad ${v.name}...`)
    const ad = await p(
      `${META}/${AD_ACCOUNT}/ads`,
      new URLSearchParams({
        access_token: token,
        name: `Airbnb Luxury — ${v.name}`,
        adset_id: adset.id,
        creative: JSON.stringify({ creative_id: creative.id }),
        status: 'PAUSED',
      })
    )
    console.log('  ad:', ad.id)
    adIds.push(ad.id)
  }

  console.log('\n[6/6] Unpausing campaign, adset, and ads...')
  await p(`${META}/${camp.id}`, new URLSearchParams({ access_token: token, status: 'ACTIVE' }))
  await p(`${META}/${adset.id}`, new URLSearchParams({ access_token: token, status: 'ACTIVE' }))
  for (const id of adIds) {
    await p(`${META}/${id}`, new URLSearchParams({ access_token: token, status: 'ACTIVE' }))
  }

  console.log('\n✅ LIVE')
  console.log('Campaign:', camp.id)
  console.log('Adset   :', adset.id)
  console.log('Ads     :', adIds.join(', '))
  console.log('Spend   : $8/day')
  console.log('Landing :', LANDING_URL)
}

main().catch((err) => {
  console.error('FATAL:', err.message || err)
  process.exit(1)
})
