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
  'winbros': '+13092411958',
}

// Also support GET for easy browser/curl access
export async function GET(request: NextRequest) {
  return handlePatch(request)
}

export async function POST(request: NextRequest) {
  return handlePatch(request)
}

async function handlePatch(request: NextRequest) {
  // Accept admin session OR CRON_SECRET (bearer header or ?secret= query param)
  const isAdmin = await requireAdmin(request)
  const isCron = verifyCronAuth(request)
  const secretParam = request.nextUrl.searchParams.get('secret')
  const isSecretParam = secretParam === process.env.CRON_SECRET
  if (!isAdmin && !isCron && !isSecretParam) {
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
      // Fetch current assistant config
      const getRes = await fetch(`https://api.vapi.ai/assistant/${vapi_assistant_id}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${vapi_api_key}`,
          'Content-Type': 'application/json',
        },
      })

      if (!getRes.ok) {
        vapiResults.push({ slug, assistantId: vapi_assistant_id, status: 'failed', error: `GET failed: ${getRes.status}` })
        continue
      }

      const current = await getRes.json()
      const currentModel = current.model || {}
      const currentTools: any[] = currentModel.tools || []
      const currentEndCallPhrases: string[] = current.endCallPhrases || ['goodbye', 'talk to you soon', 'bye bye', 'take care']

      // Remove "have a great day" from endCallPhrases (conflicts with transfer)
      const cleanedPhrases = currentEndCallPhrases
        .filter((p: string) => p.toLowerCase() !== 'have a great day')

      // Build the transfer tool with full function schema (required by VAPI)
      const transferTool = {
        type: 'transferCall',
        function: {
          name: 'transferCall',
          description: 'Transfer the call to a human. Use when the customer asks for a real person, agent, representative, or the owner.',
          parameters: {
            type: 'object',
            properties: {
              destination: {
                type: 'string',
                enum: [owner_phone],
                description: 'The phone number to transfer to.',
              },
            },
            required: ['destination'],
          },
        },
        destinations: [
          {
            type: 'number',
            number: owner_phone,
            message: 'Transferring you to the team now.',
          },
        ],
        messages: [
          {
            type: 'request-start',
            content: 'Let me connect you right now, one moment.',
          },
        ],
      }

      // Remove any transferCall from model.tools (wrong location — doesn't work there)
      const cleanedModelTools = currentTools.filter((t: any) => t.type !== 'transferCall')

      // Get current top-level tools and replace/add transferCall there
      const currentTopLevelTools: any[] = current.tools || []
      const cleanedTopLevelTools = currentTopLevelTools.filter((t: any) => t.type !== 'transferCall')
      cleanedTopLevelTools.push(transferTool)

      const patchBody: Record<string, any> = {
        // transferCall goes at assistant top-level tools, NOT model.tools
        tools: cleanedTopLevelTools,
        endCallPhrases: cleanedPhrases,
      }

      // Only update model.tools if we cleaned out a stale transferCall
      if (cleanedModelTools.length !== currentTools.length) {
        patchBody.model = { ...currentModel, tools: cleanedModelTools }
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
