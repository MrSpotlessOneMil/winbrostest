import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { scheduleLeadFollowUp } from '@/lib/scheduler'
import { logSystemEvent } from '@/lib/system-events'
import { getAllActiveTenants } from '@/lib/tenant'

/**
 * Cron: Poll Google Sheets for Meta Lead Ad leads (multi-tenant)
 * Runs every 5 minutes. For each tenant with a meta_sheet_id in workflow_config,
 * fetches the sheet as CSV, deduplicates against existing leads, and ingests new ones.
 *
 * Sheet must be shared as "Anyone with the link can view".
 * Dedup key: source_id = 'meta-sheet-{meta_lead_id}'
 *
 * Expected columns (from Meta Lead Ads → Google Sheets integration):
 * id, created_time, ad_id, ad_name, ..., full_name, phone_number, email, street_address, ...
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  try {
    const allTenants = await getAllActiveTenants()
    const sheetTenants = allTenants.filter(t => {
      const wc = t.workflow_config as Record<string, unknown>
      return !!wc?.meta_sheet_id
    })

    if (!sheetTenants.length) {
      return NextResponse.json({ success: true, message: 'No tenants with meta_sheet_id configured' })
    }

    const client = getSupabaseServiceClient()
    const results: Record<string, { ingested: number; skipped: number; errors: number }> = {}

    for (const tenant of sheetTenants) {
      const wc = tenant.workflow_config as Record<string, unknown>
      const sheetId = wc.meta_sheet_id as string

      let ingested = 0
      let skipped = 0
      let errors = 0

      try {
        // Fetch sheet as CSV (requires "Anyone with the link" sharing)
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)

        const res = await fetch(
          `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`,
          { signal: controller.signal }
        )
        clearTimeout(timeout)

        if (!res.ok) {
          console.error(`[Meta Sheet] Failed to fetch sheet for ${tenant.slug}: ${res.status}`)
          results[tenant.slug] = { ingested: 0, skipped: 0, errors: 1 }
          continue
        }

        const csvText = await res.text()
        const rows = parseCSV(csvText)

        if (rows.length < 2) {
          results[tenant.slug] = { ingested: 0, skipped: 0, errors: 0 }
          continue
        }

        const headers = rows[0].map(h => h.toLowerCase().trim())
        const idxId = headers.indexOf('id')
        const idxCreated = headers.indexOf('created_time')
        const idxFullName = headers.indexOf('full_name')
        const idxPhone = headers.indexOf('phone_number')
        const idxEmail = headers.indexOf('email')
        const idxAddress = headers.indexOf('street_address')
        const idxService = headers.findIndex(h => h.includes('service'))
        const idxNotes = headers.findIndex(h => h.includes('special_requests') || h.includes('notes'))
        const idxAdName = headers.indexOf('ad_name')
        const idxCampaign = headers.indexOf('campaign_name')

        if (idxPhone === -1) {
          console.error(`[Meta Sheet] No phone_number column found for ${tenant.slug}`)
          results[tenant.slug] = { ingested: 0, skipped: 0, errors: 1 }
          continue
        }

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]
          if (!row || row.length < 3) continue

          // Extract and normalize phone — strip "p:" prefix from Meta export
          const rawPhone = (row[idxPhone] || '').replace(/^p:/, '').trim()
          const phone = normalizePhoneNumber(rawPhone)
          if (!phone) continue

          // Build dedup key from Meta lead ID
          const metaId = (row[idxId] || '').replace(/^l:/, '').trim()
          const sourceId = metaId ? `meta-sheet-${metaId}` : `meta-sheet-${phone}-${i}`

          // Check if already ingested
          const { data: existing } = await client
            .from('leads')
            .select('id')
            .eq('source_id', sourceId)
            .eq('tenant_id', tenant.id)
            .limit(1)
            .maybeSingle()

          if (existing) {
            skipped++
            continue
          }

          // Also check if this phone already has ANY lead for this tenant (prevent double-texting)
          const { data: existingByPhone } = await client
            .from('leads')
            .select('id, status')
            .eq('phone_number', phone)
            .eq('tenant_id', tenant.id)
            .limit(1)
            .maybeSingle()

          if (existingByPhone) {
            // Phone already exists — still create the lead for tracking but DON'T schedule follow-up
            const fullName = row[idxFullName] || ''
            const nameParts = fullName.split(' ')
            const firstName = nameParts[0] || ''
            const lastName = nameParts.slice(1).join(' ') || ''

            await client.from('leads').insert({
              tenant_id: tenant.id,
              source_id: sourceId,
              phone_number: phone,
              customer_id: existingByPhone.id ? undefined : null,
              first_name: firstName || null,
              last_name: lastName || null,
              email: (row[idxEmail] || '').trim() || null,
              source: 'meta',
              status: existingByPhone.status || 'contacted',
              form_data: {
                meta_lead_id: metaId,
                service_type: idxService >= 0 ? row[idxService] : null,
                notes: idxNotes >= 0 ? row[idxNotes] : null,
                address: idxAddress >= 0 ? row[idxAddress] : null,
                ad_name: idxAdName >= 0 ? row[idxAdName] : null,
                campaign: idxCampaign >= 0 ? row[idxCampaign] : null,
                imported_from: 'google_sheet_poll',
                skipped_followup: true,
                reason: 'phone_already_exists',
              },
            })

            skipped++
            continue
          }

          // New lead — full ingest
          const fullName = row[idxFullName] || ''
          const nameParts = fullName.split(' ')
          const firstName = nameParts[0] || ''
          const lastName = nameParts.slice(1).join(' ') || ''
          const email = (row[idxEmail] || '').trim()
          const address = idxAddress >= 0 ? (row[idxAddress] || '').trim() : ''
          const serviceType = idxService >= 0 ? (row[idxService] || '').trim() : ''
          const notes = idxNotes >= 0 ? (row[idxNotes] || '').trim() : ''
          const createdTime = row[idxCreated] || new Date().toISOString()

          // Upsert customer
          const { data: customer } = await client
            .from('customers')
            .upsert(
              {
                phone_number: phone,
                tenant_id: tenant.id,
                first_name: firstName || null,
                last_name: lastName || null,
                email: email || null,
                address: address || null,
                lead_source: 'meta',
              },
              { onConflict: 'tenant_id,phone_number' }
            )
            .select('id')
            .single()

          // Create lead
          const { data: newLead, error: leadError } = await client
            .from('leads')
            .insert({
              tenant_id: tenant.id,
              source_id: sourceId,
              phone_number: phone,
              customer_id: customer?.id ?? null,
              first_name: firstName || null,
              last_name: lastName || null,
              email: email || null,
              source: 'meta',
              status: 'new',
              form_data: {
                meta_lead_id: metaId,
                service_type: serviceType,
                notes,
                address,
                ad_name: idxAdName >= 0 ? row[idxAdName] : null,
                campaign: idxCampaign >= 0 ? row[idxCampaign] : null,
                created_time: createdTime,
                imported_from: 'google_sheet_poll',
              },
              followup_stage: 0,
              followup_started_at: new Date().toISOString(),
            })
            .select('id')
            .single()

          if (leadError) {
            console.error(`[Meta Sheet] Error creating lead for ${tenant.slug}:`, leadError.message)
            errors++
            continue
          }

          // Schedule SMS follow-up
          if (newLead?.id) {
            const leadName = fullName || 'Customer'
            await scheduleLeadFollowUp(tenant.id, String(newLead.id), phone, leadName)
          }

          await logSystemEvent({
            tenant_id: tenant.id,
            source: 'meta',
            event_type: 'META_SHEET_LEAD_INGESTED',
            message: `New Meta lead from sheet: ${fullName || phone}`,
            phone_number: phone,
            metadata: {
              lead_id: newLead?.id,
              meta_lead_id: metaId,
              service_type: serviceType,
            },
          })

          ingested++
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[Meta Sheet] Error for ${tenant.slug}:`, msg)
        errors++
      }

      results[tenant.slug] = { ingested, skipped, errors }
      console.log(`[Meta Sheet] ${tenant.slug}: ${ingested} ingested, ${skipped} skipped, ${errors} errors`)
    }

    return NextResponse.json({ success: true, results })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Meta Sheet] Cron error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// ── Simple CSV parser (handles quoted fields with commas) ──

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let current: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        current.push(field)
        field = ''
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++
        current.push(field)
        field = ''
        if (current.length > 1 || current[0] !== '') {
          rows.push(current)
        }
        current = []
      } else {
        field += ch
      }
    }
  }

  // Last field/row
  current.push(field)
  if (current.length > 1 || current[0] !== '') {
    rows.push(current)
  }

  return rows
}
