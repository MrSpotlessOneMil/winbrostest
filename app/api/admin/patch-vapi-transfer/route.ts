import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { verifyCronAuth } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

/**
 * One-time admin endpoint: sets owner_phone in DB + patches live VAPI assistants with transferPlan.
 *
 * Step 1: Updates owner_phone in tenants table from known values
 * Step 2: For each tenant with vapi_api_key + vapi_assistant_id + owner_phone:
 *   PATCH https://api.vapi.ai/assistant/{id} with transferPlan + transferCallEnabled
 *   Also removes "have a great day" from endCallPhrases to prevent conflict.
 *
 * Usage: POST /api/admin/patch-vapi-transfer (requires admin auth)
 */

// Known owner phones — hardcoded for this one-time migration
const OWNER_PHONES: Record<string, string> = {
  'spotless-scrubbers': '+14242755847',
  'west-niagara': '+12894405365',
  'cedar-rapids': '+13198264311',
}

export async function POST(request: NextRequest) {
  // Accept admin session OR CRON_SECRET bearer token
  const isAdmin = await requireAdmin(request)
  const isCron = verifyCronAuth(request)
  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const client = getSupabaseServiceClient()

  // Step 1: Set owner_phone in DB for each tenant
  const phoneUpdates: Array<{ slug: string; phone: string; status: string }> = []
  for (const [slug, phone] of Object.entries(OWNER_PHONES)) {
    const { error } = await client
      .from('tenants')
      .update({ owner_phone: phone })
      .eq('slug', slug)

    phoneUpdates.push({ slug, phone, status: error ? `error: ${error.message}` : 'updated' })
  }

  // Step 2: Patch VAPI assistants
  const { data: tenants } = await client
    .from('tenants')
    .select('id, slug, name, vapi_api_key, vapi_assistant_id, owner_phone')
    .not('vapi_api_key', 'is', null)
    .not('vapi_assistant_id', 'is', null)

  if (!tenants || tenants.length === 0) {
    return NextResponse.json({ success: true, message: 'No tenants with VAPI configured', phoneUpdates, vapiResults: [] })
  }

  const vapiResults: Array<{ slug: string; assistantId: string; status: string; error?: string }> = []

  for (const tenant of tenants) {
    const { slug, vapi_api_key, vapi_assistant_id, owner_phone } = tenant

    if (!owner_phone) {
      vapiResults.push({ slug, assistantId: vapi_assistant_id, status: 'skipped', error: 'No owner_phone configured' })
      continue
    }

    try {
      // Fetch current assistant config to get existing endCallPhrases
      const getRes = await fetch(`https://api.vapi.ai/assistant/${vapi_assistant_id}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${vapi_api_key}`,
          'Content-Type': 'application/json',
        },
      })

      let currentEndCallPhrases: string[] | undefined
      if (getRes.ok) {
        const current = await getRes.json()
        currentEndCallPhrases = current.endCallPhrases
      }

      // Remove "have a great day" from endCallPhrases (conflicts with transfer)
      const cleanedPhrases = (currentEndCallPhrases || ['goodbye', 'talk to you soon', 'bye bye', 'take care'])
        .filter((p: string) => p.toLowerCase() !== 'have a great day')

      const patchBody = {
        transferCallEnabled: true,
        transferPlan: {
          mode: 'blind-transfer',
          message: 'Let me connect you now, one moment.',
          destinations: [
            {
              type: 'number',
              number: owner_phone,
              message: 'Transferring you to the team now.',
            },
          ],
        },
        endCallPhrases: cleanedPhrases,
      }

      const res = await fetch(`https://api.vapi.ai/assistant/${vapi_assistant_id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${vapi_api_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patchBody),
      })

      if (res.ok) {
        vapiResults.push({ slug, assistantId: vapi_assistant_id, status: 'patched' })
      } else {
        const err = await res.text()
        vapiResults.push({ slug, assistantId: vapi_assistant_id, status: 'failed', error: err.slice(0, 200) })
      }
    } catch (err: any) {
      vapiResults.push({ slug, assistantId: vapi_assistant_id, status: 'error', error: err.message })
    }
  }

  const patched = vapiResults.filter(r => r.status === 'patched').length
  return NextResponse.json({
    success: true,
    message: `DB phones updated. Patched ${patched}/${vapiResults.length} VAPI assistants with transferPlan.`,
    phoneUpdates,
    vapiResults,
  })
}
