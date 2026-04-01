/**
 * Send Employee Credentials
 *
 * POST /api/actions/send-employee-credentials
 * Body: { cleaner_id: number }
 *
 * Texts the employee their login username and PIN.
 * Requires dashboard auth (owner/manager).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const cleanerId = Number(body.cleaner_id)
  if (!Number.isFinite(cleanerId)) {
    return NextResponse.json({ success: false, error: 'cleaner_id is required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  // Get cleaner with credentials
  const { data: cleaner, error } = await client
    .from('cleaners')
    .select('id, name, phone, username, pin, tenant_id')
    .eq('id', cleanerId)
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .is('deleted_at', null)
    .single()

  if (error || !cleaner) {
    return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 })
  }

  if (!cleaner.phone) {
    return NextResponse.json({ success: false, error: 'Employee has no phone number on file' }, { status: 400 })
  }

  if (!cleaner.username || !cleaner.pin) {
    return NextResponse.json({ success: false, error: 'Employee credentials not set up yet' }, { status: 400 })
  }

  // Send SMS with login info
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://cleanmachine.live').replace('https://', '')
  const message = `Your portal login:\n\nWebsite: ${baseUrl}\nUsername: ${cleaner.username}\nPIN: ${cleaner.pin}\n\nYou can also tap any job link from your texts to go straight to your portal.`

  const result = await sendSMS(tenant, cleaner.phone, message, { skipDedup: true, bypassFilters: true })

  if (!result.success) {
    return NextResponse.json({ success: false, error: 'Failed to send text message' }, { status: 500 })
  }

  // Update credentials_sent_at
  await client
    .from('cleaners')
    .update({ credentials_sent_at: new Date().toISOString() })
    .eq('id', cleanerId)
    .eq('tenant_id', tenant.id)

  return NextResponse.json({ success: true })
}
