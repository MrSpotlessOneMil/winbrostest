import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"

// route-check:no-vercel-cron

/**
 * TEMPORARY: Push updated house-cleaning prompt to live VAPI assistants.
 * Also updates Cedar Rapids with targeted prompt surgery (preserves custom sections).
 */

const HOUSE_CLEANING_SLUGS = ['spotless-scrubbers', 'west-niagara']
const CEDAR_ASSISTANT_ID = '4c673d16-436d-42ae-bf51-10b2c2d30fa0'

const NEW_PRICING_SECTION = `## HANDLING PRICE QUESTIONS — STRICT RULES
You do NOT know our prices. You CANNOT calculate them. Every price is custom per location.

RULE: NEVER say a dollar amount until AFTER you get it from the send-customer-text tool response.
RULE: NEVER guess, estimate, or say "around" with a number. You literally do not know the price.
RULE: The ONLY price you can tell the customer is the exact number returned by the tool.

If they ask about price and you have their bed/bath count:
1. Say: "Give me one sec, let me pull up your exact price."
2. IMMEDIATELY call send-customer-text with message_type='price_quote'
3. Wait for the tool response — it contains the exact price
4. THEN say: "Your [service type] clean comes out to [exact price from tool]. I just texted you a link to book online!"

If they ask about price but you DON'T have bed/bath yet:
"Sure! I just need to know the size of your place to look that up. How many bedrooms and bathrooms?"
Once they answer → call the tool, THEN quote the price from the response.

If they describe heavy detail work, cabinets, organizing:
"That sounds like our Extra Deep service. Let me get someone to give you an exact quote." Then transfer.

WRONG (never do this): "A standard clean runs about $370" — you made that up.
CORRECT: "Give me one sec..." → call tool → "Your standard clean is $260. I just texted you the details!"`

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const template = await import('@/lib/vapi-templates/house-cleaning-inbound.json')
  const basePrompt: string = (template as any).default?.model?.messages?.[0]?.content
    || (template as any).model?.messages?.[0]?.content
  const toolDef = (template as any).default?.model?.tools?.[0]
    || (template as any).model?.tools?.[0]

  if (!basePrompt) {
    return NextResponse.json({ error: 'Failed to load template prompt' }, { status: 500 })
  }

  const supabase = getSupabaseServiceClient()
  const results: Array<{ slug: string; status: string; assistantId?: string }> = []

  // --- Update Spotless + West Niagara (full template replacement) ---
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, slug, business_name, service_area, sdr_persona, vapi_api_key, vapi_assistant_id')
    .in('slug', HOUSE_CLEANING_SLUGS)
    .eq('active', true)

  for (const tenant of (tenants || [])) {
    if (!tenant.vapi_api_key || !tenant.vapi_assistant_id) {
      results.push({ slug: tenant.slug, status: 'skipped: missing keys' })
      continue
    }

    const prompt = basePrompt
      .replaceAll('{{BUSINESS_NAME}}', tenant.business_name || tenant.slug)
      .replaceAll('{{SERVICE_AREA}}', tenant.service_area || 'your area')
      .replaceAll('{{SDR_PERSONA}}', tenant.sdr_persona || 'Sarah')
      .replaceAll('{{SERVICE_TYPE}}', 'house cleaning')

    try {
      const getRes = await fetch(`https://api.vapi.ai/assistant/${tenant.vapi_assistant_id}`, {
        headers: { Authorization: `Bearer ${tenant.vapi_api_key}` },
      })
      if (!getRes.ok) { results.push({ slug: tenant.slug, status: `GET failed: ${getRes.status}` }); continue }
      const current = await getRes.json()

      const updatedTools = current.model?.tools ? [...current.model.tools] : []
      if (updatedTools.length > 0 && toolDef) {
        updatedTools[0] = { ...updatedTools[0], function: { ...updatedTools[0].function, ...toolDef.function } }
      }

      const patchRes = await fetch(`https://api.vapi.ai/assistant/${tenant.vapi_assistant_id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${tenant.vapi_api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: { ...current.model, messages: [{ role: 'system', content: prompt }], tools: updatedTools } }),
      })
      results.push({ slug: tenant.slug, status: patchRes.ok ? 'updated' : `PATCH failed: ${patchRes.status}`, assistantId: tenant.vapi_assistant_id })
    } catch (err: any) {
      results.push({ slug: tenant.slug, status: `error: ${err.message}` })
    }
  }

  // --- Update Cedar Rapids (targeted prompt surgery) ---
  const { data: cedar } = await supabase
    .from('tenants')
    .select('id, vapi_api_key')
    .eq('slug', 'cedar-rapids')
    .single()

  if (cedar?.vapi_api_key) {
    try {
      const getRes = await fetch(`https://api.vapi.ai/assistant/${CEDAR_ASSISTANT_ID}`, {
        headers: { Authorization: `Bearer ${cedar.vapi_api_key}` },
      })
      if (!getRes.ok) { results.push({ slug: 'cedar-rapids', status: `GET failed: ${getRes.status}` }) }
      else {
        const current = await getRes.json()
        let cedarPrompt: string = current.model?.messages?.[0]?.content || ''

        // Replace pricing section
        const priceSectionRegex = /## HANDLING PRICE QUESTIONS[^\n]*\n[\s\S]*?(?=\n## [A-Z])/
        if (priceSectionRegex.test(cedarPrompt)) {
          cedarPrompt = cedarPrompt.replace(priceSectionRegex, NEW_PRICING_SECTION + '\n')
        }

        // Remove price param references
        cedarPrompt = cedarPrompt.replace(/Recommended: customer_name, service_type, price \(the dollar amount you quoted[^)]*\)/, 'Recommended: customer_name, service_type')
        cedarPrompt = cedarPrompt.replace(/- price: the dollar amount you quoted verbally[^\n]*/, '')
        cedarPrompt = cedarPrompt.replace(/Example: send-customer-text\([^)]*price=\d+\)/, "Example: send-customer-text(message_type='price_quote', bedrooms=3, bathrooms=2, service_type='standard', customer_name='Maria')")
        cedarPrompt = cedarPrompt.replace(
          'This sends the customer an SMS with their exact price and a link to book online.',
          'This sends the customer an SMS with their exact price and a link to book online.\nThe tool returns the exact price — use THAT number if the customer asks.\nDo NOT send a price param — the system looks up the exact price automatically.'
        )

        // Remove price from tool def
        const updatedTools = current.model?.tools ? [...current.model.tools] : []
        for (const tool of updatedTools) {
          if (tool.function?.name === 'send-customer-text' && tool.function?.parameters?.properties?.price) {
            delete tool.function.parameters.properties.price
            if (Array.isArray(tool.function.parameters.required)) {
              tool.function.parameters.required = tool.function.parameters.required.filter((r: string) => r !== 'price')
            }
          }
        }

        const patchRes = await fetch(`https://api.vapi.ai/assistant/${CEDAR_ASSISTANT_ID}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${cedar.vapi_api_key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: { ...current.model, messages: [{ role: 'system', content: cedarPrompt }], tools: updatedTools } }),
        })
        results.push({ slug: 'cedar-rapids', status: patchRes.ok ? 'updated' : `PATCH failed: ${patchRes.status}`, assistantId: CEDAR_ASSISTANT_ID })
      }
    } catch (err: any) {
      results.push({ slug: 'cedar-rapids', status: `error: ${err.message}` })
    }
  } else {
    results.push({ slug: 'cedar-rapids', status: 'skipped: no vapi_api_key' })
  }

  return NextResponse.json({
    message: 'VAPI prompt update complete',
    promptLength: basePrompt.length,
    hasToolFirst: basePrompt.includes('NEVER say a dollar amount'),
    results,
  })
}
