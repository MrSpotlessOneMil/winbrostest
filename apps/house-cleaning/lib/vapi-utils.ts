import { NextRequest } from 'next/server'
import { safeJsonParse } from '@/lib/json-utils'
import { getSupabaseClient } from '@/lib/supabase'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function extractPayload(body: Record<string, unknown>): Record<string, unknown> {
  const candidate = body.body
  if (isRecord(candidate)) {
    return candidate
  }
  if (typeof candidate === 'string') {
    const parsed = safeJsonParse<Record<string, unknown>>(candidate)
    if (parsed.value && isRecord(parsed.value)) {
      return parsed.value
    }
  }
  return body
}

/**
 * Resolve tenant from VAPI's x-call-id header.
 * 1. Extract call ID from header
 * 2. Call VAPI API to get call details (includes assistantId)
 * 3. Look up tenant by vapi_assistant_id in our DB
 */
export async function resolveTenantFromCall(request: NextRequest): Promise<string | null> {
  const callId = request.headers.get('x-call-id')
  if (!callId) {
    console.warn('[VAPI] No x-call-id header — cannot resolve tenant')
    return null
  }

  const client = getSupabaseClient()

  // Get a VAPI API key from any active tenant (all tenants share one VAPI account)
  const { data: anyTenant } = await client
    .from('tenants')
    .select('vapi_api_key')
    .eq('active', true)
    .not('vapi_api_key', 'is', null)
    .limit(1)
    .single()

  const vapiApiKey = anyTenant?.vapi_api_key
  if (!vapiApiKey) {
    console.error('[VAPI] No VAPI API key found in any tenant — cannot look up call')
    return null
  }

  try {
    const res = await fetch(`https://api.vapi.ai/call/${callId}`, {
      headers: { Authorization: `Bearer ${vapiApiKey}` },
    })

    if (!res.ok) {
      console.error(`[VAPI] VAPI call lookup failed: ${res.status} ${res.statusText}`)
      return null
    }

    const callData = await res.json()
    const assistantId = callData.assistantId

    if (!assistantId) {
      console.warn('[VAPI] No assistantId in call data')
      return null
    }

    // Look up tenant by vapi_assistant_id (inbound) or vapi_outbound_assistant_id
    const { data: tenant } = await client
      .from('tenants')
      .select('id')
      .or(`vapi_assistant_id.eq.${assistantId},vapi_outbound_assistant_id.eq.${assistantId}`)
      .eq('active', true)
      .single()

    if (!tenant) {
      console.warn(`[VAPI] No tenant found for assistantId: ${assistantId}`)
      return null
    }

    console.log(`[VAPI] Resolved tenant ${tenant.id} from call ${callId} (assistant ${assistantId})`)
    return tenant.id
  } catch (err) {
    console.error('[VAPI] Error resolving tenant from call:', err)
    return null
  }
}
