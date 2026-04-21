/**
 * One-shot: prepares Commercial/Office + Post-Construction adsets on the
 * existing paused campaigns for Spotless.
 *
 * Creates per campaign:
 *  - 1 new adset with targeted geo + interests, $8/day
 *  - prints adset IDs so Pipeboard can attach creatives + ads afterward
 *
 * Safe to re-run: checks for an existing "v2" adset by name first and
 * skips creation if one is already there.
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const AD_ACCOUNT = 'act_2746942098983588'
const PIXEL_ID = '5023947941164989'
const META = 'https://graph.facebook.com/v21.0'

async function g(url) {
  const r = await fetch(url)
  const j = await r.json()
  if (!r.ok) throw new Error(`GET: ${JSON.stringify(j).slice(0, 300)}`)
  return j
}
async function p(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
  const j = await r.json()
  if (!r.ok) throw new Error(`POST: ${JSON.stringify(j).slice(0, 400)}`)
  return j
}

async function findCampaign(token, namePattern) {
  const j = await g(`${META}/${AD_ACCOUNT}/campaigns?fields=id,name,status&limit=50&access_token=${encodeURIComponent(token)}`)
  return (j.data || []).find((c) => namePattern.test(c.name))
}

async function findOrCreateAdset(token, { name, campaign_id, targeting }) {
  const existing = await g(`${META}/${campaign_id}/adsets?fields=id,name,status&limit=20&access_token=${encodeURIComponent(token)}`)
  const match = (existing.data || []).find((a) => a.name === name)
  if (match) {
    console.log(`  [adset exists] ${name} -> ${match.id}`)
    return match.id
  }
  const r = await p(
    `${META}/${AD_ACCOUNT}/adsets`,
    new URLSearchParams({
      access_token: token,
      name,
      campaign_id,
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
  console.log(`  [adset created] ${name} -> ${r.id}`)
  return r.id
}

async function resolveInterest(token, name) {
  try {
    const j = await g(`${META}/search?type=adinterest&q=${encodeURIComponent(name)}&access_token=${encodeURIComponent(token)}&limit=10`)
    const exact = (j.data || []).find((d) => d.name.toLowerCase() === name.toLowerCase())
    if (exact) return exact
    // Require the first major word to actually appear in the result name to avoid garbage matches
    const firstWord = name.split(/\s+/)[0].toLowerCase()
    return (j.data || []).find((d) => d.name.toLowerCase().includes(firstWord)) || null
  } catch { return null }
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const t = await sb.from('tenants').select('workflow_config').eq('slug', 'spotless-scrubbers').single()
  const token = t.data.workflow_config.meta_ads_access_token

  // ─── COMMERCIAL ─────────────────────────────────────────
  console.log('[Commercial]')
  const cc = await findCampaign(token, /commercial\s*\/?\s*office/i)
  if (!cc) throw new Error('Commercial campaign not found')
  console.log('  campaign:', cc.id, cc.name)

  const commInterests = await Promise.all([
    resolveInterest(token, 'Facility management'),
    resolveInterest(token, 'Property management'),
    resolveInterest(token, 'Small business'),
    resolveInterest(token, 'Entrepreneurship'),
  ])
  const commValid = commInterests.filter(Boolean).slice(0, 4)
  console.log('  interests:', commValid.map((i) => i.name).join(', ') || '(none)')

  const commAdsetId = await findOrCreateAdset(token, {
    name: 'Commercial LA — Office Managers & Property Mgrs',
    campaign_id: cc.id,
    targeting: {
      geo_locations: { cities: [{ key: '2420379', radius: 25, distance_unit: 'mile' }] },
      age_min: 25,
      age_max: 65,
      flexible_spec: commValid.length ? [{ interests: commValid.map((i) => ({ id: i.id, name: i.name })) }] : undefined,
      targeting_automation: { advantage_audience: 1 },
      publisher_platforms: ['facebook', 'instagram'],
    },
  })

  // ─── POST-CONSTRUCTION ──────────────────────────────────
  console.log('[Post-Construction]')
  const pc = await findCampaign(token, /post[-\s]?construction/i)
  if (!pc) throw new Error('Post-Construction campaign not found')
  console.log('  campaign:', pc.id, pc.name)

  const pcInterests = await Promise.all([
    resolveInterest(token, 'Real estate'),
    resolveInterest(token, 'Home improvement'),
    resolveInterest(token, 'Interior design'),
    resolveInterest(token, 'Home renovation'),
  ])
  const pcValid = pcInterests.filter(Boolean).slice(0, 4)
  console.log('  interests:', pcValid.map((i) => i.name).join(', ') || '(none)')

  const pcAdsetId = await findOrCreateAdset(token, {
    name: 'Post-Construction LA — Realtors & Contractors',
    campaign_id: pc.id,
    targeting: {
      geo_locations: { cities: [{ key: '2420379', radius: 30, distance_unit: 'mile' }] },
      age_min: 25,
      age_max: 65,
      flexible_spec: pcValid.length ? [{ interests: pcValid.map((i) => ({ id: i.id, name: i.name })) }] : undefined,
      targeting_automation: { advantage_audience: 1 },
      publisher_platforms: ['facebook', 'instagram'],
    },
  })

  console.log('\n═══ RESULT ═══')
  console.log(JSON.stringify({
    commercial: { campaign_id: cc.id, adset_id: commAdsetId },
    post_construction: { campaign_id: pc.id, adset_id: pcAdsetId },
  }, null, 2))
}

main().catch((err) => {
  console.error('FATAL:', err.message || err)
  process.exit(1)
})
