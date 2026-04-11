/**
 * One-off script: Push updated house-cleaning VAPI prompt to live assistants.
 *
 * Run via: npx tsx scripts/update-vapi-prompts.ts
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in environment (or run on Vercel).
 * Reads each house cleaning tenant's vapi_api_key + vapi_assistant_id from DB,
 * then PATCHes the assistant's system prompt via VAPI API.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kcmbwstjmdrjkhxhkkjt.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required. Set it in your environment.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Load the updated template prompt
const template = require('../lib/vapi-templates/house-cleaning-inbound.json')
const basePrompt: string = template.model.messages[0].content
const toolDef = template.model.tools[0]

// House cleaning tenant slugs to update
const HOUSE_CLEANING_SLUGS = ['spotless-scrubbers', 'cedar-rapids', 'west-niagara']

async function updateAssistant(
  vapiApiKey: string,
  assistantId: string,
  prompt: string,
  slug: string
): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)

  try {
    // First GET the current assistant config to preserve other settings
    const getRes = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      headers: { Authorization: `Bearer ${vapiApiKey}` },
      signal: controller.signal,
    })

    if (!getRes.ok) {
      const errText = await getRes.text()
      console.error(`  [${slug}] Failed to GET assistant ${assistantId}: ${getRes.status} ${errText}`)
      clearTimeout(timeout)
      return false
    }

    const current = await getRes.json()

    // Update the system prompt and tool definition
    const updatedMessages = [{ role: 'system', content: prompt }]
    const updatedTools = current.model?.tools ? [...current.model.tools] : []
    // Replace the send-customer-text tool definition (first tool)
    if (updatedTools.length > 0) {
      updatedTools[0] = {
        ...updatedTools[0],
        function: {
          ...updatedTools[0].function,
          ...toolDef.function,
        },
      }
    }

    const patchRes = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${vapiApiKey}`,
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
      console.error(`  [${slug}] Failed to PATCH assistant ${assistantId}: ${patchRes.status} ${errText}`)
      return false
    }

    console.log(`  [${slug}] ✓ Updated assistant ${assistantId}`)
    return true
  } catch (err) {
    clearTimeout(timeout)
    console.error(`  [${slug}] Error updating assistant ${assistantId}:`, err)
    return false
  }
}

async function main() {
  console.log('=== Updating VAPI House Cleaning Prompts ===\n')
  console.log(`Template prompt length: ${basePrompt.length} chars`)
  console.log(`Hardcoded formula present: ${basePrompt.includes('100 per bedroom')}`)
  console.log(`Tool-first pricing: ${basePrompt.includes('Do NOT calculate')}\n`)

  // Fetch house cleaning tenants
  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('id, slug, business_name, service_area, sdr_persona, vapi_api_key, vapi_assistant_id')
    .in('slug', HOUSE_CLEANING_SLUGS)
    .eq('active', true)

  if (error || !tenants) {
    console.error('Failed to fetch tenants:', error?.message)
    process.exit(1)
  }

  console.log(`Found ${tenants.length} house cleaning tenants:\n`)

  let success = 0
  let failed = 0

  for (const tenant of tenants) {
    console.log(`[${tenant.slug}] ${tenant.business_name}`)

    if (!tenant.vapi_api_key) {
      console.log(`  SKIP: No VAPI API key configured`)
      continue
    }
    if (!tenant.vapi_assistant_id) {
      console.log(`  SKIP: No VAPI assistant ID configured`)
      continue
    }

    // Replace placeholders with tenant-specific values
    const prompt = basePrompt
      .replaceAll('{{BUSINESS_NAME}}', tenant.business_name || tenant.slug)
      .replaceAll('{{SERVICE_AREA}}', tenant.service_area || 'your area')
      .replaceAll('{{SDR_PERSONA}}', tenant.sdr_persona || 'Sarah')
      .replaceAll('{{SERVICE_TYPE}}', 'house cleaning')

    console.log(`  Prompt customized: ${prompt.length} chars`)
    console.log(`  Assistant ID: ${tenant.vapi_assistant_id}`)

    const ok = await updateAssistant(
      tenant.vapi_api_key,
      tenant.vapi_assistant_id,
      prompt,
      tenant.slug,
    )

    if (ok) success++
    else failed++
  }

  console.log(`\n=== Done: ${success} updated, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}

main()
