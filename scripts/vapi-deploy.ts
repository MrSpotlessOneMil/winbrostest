#!/usr/bin/env npx tsx
/**
 * VAPI Deploy Script
 *
 * Pushes winning script variants + settings upgrades to VAPI assistants.
 *
 * Usage:
 *   npx tsx scripts/vapi-deploy.ts --variant spotless-a    # Deploy specific variant
 *   npx tsx scripts/vapi-deploy.ts --upgrade-settings      # Upgrade model/voice/turn detection settings
 *   npx tsx scripts/vapi-deploy.ts --dry-run               # Preview changes without applying
 */

import * as fs from 'fs';
import * as path from 'path';

const VAPI_API_KEY = process.env.VAPI_TOKEN;
if (!VAPI_API_KEY) throw new Error('VAPI_TOKEN env var required');
const VAPI_BASE = 'https://api.vapi.ai';

// Map tenant+type to VAPI assistant IDs (from the live API)
const ASSISTANT_MAP: Record<string, string> = {
  // Active assistants
  'spotless-inbound': 'e3ed2426-dc28-4046-a5e9-0fbb945ff706', // V2 Sarah - Spotless (Optimized)
  'spotless-inbound-west': '81cee3b3-324f-4d05-900e-ac0f57ed283f', // Mary - West Niagara
  'winbros-inbound': '74ba08ba-0b42-4186-8d15-1ea45cdeb368', // Mary - WinBros Bot
  'cedar-inbound': '4c673d16-436d-42ae-bf51-10b2c2d30fa0', // Mary - Cedar Rapids
  // Legacy (not actively used but listed)
  'spotless-legacy': '3aab40c8-6f4e-4a12-a411-85ace7b86ba8', // Mary - Spotless Bot
};

interface Variant {
  variantId: string;
  tenant: string;
  name: string;
  firstMessage: string;
  systemPrompt: string;
}

// V2 optimized settings to apply
const V2_SETTINGS = {
  model: {
    model: 'gpt-4o',
    temperature: 0.5,
  },
  voice: {
    provider: '11labs',
    model: 'eleven_flash_v2_5',
    voiceId: 'sWsBiVcjjowceAScTnu3',
    stability: 0.45,
    similarityBoost: 0.75,
    useSpeakerBoost: true,
    inputMinCharacters: 10,
  },
  // Turn detection — fix the 1500ms dead air
  transcriber: {
    provider: 'deepgram',
    model: 'nova-2-phonecall',
  },
};

async function vapiRequest(method: string, endpoint: string, body?: object) {
  const res = await fetch(`${VAPI_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VAPI ${method} ${endpoint} failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function deployVariant(variantId: string, dryRun: boolean) {
  const variantPath = path.join(__dirname, 'vapi-variants', `${variantId}.json`);
  if (!fs.existsSync(variantPath)) {
    console.error(`Variant file not found: ${variantPath}`);
    process.exit(1);
  }

  const variant: Variant = JSON.parse(fs.readFileSync(variantPath, 'utf-8'));
  const tenant = variant.tenant;

  // Determine which assistant(s) to update
  // Use exact tenant match from variant-to-assistant mapping, not prefix matching
  // (prefix matching caused spotless-a to deploy to spotless-inbound-west / West Niagara)
  const VARIANT_ASSISTANT_MAP: Record<string, string[]> = {
    spotless: ['spotless-inbound'],
    westNiagara: ['spotless-inbound-west'],
    winbros: ['winbros-inbound'],
    cedar: ['cedar-inbound'],
  };
  const assistantKeys = VARIANT_ASSISTANT_MAP[tenant] || Object.keys(ASSISTANT_MAP).filter(k => k === tenant);
  if (assistantKeys.length === 0) {
    console.error(`No assistant mapping found for tenant: ${tenant}`);
    process.exit(1);
  }

  console.log(`\nDeploying variant: ${variant.name} (${variantId})`);
  console.log(`Tenant: ${tenant}`);
  console.log(`Target assistants: ${assistantKeys.join(', ')}`);

  for (const key of assistantKeys) {
    if (key.includes('legacy')) {
      console.log(`  Skipping legacy assistant: ${key}`);
      continue;
    }

    const assistantId = ASSISTANT_MAP[key];
    console.log(`\n  Updating ${key} (${assistantId})...`);

    // Fetch current config to preserve toolIds and other fields
    const current = await vapiRequest('GET', `/assistant/${assistantId}`);
    const currentModel = current.model || {};

    const update = {
      firstMessage: variant.firstMessage,
      model: {
        ...V2_SETTINGS.model,
        provider: 'openai',
        toolIds: currentModel.toolIds || [],
        maxTokens: currentModel.maxTokens || 300,
        messages: [
          {
            role: 'system',
            content: variant.systemPrompt,
          },
        ],
      },
      voice: V2_SETTINGS.voice,
      transcriber: V2_SETTINGS.transcriber,
    };

    if (dryRun) {
      console.log(`  [DRY RUN] Would update with:`);
      console.log(`    First message: "${variant.firstMessage.slice(0, 80)}..."`);
      console.log(`    Prompt length: ${variant.systemPrompt.length} chars`);
      console.log(`    Model: ${V2_SETTINGS.model.model}`);
      console.log(`    Voice: ${V2_SETTINGS.voice.model}`);
    } else {
      await vapiRequest('PATCH', `/assistant/${assistantId}`, update);
      console.log(`  Updated successfully.`);
    }
  }
}

async function upgradeSettings(dryRun: boolean) {
  console.log('\nUpgrading VAPI settings for all assistants...');

  for (const [key, assistantId] of Object.entries(ASSISTANT_MAP)) {
    if (key.includes('legacy')) {
      console.log(`  Skipping legacy: ${key}`);
      continue;
    }

    console.log(`\n  ${key} (${assistantId})...`);

    // Get current config
    const current = await vapiRequest('GET', `/assistant/${assistantId}`);
    const currentModel = current.model?.model || 'unknown';
    const currentVoice = current.voice?.model || 'unknown';

    console.log(`    Current: model=${currentModel}, voice=${currentVoice}`);

    const update: Record<string, unknown> = {
      voice: V2_SETTINGS.voice,
      transcriber: V2_SETTINGS.transcriber,
    };

    // Only upgrade model if it's on gpt-4o-mini
    if (currentModel === 'gpt-4o-mini') {
      update.model = {
        ...current.model,
        model: 'gpt-4o',
        provider: 'openai',
        temperature: 0.5,
      };
      console.log(`    Upgrading model: gpt-4o-mini → gpt-4o`);
    }

    console.log(`    Upgrading voice: ${currentVoice} → ${V2_SETTINGS.voice.model}`);

    if (dryRun) {
      console.log(`    [DRY RUN] Would apply above changes`);
    } else {
      await vapiRequest('PATCH', `/assistant/${assistantId}`, update);
      console.log(`    Updated successfully.`);
    }
  }
}

// Tenant config for --fix-tools deployment
// Each entry maps to its variant file + assistant key
const HOUSE_CLEANING_ASSISTANTS: Record<string, { variant: string; assistantKey: string }> = {
  spotless: { variant: 'spotless-a', assistantKey: 'spotless-inbound' },
  westNiagara: { variant: 'west-niagara-a', assistantKey: 'spotless-inbound-west' },
  cedar: { variant: 'cedar-a', assistantKey: 'cedar-inbound' },
};

async function fixTools(dryRun: boolean) {
  console.log('\nDeploying 4-phase quote flow to house cleaning assistants...\n');

  // Load inline tools from the base template
  const templatePath = path.join(__dirname, '..', 'lib', 'vapi-templates', 'house-cleaning-inbound.json');
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
  const templateTools: object[] = template.model.tools || [];

  if (templateTools.length === 0) {
    console.error('ERROR: Template has no model.tools — nothing to deploy');
    process.exit(1);
  }

  for (const [tenantLabel, config] of Object.entries(HOUSE_CLEANING_ASSISTANTS)) {
    const assistantId = ASSISTANT_MAP[config.assistantKey];
    if (!assistantId) {
      console.warn(`  Skipping ${tenantLabel}: no assistant ID for ${config.assistantKey}`);
      continue;
    }

    // Load the variant (prompt already has tool instructions baked in)
    const variantPath = path.join(__dirname, 'vapi-variants', `${config.variant}.json`);
    if (!fs.existsSync(variantPath)) {
      console.warn(`  Skipping ${tenantLabel}: variant ${config.variant}.json not found`);
      continue;
    }
    const variant: Variant = JSON.parse(fs.readFileSync(variantPath, 'utf-8'));

    console.log(`  ${tenantLabel} / ${config.assistantKey} (${assistantId})`);
    console.log(`    Variant: ${variant.name} (${config.variant})`);

    // Fetch current config to preserve toolIds
    const current = await vapiRequest('GET', `/assistant/${assistantId}`);
    const currentModel = current.model || {};
    const existingToolIds: string[] = currentModel.toolIds || [];

    // Set base URL for inline tool server URLs
    const baseUrl = current.server?.url
      ? new URL(current.server.url).origin
      : 'https://cleanmachine.live';

    const tools = JSON.parse(JSON.stringify(templateTools));
    for (const tool of tools) {
      if (tool.server?.url && typeof tool.server.url === 'string') {
        try {
          const parsed = new URL(tool.server.url);
          tool.server.url = `${baseUrl}${parsed.pathname}`;
        } catch { /* leave as-is */ }
      }
    }

    const update = {
      firstMessage: variant.firstMessage,
      model: {
        ...V2_SETTINGS.model,
        provider: 'openai',
        toolIds: existingToolIds,
        tools,
        maxTokens: currentModel.maxTokens || 300,
        messages: [{ role: 'system', content: variant.systemPrompt }],
      },
    };

    if (dryRun) {
      console.log(`    [DRY RUN] Would update:`);
      console.log(`      First message: "${variant.firstMessage.slice(0, 70)}..."`);
      console.log(`      Prompt length: ${variant.systemPrompt.length} chars`);
      console.log(`      Inline tools: ${tools.length} (${tools.map((t: any) => t.function?.name).join(', ')})`);
      console.log(`      Preserved toolIds: [${existingToolIds.join(', ')}]`);
      console.log(`      Has CRITICAL instruction: ${variant.systemPrompt.includes('CRITICAL: You MUST call send-customer-text')}`);
      console.log(`      Has 4-phase flow: ${variant.systemPrompt.includes('Phase 4: Confirm')}`);
    } else {
      await vapiRequest('PATCH', `/assistant/${assistantId}`, update);
      console.log(`    Updated successfully.`);
      console.log(`      Inline tools: ${tools.length}`);
      console.log(`      Preserved toolIds: ${existingToolIds.length}`);
    }
    console.log('');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const variantArg = args.includes('--variant')
    ? args[args.indexOf('--variant') + 1]
    : undefined;
  const upgradeOnly = args.includes('--upgrade-settings');
  const fixToolsFlag = args.includes('--fix-tools');

  if (dryRun) {
    console.log('*** DRY RUN MODE — no changes will be made ***');
  }

  if (variantArg) {
    await deployVariant(variantArg, dryRun);
  } else if (upgradeOnly) {
    await upgradeSettings(dryRun);
  } else if (fixToolsFlag) {
    await fixTools(dryRun);
  } else {
    console.log('Usage:');
    console.log('  npx tsx scripts/vapi-deploy.ts --variant spotless-a     Deploy a variant');
    console.log('  npx tsx scripts/vapi-deploy.ts --upgrade-settings       Upgrade model/voice');
    console.log('  npx tsx scripts/vapi-deploy.ts --fix-tools              Deploy tool fix to house cleaning assistants');
    console.log('  npx tsx scripts/vapi-deploy.ts --dry-run --variant X    Preview changes');
  }

  console.log('\nDone.');
}

main().catch(console.error);
