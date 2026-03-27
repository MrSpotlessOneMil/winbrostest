import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { scheduleLeadFollowUp } from '@/lib/scheduler'
import { sendSMS } from '@/lib/openphone'
import { logSystemEvent } from '@/lib/system-events'
import { getAllActiveTenants, getTenantBusinessName, getTenantSdrName, type Tenant } from '@/lib/tenant'

/**
 * Cron: Poll Google Sheets for Meta Lead Ad leads (multi-tenant)
 * Runs every 2 minutes. For each tenant with a meta_sheet_id in workflow_config,
 * fetches the sheet as CSV, deduplicates, and ingests new leads.
 *
 * NEW LEADS get an AI-personalized first SMS based on:
 * - Their name, service type, notes/requests, address
 * - Then stages 2-5 of the normal follow-up sequence are scheduled
 *
 * Sheet must be shared as "Anyone with the link can view".
 * Dedup key: source_id = 'meta-sheet-{meta_lead_id}'
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
        // Fetch sheet as CSV
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

          const rawPhone = (row[idxPhone] || '').replace(/^p:/, '').trim()
          const phone = normalizePhoneNumber(rawPhone)
          if (!phone) continue

          const metaId = (row[idxId] || '').replace(/^l:/, '').trim()
          const sourceId = metaId ? `meta-sheet-${metaId}` : `meta-sheet-${phone}-${i}`

          // Dedup by source_id
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

          const fullName = row[idxFullName] || ''
          const nameParts = fullName.split(' ')
          const firstName = nameParts[0] || ''
          const lastName = nameParts.slice(1).join(' ') || ''
          const email = (row[idxEmail] || '').trim()
          const address = idxAddress >= 0 ? (row[idxAddress] || '').trim() : ''
          const serviceType = idxService >= 0 ? (row[idxService] || '').trim() : ''
          const notes = idxNotes >= 0 ? (row[idxNotes] || '').trim() : ''
          const createdTime = row[idxCreated] || new Date().toISOString()

          // Check if phone already exists (prevent double-texting)
          const { data: existingByPhone } = await client
            .from('leads')
            .select('id, status')
            .eq('phone_number', phone)
            .eq('tenant_id', tenant.id)
            .limit(1)
            .maybeSingle()

          if (existingByPhone) {
            await client.from('leads').insert({
              tenant_id: tenant.id,
              source_id: sourceId,
              phone_number: phone,
              first_name: firstName || null,
              last_name: lastName || null,
              email: email || null,
              source: 'meta',
              status: existingByPhone.status || 'contacted',
              form_data: {
                meta_lead_id: metaId,
                service_type: serviceType,
                notes,
                address,
                imported_from: 'google_sheet_poll',
                skipped_followup: true,
                reason: 'phone_already_exists',
              },
            })
            skipped++
            continue
          }

          // ── NEW LEAD: Full ingest + AI-personalized first message ──

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
              followup_stage: 1,
              followup_started_at: new Date().toISOString(),
            })
            .select('id')
            .single()

          if (leadError) {
            console.error(`[Meta Sheet] Error creating lead for ${tenant.slug}:`, leadError.message)
            errors++
            continue
          }

          // Generate AI-personalized first SMS
          const personalizedMsg = await generatePersonalizedSMS(tenant, firstName, serviceType, notes, address)

          // Send immediately
          const smsResult = await sendSMS(tenant, phone, personalizedMsg)
          if (smsResult.success) {
            // Update lead to contacted
            await client.from('leads').update({
              status: 'contacted',
              followup_stage: 1,
              last_contact_at: new Date().toISOString(),
            }).eq('id', newLead!.id)

            console.log(`[Meta Sheet] AI SMS sent to ${firstName || phone} (${tenant.slug})`)
          }

          // Schedule stages 2-5 only (stage 1 already sent as AI message)
          if (newLead?.id) {
            const leadName = fullName || 'Customer'
            // Delays: skip stage 1 (0 min), start from stage 2 (day 1) onward
            await scheduleLeadFollowUp(
              tenant.id,
              String(newLead.id),
              phone,
              leadName,
              [1440, 4320, 10080, 20160] // day 1, day 3, day 7, day 14
            )
          }

          await logSystemEvent({
            tenant_id: tenant.id,
            source: 'meta',
            event_type: 'META_SHEET_LEAD_INGESTED',
            message: `New Meta lead from sheet: ${fullName || phone} — AI SMS sent`,
            phone_number: phone,
            metadata: {
              lead_id: newLead?.id,
              meta_lead_id: metaId,
              service_type: serviceType,
              ai_message: personalizedMsg,
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

// ── AI Personalized SMS Generator ──

async function generatePersonalizedSMS(
  tenant: Tenant,
  firstName: string,
  serviceType: string,
  notes: string,
  address: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Fallback to template if no API key
    const biz = getTenantBusinessName(tenant, true)
    return `Hi ${firstName || 'there'}! Thanks for reaching out to ${biz}. We'd love to help with your cleaning needs. When works best for a quick call?`
  }

  const businessName = getTenantBusinessName(tenant)
  const sdrName = getTenantSdrName(tenant)
  const serviceLabel = serviceType
    .replace(/_/g, ' ')
    .replace(/clean$/, 'cleaning')
    .replace(/^standard/, 'standard')
    .replace(/^deep/, 'deep')

  const prompt = `You are ${sdrName} from ${businessName}. A new customer just filled out a form on Facebook requesting cleaning services. Write a SHORT, warm, personalized first SMS (2-3 sentences max, under 300 chars).

Customer info:
- Name: ${firstName || 'unknown'}
- Service requested: ${serviceLabel || 'cleaning'}
- Their notes/requests: ${notes || 'none'}
- Address: ${address || 'not provided'}

Rules:
- Use their first name naturally
- Reference their specific service type or notes if they provided any (e.g. "I see you're looking for a deep clean" or "focusing on baseboards and fans sounds great")
- End with a simple question to keep the conversation going (availability, number of rooms, etc.)
- Sound human, warm, not salesy. Like a friendly text, not a marketing message.
- NO emojis. NO exclamation marks overload. NO "we'd be honored" type fluff.
- Do NOT mention discounts or deals.
- Do NOT say "I'm an AI" or anything like that.
- Just the message text, nothing else.`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    })
    clearTimeout(timeout)

    const text = response.content[0]
    if (text.type === 'text') {
      return text.text.trim()
    }

    // Fallback
    return `Hi ${firstName || 'there'}! Thanks for reaching out to ${businessName}. We'd love to help with your ${serviceLabel || 'cleaning'}. When works best for a quick call?`
  } catch (err) {
    clearTimeout(timeout)
    console.error('[Meta Sheet] AI message generation failed:', err)
    return `Hi ${firstName || 'there'}! Thanks for reaching out to ${businessName}. We'd love to help with your ${serviceLabel || 'cleaning'}. When works best for a quick call?`
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

  current.push(field)
  if (current.length > 1 || current[0] !== '') {
    rows.push(current)
  }

  return rows
}
