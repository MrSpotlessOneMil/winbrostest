import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"

// route-check:no-vercel-cron

/**
 * TEMPORARY: Push updated house-cleaning prompt to live VAPI assistants.
 * Call once after deploy, then delete this file.
 *
 * POST /api/admin/update-vapi-prompts
 * Header: Authorization: Bearer <CRON_SECRET>
 */

const HOUSE_CLEANING_SLUGS = ['spotless-scrubbers', 'cedar-rapids', 'west-niagara']

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Load the updated template
  const template = await import('@/lib/vapi-templates/house-cleaning-inbound.json')
  const basePrompt: string = (template as any).default?.model?.messages?.[0]?.content
    || (template as any).model?.messages?.[0]?.content
  const toolDef = (template as any).default?.model?.tools?.[0]
    || (template as any).model?.tools?.[0]

  if (!basePrompt) {
    return NextResponse.json({ error: 'Failed to load template prompt' }, { status: 500 })
  }

  const supabase = getSupabaseServiceClient()

  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('id, slug, business_name, service_area, sdr_persona, vapi_api_key, vapi_assistant_id')
    .in('slug', HOUSE_CLEANING_SLUGS)
    .eq('active', true)

  if (error || !tenants) {
    return NextResponse.json({ error: `Failed to fetch tenants: ${error?.message}` }, { status: 500 })
  }

  const results: Array<{ slug: string; status: string; assistantId?: string }> = []

  for (const tenant of tenants) {
    if (!tenant.vapi_api_key || !tenant.vapi_assistant_id) {
      results.push({ slug: tenant.slug, status: 'skipped: missing vapi_api_key or vapi_assistant_id' })
      continue
    }

    // Replace placeholders
    const prompt = basePrompt
      .replaceAll('{{BUSINESS_NAME}}', tenant.business_name || tenant.slug)
      .replaceAll('{{SERVICE_AREA}}', tenant.service_area || 'your area')
      .replaceAll('{{SDR_PERSONA}}', tenant.sdr_persona || 'Sarah')
      .replaceAll('{{SERVICE_TYPE}}', 'house cleaning')

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)

      // GET current assistant to preserve other settings
      const getRes = await fetch(`https://api.vapi.ai/assistant/${tenant.vapi_assistant_id}`, {
        headers: { Authorization: `Bearer ${tenant.vapi_api_key}` },
        signal: controller.signal,
      })

      if (!getRes.ok) {
        clearTimeout(timeout)
        const errText = await getRes.text()
        results.push({ slug: tenant.slug, status: `GET failed: ${getRes.status} ${errText.slice(0, 200)}`, assistantId: tenant.vapi_assistant_id })
        continue
      }

      const current = await getRes.json()

      // Update messages and tool definition
      const updatedMessages = [{ role: 'system', content: prompt }]
      const updatedTools = current.model?.tools ? [...current.model.tools] : []
      if (updatedTools.length > 0 && toolDef) {
        updatedTools[0] = {
          ...updatedTools[0],
          function: {
            ...updatedTools[0].function,
            ...toolDef.function,
          },
        }
      }

      const patchRes = await fetch(`https://api.vapi.ai/assistant/${tenant.vapi_assistant_id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tenant.vapi_api_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: {
            ...current.model,
            messages: updatedMessages,
            tools: updatedTools,
          },
        }),
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (!patchRes.ok) {
        const errText = await patchRes.text()
        results.push({ slug: tenant.slug, status: `PATCH failed: ${patchRes.status} ${errText.slice(0, 200)}`, assistantId: tenant.vapi_assistant_id })
      } else {
        results.push({ slug: tenant.slug, status: 'updated', assistantId: tenant.vapi_assistant_id })
      }
    } catch (err: any) {
      results.push({ slug: tenant.slug, status: `error: ${err.message}`, assistantId: tenant.vapi_assistant_id })
    }
  }

  return NextResponse.json({
    message: 'VAPI prompt update complete',
    promptLength: basePrompt.length,
    hasFormula: basePrompt.includes('100 per bedroom'),
    hasToolFirst: basePrompt.includes('Do NOT calculate'),
    results,
  })
}
