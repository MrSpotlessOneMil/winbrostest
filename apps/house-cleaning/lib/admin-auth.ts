import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function getAdminOwner(request: NextRequest): Promise<{ id: string; name: string; email: string } | null> {
  const sessionToken = request.cookies.get('osiris_session')?.value
  if (!sessionToken) return null

  const supabase = getSupabase()

  const { data: session } = await supabase
    .from('dashboard_sessions')
    .select('owner_id, expires_at')
    .eq('token', sessionToken)
    .single()

  if (!session || new Date(session.expires_at) < new Date()) return null

  const { data: owner } = await supabase
    .from('business_owners')
    .select('id, name, email')
    .eq('id', session.owner_id)
    .single()

  if (!owner) return null

  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail || owner.email.toLowerCase() !== adminEmail.toLowerCase()) return null

  return owner
}
