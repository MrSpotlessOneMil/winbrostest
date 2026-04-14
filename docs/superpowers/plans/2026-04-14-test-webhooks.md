# Webhook Test Coverage Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unit tests for all webhook routes — Stripe, OpenPhone, VAPI, GHL, HousecallPro, Meta, and Website. These are public endpoints with no user auth — they're the most exposed surface area.

**Architecture:** Webhook routes resolve tenants from payloads (not sessions), verify signatures, check idempotency, and mutate core tables. Tests verify: signature rejection, tenant resolution, idempotency dedup, and happy path mutations. Each webhook has unique auth — signature HMAC, token verification, or none.

**Tech Stack:** Vitest, existing MockSupabaseClient, mock modules, `tests/fixtures/payloads.ts` for webhook payloads

---

## Key Webhook Patterns

| Webhook | Signature Header | Tenant Resolution | Idempotency |
|---|---|---|---|
| Stripe | `stripe-signature` (HMAC) | Per-tenant secret matching | `stripe_processed_events` table |
| OpenPhone | `openphone-signature` (HMAC) | Phone number lookup | Message ID dedup |
| GHL | `X-GHL-Signature` (HMAC) | `?tenant=` query param | Phone + source_id |
| HousecallPro | `X-HousecallPro-Signature` (HMAC) | Per-tenant secret matching | `housecall_pro_job_id` |
| Meta | Token in GET verify | URL `[slug]` param | `source_id='meta-{id}'` |
| Website | None | URL `[slug]` param | Message pre-insert |
| VAPI | None visible | Hardcoded 'winbros' | Delegates to handler |

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `tests/unit/webhooks/stripe-webhook.test.ts` | Create | Stripe payment webhook tests |
| `tests/unit/webhooks/openphone-webhook.test.ts` | Create | OpenPhone SMS webhook tests |
| `tests/unit/webhooks/ghl-webhook.test.ts` | Create | GoHighLevel lead webhook tests |
| `tests/unit/webhooks/housecall-pro-webhook.test.ts` | Create | HousecallPro job sync webhook tests |
| `tests/unit/webhooks/meta-webhook.test.ts` | Create | Meta lead ads webhook tests |
| `tests/unit/webhooks/website-webhook.test.ts` | Create | Website form submission webhook tests |

---

## Chunk 1: Stripe & OpenPhone (Highest Priority)

### Task 1: Stripe Webhook Tests

**Files:**
- Create: `tests/unit/webhooks/stripe-webhook.test.ts`
- Reference: `app/api/webhooks/stripe/route.ts`

Stripe is the most critical webhook — handles all payment events.

Tests to write:

- [ ] **Step 1: Write test — valid deposit payment updates job status**

```typescript
// POST with checkout.session.completed event, metadata.type='DEPOSIT'
// Mock: validateStripeWebhook returns valid event
// Seed: job with payment_status='pending'
// Assert: job.payment_status='deposit_paid', stripe_processed_events row inserted
```

- [ ] **Step 2: Write test — duplicate event ID is skipped (idempotency)**

```typescript
// POST with event_id already in stripe_processed_events
// Assert: 200 (acknowledged), NO mutations to jobs table
```

- [ ] **Step 3: Write test — invalid signature returns 400**

```typescript
// POST with bad/missing stripe-signature header
// Mock: validateStripeWebhook throws
// Assert: 400
```

- [ ] **Step 4: Write test — payment_failed event updates job correctly**

```typescript
// POST with payment_intent.payment_failed event
// Seed: job with payment_status='pending'
// Assert: job.payment_status='payment_failed'
```

- [ ] **Step 5: Run tests, commit**

Run: `npm run test -- tests/unit/webhooks/stripe-webhook.test.ts`

```bash
git add tests/unit/webhooks/stripe-webhook.test.ts
git commit -m "test: add Stripe webhook tests (deposit, idempotency, signature, failure)"
```

---

### Task 2: OpenPhone Webhook Tests

**Files:**
- Create: `tests/unit/webhooks/openphone-webhook.test.ts`
- Reference: `app/api/webhooks/openphone/route.ts`

OpenPhone handles all inbound/outbound SMS.

Tests to write:

- [ ] **Step 1: Write test — inbound SMS from known customer resolves tenant**

```typescript
// POST with valid openphone-signature, inbound message to tenant's phone number
// Seed: customer with matching phone, tenant with openphone_phone_number
// Assert: 200, message stored, tenant correctly resolved
```

- [ ] **Step 2: Write test — invalid signature returns 401**

```typescript
// POST with bad openphone-signature header
// Assert: 401 or 400
```

- [ ] **Step 3: Write test — outbound message deduplication**

```typescript
// POST with outbound message where external_message_id already exists
// Assert: 200, no duplicate message created
```

- [ ] **Step 4: Run tests, commit**

```bash
git add tests/unit/webhooks/openphone-webhook.test.ts
git commit -m "test: add OpenPhone webhook tests (inbound, signature, dedup)"
```

---

## Chunk 2: GHL, HousecallPro, Meta, Website

### Task 3: GHL Webhook Tests

**Files:**
- Create: `tests/unit/webhooks/ghl-webhook.test.ts`
- Reference: `app/api/webhooks/ghl/route.ts`

Tests to write:

- [ ] **Step 1: Write test — valid lead creates customer and lead records**

```typescript
// POST with valid X-GHL-Signature, ?tenant=cedar-rapids, lead payload with phone/name
// Assert: 200, customer upserted, lead created with source='ghl'
```

- [ ] **Step 2: Write test — invalid signature returns 401**

```typescript
// POST with bad X-GHL-Signature
// Assert: 401
```

- [ ] **Step 3: Write test — missing ?tenant= param returns 400**

```typescript
// POST with no tenant query param
// Assert: 400
```

- [ ] **Step 4: Run tests, commit**

```bash
git add tests/unit/webhooks/ghl-webhook.test.ts
git commit -m "test: add GHL webhook tests (lead creation, signature, missing tenant)"
```

---

### Task 4: HousecallPro Webhook Tests

**Files:**
- Create: `tests/unit/webhooks/housecall-pro-webhook.test.ts`
- Reference: `app/api/webhooks/housecall-pro/route.ts`

Tests to write:

- [ ] **Step 1: Write test — job.created creates customer + job in OSIRIS**

```typescript
// POST with valid X-HousecallPro-Signature, event_type='job.created'
// Assert: 200, customer upserted, job created with housecall_pro_job_id
```

- [ ] **Step 2: Write test — duplicate housecall_pro_job_id is skipped**

```typescript
// POST with job.created where housecall_pro_job_id already exists in jobs table
// Assert: 200, no duplicate job
```

- [ ] **Step 3: Write test — invalid signature returns 401**

```typescript
// POST with bad signature
// Assert: 401
```

- [ ] **Step 4: Run tests, commit**

```bash
git add tests/unit/webhooks/housecall-pro-webhook.test.ts
git commit -m "test: add HousecallPro webhook tests (job sync, dedup, signature)"
```

---

### Task 5: Meta Webhook Tests

**Files:**
- Create: `tests/unit/webhooks/meta-webhook.test.ts`
- Reference: `app/api/webhooks/meta/[slug]/route.ts`

Tests to write:

- [ ] **Step 1: Write test — GET verification returns challenge on valid token**

```typescript
// GET with hub.mode=subscribe, hub.verify_token=matching_token, hub.challenge='test123'
// Assert: 200, body = 'test123'
```

- [ ] **Step 2: Write test — GET verification rejects wrong token**

```typescript
// GET with hub.verify_token=wrong_token
// Assert: 403
```

- [ ] **Step 3: Write test — POST leadgen creates customer and lead**

```typescript
// POST with leadgen event, valid slug
// Mock: Meta Graph API fetch returns lead data
// Assert: 200, customer upserted, lead created with source='meta'
```

- [ ] **Step 4: Run tests, commit**

```bash
git add tests/unit/webhooks/meta-webhook.test.ts
git commit -m "test: add Meta webhook tests (verification, token rejection, leadgen)"
```

---

### Task 6: Website Webhook Tests

**Files:**
- Create: `tests/unit/webhooks/website-webhook.test.ts`
- Reference: `app/api/webhooks/website/[slug]/route.ts`

Tests to write:

- [ ] **Step 1: Write test — valid form submission creates customer and lead**

```typescript
// POST with name='Jane', phone='+13195550001', valid slug
// Assert: 200, customer upserted, lead created with source='website'
```

- [ ] **Step 2: Write test — missing name or phone returns 400**

```typescript
// POST with missing phone
// Assert: 400
```

- [ ] **Step 3: Write test — invalid slug (unknown tenant) returns 404**

```typescript
// POST with slug='nonexistent-tenant'
// Assert: 404
```

- [ ] **Step 4: Run tests, commit**

```bash
git add tests/unit/webhooks/website-webhook.test.ts
git commit -m "test: add website webhook tests (form submission, validation, bad slug)"
```

---

## Notes

- **Signature verification** is the most critical thing to test for each webhook — it's the only auth layer
- **Existing webhook tests** in `tests/cedar-rapids/` cover some Stripe and Telegram flows but not the HTTP/signature layer
- **Mock fetch** for Meta webhook (Graph API call) — use `vi.stubGlobal('fetch', mockFetch)` pattern from vapi-templates tests
- **OpenPhone webhook** is the most complex route (~500+ lines) — start with the 3 highest-value tests, expand later
- Total new tests: ~19 across 6 files