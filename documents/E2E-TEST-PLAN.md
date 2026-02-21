# 🧪 OSIRIS FULL END-TO-END TEST PLAN

**Date:** 2/19/2026
**Environment:** Live on Vercel
**Testers:** Jack (Routing) | Dominic (UI/Forms) | Daniel (Backend/API)

---

## 🔵 JACK — ROUTING & NAVIGATION

### Auth Routes
- [ ] Go to `/login` while logged out — login page loads
- [ ] Try accessing `/` (dashboard) while logged out — should redirect to login or show auth error
- [ ] Log in with valid credentials — redirects to dashboard
- [ ] Log in with wrong password — shows error, stays on login
- [ ] Log in with empty fields — shows validation error
- [ ] After login, refresh the page — stays logged in (session persists)
- [ ] Click logout — session clears, redirected to login
- [ ] After logout, hit browser back button — should NOT show dashboard data

### Main Navigation (Sidebar)
- [ ] Click "Overview" → loads `/` (dashboard home)
- [ ] Click "Customers" → loads `/customers`
- [ ] Click "Calendar" → loads `/jobs`
- [ ] Click "Teams" → loads `/teams`
- [ ] Click "Assistant" → loads `/assistant`
- [ ] Click "Campaigns" → loads `/campaigns`
- [ ] Verify sidebar highlights the active page correctly on each click
- [ ] Verify the URL in the browser matches the expected route

### Admin-Only Routes
- [ ] Log in as **admin** — "Debug" and "Admin" tabs appear in sidebar
- [ ] Click "Debug" → loads `/exceptions`
- [ ] Click "Admin" → loads `/admin`
- [ ] Log in as a **regular tenant user** — "Debug" and "Admin" tabs are NOT visible
- [ ] As tenant user, manually type `/admin` in URL bar — should not show admin content
- [ ] As tenant user, manually type `/exceptions` in URL bar — should not show admin content

### Special Routes
- [ ] Navigate to `/tip/[jobId]` (use a real job ID) — public tip page loads without auth
- [ ] Navigate to `/tip/[jobId]/success` — success page loads
- [ ] Navigate to `/teams/manage` — manage teams page loads

### Deep Linking & Edge Cases
- [ ] Paste a full dashboard URL directly in a new tab (while logged in) — correct page loads
- [ ] Navigate to a route that doesn't exist (e.g. `/fakeurl`) — 404 or graceful fallback
- [ ] Rapidly click between sidebar items — no crashes, correct page always loads
- [ ] Open the same route in two tabs — both work independently
- [ ] Check mobile/responsive sidebar — hamburger menu works, navigation still functions

### Account Switching
- [ ] If multiple accounts saved, switch between them — dashboard data changes to match account
- [ ] After switching, sidebar admin tabs appear/disappear based on new account role
- [ ] After switching, URL stays on current page but data refreshes

### Top Nav
- [ ] Status indicator shows correct state (Online/Inactive/SMS Off) based on tenant config
- [ ] Search bar is visible and functional (or placeholder if not implemented)

---

## 🟢 DOMINIC — UI, FORMS & DASHBOARD PAGES

### Dashboard Home (`/`)
- [ ] Page loads without errors — stats cards visible
- [ ] Revenue chart renders with data (or empty state)
- [ ] Today's jobs section shows scheduled jobs
- [ ] Team status section shows cleaner availability
- [ ] Recent leads section populates
- [ ] System on/off toggle works — click it, status changes, click again to revert
- [ ] Loading spinners appear while data fetches
- [ ] If any section fails to load, it shows an error state (not a blank crash)

### Customers Page (`/customers`)
- [ ] Customer list loads with names, phone numbers
- [ ] Click a customer — detail view opens (messages, jobs, invoices tabs)
- [ ] Messages tab shows conversation history with timestamps
- [ ] AI-generated messages have a badge/indicator
- [ ] Jobs tab shows job history with statuses
- [ ] Search/filter customers — results update
- [ ] Auto-response toggle (if visible) — can be toggled on/off
- [ ] Send SMS to customer — form appears, message sends, shows in history
- [ ] Empty state: if no customers exist, shows a friendly message

### Calendar / Jobs Page (`/jobs`)
- [ ] Calendar renders (FullCalendar) — day/week/month/list views all work
- [ ] Switch between day, week, month, list views — no crash
- [ ] Click a date to create a job — creation form/modal opens
- [ ] Fill out job form: customer info, address, service type, date, time, price
- [ ] Submit job — appears on calendar
- [ ] Click an existing job — edit modal opens with correct data
- [ ] Edit a job field and save — changes persist after refresh
- [ ] Drag-and-drop a job to a new date (if enabled) — job reschedules
- [ ] Rain day preview button (if visible) — shows affected jobs
- [ ] Edge case: create a job with missing required fields — validation errors show
- [ ] Edge case: create two jobs at the same time for same cleaner — conflict handling

### Teams Page (`/teams`)
- [ ] Team member list loads with names, roles (Lead/Technician), status
- [ ] Status shows correctly: On Job, Traveling, Available, Off
- [ ] Daily metrics display for each team
- [ ] Click edit on a team member — edit modal opens
- [ ] Edit a field and save — changes persist
- [ ] Team chat/messaging (Telegram) — messages load, can send a message
- [ ] Navigate to `/teams/manage` — manage teams UI loads
- [ ] Add/remove team member (if CRUD is available)

### AI Assistant Page (`/assistant`)
- [ ] Chat interface loads
- [ ] Type a message and send — response comes back from Claude
- [ ] Conversation history persists (check localStorage)
- [ ] Clear conversation — history resets
- [ ] Long message handling — no UI overflow/break
- [ ] Edge case: send empty message — should be prevented or handled

### Campaigns Page (`/campaigns`)
- [ ] Page loads with campaign list (or empty state)
- [ ] **Master toggle: Seasonal Reminders** — toggle on/off, saves
- [ ] **Frequency Nudge toggle** — toggle on/off, saves
- [ ] **Frequency Nudge days slider** — adjust between 7-90 days, saves
- [ ] **Review-only follow-up toggle** — toggle on/off, saves
- [ ] Click "Create Campaign" — modal opens
- [ ] Fill out campaign: name, message, start date, end date, target segment
- [ ] Character counter shows and limits to 160 chars
- [ ] Target segment dropdown: All, Inactive 30, Inactive 60, Inactive 90, Completed
- [ ] Submit campaign — appears in list with correct status badge (Active/Scheduled/Ended)
- [ ] Edit existing campaign — modal prefills with data, changes save
- [ ] Delete a campaign — removed from list
- [ ] Enable/disable individual campaign toggle
- [ ] Edge case: create campaign with end date before start date — validation error
- [ ] Edge case: create campaign with empty message — validation error
- [ ] Edge case: create campaign with message over 160 chars — prevented

### Calls Page (`/calls`)
- [ ] Call log loads with entries
- [ ] Each call shows: phone number, direction, duration, outcome
- [ ] Empty state if no calls

### Earnings/Tips Page (`/earnings`)
- [ ] Tips section loads with data (or empty state)
- [ ] Upsells section loads
- [ ] Team breakdown view works
- [ ] Time range selector: Today, Week, Month — data updates
- [ ] Charts render correctly

### Leads Page (`/leads`)
- [ ] Lead funnel visualization loads
- [ ] Filter by status: New, Contacted, Qualified, Booked, Nurturing, Lost
- [ ] Source attribution shows correctly (Phone, Meta, Website, SMS)
- [ ] Timestamps show relative time ("5h ago")
- [ ] Search/filter leads
- [ ] Empty state for no leads

### Leaderboard (`/leaderboard`)
- [ ] Rankings load with team/performer data
- [ ] Metrics display correctly
- [ ] Empty state if no data

### Admin Panel (`/admin`) — test with admin account
- [ ] Controls tab: all workflow toggles load with correct current values
- [ ] Toggle a workflow setting (e.g., SMS auto-response) — saves successfully
- [ ] Credentials tab: API keys show masked
- [ ] Campaigns tab: matches campaigns page data
- [ ] Tenant management section works
- [ ] Edge case: save with invalid config — error handling

### Public Tip Page (`/tip/[jobId]`)
- [ ] Page loads with job details (customer name, service, amount)
- [ ] Tip amount input works
- [ ] Submit tip — redirects to success page
- [ ] Edge case: invalid job ID — shows error, not a crash
- [ ] Edge case: submit $0 tip or negative — validation

### General UI Checks
- [ ] No console errors on any page (open browser DevTools)
- [ ] All pages responsive on mobile viewport
- [ ] Dark/light theme consistent (if applicable)
- [ ] No broken images or missing icons
- [ ] All buttons have hover/active states
- [ ] Loading states show on slow connections (throttle in DevTools)

---

## 🔴 DANIEL — BACKEND, API & DATA

### Authentication APIs
- [ ] `POST /api/auth/login` — valid creds return session token + set cookie
- [ ] `POST /api/auth/login` — invalid creds return 401
- [ ] `POST /api/auth/login` — missing fields return 400
- [ ] `GET /api/auth/session` — with valid cookie returns user data
- [ ] `GET /api/auth/session` — with expired/invalid cookie returns 401
- [ ] `POST /api/auth/logout` — clears session, subsequent `/session` call fails
- [ ] `POST /api/auth/switch` — switches active account, new session works

### Tenant & Config APIs
- [ ] `GET /api/tenant/status` — returns tenant config with active state
- [ ] `POST /api/tenant/status` — toggle active on/off, verify in DB
- [ ] `GET /api/tenant/campaigns` — returns campaign list + settings
- [ ] `PATCH /api/tenant/campaigns` — update campaigns, verify changes persist
- [ ] Edge case: PATCH with invalid campaign data — returns error
- [ ] Edge case: GET campaigns as wrong tenant — should not see other tenant's data

### Job & Action APIs
- [ ] `GET /api/jobs` — returns job list (check tenant filtering)
- [ ] `POST /api/jobs` — create a job with all required fields
- [ ] `POST /api/jobs` — missing required fields returns 400
- [ ] `PATCH /api/jobs` — update a job status
- [ ] `POST /api/actions/assign-cleaner` — assigns cleaner to job
- [ ] `POST /api/actions/assign-cleaner` — no available cleaners returns 409
- [ ] `POST /api/actions/assign-cleaner` — invalid job ID returns 404
- [ ] `POST /api/actions/complete-job` — marks job complete, creates payment link
- [ ] `POST /api/actions/complete-job` — already completed job — handles gracefully
- [ ] `POST /api/actions/send-sms` — sends SMS, verify in messages table
- [ ] `POST /api/actions/send-invoice` — creates Stripe invoice
- [ ] `POST /api/actions/send-payment-links` — generates payment link

### Customer & Lead APIs
- [ ] `GET /api/customers` — returns customer list with messages, jobs, leads
- [ ] `GET /api/customers` — tenant isolation: only see own tenant's customers
- [ ] `GET /api/leads` — returns lead list with status and source
- [ ] `GET /api/leads` — tenant isolation check

### Teams & Earnings APIs
- [ ] `GET /api/teams` — returns team list with metrics
- [ ] `GET /api/teams/messages` — returns Telegram messages
- [ ] `POST /api/teams/send-telegram` — sends Telegram message
- [ ] `GET /api/earnings` — returns tips and upsells data
- [ ] `GET /api/leaderboard` — returns rankings
- [ ] `GET /api/calls` — returns call log

### Tip APIs
- [ ] `GET /api/tip/job-info?jobId=X` — returns job details for tip page
- [ ] `GET /api/tip/job-info` — missing jobId returns error
- [ ] `POST /api/tip/create` — creates tip, splits among assigned cleaners
- [ ] `POST /api/tip/create` — tip with no assigned cleaners — stores as unattributed
- [ ] Edge case: negative tip amount — validation error
- [ ] Edge case: tip for non-existent job — 404

### Admin APIs (test with admin account)
- [ ] `GET /api/admin/tenants` — returns all tenants
- [ ] `POST /api/admin/tenants` — create new tenant
- [ ] `POST /api/admin/users` — manage users
- [ ] `POST /api/admin/reset-customer` — resets customer data
- [ ] `GET /api/system-events` — returns audit log
- [ ] `GET /api/exceptions` — returns exception list
- [ ] `GET /api/metrics` — returns dashboard metrics
- [ ] Admin APIs as non-admin user — should return 401/403

### Webhook Endpoints (if you can trigger test events)
- [ ] `POST /api/webhooks/stripe` — test with Stripe test event
- [ ] `POST /api/webhooks/openphone` — test SMS received event
- [ ] `POST /api/webhooks/vapi/[slug]` — test inbound call event
- [ ] `POST /api/webhooks/telegram` — test Telegram message event
- [ ] `POST /api/webhooks/housecall-pro` — test HCP job sync
- [ ] `POST /api/webhooks/ghl` — test GHL lead event
- [ ] Edge case: webhook with invalid signature — rejected
- [ ] Edge case: webhook for non-existent tenant slug — handled gracefully

### Cron Jobs (trigger manually via API with CRON_SECRET)
- [ ] `POST /api/cron/unified-daily` — runs all sub-crons, returns success metrics
- [ ] `POST /api/cron/crew-briefing` — sends Telegram briefing to team leads
- [ ] `POST /api/cron/send-reminders` — sends customer/cleaner reminders
- [ ] `POST /api/cron/seasonal-reminders` — sends campaign SMS (check deduplication)
- [ ] `POST /api/cron/frequency-nudge` — nudges due customers
- [ ] `POST /api/cron/post-job-followup` — sends post-job review/tip requests
- [ ] `POST /api/cron/monthly-followup` — sends re-engagement SMS
- [ ] `POST /api/cron/ghl-followups` — processes lead follow-up stages
- [ ] `POST /api/cron/check-timeouts` — handles stalled assignments
- [ ] `POST /api/cron/process-scheduled-tasks` — executes queued tasks
- [ ] Edge case: cron without CRON_SECRET header — returns 401
- [ ] Edge case: run same cron twice — deduplication prevents double-sends

### Data Integrity Checks
- [ ] Create a job → assign cleaner → complete job → check all related records update
- [ ] Create a customer → send SMS → check messages table has the record
- [ ] Toggle a campaign on → trigger seasonal cron → check only targeted customers get SMS
- [ ] Check `seasonal_reminder_tracker` JSONB updates correctly after campaign send
- [ ] Check `frequency_nudge_sent_at` updates after nudge
- [ ] Verify phone numbers stored in E164 format
- [ ] Verify tenant isolation: query with tenant A creds, confirm no tenant B data leaks

### Multi-Tenancy Edge Cases
- [ ] Two tenants with same customer phone number — handled correctly
- [ ] Webhook for tenant A doesn't create data in tenant B
- [ ] Admin can see all tenants' data, regular user cannot
- [ ] Tenant with disabled integrations — those features don't fire

---

## 📋 SHARED — EVERYONE CHECK THESE

- [ ] No 500 errors in Vercel function logs during testing
- [ ] No unhandled promise rejections in server logs
- [ ] Page load times reasonable (<3s for dashboard pages)
- [ ] Session doesn't randomly expire mid-testing
- [ ] Data created by one tester is visible to others testing the same tenant
- [ ] System events log captures all actions taken during testing

---

## 🏁 TEST COMPLETION

When done, each person posts:
- ✅ = passed
- ❌ = failed (describe the issue)
- ⚠️ = partially working (describe what's off)
- ⏭️ = skipped (explain why — missing data, integration not configured, etc.)
