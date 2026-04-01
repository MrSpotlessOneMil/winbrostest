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

const VAPI_API_KEY = process.env.VAPI_TOKEN || 'ea797598-b8b9-4fde-a75d-7c40be82ab9a';
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
  const assistantKeys = Object.keys(ASSISTANT_MAP).filter(k => k.startsWith(tenant));
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

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const variantArg = args.includes('--variant')
    ? args[args.indexOf('--variant') + 1]
    : undefined;
  const upgradeOnly = args.includes('--upgrade-settings');

  if (dryRun) {
    console.log('*** DRY RUN MODE — no changes will be made ***');
  }

  if (variantArg) {
    await deployVariant(variantArg, dryRun);
  } else if (upgradeOnly) {
    await upgradeSettings(dryRun);
  } else {
    console.log('Usage:');
    console.log('  npx tsx scripts/vapi-deploy.ts --variant spotless-a     Deploy a variant');
    console.log('  npx tsx scripts/vapi-deploy.ts --upgrade-settings       Upgrade model/voice');
    console.log('  npx tsx scripts/vapi-deploy.ts --dry-run --variant X    Preview changes');
  }

  console.log('\nDone.');
}

main().catch(console.error);
