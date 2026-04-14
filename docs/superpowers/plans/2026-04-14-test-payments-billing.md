# Payments & Billing Test Coverage Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unit tests for all payment-critical routes — visit payments, upsells, quote approval/conversion, crew charge, and earnings.

**Architecture:** Each test file imports the route handler, mocks Supabase/Stripe via the existing `tests/mocks/modules.ts` infrastructure, and verifies auth, cross-tenant rejection, happy path mutations, and error cases. Tests follow the project convention: happy path + cross-tenant 404 + edge case.

**Tech Stack:** Vitest, existing MockSupabaseClient (`tests/mocks/supabase-mock.ts`), existing mock modules (`tests/mocks/modules.ts`)

---

## Existing Patterns to Follow

- **Mock setup:** `tests/mocks/modules.ts` provides `resetAllMocks()`, `mockClient`, `mockSendSMS`, `resetMockClient(seedData)`
- **Request factory:** `tests/helpers.ts` provides `createMockRequest(url, options)`
- **Auth mock:** `requireAuthWithTenant` is mocked — returns `{ tenant: {...}, user: {...} }` by default
- **Seed data:** `tests/fixtures/cedar-rapids.ts` provides `makeSeedData()`, `CEDAR_RAPIDS_ID`, `CEDAR_RAPIDS_TENANT`
- **Run command:** `npm run test -- tests/unit/payments/`
- **Assertion pattern:** `expect(res.status).toBe(200)`, parse body with `await res.json()`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `tests/unit/payments/visit-payment.test.ts` | Create | Tests for `POST /api/actions/visits/payment` |
| `tests/unit/payments/visit-upsell.test.ts` | Create | Tests for `POST /api/actions/visits/upsell` |
| `tests/unit/payments/visit-transition.test.ts` | Create | Tests for `POST /api/actions/visits/transition` |
| `tests/unit/payments/quote-approve.test.ts` | Create | Tests for `POST /api/actions/quotes/approve` |
| `tests/unit/payments/crew-charge.test.ts` | Create | Tests for `POST /api/crew/[token]/job/[jobId]/charge` |

---

## Chunk 1: Visit Payment & Upsell Tests

### Task 1: Visit Payment Route Tests

**Files:**
- Create: `tests/unit/payments/visit-payment.test.ts`
- Reference: `app/api/actions/visits/payment/route.ts`

Tests to write (3 per convention):

- [ ] **Step 1: Write test — happy path records payment on valid visit**

```typescript
// POST with valid visitId, payment_type='card', payment_amount=350
// Seed: visit with status 'completed', tenant_id = CEDAR_RAPIDS_ID
// Assert: 200, payment recorded on visit
```

- [ ] **Step 2: Write test — cross-tenant visit returns 404**

```typescript
// POST with visitId belonging to DIFFERENT tenant
// Assert: 404 (not 200, not 403 — standard cross-tenant pattern)
```

- [ ] **Step 3: Write test — missing required fields returns 400**

```typescript
// POST with missing payment_type or payment_amount
// Assert: 400 with error message
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/payments/visit-payment.test.ts`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add tests/unit/payments/visit-payment.test.ts
git commit -m "test: add visit payment route tests (happy path, cross-tenant, validation)"
```

---

### Task 2: Visit Upsell Route Tests

**Files:**
- Create: `tests/unit/payments/visit-upsell.test.ts`
- Reference: `app/api/actions/visits/upsell/route.ts`

Tests to write:

- [ ] **Step 1: Write test — happy path adds upsell line item to in-progress visit**

```typescript
// POST with visitId (status='in_progress'), service_name='Screen Cleaning', price=50
// Assert: 200, line item created with revenue_type='technician_upsell'
```

- [ ] **Step 2: Write test — cross-tenant visit returns 404**

```typescript
// POST with visitId belonging to different tenant
// Assert: 404
```

- [ ] **Step 3: Write test — upsell on non-in-progress visit returns 400**

```typescript
// POST with visitId where status='completed' (not in_progress)
// Assert: 400 (upsell window closed)
```

- [ ] **Step 4: Run tests, commit**

Run: `npm run test -- tests/unit/payments/visit-upsell.test.ts`

```bash
git add tests/unit/payments/visit-upsell.test.ts
git commit -m "test: add visit upsell route tests"
```

---

### Task 3: Visit Transition Route Tests

**Files:**
- Create: `tests/unit/payments/visit-transition.test.ts`
- Reference: `app/api/actions/visits/transition/route.ts`

Tests to write:

- [ ] **Step 1: Write test — happy path transitions visit to next valid status**

```typescript
// POST with visitId (status='not_started'), targetStatus='on_my_way'
// Assert: 200, visit status updated
```

- [ ] **Step 2: Write test — cross-tenant visit returns 404**

```typescript
// Assert: 404 for visit belonging to different tenant
```

- [ ] **Step 3: Write test — invalid transition rejected (skip status)**

```typescript
// POST with visitId (status='not_started'), targetStatus='completed' (skipping steps)
// Assert: 400 (invalid transition)
```

- [ ] **Step 4: Run tests, commit**

```bash
git add tests/unit/payments/visit-transition.test.ts
git commit -m "test: add visit transition route tests"
```

---

## Chunk 2: Quote Approval & Crew Charge Tests

### Task 4: Quote Approve Route Tests

**Files:**
- Create: `tests/unit/payments/quote-approve.test.ts`
- Reference: `app/api/actions/quotes/approve/route.ts`

Tests to write:

- [ ] **Step 1: Write test — happy path approves quote and creates job + visit**

```typescript
// POST with quoteId (status='sent'), approvedBy='salesman'
// Seed: quote with line items, customer, tenant
// Assert: 200, quote status='approved', job created, visit created with line items
```

- [ ] **Step 2: Write test — cross-tenant quote returns 404**

```typescript
// POST with quoteId belonging to different tenant
// Assert: 404
```

- [ ] **Step 3: Write test — already-converted quote returns 400**

```typescript
// POST with quoteId (status='converted' — already approved)
// Assert: 400 (cannot re-approve)
```

- [ ] **Step 4: Run tests, commit**

```bash
git add tests/unit/payments/quote-approve.test.ts
git commit -m "test: add quote approval route tests"
```

---

### Task 5: Crew Charge Route Tests

**Files:**
- Create: `tests/unit/payments/crew-charge.test.ts`
- Reference: `app/api/crew/[token]/job/[jobId]/charge/route.ts`

This route uses portal token auth (not requireAuthWithTenant). Tests need different setup.

Tests to write:

- [ ] **Step 1: Write test — happy path charges card on completed job**

```typescript
// POST with valid portal_token, jobId for completed+unpaid job
// Seed: cleaner with portal_token, assignment confirmed, job completed, customer with stripe_customer_id
// Mock: chargeCardOnFile returns success
// Assert: 200, job.paid=true, job.payment_status='fully_paid'
```

- [ ] **Step 2: Write test — invalid portal token returns 404**

```typescript
// POST with non-existent portal_token
// Assert: 404 (cleaner not found)
```

- [ ] **Step 3: Write test — already-paid job returns 400**

```typescript
// POST with jobId where paid=true
// Assert: 400 (already paid)
```

- [ ] **Step 4: Run tests, commit**

```bash
git add tests/unit/payments/crew-charge.test.ts
git commit -m "test: add crew charge route tests"
```

---

## Notes

- **Do NOT test Stripe API calls directly** — mock `chargeCardOnFile` and `createDepositLink` via the existing mock infrastructure
- **Visit state machine** is tested in `tests/unit/winbros/visit-flow.test.ts` — these route tests verify the HTTP layer (auth, validation, cross-tenant), not the state logic itself
- **Quote conversion logic** partially tested in `tests/unit/winbros/quote-conversion.test.ts` — route tests add auth + HTTP layer coverage
- Total new tests: ~15 across 5 files