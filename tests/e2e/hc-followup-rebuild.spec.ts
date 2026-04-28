/**
 * Tier 3 E2E — HC Build 1 (rapport+price-hidden) + Build 2 (followup rebuild)
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 *
 * STATE OF THESE TESTS
 * ─────────────────────────────────────────────────────────────────────────
 * Tests are split into two groups:
 *
 *  1. "no-DB" — runs against any dev server. Verifies auth + routing + handler
 *     wiring for the new task_types. Safe to run today.
 *
 *  2. "requires migrations" — exercises the full inbound→rapport→quote-link
 *     flow and ghost-chase scheduling. Skipped by default. Un-skip by:
 *       (a) applying scripts/migrations/20260428_pre_quote_rapport_state.sql
 *       (b) applying scripts/migrations/20260428_followup_rebuild_columns.sql
 *       (c) flipping spotless-scrubbers workflow_config.followup_rebuild_v2_enabled = true
 *       (d) running with FOLLOWUP_REBUILD_E2E=true env var
 */

import { test, expect } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const CRON_SECRET = process.env.CRON_SECRET || ''
const E2E_MIGRATIONS_APPLIED = process.env.FOLLOWUP_REBUILD_E2E === 'true'

// ─────────────────────────────────────────────────────────────────────────
// Group 1 — no-DB: cron auth + handler wiring
// ─────────────────────────────────────────────────────────────────────────

test.describe('process-scheduled-tasks — auth (no DB required)', () => {
  test.skip(!CRON_SECRET, 'Skipped: CRON_SECRET not set (dev mode allows all)')

  test('rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get(`${BASE}/api/cron/process-scheduled-tasks`)
    expect(res.status()).toBe(401)
  })

  test('accepts authenticated requests with bearer secret', async ({ request }) => {
    const res = await request.get(`${BASE}/api/cron/process-scheduled-tasks`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
    // Should be 200 even with no due tasks — valid no-op response
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Group 2 — requires migrations + Spotless flag flipped on
// ─────────────────────────────────────────────────────────────────────────

test.describe('Build 1 — rapport-first quote send', () => {
  test.skip(!E2E_MIGRATIONS_APPLIED, 'Skipped: requires migrations applied + Spotless v2 flag enabled (set FOLLOWUP_REBUILD_E2E=true to run)')

  test.fixme('inbound flow: gathers facts → sends rapport → sends quote-link with no $', async () => {
    // Outline (un-skip and fill in once migrations are applied):
    // 1. POST a fake inbound to /api/webhooks/openphone/{spotless-id} with a fresh phone number
    // 2. Verify AI response asks for bed/bath
    // 3. POST another inbound providing bed/bath
    // 4. Verify next AI response is RAPPORT (no $, no quote URL, no [BOOKING_COMPLETE])
    // 5. Query customers table — pre_quote_rapport_sent_at should be set
    // 6. POST another inbound (the customer reply to rapport)
    // 7. Verify next AI response triggers [BOOKING_COMPLETE] AND the message body has no $ NN
    // 8. Verify a quote-link SMS was queued separately
  })

  test.fixme('takeover-resume: AI re-reads history when human takeover ends', async () => {
    // 1. Set customers.human_takeover_until = NOW() - 1 hour for the test customer
    // 2. POST an inbound
    // 3. Verify the AI response references prior conversation and does not repeat what the human said
  })
})

test.describe('Build 2 — ghost chase + retargeting + STOP', () => {
  test.skip(!E2E_MIGRATIONS_APPLIED, 'Skipped: requires migrations applied + Spotless v2 flag enabled (set FOLLOWUP_REBUILD_E2E=true to run)')

  test.fixme('ghost chase: 6 tasks scheduled when lead is contacted', async () => {
    // 1. Create a fresh lead via POST /api/webhooks/openphone with a new phone
    // 2. Verify scheduled_tasks has 6 rows with task_type='followup.ghost_chase' for that customer
    // 3. Each row's payload contains step_index 1-6 and matching scheduled_for offsets
  })

  test.fixme('STOP cancels all pending tasks system-wide and sends ONE confirmation', async () => {
    // 1. Pre-seed: a customer with 3 pending scheduled_tasks of varying task_types
    // 2. POST inbound "STOP" via /api/webhooks/openphone
    // 3. Verify all 3 scheduled_tasks rows now have status='cancelled'
    // 4. Verify customers.unsubscribed_at is set
    // 5. Verify exactly ONE outbound SMS was sent (the TCPA confirmation)
  })

  test.fixme('process-scheduled-tasks fires followup.ghost_chase step 1 with no $ in body', async () => {
    // 1. Pre-seed: scheduled_tasks row with task_type='followup.ghost_chase', step_index=1, scheduled_for=PAST
    // 2. Customer eligible (engaged, not unsubscribed, no human takeover)
    // 3. Trigger /api/cron/process-scheduled-tasks with CRON_SECRET
    // 4. Verify: outbound SMS sent, message body matches "still_there" template, no $ in body
  })

  test.fixme('retargeting next-task-on-fire: after step 5, next task is +4 weeks evergreen', async () => {
    // 1. Pre-seed: scheduled_tasks row with task_type='retargeting.win_back', step_index=5, phase='structured', scheduled_for=PAST
    // 2. Trigger cron
    // 3. Verify: ONE new scheduled_tasks row, phase='evergreen', step_index=6, scheduled_for ~+4 weeks
  })
})
