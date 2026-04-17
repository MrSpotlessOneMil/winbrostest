# Auth & Sessions Test Coverage Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unit tests for all authentication routes — login (owner + employee fallback), session validation, logout, tenant switching, and crew portal login.

**Architecture:** Auth routes use password verification RPCs, session tokens, cookies, and portal tokens. Tests mock Supabase and verify the auth flow returns correct tokens, sets cookies, and rejects invalid credentials. These routes have NO `requireAuthWithTenant` — they ARE the auth layer.

**Tech Stack:** Vitest, existing MockSupabaseClient, mock modules

---

## Key Auth Patterns

- **Owner login:** `verifyPassword(username, password)` → `createSession(user.id)` → set `winbros_session` cookie
- **Employee login:** `verifyEmployeePassword(username, password)` → `createEmployeeSession(cleaner.id)` → set cookie
- **Session check:** Read `winbros_session` cookie → `getAuthCleaner()` or `getAuthUser()`
- **Crew login:** Phone-based lookup → return `portal_token` (no password, no cookie)
- **Tenant switch:** Validate session token → set cookie to new token

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `tests/unit/auth/login.test.ts` | Create | Tests for `POST /api/auth/login` |
| `tests/unit/auth/session.test.ts` | Create | Tests for `GET /api/auth/session` |
| `tests/unit/auth/logout.test.ts` | Create | Tests for `POST /api/auth/logout` |
| `tests/unit/auth/crew-login.test.ts` | Create | Tests for `POST /api/auth/crew-login` |
| `tests/unit/auth/switch.test.ts` | Create | Tests for `POST /api/auth/switch` |

---

## Chunk 1: Login & Session Tests

### Task 1: Login Route Tests

**Files:**
- Create: `tests/unit/auth/login.test.ts`
- Reference: `app/api/auth/login/route.ts`

Tests to write:

- [ ] **Step 1: Write test — owner login with valid credentials returns session token**

```typescript
// POST with username='admin', password='correct-password'
// Mock: verifyPassword returns user object, createSession returns token
// Assert: 200, body contains sessionToken, role='owner'
```

- [ ] **Step 2: Write test — employee fallback when owner login fails**

```typescript
// POST with username='cleaner1', password='cleaner-pass'
// Mock: verifyPassword returns null, verifyEmployeePassword returns cleaner
// Assert: 200, body contains portalToken, role='employee'
```

- [ ] **Step 3: Write test — invalid credentials for both owner and employee returns 401**

```typescript
// POST with username='nobody', password='wrong'
// Mock: both verifyPassword and verifyEmployeePassword return null
// Assert: 401
```

- [ ] **Step 4: Write test — missing username or password returns 400**

```typescript
// POST with empty body or missing password
// Assert: 400
```

- [ ] **Step 5: Run tests, commit**

Run: `npm run test -- tests/unit/auth/login.test.ts`

```bash
git add tests/unit/auth/login.test.ts
git commit -m "test: add login route tests (owner, employee fallback, invalid, missing fields)"
```

---

### Task 2: Session Route Tests

**Files:**
- Create: `tests/unit/auth/session.test.ts`
- Reference: `app/api/auth/session/route.ts`

Tests to write:

- [ ] **Step 1: Write test — valid owner session returns user and tenant data**

```typescript
// GET with winbros_session cookie containing valid token
// Mock: getAuthUser returns user, tenant lookup returns active tenant
// Assert: 200, body contains user, tenantStatus.active=true
```

- [ ] **Step 2: Write test — valid employee session returns cleaner and portal token**

```typescript
// GET with winbros_session cookie
// Mock: getAuthCleaner returns cleaner with portalToken
// Assert: 200, body contains portalToken, employee_type
```

- [ ] **Step 3: Write test — no session cookie returns 401**

```typescript
// GET with no cookie
// Assert: 401
```

- [ ] **Step 4: Run tests, commit**

```bash
git add tests/unit/auth/session.test.ts
git commit -m "test: add session validation route tests"
```

---

### Task 3: Logout Route Tests

**Files:**
- Create: `tests/unit/auth/logout.test.ts`
- Reference: `app/api/auth/logout/route.ts`

Tests to write:

- [ ] **Step 1: Write test — logout deletes session and clears cookie**

```typescript
// POST with winbros_session cookie containing valid token
// Mock: deleteSession called with token
// Assert: 200, cookie cleared
```

- [ ] **Step 2: Write test — logout without session still returns 200**

```typescript
// POST with no cookie
// Assert: 200 (graceful, no crash)
```

- [ ] **Step 3: Run tests, commit**

```bash
git add tests/unit/auth/logout.test.ts
git commit -m "test: add logout route tests"
```

---

## Chunk 2: Crew Login & Tenant Switch Tests

### Task 4: Crew Login Route Tests

**Files:**
- Create: `tests/unit/auth/crew-login.test.ts`
- Reference: `app/api/auth/crew-login/route.ts`

Tests to write:

- [ ] **Step 1: Write test — valid phone returns portal token and cleaner info**

```typescript
// POST with phone='+13195550001'
// Seed: active cleaner with matching phone and portal_token
// Assert: 200, body contains portalToken, cleaner name, tenant info
```

- [ ] **Step 2: Write test — phone with no matching cleaner returns 404**

```typescript
// POST with phone='+19999999999'
// Assert: 404
```

- [ ] **Step 3: Write test — generates portal_token if cleaner has none**

```typescript
// POST with phone matching cleaner where portal_token is null
// Assert: 200, portal_token generated and returned
// Verify: cleaners table updated with new portal_token
```

- [ ] **Step 4: Write test — invalid phone format returns 400**

```typescript
// POST with phone='abc' or phone < 10 digits
// Assert: 400
```

- [ ] **Step 5: Run tests, commit**

```bash
git add tests/unit/auth/crew-login.test.ts
git commit -m "test: add crew login route tests (valid, not found, auto-generate token, invalid)"
```

---

### Task 5: Tenant Switch Route Tests

**Files:**
- Create: `tests/unit/auth/switch.test.ts`
- Reference: `app/api/auth/switch/route.ts`

Tests to write:

- [ ] **Step 1: Write test — valid session token switches tenant and sets cookie**

```typescript
// POST with sessionToken for a different tenant
// Mock: getSession returns valid session
// Assert: 200, cookie set to new token, body contains tenant info
```

- [ ] **Step 2: Write test — invalid/expired session token returns 401**

```typescript
// POST with sessionToken='expired-token-123'
// Mock: getSession returns null
// Assert: 401
```

- [ ] **Step 3: Write test — missing sessionToken returns 400**

```typescript
// POST with empty body
// Assert: 400
```

- [ ] **Step 4: Run tests, commit**

```bash
git add tests/unit/auth/switch.test.ts
git commit -m "test: add tenant switch route tests"
```

---

## Notes

- **Auth helpers** (`verifyPassword`, `createSession`, `getAuthUser`, etc.) are in `lib/auth.ts` — mock these, don't test their internals here
- **Cookie handling** — test that the response includes `Set-Cookie` header, don't test cookie parsing internals
- **Google LSA OAuth** (`auth/google-lsa`) is excluded — low priority, integration-heavy, rarely changes
- Total new tests: ~16 across 5 files