/**
 * Auto-wire Meta Leadgen webhooks for every active tenant that has a
 * meta_ads_access_token stored in workflow_config.
 *
 * What this script does:
 *   1. Reads each tenant's System User token
 *   2. Calls Graph /me/accounts to discover the FB pages the token controls
 *   3. Picks the first page (or matches by tenant.name if multiple)
 *   4. Stores discovered page_id + a random meta_verify_token in workflow_config
 *   5. Subscribes the page to the app's leadgen webhook via POST /{page_id}/subscribed_apps
 *
 * After this runs, Meta will POST real-time lead notifications to:
 *   https://cleanmachine.live/api/webhooks/meta/{tenant_slug}
 *
 * Manual one-time step REMAINING (done in Meta app dashboard):
 *   - In your Meta app → Webhooks → Add Page subscription
 *   - Callback URL: https://cleanmachine.live/api/webhooks/meta/spotless-scrubbers
 *   - Verify token: (script prints it)
 *   - Fields: leadgen
 *
 * Usage:
 *   node scripts/setup-meta-webhooks.js              # all tenants
 *   node scripts/setup-meta-webhooks.js spotless-scrubbers   # specific tenant
 */

require('dotenv').config({ path: '.env.local' })
const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')

const META_API_BASE = 'https://graph.facebook.com/v21.0'
const CALLBACK_BASE = process.env.META_WEBHOOK_CALLBACK_BASE || 'https://cleanmachine.live/api/webhooks/meta'

async function metaGet(path, params, token) {
  const url = new URL(`${META_API_BASE}/${path}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  const json = await res.json()
  if (!res.ok) throw new Error(`Meta GET ${path}: ${JSON.stringify(json).slice(0, 300)}`)
  return json
}

async function metaPost(path, fields, token) {
  const body = new URLSearchParams({ access_token: token, ...fields })
  const res = await fetch(`${META_API_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`Meta POST ${path}: ${JSON.stringify(json).slice(0, 300)}`)
  return json
}

async function setupTenant(sb, tenant) {
  const wc = tenant.workflow_config || {}
  const token = wc.meta_ads_access_token
  if (!token) {
    console.log(`[${tenant.slug}] SKIP — no meta_ads_access_token`)
    return { slug: tenant.slug, skipped: 'no_token' }
  }

  console.log(`\n[${tenant.slug}] === setting up ===`)

  const pages = await metaGet('me/accounts', { fields: 'id,name,access_token' }, token)
  const list = pages.data || []
  if (!list.length) {
    console.log(`[${tenant.slug}] SKIP — token has 0 pages`)
    return { slug: tenant.slug, skipped: 'no_pages' }
  }

  let page = list[0]
  if (list.length > 1) {
    const match = list.find((p) => {
      const n = (p.name || '').toLowerCase()
      const tn = (tenant.name || '').toLowerCase().split(' ')[0]
      return n.includes(tn)
    })
    if (match) page = match
  }
  console.log(`[${tenant.slug}] page: ${page.name} (id ${page.id})  [${list.length} pages visible]`)

  const verifyToken = wc.meta_verify_token || crypto.randomBytes(24).toString('hex')

  const pageToken = page.access_token || token
  try {
    await metaPost(`${page.id}/subscribed_apps`, { subscribed_fields: 'leadgen' }, pageToken)
    console.log(`[${tenant.slug}] ✅ subscribed page ${page.id} to leadgen`)
  } catch (err) {
    console.warn(`[${tenant.slug}] ⚠️ page subscription failed: ${err.message}`)
  }

  const nextConfig = {
    ...wc,
    meta_page_id: page.id,
    meta_page_name: page.name,
    meta_verify_token: verifyToken,
  }
  if (page.access_token) nextConfig.meta_page_access_token = page.access_token

  const { error } = await sb.from('tenants').update({ workflow_config: nextConfig }).eq('id', tenant.id)
  if (error) throw new Error(`Supabase update: ${error.message}`)

  console.log(`[${tenant.slug}] ✅ saved meta_page_id + meta_verify_token to workflow_config`)
  console.log(`[${tenant.slug}] ---- MANUAL STEP ----`)
  console.log(`  In your Meta app dashboard → Webhooks → Add Subscription → Page`)
  console.log(`  Callback URL : ${CALLBACK_BASE}/${tenant.slug}`)
  console.log(`  Verify token : ${verifyToken}`)
  console.log(`  Fields       : leadgen`)
  console.log(`[${tenant.slug}] ---------------------`)

  return {
    slug: tenant.slug,
    page_id: page.id,
    page_name: page.name,
    callback_url: `${CALLBACK_BASE}/${tenant.slug}`,
    verify_token: verifyToken,
  }
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const only = process.argv[2]

  const query = sb.from('tenants').select('id, slug, name, workflow_config').eq('active', true)
  const { data, error } = await query
  if (error) {
    console.error('Tenant list failed:', error.message)
    process.exit(1)
  }
  const tenants = only ? data.filter((t) => t.slug === only) : data
  if (!tenants.length) {
    console.log('No matching tenants')
    return
  }

  const summary = []
  for (const t of tenants) {
    try {
      summary.push(await setupTenant(sb, t))
    } catch (err) {
      console.error(`[${t.slug}] ERROR:`, err.message)
      summary.push({ slug: t.slug, error: err.message })
    }
  }

  console.log('\n\n===== SUMMARY =====')
  for (const s of summary) console.log(s)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
