#!/usr/bin/env npx tsx
/**
 * VAPI Call Flow Simulator
 *
 * Simulates hundreds of phone conversations between customer personas
 * and VAPI script variants using Claude, then scores each conversation
 * with an LLM judge.
 *
 * Usage:
 *   npx tsx scripts/vapi-simulator.ts                     # Run all tenants, all variants
 *   npx tsx scripts/vapi-simulator.ts --tenant spotless    # Run one tenant
 *   npx tsx scripts/vapi-simulator.ts --runs 3             # 3 runs per combo (default 5)
 *   npx tsx scripts/vapi-simulator.ts --concurrency 10     # 10 parallel convos (default 5)
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { getPersonasForTenant, type Persona } from './vapi-personas';
import { judgeConversation, type ConversationScore } from './vapi-judge';

// --- Config ---
const VARIANTS_DIR = path.join(__dirname, 'vapi-variants');
const RESULTS_DIR = path.join(__dirname, 'vapi-results');
const MAX_TURNS = 20;
const CUSTOMER_MODEL = 'claude-3-haiku-20240307';
const ASSISTANT_MODEL = 'claude-3-haiku-20240307';

interface Variant {
  variantId: string;
  tenant: string;
  name: string;
  firstMessage: string;
  systemPrompt: string;
}

interface SimResult {
  variantId: string;
  tenant: string;
  variantName: string;
  personaId: string;
  personaName: string;
  runIndex: number;
  transcript: string;
  score: ConversationScore;
  durationMs: number;
}

interface LeaderboardEntry {
  variantId: string;
  variantName: string;
  tenant: string;
  totalRuns: number;
  bookingRate: number;
  avgTurns: number;
  avgPriceMentions: number;
  objectionRecoveryRate: number;
  aiDisclosureRate: number;
  positiveRate: number;
  compositeScore: number;
}

// --- Helpers ---

function loadVariants(tenant?: string): Variant[] {
  const files = fs.readdirSync(VARIANTS_DIR).filter(f => f.endsWith('.json'));
  const variants: Variant[] = [];
  for (const file of files) {
    const v = JSON.parse(fs.readFileSync(path.join(VARIANTS_DIR, file), 'utf-8')) as Variant;
    if (!tenant || v.tenant === tenant) {
      variants.push(v);
    }
  }
  return variants;
}

async function simulateConversation(
  variant: Variant,
  persona: Persona,
  anthropic: Anthropic
): Promise<string> {
  const messages: { role: 'assistant' | 'user'; content: string }[] = [];
  const transcriptLines: string[] = [];

  // Assistant speaks first (VAPI default)
  transcriptLines.push(`AGENT: ${variant.firstMessage}`);
  messages.push({ role: 'assistant', content: variant.firstMessage });

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Customer responds
    const customerResponse = await anthropic.messages.create({
      model: CUSTOMER_MODEL,
      max_tokens: 150,
      system: `${persona.systemPrompt}\n\nYou are on a phone call with a booking agent. Respond naturally as this character would. Keep responses conversational and realistic — 1-3 sentences. If you want to end the call (book, hang up, or say goodbye), make it clear. The company is ${variant.tenant === 'spotless' ? 'Spotless Scrubbers (house cleaning, LA)' : variant.tenant === 'winbros' ? 'WinBros Window Cleaning (window cleaning, IL)' : 'Cedar Rapids Cleaning (house cleaning, Cedar Rapids IA)'}.`,
      messages: messages.map(m => ({
        role: m.role === 'assistant' ? 'user' : 'assistant', // flip roles for customer perspective
        content: m.content,
      })),
    });

    const customerText =
      customerResponse.content[0].type === 'text'
        ? customerResponse.content[0].text
        : '[no response]';
    transcriptLines.push(`CUSTOMER: ${customerText}`);
    messages.push({ role: 'user', content: customerText });

    // Check for conversation end signals
    const endSignals = [
      'goodbye', 'bye', 'hang up', 'forget it', "i'll call back",
      'not interested', 'no thanks', 'talk to you later',
      'have a great day', 'take care', 'thanks bye',
    ];
    const lowerCustomer = customerText.toLowerCase();
    const isEnding = endSignals.some(s => lowerCustomer.includes(s));

    if (isEnding && turn >= 2) {
      // Let assistant say goodbye too
      const agentGoodbye = await anthropic.messages.create({
        model: ASSISTANT_MODEL,
        max_tokens: 100,
        system: variant.systemPrompt,
        messages,
      });
      const goodbyeText =
        agentGoodbye.content[0].type === 'text'
          ? agentGoodbye.content[0].text
          : 'Have a great day!';
      transcriptLines.push(`AGENT: ${goodbyeText}`);
      break;
    }

    // Agent responds
    const agentResponse = await anthropic.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 150,
      system: variant.systemPrompt,
      messages,
    });

    const agentText =
      agentResponse.content[0].type === 'text'
        ? agentResponse.content[0].text
        : '[no response]';
    transcriptLines.push(`AGENT: ${agentText}`);
    messages.push({ role: 'assistant', content: agentText });

    // Check if agent ended call
    const agentEnd = ['have a great day', 'bye', 'goodbye', 'take care'].some(s =>
      agentText.toLowerCase().includes(s)
    );
    if (agentEnd && turn >= 3) break;
  }

  return transcriptLines.join('\n');
}

function computeLeaderboard(results: SimResult[]): LeaderboardEntry[] {
  const grouped = new Map<string, SimResult[]>();
  for (const r of results) {
    const key = r.variantId;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  const leaderboard: LeaderboardEntry[] = [];
  for (const [variantId, runs] of grouped) {
    const total = runs.length;
    const booked = runs.filter(r => r.score.booked).length;
    const avgTurns = runs.reduce((s, r) => s + r.score.turns, 0) / total;
    const avgPrice = runs.reduce((s, r) => s + r.score.priceMentions, 0) / total;
    const objRecovered = runs.filter(r => r.score.objectionRecovered).length;
    const aiHandled = runs.filter(r => r.score.aiDisclosureHandled).length;
    const positive = runs.filter(r => r.score.callerSentiment === 'positive').length;

    const bookingRate = booked / total;
    const objRate = objRecovered / total;
    const aiRate = aiHandled / total;
    const turnScore = Math.max(0, 1 - (avgTurns - 4) / 16); // 4 turns = perfect, 20 = 0
    const priceScore = Math.max(0, 1 - avgPrice / 5); // 0 mentions = perfect, 5+ = 0

    // Composite: booking 50%, turns 15%, price 15%, objection 10%, AI 10%
    const composite =
      bookingRate * 0.5 +
      turnScore * 0.15 +
      priceScore * 0.15 +
      objRate * 0.1 +
      aiRate * 0.1;

    leaderboard.push({
      variantId,
      variantName: runs[0].variantName,
      tenant: runs[0].tenant,
      totalRuns: total,
      bookingRate: Math.round(bookingRate * 100),
      avgTurns: Math.round(avgTurns * 10) / 10,
      avgPriceMentions: Math.round(avgPrice * 10) / 10,
      objectionRecoveryRate: Math.round(objRate * 100),
      aiDisclosureRate: Math.round(aiRate * 100),
      positiveRate: Math.round((positive / total) * 100),
      compositeScore: Math.round(composite * 100),
    });
  }

  return leaderboard.sort((a, b) => b.compositeScore - a.compositeScore);
}

function printLeaderboard(leaderboard: LeaderboardEntry[]) {
  // Group by tenant
  const tenants = [...new Set(leaderboard.map(e => e.tenant))];

  for (const tenant of tenants) {
    const entries = leaderboard.filter(e => e.tenant === tenant);
    console.log(`\n${'='.repeat(80)}`);
    console.log(`  ${tenant.toUpperCase()} — RESULTS`);
    console.log('='.repeat(80));
    console.log(
      `  ${'Rank'.padEnd(5)} ${'Variant'.padEnd(30)} ${'Book%'.padEnd(7)} ${'Turns'.padEnd(7)} ${'Price'.padEnd(7)} ${'ObjRec%'.padEnd(9)} ${'AI%'.padEnd(6)} ${'Score'.padEnd(6)}`
    );
    console.log('-'.repeat(80));

    entries.forEach((e, i) => {
      const medal = i === 0 ? '[1st]' : i === 1 ? '[2nd]' : i === 2 ? '[3rd]' : `[${i + 1}]`;
      console.log(
        `  ${medal.padEnd(5)} ${e.variantName.padEnd(30)} ${(e.bookingRate + '%').padEnd(7)} ${String(e.avgTurns).padEnd(7)} ${String(e.avgPriceMentions).padEnd(7)} ${(e.objectionRecoveryRate + '%').padEnd(9)} ${(e.aiDisclosureRate + '%').padEnd(6)} ${e.compositeScore}`
      );
    });
  }
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const tenantArg = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : undefined;
  const runsPerCombo = args.includes('--runs')
    ? parseInt(args[args.indexOf('--runs') + 1])
    : 5;
  const concurrency = args.includes('--concurrency')
    ? parseInt(args[args.indexOf('--concurrency') + 1])
    : 5;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY not set. Add it to your .env.local or export it.');
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey });
  const variants = loadVariants(tenantArg);

  if (variants.length === 0) {
    console.error(`No variants found${tenantArg ? ` for tenant "${tenantArg}"` : ''}`);
    process.exit(1);
  }

  console.log(`\nVAPI Call Flow Simulator`);
  console.log(`${'='.repeat(50)}`);
  console.log(`Variants: ${variants.length}`);
  console.log(`Runs per persona/variant: ${runsPerCombo}`);
  console.log(`Concurrency: ${concurrency}`);

  // Build simulation jobs
  type Job = { variant: Variant; persona: Persona; runIndex: number };
  const jobs: Job[] = [];
  for (const variant of variants) {
    const tenant = variant.tenant as 'spotless' | 'winbros' | 'cedar';
    const personas = getPersonasForTenant(tenant);
    for (const persona of personas) {
      for (let run = 0; run < runsPerCombo; run++) {
        jobs.push({ variant, persona, runIndex: run });
      }
    }
  }

  console.log(`Total conversations: ${jobs.length}`);
  console.log(`\nStarting simulation...\n`);

  const results: SimResult[] = [];
  let completed = 0;
  let errors = 0;

  // Process with concurrency limit
  async function processJob(job: Job): Promise<SimResult | null> {
    const start = Date.now();
    try {
      const transcript = await simulateConversation(job.variant, job.persona, anthropic);
      const score = await judgeConversation(transcript, anthropic);

      completed++;
      const pct = Math.round((completed / jobs.length) * 100);
      const status = score.booked ? 'BOOKED' : 'NO BOOK';
      process.stdout.write(
        `\r  [${pct}%] ${completed}/${jobs.length} done | ${job.variant.variantId} × ${job.persona.id} → ${status}    `
      );

      return {
        variantId: job.variant.variantId,
        tenant: job.variant.tenant,
        variantName: job.variant.name,
        personaId: job.persona.id,
        personaName: job.persona.name,
        runIndex: job.runIndex,
        transcript,
        score,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      errors++;
      console.error(`\n  ERROR: ${job.variant.variantId} × ${job.persona.id} #${job.runIndex}: ${(e as Error).message}`);
      return null;
    }
  }

  // Run with concurrency pool
  const pool: Promise<void>[] = [];
  let jobIndex = 0;

  async function worker() {
    while (jobIndex < jobs.length) {
      const idx = jobIndex++;
      const result = await processJob(jobs[idx]);
      if (result) results.push(result);
    }
  }

  for (let i = 0; i < Math.min(concurrency, jobs.length); i++) {
    pool.push(worker());
  }
  await Promise.all(pool);

  console.log(`\n\n  Completed: ${completed} | Errors: ${errors}\n`);

  // Compute and display leaderboard
  const leaderboard = computeLeaderboard(results);
  printLeaderboard(leaderboard);

  // Save results
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const resultFile = path.join(RESULTS_DIR, `simulation-${timestamp}.json`);

  fs.writeFileSync(
    resultFile,
    JSON.stringify(
      {
        metadata: {
          timestamp: new Date().toISOString(),
          runsPerCombo,
          totalConversations: results.length,
          errors,
          tenantFilter: tenantArg || 'all',
        },
        leaderboard,
        results: results.map(r => ({
          variantId: r.variantId,
          personaId: r.personaId,
          runIndex: r.runIndex,
          score: r.score,
          durationMs: r.durationMs,
          // Omit full transcripts from summary — they're big
        })),
        // Save a few sample transcripts for review
        sampleTranscripts: results.slice(0, 20).map(r => ({
          variantId: r.variantId,
          personaId: r.personaId,
          transcript: r.transcript,
          score: r.score,
        })),
      },
      null,
      2
    )
  );

  console.log(`\nResults saved to: ${resultFile}`);

  // Save full transcripts separately
  const transcriptFile = path.join(RESULTS_DIR, `transcripts-${timestamp}.json`);
  fs.writeFileSync(
    transcriptFile,
    JSON.stringify(
      results.map(r => ({
        variantId: r.variantId,
        personaId: r.personaId,
        runIndex: r.runIndex,
        transcript: r.transcript,
        score: r.score,
      })),
      null,
      2
    )
  );
  console.log(`Transcripts saved to: ${transcriptFile}`);

  // Print winner recommendation
  const tenants = [...new Set(leaderboard.map(e => e.tenant))];
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  RECOMMENDATIONS`);
  console.log('='.repeat(80));
  for (const tenant of tenants) {
    const winner = leaderboard.filter(e => e.tenant === tenant)[0];
    if (winner) {
      console.log(
        `  ${tenant.toUpperCase()}: Deploy "${winner.variantName}" (${winner.variantId}) — ${winner.bookingRate}% booking rate, score ${winner.compositeScore}`
      );
    }
  }
  console.log('');
}

main().catch(console.error);
