import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"

// route-check:no-vercel-cron

/**
 * TEMPORARY: Update Cedar Rapids VAPI assistant to use tool-first pricing.
 * 1. Sets vapi_assistant_id in DB if missing
 * 2. Replaces hardcoded price table with tool-first instructions
 * 3. Removes price param from send-customer-text tool
 */

const CEDAR_ASSISTANT_ID = '4c673d16-436d-42ae-bf51-10b2c2d30fa0'

// New pricing section — replaces the hardcoded price table
const NEW_PRICING_SECTION = `## HANDLING PRICE QUESTIONS
Do NOT calculate or guess prices. Our pricing is looked up from our system automatically.

If they ask about price and you ALREADY have their bed/bath count:
Call send-customer-text RIGHT AWAY with message_type='price_quote'. The tool returns the exact price.
Then tell them: "Your [service type] clean for a [X] bed [X] bath is [price from tool]. I just texted you a link with all the options!"

If they ask about price but you DON'T have bed/bath yet:
"Sure! Pricing depends on the size of your home. How many bedrooms and bathrooms?" Once they answer, call the tool.

NEVER make up a price or estimate. ALWAYS use the tool to get the real number.`

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseServiceClient()

  // Fetch Cedar Rapids tenant (even if inactive)
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, slug, vapi_api_key, vapi_assistant_id')
    .eq('slug', 'cedar-rapids')
    .single()

  if (error || !tenant) {
    return NextResponse.json({ error: `Tenant not found: ${error?.message}` }, { status: 404 })
  }

  if (!tenant.vapi_api_key) {
    return NextResponse.json({ error: 'Cedar Rapids has no vapi_api_key' }, { status: 400 })
  }

  // Step 1: Update vapi_assistant_id in DB if missing
  if (!tenant.vapi_assistant_id) {
    const { error: updateErr } = await supabase
      .from('tenants')
      .update({ vapi_assistant_id: CEDAR_ASSISTANT_ID })
      .eq('id', tenant.id)

    if (updateErr) {
      return NextResponse.json({ error: `DB update failed: ${updateErr.message}` }, { status: 500 })
    }
  }

  // Step 2: GET current assistant from VAPI
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)

  const getRes = await fetch(`https://api.vapi.ai/assistant/${CEDAR_ASSISTANT_ID}`, {
    headers: { Authorization: `Bearer ${tenant.vapi_api_key}` },
    signal: controller.signal,
  })

  if (!getRes.ok) {
    clearTimeout(timeout)
    const errText = await getRes.text()
    return NextResponse.json({ error: `VAPI GET failed: ${getRes.status} ${errText.slice(0, 300)}` }, { status: 500 })
  }

  const current = await getRes.json()
  const currentPrompt: string = current.model?.messages?.[0]?.content || ''

  // Step 3: Replace the HANDLING PRICE QUESTIONS section
  // Match from "## HANDLING PRICE QUESTIONS" to the next ## heading
  const priceSectionRegex = /## HANDLING PRICE QUESTIONS[\s\S]*?(?=\n## [A-Z])/
  let newPrompt: string

  if (priceSectionRegex.test(currentPrompt)) {
    newPrompt = currentPrompt.replace(priceSectionRegex, NEW_PRICING_SECTION + '\n\n')
  } else {
    // Fallback: append at the end if section not found
    newPrompt = currentPrompt + '\n\n' + NEW_PRICING_SECTION
  }

  // Also update the send-customer-text tool instructions in the prompt
  // Remove "price (the dollar amount you quoted, as a number)" from the tool params
  newPrompt = newPrompt.replace(
    /Recommended: customer_name, service_type, price \(the dollar amount you quoted[^)]*\)/,
    'Recommended: customer_name, service_type'
  )
  newPrompt = newPrompt.replace(
    /- price: the dollar amount you quoted verbally[^\n]*/,
    ''
  )
  // Update the example to not include price
  newPrompt = newPrompt.replace(
    /Example: send-customer-text\([^)]*price=\d+\)/,
    "Example: send-customer-text(message_type='price_quote', bedrooms=3, bathrooms=2, service_type='standard', customer_name='Maria')"
  )
  // Add instruction that tool returns the price
  newPrompt = newPrompt.replace(
    'This sends the customer an SMS with their exact price and a link to book online.',
    'This sends the customer an SMS with their exact price and a link to book online.\nThe tool returns the exact price — use THAT number if the customer asks.\nDo NOT send a price param — the system looks up the exact price automatically.'
  )

  // Step 4: Update tool definition — remove price parameter
  const updatedTools = current.model?.tools ? [...current.model.tools] : []
  for (const tool of updatedTools) {
    if (tool.function?.name === 'send-customer-text' && tool.function?.parameters?.properties?.price) {
      delete tool.function.parameters.properties.price
      // Also remove from required if present
      if (Array.isArray(tool.function.parameters.required)) {
        tool.function.parameters.required = tool.function.parameters.required.filter((r: string) => r !== 'price')
      }
    }
  }

  // Step 5: PATCH the assistant
  const patchRes = await fetch(`https://api.vapi.ai/assistant/${CEDAR_ASSISTANT_ID}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tenant.vapi_api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: {
        ...current.model,
        messages: [{ role: 'system', content: newPrompt }],
        tools: updatedTools,
      },
    }),
    signal: controller.signal,
  })

  clearTimeout(timeout)

  if (!patchRes.ok) {
    const errText = await patchRes.text()
    return NextResponse.json({ error: `VAPI PATCH failed: ${patchRes.status} ${errText.slice(0, 300)}` }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    assistantId: CEDAR_ASSISTANT_ID,
    dbUpdated: !tenant.vapi_assistant_id,
    promptLength: newPrompt.length,
    hadPriceSection: priceSectionRegex.test(currentPrompt),
    hasFormula: newPrompt.includes('100 per bedroom'),
    hasToolFirst: newPrompt.includes('Do NOT calculate'),
  })
}
