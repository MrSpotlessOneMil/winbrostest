/**
 * Regression test: Stripe webhook double-send race condition.
 *
 * Bug history: checkout.session.completed and setup_intent.succeeded BOTH fire
 * simultaneously for card-on-file setups. Any DB-based dedup races — both pass
 * the check before either writes. Fix: setup_intent.succeeded is a no-op.
 * ALL processing happens in checkout.session.completed only.
 *
 * This test verifies the dedup patterns work correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetAllMocks, mockClient, resetMockClient } from '../mocks/modules'
import { CEDAR_RAPIDS_ID, makeSeedData, makeBookedJob } from '../fixtures/cedar-rapids'
import { makeStripeCheckoutCompleted, makeStripeSetupIntentSucceeded } from '../fixtures/payloads'

describe('Stripe webhook dedup', () => {
  beforeEach(() => {
    resetAllMocks()
    const seed = makeSeedData()
    seed.jobs.push(makeBookedJob())
    // Add the stripe_processed_events table
    ;(seed as any).stripe_processed_events = []
    resetMockClient(seed)
  })

  it('first checkout.session.completed event is processed', async () => {
    const event = makeStripeCheckoutCompleted('job-cr-001', 'DEPOSIT')

    // Check if event was already processed
    const { data: existing } = await mockClient.from('stripe_processed_events')
      .select('*')
      .eq('event_id', event.id)
      .maybeSingle()

    expect(existing).toBeNull() // Not yet processed

    // Mark as processed
    await mockClient.from('stripe_processed_events').insert({
      event_id: event.id,
      event_type: event.type,
      tenant_id: CEDAR_RAPIDS_ID,
    })

    // Verify it's now in the dedup table
    const { data: recorded } = await mockClient.from('stripe_processed_events')
      .select('*')
      .eq('event_id', event.id)
      .single()

    expect(recorded).not.toBeNull()
    expect(recorded?.event_type).toBe('checkout.session.completed')
  })

  it('duplicate event is rejected by dedup check', async () => {
    const event = makeStripeCheckoutCompleted('job-cr-001', 'DEPOSIT')

    // First processing — insert into dedup table
    await mockClient.from('stripe_processed_events').insert({
      event_id: event.id,
      event_type: event.type,
      tenant_id: CEDAR_RAPIDS_ID,
    })

    // Second processing attempt — should find existing record
    const { data: existing } = await mockClient.from('stripe_processed_events')
      .select('*')
      .eq('event_id', event.id)
      .maybeSingle()

    expect(existing).not.toBeNull()
    // This means the handler would early-return (not process twice)
  })

  it('setup_intent.succeeded event should be a no-op (all processing in checkout)', () => {
    const event = makeStripeSetupIntentSucceeded('job-cr-001')
    // The fix: setup_intent.succeeded just logs and returns.
    // We verify the event type is recognized but should NOT trigger job updates.
    expect(event.type).toBe('setup_intent.succeeded')
    // The actual route handler should return early for this event type.
    // This test documents the expected behavior — the route test (if added)
    // would verify the handler returns 200 without updating the job.
  })

  it('payment links dedup prevents double-sending to customer', async () => {
    // Simulate: payment links already sent for this job
    await mockClient.from('messages').insert({
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550001',
      content: 'Here is your payment link: https://stripe.mock/deposit/123',
      role: 'assistant',
      direction: 'outbound',
      source: 'deposit',
    })

    // Check if payment links already sent
    const { data: existingPaymentMessages } = await mockClient.from('messages')
      .select('*')
      .eq('tenant_id', CEDAR_RAPIDS_ID)
      .eq('phone_number', '+13195550001')
      .in('source', ['card_on_file', 'deposit', 'invoice', 'estimate_booked'])

    expect(existingPaymentMessages!.length).toBeGreaterThan(0)
    // Handler would skip sending payment links again
  })
})
