/**
 * Demo Data Seed Script
 * Creates 2 brand-new demo tenants with realistic fake data.
 *
 * - "Crystal Clear Windows" (window washing demo) → login: test / 123
 * - "Sparkle Home Cleaning" (house cleaning demo) → login: test2 / 123
 *
 * Run: node scripts/seed-demo-data.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local
const envPath = resolve(__dirname, '..', '.env.local')
const envContent = readFileSync(envPath, 'utf8')
const env = {}
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^#=][^=]*)=(.*)$/)
  if (m) env[m[1].trim()] = m[2].trim()
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY
const db = createClient(supabaseUrl, supabaseKey)

// ─── Helpers ─────────────────────────────────────────────────────────────────
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0] }
function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0] }
function isoAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString() }
function rp(min, max) { return parseFloat((Math.random() * (max - min) + min).toFixed(2)) }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Demo Tenant Seed ===\n')

  // PostgreSQL pgcrypto uses $2a$ prefix; Node bcryptjs uses $2b$. They're identical
  // algorithms but pgcrypto's crypt() doesn't recognize $2b$, so we swap the prefix.
  const passwordHash = bcrypt.hashSync('123', 10).replace('$2b$', '$2a$')
  console.log(`Password hash for "123": ${passwordHash.substring(0, 25)}...`)

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Create demo tenants
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- Creating demo tenants ---')

  const wwTenantData = {
    name: 'Crystal Clear Windows',
    slug: 'crystal-clear',
    business_name: 'Crystal Clear Windows',
    business_name_short: 'Crystal Clear',
    service_area: 'Springfield, IL',
    service_type: 'window_washing',
    currency: 'usd',
    timezone: 'America/Chicago',
    owner_phone: '+12175550001',
    owner_email: 'max@crystalclear.demo',
    google_review_link: 'https://g.page/crystalclear-demo',
    active: true,
    service_description: 'Window Cleaning, Gutter Cleaning, Power Washing',
    workflow_config: {
      use_stripe: true, use_card_on_file: true, assignment_mode: 'team_routing',
      use_team_routing: true, use_hcp_mirror: false, use_retargeting: false,
      cleaner_pay_model: 'percentage', use_cleaner_dispatch: true,
      sms_auto_response_enabled: false, use_vapi_inbound: false,
      use_broadcast_assignment: false, use_review_request: true,
    },
  }

  const hcTenantData = {
    name: 'Sparkle Home Cleaning',
    slug: 'sparkle-home',
    business_name: 'Sparkle Home Cleaning',
    business_name_short: 'Sparkle Home',
    service_area: 'Austin, TX',
    service_type: 'house_cleaning',
    currency: 'usd',
    timezone: 'America/Chicago',
    owner_phone: '+15125550001',
    owner_email: 'sarah@sparklehome.demo',
    google_review_link: 'https://g.page/sparklehome-demo',
    active: true,
    service_description: 'House Cleaning, Deep Cleaning, Move-In/Out Cleaning',
    workflow_config: {
      use_stripe: true, use_card_on_file: true, assignment_mode: 'broadcast',
      use_team_routing: false, use_hcp_mirror: false, use_retargeting: true,
      cleaner_pay_model: 'hourly', use_cleaner_dispatch: true,
      sms_auto_response_enabled: true, use_vapi_inbound: true,
      use_broadcast_assignment: true, use_review_request: true,
      lead_followup_enabled: true, lead_followup_stages: 5,
      cleaner_pay_hourly_standard: 25, cleaner_pay_hourly_deep: 30,
    },
  }

  // Upsert WW tenant
  let { data: wwTenant } = await db.from('tenants').select('id').eq('slug', 'crystal-clear').single()
  if (!wwTenant) {
    const { data, error } = await db.from('tenants').insert(wwTenantData).select('id').single()
    if (error) { console.error('WW tenant error:', error.message); return }
    wwTenant = data
    console.log(`  Created Crystal Clear Windows (id=${wwTenant.id})`)
  } else {
    console.log(`  Crystal Clear Windows exists (id=${wwTenant.id})`)
  }
  const WW = wwTenant.id

  // Upsert HC tenant
  let { data: hcTenant } = await db.from('tenants').select('id').eq('slug', 'sparkle-home').single()
  if (!hcTenant) {
    const { data, error } = await db.from('tenants').insert(hcTenantData).select('id').single()
    if (error) { console.error('HC tenant error:', error.message); return }
    hcTenant = data
    console.log(`  Created Sparkle Home Cleaning (id=${hcTenant.id})`)
  } else {
    console.log(`  Sparkle Home Cleaning exists (id=${hcTenant.id})`)
  }
  const HC = hcTenant.id

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Create test users
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- Creating test users ---')

  for (const { uname, display, email, tid, label } of [
    { uname: 'test', display: 'Max Demo', email: 'test@crystalclear.demo', tid: WW, label: 'Crystal Clear (WW)' },
    { uname: 'test2', display: 'Sarah Demo', email: 'test2@sparklehome.demo', tid: HC, label: 'Sparkle Home (HC)' },
  ]) {
    const { data: existing } = await db.from('users').select('id').eq('username', uname).single()
    if (existing) {
      await db.from('users').update({ password_hash: passwordHash, tenant_id: tid, is_active: true }).eq('id', existing.id)
      console.log(`  Updated user "${uname}" (id=${existing.id}) → ${label}`)
    } else {
      const { data, error } = await db.from('users').insert({
        username: uname, password_hash: passwordHash, display_name: display,
        email, tenant_id: tid, is_active: true,
      }).select('id').single()
      if (error) { console.error(`  User "${uname}" error:`, error.message); continue }
      console.log(`  Created user "${uname}" (id=${data.id}) → ${label}`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Cleaners
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- Seeding cleaners ---')

  async function ensureCleaner(c) {
    const { data: existing } = await db.from('cleaners').select('id').eq('username', c.username).single()
    if (existing) return existing.id
    const { data, error } = await db.from('cleaners').insert(c).select('id').single()
    if (error) { console.error(`  Cleaner "${c.name}":`, error.message); return null }
    return data.id
  }

  // WW cleaners (window washing)
  const wwCleanerDefs = [
    { name: 'Jake Miller', phone: '+12175551001', is_team_lead: true, employee_type: 'technician', role: 'team_lead', username: 'demo.jake', pin: '1111', hourly_rate: 28, home_address: '205 W Monroe St, Springfield, IL 62704' },
    { name: 'Ryan Cooper', phone: '+12175551002', is_team_lead: false, employee_type: 'technician', role: 'technician', username: 'demo.ryan', pin: '2222', hourly_rate: 22, home_address: '410 S 6th St, Springfield, IL 62701' },
    { name: 'Tyler Brooks', phone: '+12175551003', is_team_lead: false, employee_type: 'technician', role: 'technician', username: 'demo.tyler', pin: '3333', hourly_rate: 22, home_address: '1200 Wabash Ave, Springfield, IL 62704' },
    { name: 'Marcus Davis', phone: '+12175551004', is_team_lead: true, employee_type: 'technician', role: 'team_lead', username: 'demo.marcus', pin: '4444', hourly_rate: 28, home_address: '890 N Grand Ave, Springfield, IL 62702' },
    { name: 'Blake Thompson', phone: '+12175551005', is_team_lead: false, employee_type: 'salesman', role: 'salesman', username: 'demo.blake', pin: '5555', hourly_rate: 0, home_address: '320 Chatham Rd, Springfield, IL 62704' },
  ]

  const wwCleanerIds = []
  for (const def of wwCleanerDefs) {
    const id = await ensureCleaner({ ...def, tenant_id: WW, active: true, portal_token: randomUUID(), max_jobs_per_day: 5 })
    if (id) wwCleanerIds.push(id)
  }
  console.log(`  ${wwCleanerIds.length} WW cleaners`)

  // HC cleaners (house cleaning)
  const hcCleanerDefs = [
    { name: 'Maria Santos', phone: '+15125551001', is_team_lead: false, employee_type: 'technician', role: 'technician', username: 'demo.maria', pin: '6666', hourly_rate: 25, home_address: '1420 S Congress Ave, Austin, TX 78704' },
    { name: 'Jessica Reyes', phone: '+15125551002', is_team_lead: false, employee_type: 'technician', role: 'technician', username: 'demo.jessica', pin: '7777', hourly_rate: 25, home_address: '3200 Guadalupe St, Austin, TX 78705' },
    { name: 'Rosa Martinez', phone: '+15125551003', is_team_lead: true, employee_type: 'technician', role: 'technician', username: 'demo.rosa', pin: '8888', hourly_rate: 30, home_address: '5601 Burnet Rd, Austin, TX 78756' },
    { name: 'Lucia Torres', phone: '+15125551004', is_team_lead: false, employee_type: 'technician', role: 'technician', username: 'demo.lucia', pin: '9999', hourly_rate: 25, home_address: '2100 E Riverside Dr, Austin, TX 78741' },
    { name: 'Ana Flores', phone: '+15125551005', is_team_lead: false, employee_type: 'technician', role: 'technician', username: 'demo.ana', pin: '1010', hourly_rate: 25, home_address: '800 W 5th St, Austin, TX 78703' },
  ]

  const hcCleanerIds = []
  for (const def of hcCleanerDefs) {
    const id = await ensureCleaner({ ...def, tenant_id: HC, active: true, portal_token: randomUUID(), max_jobs_per_day: 4 })
    if (id) hcCleanerIds.push(id)
  }
  console.log(`  ${hcCleanerIds.length} HC cleaners`)

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Customers
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- Seeding customers ---')

  async function ensureCustomer(c) {
    const { data: existing } = await db.from('customers').select('id').eq('phone_number', c.phone_number).eq('tenant_id', c.tenant_id).single()
    if (existing) return existing.id
    const { data, error } = await db.from('customers').insert(c).select('id').single()
    if (error) { console.error(`  Customer "${c.first_name}":`, error.message); return null }
    return data.id
  }

  // WW customers (Springfield IL area)
  const wwCustDefs = [
    { first_name: 'Tom', last_name: 'Henderson', phone_number: '+12175550101', email: 'tom.h@demo.com', address: '445 W Adams St, Springfield, IL 62704' },
    { first_name: 'Sarah', last_name: 'Mitchell', phone_number: '+12175550102', email: 'sarah.m@demo.com', address: '1820 N Rutledge St, Springfield, IL 62702' },
    { first_name: 'Dave', last_name: 'Larson', phone_number: '+12175550103', address: '310 Chatham Rd, Springfield, IL 62704' },
    { first_name: 'Karen', last_name: "O'Brien", phone_number: '+12175550104', email: 'karen.ob@demo.com', address: '2200 S MacArthur Blvd, Springfield, IL 62704' },
    { first_name: 'Mike', last_name: 'Schneider', phone_number: '+12175550105', address: '890 E Monroe St, Springfield, IL 62701' },
    { first_name: 'Lisa', last_name: 'Hoffman', phone_number: '+12175550106', email: 'lisa.h@demo.com', address: '1105 S 2nd St, Springfield, IL 62704' },
    { first_name: 'James', last_name: 'Weber', phone_number: '+12175550107', address: '750 N Grand Ave W, Springfield, IL 62702' },
    { first_name: 'Nancy', last_name: 'Fischer', phone_number: '+12175550108', email: 'nancy.f@demo.com', address: '455 Stevenson Dr, Springfield, IL 62703' },
    { first_name: 'Bob', last_name: 'Keller', phone_number: '+12175550109', address: '1600 Toronto Rd, Springfield, IL 62712' },
    { first_name: 'Jennifer', last_name: 'Roth', phone_number: '+12175550110', email: 'jen.r@demo.com', address: '320 W Lawrence Ave, Springfield, IL 62704' },
    { first_name: 'Steve', last_name: 'Mueller', phone_number: '+12175550111', address: '200 E Cook St, Springfield, IL 62703' },
    { first_name: 'Diane', last_name: 'Braun', phone_number: '+12175550112', email: 'diane.b@demo.com', address: '615 N Walnut St, Springfield, IL 62702' },
  ]

  const wwCustIds = []
  for (const c of wwCustDefs) {
    const id = await ensureCustomer({ ...c, tenant_id: WW, lifecycle_stage: 'active', lead_source: pick(['referral', 'website', 'sms']) })
    if (id) wwCustIds.push(id)
  }
  console.log(`  ${wwCustIds.length} WW customers`)

  // HC customers (Austin TX area)
  const hcCustDefs = [
    { first_name: 'Ashley', last_name: 'Chen', phone_number: '+15125550201', email: 'ashley.c@demo.com', address: '1234 S Lamar Blvd, Austin, TX 78704', bedrooms: 3, bathrooms: 2 },
    { first_name: 'Brandon', last_name: 'Williams', phone_number: '+15125550202', email: 'brandon.w@demo.com', address: '5678 Burnet Rd, Austin, TX 78756', bedrooms: 4, bathrooms: 3 },
    { first_name: 'Christine', last_name: 'Park', phone_number: '+15125550203', address: '910 E 6th St, Austin, TX 78702', bedrooms: 2, bathrooms: 1 },
    { first_name: 'Daniel', last_name: 'Nguyen', phone_number: '+15125550204', email: 'daniel.n@demo.com', address: '2345 W 35th St, Austin, TX 78703', bedrooms: 3, bathrooms: 2 },
    { first_name: 'Emily', last_name: 'Rodriguez', phone_number: '+15125550205', email: 'emily.r@demo.com', address: '4567 S Congress Ave, Austin, TX 78745', bedrooms: 5, bathrooms: 4 },
    { first_name: 'Frank', last_name: 'Kim', phone_number: '+15125550206', address: '7890 N Lamar Blvd, Austin, TX 78752', bedrooms: 2, bathrooms: 2 },
    { first_name: 'Grace', last_name: 'Johnson', phone_number: '+15125550207', email: 'grace.j@demo.com', address: '1111 W 5th St, Austin, TX 78703', bedrooms: 4, bathrooms: 3 },
    { first_name: 'Henry', last_name: 'Lopez', phone_number: '+15125550208', address: '3333 E Cesar Chavez St, Austin, TX 78702', bedrooms: 3, bathrooms: 2 },
    { first_name: 'Isabella', last_name: 'Garcia', phone_number: '+15125550209', email: 'isabella.g@demo.com', address: '5555 Manchaca Rd, Austin, TX 78745', bedrooms: 3, bathrooms: 2 },
    { first_name: 'Kevin', last_name: 'Tanaka', phone_number: '+15125550210', email: 'kevin.t@demo.com', address: '7777 Anderson Ln, Austin, TX 78757', bedrooms: 4, bathrooms: 3 },
    { first_name: 'Laura', last_name: 'Patel', phone_number: '+15125550211', address: '9999 Research Blvd, Austin, TX 78759', bedrooms: 2, bathrooms: 1 },
    { first_name: 'Michael', last_name: 'Thompson', phone_number: '+15125550212', email: 'mike.t@demo.com', address: '2222 Barton Springs Rd, Austin, TX 78704', bedrooms: 5, bathrooms: 4 },
  ]

  const hcCustIds = []
  for (const c of hcCustDefs) {
    const id = await ensureCustomer({ ...c, tenant_id: HC, lifecycle_stage: 'active', lead_source: pick(['meta', 'website', 'sms', 'phone']) })
    if (id) hcCustIds.push(id)
  }
  console.log(`  ${hcCustIds.length} HC customers`)

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: WW Jobs + Visits
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- Seeding WW jobs + visits ---')

  const wwServices = ['Exterior Windows', 'Interior + Exterior', 'Storm Windows', 'Gutter Cleaning', 'Power Wash + Windows', 'Screen Cleaning']

  const wwJobConfigs = [
    // 6 completed
    { status: 'completed', date: daysAgo(35), price: 285, svc: 0 },
    { status: 'completed', date: daysAgo(28), price: 445, svc: 1 },
    { status: 'completed', date: daysAgo(21), price: 320, svc: 2 },
    { status: 'completed', date: daysAgo(14), price: 190, svc: 3 },
    { status: 'completed', date: daysAgo(7), price: 560, svc: 4 },
    { status: 'completed', date: daysAgo(3), price: 375, svc: 1 },
    // 3 in_progress
    { status: 'in_progress', date: daysAgo(0), price: 375, svc: 1 },
    { status: 'in_progress', date: daysAgo(0), price: 250, svc: 0 },
    { status: 'in_progress', date: daysAgo(1), price: 410, svc: 2 },
    // 4 scheduled (future)
    { status: 'scheduled', date: daysFromNow(1), price: 295, svc: 0 },
    { status: 'scheduled', date: daysFromNow(3), price: 480, svc: 1 },
    { status: 'scheduled', date: daysFromNow(5), price: 350, svc: 4 },
    { status: 'scheduled', date: daysFromNow(7), price: 220, svc: 5 },
    // 3 pending
    { status: 'pending', date: daysFromNow(10), price: 525, svc: 1 },
    { status: 'pending', date: daysFromNow(14), price: 310, svc: 0 },
    { status: 'pending', date: daysFromNow(21), price: 400, svc: 2 },
  ]

  const wwJobIds = []
  for (let i = 0; i < wwJobConfigs.length; i++) {
    const j = wwJobConfigs[i]
    const ci = i % wwCustIds.length
    const cli = i % wwCleanerIds.length

    const { data, error } = await db.from('jobs').insert({
      tenant_id: WW,
      customer_id: wwCustIds[ci],
      phone_number: wwCustDefs[ci].phone_number,
      address: wwCustDefs[ci].address,
      service_type: wwServices[j.svc],
      date: j.date,
      scheduled_at: j.date ? `${j.date}T14:00:00.000Z` : null,
      price: j.price,
      hours: (j.price / 100).toFixed(1),
      cleaners: j.status === 'pending' ? 0 : 2,
      status: j.status,
      booked: j.status !== 'pending',
      paid: j.status === 'completed',
      payment_status: j.status === 'completed' ? 'fully_paid' : 'pending',
      cleaner_id: j.status !== 'pending' ? wwCleanerIds[cli] : null,
      cleaner_confirmed: ['in_progress', 'completed'].includes(j.status),
      completed_at: j.status === 'completed' ? `${j.date}T20:00:00+00:00` : null,
      job_type: 'cleaning',
      frequency: i < 4 ? 'quarterly' : 'one-time',
      source: 'manual',
    }).select('id').single()

    if (error) { console.error(`  WW job:`, error.message); continue }
    wwJobIds.push({ id: data.id, ...j, custIdx: ci, cleanerIdx: cli })
  }
  console.log(`  ${wwJobIds.length} WW jobs`)

  // Create visits for non-pending jobs
  let visitCount = 0
  for (const job of wwJobIds) {
    if (job.status === 'pending') continue

    const isComplete = job.status === 'completed'
    const isActive = job.status === 'in_progress'

    const visitData = {
      job_id: job.id, tenant_id: WW, visit_date: job.date,
      status: isComplete ? 'closed' : isActive ? 'in_progress' : 'not_started',
      started_at: isComplete ? `${job.date}T14:15:00+00:00` : isActive ? `${job.date}T14:00:00+00:00` : null,
      stopped_at: isComplete ? `${job.date}T17:30:00+00:00` : null,
      completed_at: isComplete ? `${job.date}T17:35:00+00:00` : null,
      closed_at: isComplete ? `${job.date}T17:40:00+00:00` : null,
      technicians: [wwCleanerIds[job.cleanerIdx]],
      checklist_completed: isComplete,
      payment_type: isComplete ? pick(['card', 'cash', 'check']) : null,
      payment_amount: isComplete ? job.price : null,
      tip_amount: isComplete ? pick([0, 10, 15, 20, 25, 30]) : 0,
      payment_recorded: isComplete,
    }

    const { data: visit, error } = await db.from('visits').insert(visitData).select('id').single()
    if (error) { console.error(`  Visit:`, error.message); continue }
    visitCount++

    // Line items
    const items = [
      { visit_id: visit.id, job_id: job.id, tenant_id: WW, service_name: wwServices[job.svc], description: `Full ${wwServices[job.svc].toLowerCase()} service`, price: job.price * 0.85, revenue_type: 'original_quote' },
    ]
    if (isComplete && visitCount % 2 === 0) {
      items.push({ visit_id: visit.id, job_id: job.id, tenant_id: WW, service_name: 'Screen Cleaning Add-on', description: 'Upsold during visit', price: job.price * 0.15, revenue_type: 'technician_upsell', added_by: wwCleanerIds[job.cleanerIdx] })
    }
    await db.from('visit_line_items').insert(items)

    // Checklist
    const checkItems = ['Windows cleaned streak-free', 'Screens removed & cleaned', 'Sills wiped down', 'Drop cloths removed', 'Customer walkthrough'].map((text, idx) => ({
      visit_id: visit.id, tenant_id: WW, item_text: text, is_completed: isComplete,
      completed_at: isComplete ? visitData.completed_at : null,
      completed_by: isComplete ? wwCleanerIds[job.cleanerIdx] : null,
      sort_order: idx + 1,
    }))
    await db.from('visit_checklists').insert(checkItems)
  }
  console.log(`  ${visitCount} visits with line items + checklists`)

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: WW Quotes
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- Seeding WW quotes ---')

  const qStatuses = ['pending', 'pending', 'approved', 'converted', 'expired', 'declined']
  let qCount = 0

  for (let i = 0; i < 6; i++) {
    const ci = (i + 5) % wwCustIds.length
    const total = rp(200, 650)

    const { data: quote, error } = await db.from('quotes').insert({
      tenant_id: WW, customer_id: wwCustIds[ci],
      token: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').substring(0, 16),
      status: qStatuses[i],
      customer_name: `${wwCustDefs[ci].first_name} ${wwCustDefs[ci].last_name}`,
      customer_phone: wwCustDefs[ci].phone_number,
      customer_email: wwCustDefs[ci].email || null,
      customer_address: wwCustDefs[ci].address,
      total_price: total, service_category: 'standard',
      approved_at: ['approved', 'converted'].includes(qStatuses[i]) ? isoAgo(5) : null,
      approved_by: ['approved', 'converted'].includes(qStatuses[i]) ? 'salesman' : null,
      valid_until: daysFromNow(qStatuses[i] === 'expired' ? -10 : 30) + 'T23:59:59Z',
      notes: `Demo quote — ${wwServices[i]}`,
      salesman_id: wwCleanerIds[4],
    }).select('id').single()

    if (error) { console.error(`  Quote:`, error.message); continue }
    qCount++

    await db.from('quote_line_items').insert([
      { quote_id: quote.id, tenant_id: WW, service_name: wwServices[i], description: 'Full service', price: total * 0.75, revenue_type: 'original_quote' },
      { quote_id: quote.id, tenant_id: WW, service_name: 'Travel Fee', description: 'Mileage', price: total * 0.25, revenue_type: 'original_quote' },
    ])
  }
  console.log(`  ${qCount} quotes`)

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 7: WW Service Plans
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- Seeding WW service plans ---')

  const planConfigs = [
    { type: 'quarterly', months: [1,4,7,10], price: 280, normal: 350, visits: 4, slug: 'demo-quarterly' },
    { type: 'triannual', months: [2,6,10], price: 350, normal: 440, visits: 3, slug: 'demo-triannual' },
    { type: 'biannual', months: [3,9], price: 400, normal: 500, visits: 2, slug: 'demo-biannual' },
  ]

  let planCount = 0
  for (let i = 0; i < planConfigs.length; i++) {
    const p = planConfigs[i]
    const { data: existing } = await db.from('service_plans').select('id').eq('slug', p.slug).eq('tenant_id', WW).single()
    if (existing) { planCount++; continue }

    const intervalMonths = { quarterly: 3, triannual: 4, biannual: 6 }[p.type]
    const { data: plan, error } = await db.from('service_plans').insert({
      tenant_id: WW, customer_id: wwCustIds[i],
      name: `${wwCustDefs[i].first_name}'s ${p.type} plan`,
      slug: p.slug, plan_type: p.type, service_months: p.months,
      plan_price: p.price, normal_price: p.normal, visits_per_year: p.visits,
      interval_months: intervalMonths,
      discount_per_visit: p.normal - p.price,
      discount_type: 'flat',
      status: 'active', salesman_id: wwCleanerIds[4],
      first_service_date: daysAgo(60), start_date: daysAgo(90), end_date: daysFromNow(275),
      agreement_text: `By signing, you agree to ${p.visits} window cleaning visits per year at $${p.price} each (normally $${p.normal}).`,
      active: true,
    }).select('id').single()

    if (error) { console.error(`  Plan:`, error.message); continue }
    planCount++

    // Generate service plan jobs
    const now = new Date()
    const curMonth = now.getMonth() + 1
    const curYear = now.getFullYear()
    for (const month of p.months) {
      const year = month >= curMonth ? curYear : curYear + 1
      await db.from('service_plan_jobs').insert({
        service_plan_id: plan.id, customer_id: wwCustIds[i], tenant_id: WW,
        scheduled_month: month, scheduled_year: year, target_week: 2,
        status: year === curYear && month < curMonth ? 'completed' : 'unscheduled',
      })
    }
  }
  console.log(`  ${planCount} service plans with jobs`)

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 8: WW Pay Rates + Payroll
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- Seeding WW pay rates + payroll ---')

  for (let i = 0; i < wwCleanerIds.length; i++) {
    const role = wwCleanerDefs[i].role
    const { data: existing } = await db.from('pay_rates').select('id').eq('cleaner_id', wwCleanerIds[i]).single()
    if (existing) continue
    await db.from('pay_rates').insert({
      cleaner_id: wwCleanerIds[i], tenant_id: WW, role,
      base_rate: role === 'salesman' ? 0 : wwCleanerDefs[i].hourly_rate,
      commission_1time_pct: role === 'salesman' ? 15 : 0,
      commission_triannual_pct: role === 'salesman' ? 10 : 0,
      commission_quarterly_pct: role === 'salesman' ? 8 : 0,
      effective_from: daysAgo(90),
    })
  }

  // 2 payroll weeks
  for (let w = 1; w <= 2; w++) {
    const wStart = daysAgo(w * 7)
    const wEnd = daysAgo((w - 1) * 7)

    const { data: pw, error } = await db.from('payroll_weeks').insert({ tenant_id: WW, week_start: wStart, week_end: wEnd }).select('id').single()
    if (error) { console.error(`  Payroll week:`, error.message); continue }

    for (let i = 0; i < 4; i++) {
      const revenue = rp(800, 2200)
      const hours = rp(32, 45)
      const ot = hours > 40 ? hours - 40 : 0
      const pct = wwCleanerDefs[i].role === 'team_lead' ? 35 : 30
      await db.from('payroll_entries').insert({
        payroll_week_id: pw.id, tenant_id: WW, cleaner_id: wwCleanerIds[i],
        role: wwCleanerDefs[i].role, revenue_completed: revenue, pay_percentage: pct,
        hours_worked: hours, overtime_hours: ot, overtime_rate: 1.5,
        total_pay: (revenue * pct / 100) + (ot * wwCleanerDefs[i].hourly_rate * 1.5),
      })
    }
    // Salesman
    await db.from('payroll_entries').insert({
      payroll_week_id: pw.id, tenant_id: WW, cleaner_id: wwCleanerIds[4],
      role: 'salesman', revenue_completed: 0, pay_percentage: 0,
      hours_worked: 40, overtime_hours: 0,
      commission_1time: rp(100, 300), commission_triannual: rp(50, 150), commission_quarterly: rp(40, 120),
      total_pay: rp(200, 500),
    })
  }
  console.log(`  Pay rates + 2 payroll weeks`)

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 9: WW Tags + Templates + Messages
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- Seeding WW tags, templates, messages ---')

  // Customer tags
  let tagC = 0
  const tagLabels = ['VIP', 'Residential', 'Commercial', 'HOA', 'Repeat', 'Referral Source', 'Dog on property', 'Gate code needed']
  for (let i = 0; i < Math.min(8, wwCustIds.length); i++) {
    const tags = [{ customer_id: wwCustIds[i], tenant_id: WW, tag_type: 'custom', tag_value: tagLabels[i] }]
    if (i < 3) tags.push({ customer_id: wwCustIds[i], tenant_id: WW, tag_type: 'service_plan', tag_value: planConfigs[i].type })
    if (i % 2 === 0) tags.push({ customer_id: wwCustIds[i], tenant_id: WW, tag_type: 'salesman', tag_value: 'Blake Thompson' })
    for (const t of tags) {
      const { error } = await db.from('customer_tags').insert(t)
      if (!error) tagC++
    }
  }

  // Tag definitions
  const tdColors = { VIP: '#FFD700', Residential: '#4CAF50', Commercial: '#2196F3', HOA: '#9C27B0', Repeat: '#FF9800', 'Referral Source': '#E91E63', 'Dog on property': '#795548', 'Gate code needed': '#607D8B' }
  for (const [val, color] of Object.entries(tdColors)) {
    const { data: existing } = await db.from('tag_definitions').select('id').eq('tag_value', val).eq('tenant_id', WW).single()
    if (!existing) await db.from('tag_definitions').insert({ tenant_id: WW, tag_type: 'custom', tag_value: val, color, is_active: true })
  }

  // Checklist templates
  for (const t of [
    { name: 'Standard Window Clean', items: ['Windows streak-free', 'Screens cleaned', 'Sills wiped', 'Drop cloths removed', 'Walkthrough'], is_default: true },
    { name: 'Gutter + Window Combo', items: ['Gutters cleared', 'Downspouts flushed', 'Windows cleaned', 'Screens cleaned', 'Sign-off'], is_default: false },
  ]) {
    const { data: existing } = await db.from('checklist_templates').select('id').eq('name', t.name).eq('tenant_id', WW).single()
    if (!existing) await db.from('checklist_templates').insert({ ...t, tenant_id: WW })
  }

  // Automated messages
  for (const m of [
    { trigger_type: 'on_my_way', message_template: "Hi {{customer_name}}! This is {{technician_name}} from Crystal Clear. I'm on my way — be there in about {{eta}} minutes!", is_active: true },
    { trigger_type: 'receipt', message_template: "Thanks {{customer_name}}! Your receipt:\n\nServices: {{services}}\nTotal: ${{total}}\nPaid via: {{payment_method}}\n\nAppreciate your business!", is_active: true },
    { trigger_type: 'review_request', message_template: "Hi {{customer_name}}, thanks for choosing Crystal Clear! Mind leaving a quick review? {{review_link}}", is_active: true },
  ]) {
    const { data: existing } = await db.from('automated_messages').select('id').eq('trigger_type', m.trigger_type).eq('tenant_id', WW).single()
    if (!existing) await db.from('automated_messages').insert({ ...m, tenant_id: WW })
  }

  console.log(`  ${tagC} customer tags, tag defs, checklist templates, message templates`)

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 10: HC Jobs
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- Seeding HC jobs ---')

  const hcServices = ['Standard Clean', 'Deep Clean', 'Move-out Clean', 'Move-in Clean', 'Post-Construction']

  const hcJobConfigs = [
    { status: 'completed', date: daysAgo(30), price: 250, svc: 0 },
    { status: 'completed', date: daysAgo(25), price: 180, svc: 0 },
    { status: 'completed', date: daysAgo(18), price: 350, svc: 2 },
    { status: 'completed', date: daysAgo(12), price: 150, svc: 0 },
    { status: 'completed', date: daysAgo(7), price: 420, svc: 1 },
    { status: 'completed', date: daysAgo(3), price: 200, svc: 0 },
    { status: 'completed', date: daysAgo(1), price: 550, svc: 4 },
    // 3 in_progress
    { status: 'in_progress', date: daysAgo(0), price: 280, svc: 1 },
    { status: 'in_progress', date: daysAgo(0), price: 175, svc: 0 },
    { status: 'in_progress', date: daysAgo(0), price: 300, svc: 3 },
    // 5 scheduled
    { status: 'scheduled', date: daysFromNow(1), price: 190, svc: 0 },
    { status: 'scheduled', date: daysFromNow(2), price: 350, svc: 1 },
    { status: 'scheduled', date: daysFromNow(4), price: 225, svc: 0 },
    { status: 'scheduled', date: daysFromNow(6), price: 500, svc: 2 },
    { status: 'scheduled', date: daysFromNow(8), price: 175, svc: 0 },
    // 3 pending
    { status: 'pending', date: daysFromNow(12), price: 280, svc: 1 },
    { status: 'pending', date: daysFromNow(15), price: 160, svc: 0 },
    { status: 'pending', date: daysFromNow(20), price: 450, svc: 2 },
  ]

  let hcJobCount = 0
  for (let i = 0; i < hcJobConfigs.length; i++) {
    const j = hcJobConfigs[i]
    const ci = i % hcCustIds.length
    const cli = i % hcCleanerIds.length

    const { error } = await db.from('jobs').insert({
      tenant_id: HC, customer_id: hcCustIds[ci],
      phone_number: hcCustDefs[ci].phone_number, address: hcCustDefs[ci].address,
      service_type: hcServices[j.svc], date: j.date,
      scheduled_at: j.date ? `${j.date}T10:00:00.000Z` : null,
      price: j.price, hours: (j.price / 50).toFixed(1),
      cleaners: j.status === 'pending' ? 0 : 1,
      status: j.status, booked: j.status !== 'pending',
      paid: j.status === 'completed',
      payment_status: j.status === 'completed' ? 'fully_paid' : 'pending',
      cleaner_id: j.status !== 'pending' ? hcCleanerIds[cli] : null,
      cleaner_confirmed: ['in_progress', 'completed'].includes(j.status),
      completed_at: j.status === 'completed' ? `${j.date}T16:00:00+00:00` : null,
      job_type: 'cleaning', frequency: i < 4 ? 'biweekly' : i < 7 ? 'monthly' : 'one-time',
      bedrooms: hcCustDefs[ci].bedrooms, bathrooms: hcCustDefs[ci].bathrooms,
      source: 'manual',
    })
    if (!error) hcJobCount++
    else console.error(`  HC job:`, error.message)
  }
  console.log(`  ${hcJobCount} HC jobs`)

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 11: HC Leads
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- Seeding HC leads ---')

  const leadDefs = [
    { status: 'new', first: 'Alex', last: 'Rivera', phone: '+15125550301', source: 'meta' },
    { status: 'new', first: 'Samantha', last: 'Wong', phone: '+15125550302', source: 'website' },
    { status: 'new', first: 'Tyler', last: 'Okafor', phone: '+15125550303', source: 'phone' },
    { status: 'contacted', first: 'Megan', last: 'Brooks', phone: '+15125550304', source: 'meta' },
    { status: 'contacted', first: 'Jordan', last: 'Lee', phone: '+15125550305', source: 'website' },
    { status: 'qualified', first: 'Rachel', last: 'Kumar', phone: '+15125550306', source: 'phone' },
    { status: 'qualified', first: 'Nathan', last: 'Davis', phone: '+15125550307', source: 'meta' },
    { status: 'booked', first: 'Sophie', last: 'Hernandez', phone: '+15125550308', source: 'website' },
    { status: 'booked', first: 'Marcus', last: 'Bell', phone: '+15125550309', source: 'sms' },
    { status: 'booked', first: 'Olivia', last: 'Price', phone: '+15125550310', source: 'meta' },
  ]

  let leadCount = 0
  for (const l of leadDefs) {
    const stage = { new: 0, contacted: 1, qualified: 2, booked: 3 }[l.status]
    const { error } = await db.from('leads').insert({
      tenant_id: HC, source_id: `demo-${randomUUID().substring(0, 8)}`,
      source: l.source, phone_number: l.phone,
      first_name: l.first, last_name: l.last, status: l.status,
      followup_stage: stage,
      followup_started_at: stage > 0 ? isoAgo(stage * 3) : null,
      last_contact_at: stage > 0 ? isoAgo(1) : null,
      form_data: {
        name: `${l.first} ${l.last}`, phone: l.phone.replace('+1', ''),
        source: l.source, service_type: pick(['standard-clean', 'deep-clean', 'move-out']),
        bedrooms: Math.floor(Math.random() * 3) + 2,
        bathrooms: Math.floor(Math.random() * 2) + 1,
      },
    })
    if (!error) leadCount++
    else console.error(`  Lead:`, error.message)
  }
  console.log(`  ${leadCount} leads`)

  // ═══════════════════════════════════════════════════════════════════════════
  // DONE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n========================================')
  console.log('  DEMO TENANTS READY')
  console.log('========================================')
  console.log('')
  console.log('  Window Washing Demo:')
  console.log('    Tenant: Crystal Clear Windows')
  console.log('    Login:  test / 123')
  console.log('    Data:   12 customers, 5 crew, 16 jobs,')
  console.log('            visits, quotes, service plans, payroll')
  console.log('')
  console.log('  House Cleaning Demo:')
  console.log('    Tenant: Sparkle Home Cleaning')
  console.log('    Login:  test2 / 123')
  console.log('    Data:   12 customers, 5 crew, 18 jobs, 10 leads')
  console.log('')
}

main().catch(console.error)
