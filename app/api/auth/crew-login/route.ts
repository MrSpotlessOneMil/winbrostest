import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'

// POST /api/auth/crew-login
// Look up a cleaner by phone number and return their portal token
export async function POST(request: NextRequest) {
  let body: { phone?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { phone } = body
  if (!phone || typeof phone !== 'string') {
    return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
  }

  // Normalize phone: strip everything except digits, ensure 10+ digits
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 10) {
    return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 })
  }

  // Match last 10 digits to handle +1 prefix variations
  const last10 = digits.slice(-10)

  const client = getSupabaseServiceClient()

  // Look up cleaner by phone (try multiple formats)
  const { data: cleaners, error } = await client
    .from('cleaners')
    .select('id, name, phone, portal_token, employee_type, tenant_id, tenants!inner(name, slug)')
    .is('deleted_at', null)
    .eq('is_active', true)

  if (error) {
    console.error('[crew-login] DB error:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }

  // Find matching cleaner by last 10 digits of phone
  const match = cleaners?.find((c: any) => {
    const cleanerDigits = (c.phone || '').replace(/\D/g, '')
    return cleanerDigits.slice(-10) === last10
  })

  if (!match) {
    return NextResponse.json(
      { error: 'No crew account found for this phone number. Contact your manager.' },
      { status: 404 }
    )
  }

  if (!match.portal_token) {
    // Generate a token if one doesn't exist
    const token = crypto.randomUUID()
    await client
      .from('cleaners')
      .update({ portal_token: token })
      .eq('id', match.id)
    match.portal_token = token
  }

  const tenant = (match as any).tenants
  return NextResponse.json({
    success: true,
    cleaner: {
      name: match.name,
      employee_type: match.employee_type || 'technician',
    },
    tenant: {
      name: tenant?.name,
      slug: tenant?.slug,
    },
    portalUrl: `/crew/${match.portal_token}`,
  })
}
