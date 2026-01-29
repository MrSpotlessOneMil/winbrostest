/**
 * Sync HubSpot Action Endpoint
 *
 * POST /api/actions/sync-hubspot
 * Body: { jobId?: string, phone?: string, customerOnly?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getJobById,
  getJobsByPhone,
  getCustomerByPhone,
} from '@/lib/supabase'
import { syncHubSpotContact, syncHubSpotDeal } from '@/lib/hubspot'
import { getClientConfig } from '@/lib/client-config'

export async function POST(request: NextRequest) {
  try {
    const config = getClientConfig()
    if (!config.features.hubspot) {
      return NextResponse.json({ error: 'HubSpot not enabled' }, { status: 404 })
    }

    const body = await request.json()
    const { jobId, phone, customerOnly } = body || {}

    let job = null
    if (jobId) {
      job = await getJobById(jobId)
    } else if (phone) {
      const jobs = await getJobsByPhone(phone)
      job = jobs[0] || null
    }

    let customer = null
    if (job?.phone_number) {
      customer = await getCustomerByPhone(job.phone_number)
    } else if (phone) {
      customer = await getCustomerByPhone(phone)
    }

    if (!customer && !job) {
      return NextResponse.json({ error: 'No customer or job found' }, { status: 404 })
    }

    const contactResult = customer
      ? await syncHubSpotContact(customer)
      : { success: false }

    if (customerOnly || !job) {
      return NextResponse.json({
        success: contactResult.success,
        contactId: contactResult.contactId,
        error: contactResult.error,
      })
    }

    const dealResult = await syncHubSpotDeal(job, customer || undefined)

    return NextResponse.json({
      success: dealResult.success,
      contactId: dealResult.contactId || contactResult.contactId,
      dealId: dealResult.dealId,
      error: dealResult.error || contactResult.error,
    })
  } catch (error) {
    console.error('Sync HubSpot error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'sync-hubspot',
    method: 'POST',
    body: {
      jobId: 'string (optional)',
      phone: 'string (optional, E.164 or raw)',
      customerOnly: 'boolean (optional)',
    },
  })
}
