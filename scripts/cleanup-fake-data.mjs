/**
 * Cleanup script: removes ALL fake demo data from the REAL tenants
 * (Spotless Scrubbers and WinBros) that was accidentally seeded.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '..', '.env.local')
const envContent = readFileSync(envPath, 'utf8')
const env = {}
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^#=][^=]*)=(.*)$/)
  if (m) env[m[1].trim()] = m[2].trim()
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const SS = '2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df' // Real Spotless
const WB = 'e954fbd6-b3e1-4271-88b0-341c9df56beb' // Real WinBros

// Fake phone patterns inserted by the first seed run
const fakeSSCustPhones = [
  '+13105550201','+13105550202','+13105550203','+13105550204',
  '+13105550205','+13105550206','+13105550207','+13105550208',
  '+13105550209','+13105550210','+13105550211','+13105550212',
]
const fakeSSLeadPhones = [
  '+13105550301','+13105550302','+13105550303','+13105550304',
  '+13105550305','+13105550306','+13105550307','+13105550308',
]
const fakeSSCleanerUsernames = ['maria.santos','jessica.reyes','rosa.martinez','lucia.torres']

const fakeWBCustPhones = [
  '+13095550101','+13095550102','+13095550103','+13095550104',
  '+13095550105','+13095550106','+13095550107','+13095550108',
  '+13095550109','+13095550110','+13095550111','+13095550112',
]
const fakeWBCleanerUsernames = ['jake.miller','ryan.cooper','tyler.brooks','marcus.davis','blake.thompson']

async function cleanup() {
  console.log('=== CLEANING FAKE DATA FROM REAL TENANTS ===\n')

  // ─── SPOTLESS SCRUBBERS ─────────────────────────────────────────────
  console.log('--- Spotless Scrubbers ---')

  // Get fake customer IDs
  const { data: fakeSsCusts } = await db.from('customers')
    .select('id').eq('tenant_id', SS).in('phone_number', fakeSSCustPhones)
  const ssCustIds = (fakeSsCusts || []).map(c => c.id)
  console.log(`  Found ${ssCustIds.length} fake customers`)

  // Delete jobs referencing fake customers
  if (ssCustIds.length > 0) {
    const { data: dj } = await db.from('jobs').delete()
      .eq('tenant_id', SS).in('customer_id', ssCustIds).select('id')
    console.log(`  Deleted ${dj?.length || 0} fake jobs`)

    // Delete customers
    const { data: dc } = await db.from('customers').delete()
      .eq('tenant_id', SS).in('phone_number', fakeSSCustPhones).select('id')
    console.log(`  Deleted ${dc?.length || 0} fake customers`)
  }

  // Delete fake leads
  const { data: dl } = await db.from('leads').delete()
    .eq('tenant_id', SS).in('phone_number', fakeSSLeadPhones).select('id')
  console.log(`  Deleted ${dl?.length || 0} fake leads`)

  // Delete fake cleaners
  const { data: fakeSsCleaners } = await db.from('cleaners')
    .select('id').eq('tenant_id', SS).in('username', fakeSSCleanerUsernames)
  const ssCleanerIds = (fakeSsCleaners || []).map(c => c.id)

  if (ssCleanerIds.length > 0) {
    // Unassign from any jobs first
    for (const cid of ssCleanerIds) {
      await db.from('jobs').update({ cleaner_id: null }).eq('cleaner_id', cid)
    }
    const { data: dsc } = await db.from('cleaners').delete()
      .in('id', ssCleanerIds).select('id')
    console.log(`  Deleted ${dsc?.length || 0} fake cleaners`)
  }

  // ─── WINBROS ────────────────────────────────────────────────────────
  console.log('\n--- WinBros ---')

  // Get fake customer IDs
  const { data: fakeWbCusts } = await db.from('customers')
    .select('id').eq('tenant_id', WB).in('phone_number', fakeWBCustPhones)
  const wbCustIds = (fakeWbCusts || []).map(c => c.id)
  console.log(`  Found ${wbCustIds.length} fake customers`)

  if (wbCustIds.length > 0) {
    // Get fake job IDs
    const { data: fakeJobs } = await db.from('jobs')
      .select('id').eq('tenant_id', WB).in('customer_id', wbCustIds)
    const fakeJobIds = (fakeJobs || []).map(j => j.id)

    if (fakeJobIds.length > 0) {
      // Delete visits + their children
      const { data: fakeVisits } = await db.from('visits')
        .select('id').in('job_id', fakeJobIds)
      const fakeVisitIds = (fakeVisits || []).map(v => v.id)

      if (fakeVisitIds.length > 0) {
        await db.from('visit_checklists').delete().in('visit_id', fakeVisitIds)
        await db.from('visit_line_items').delete().in('visit_id', fakeVisitIds)
        const { data: dv } = await db.from('visits').delete()
          .in('id', fakeVisitIds).select('id')
        console.log(`  Deleted ${dv?.length || 0} fake visits`)
      }

      const { data: dj } = await db.from('jobs').delete()
        .in('id', fakeJobIds).select('id')
      console.log(`  Deleted ${dj?.length || 0} fake jobs`)
    }

    // Delete quotes for fake customers
    const { data: dq } = await db.from('quotes').delete()
      .eq('tenant_id', WB).in('customer_id', wbCustIds).select('id')
    console.log(`  Deleted ${dq?.length || 0} fake quotes`)

    // Delete customer tags
    await db.from('customer_tags').delete()
      .eq('tenant_id', WB).in('customer_id', wbCustIds)

    // Delete customers
    const { data: dc } = await db.from('customers').delete()
      .in('id', wbCustIds).select('id')
    console.log(`  Deleted ${dc?.length || 0} fake customers`)
  }

  // Delete fake WB cleaners
  const { data: fakeWbCleaners } = await db.from('cleaners')
    .select('id').eq('tenant_id', WB).in('username', fakeWBCleanerUsernames)
  const wbCleanerIds = (fakeWbCleaners || []).map(c => c.id)

  if (wbCleanerIds.length > 0) {
    await db.from('pay_rates').delete().in('cleaner_id', wbCleanerIds)
    await db.from('payroll_entries').delete().in('cleaner_id', wbCleanerIds)
    for (const cid of wbCleanerIds) {
      await db.from('jobs').update({ cleaner_id: null }).eq('cleaner_id', cid)
    }
    const { data: dwc } = await db.from('cleaners').delete()
      .in('id', wbCleanerIds).select('id')
    console.log(`  Deleted ${dwc?.length || 0} fake cleaners`)
  }

  // Delete tag defs, checklist templates, messages added to real WB
  await db.from('tag_definitions').delete().eq('tenant_id', WB)
    .in('tag_value', ['VIP','Residential','Commercial','HOA','Repeat','Referral Source','Dog on property','Gate code needed'])
  await db.from('checklist_templates').delete().eq('tenant_id', WB)
    .in('name', ['Standard Window Clean','Gutter + Window Combo','Power Wash'])
  await db.from('automated_messages').delete().eq('tenant_id', WB)
    .in('trigger_type', ['on_my_way','receipt','review_request','thank_you_tip'])

  // Delete orphaned payroll weeks
  const { data: pwWeeks } = await db.from('payroll_weeks')
    .select('id').eq('tenant_id', WB)
  for (const pw of (pwWeeks || [])) {
    const { data: entries } = await db.from('payroll_entries')
      .select('id').eq('payroll_week_id', pw.id)
    if (!entries || entries.length === 0) {
      await db.from('payroll_weeks').delete().eq('id', pw.id)
    }
  }

  console.log('\n=== CLEANUP COMPLETE ===')
  console.log('All fake data removed from real Spotless and WinBros tenants.')
}

cleanup().catch(console.error)
