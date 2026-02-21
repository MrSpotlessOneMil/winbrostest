# HCP Integration Handoff

## Goal
Make job scheduling from our system (VAPI calls, text, OpenPhone, Stripe card-on-file flow) reliably create/update jobs in Housecall Pro (HCP) so jobs are visible on the HCP calendar with full details.

## What We Need To Happen
When a customer calls/texts and books:

1. Create/find customer profile in HCP.
2. Create job in HCP (not just internal DB).
3. Schedule job to the correct date/time window.
4. Assign to the right team/employee.
5. Push all available details:
   - customer name
   - phone
   - address
   - service type / what they are buying
   - job amount (ex: 275.00, never 2.75)
   - notes/context from booking flow
6. Ensure job is visually present in HCP calendar immediately after booking/card-on-file completion.

## Current Problem
Primary blocker in production logs is HCP auth failure:

- `api.housecallpro.com/customers` returns `401 Unauthorized`
- Customer find/create fails
- HCP sync aborts before job can be created/scheduled in HCP

This is why users see internal assignment updates but no HCP calendar job.

## Recent Code Work Already Added
- Auth fallback logic in `lib/housecall-pro-api.ts`:
  - normalizes API key
  - retries with `Token` and `Bearer`
  - retries with and without `X-Company-Id`
- HCP create/sync hardening in earlier commits:
  - create fallback paths
  - post-create schedule/dispatch/line-items pass
  - improved customer matching search

## Required Validation (Must Pass)
Use a fresh real test booking flow (call/text + card on file):

1. Stripe webhook runs successfully.
2. HCP API calls do NOT return 401.
3. Logs show HCP customer found/created.
4. Logs show HCP job created or updated with HCP job ID.
5. Job appears in HCP calendar UI on correct date.
6. Amount is correct (`$275.00`, not `$2.75`).
7. Assigned team/employee is reflected in HCP.

## If 401 Still Happens
Then credentials/config are wrong (not code logic):

1. Verify tenant `housecall_pro_api_key` is valid and not expired.
2. Verify key format in DB (no accidental double prefix issues).
3. Verify `housecall_pro_company_id` is correct for this account.
4. Confirm account has required API permissions/scopes.

## Implementation Contract
Do not mark this done until:

1. A real end-to-end test call creates a visible HCP calendar job.
2. Customer profile exists/updates in HCP.
3. Job amount and schedule are correct.
4. Team assignment is visible in HCP.
5. Logs prove success without auth errors.

## Useful Files
- `lib/housecall-pro-api.ts`
- `lib/hcp-job-sync.ts`
- `api/webhooks/stripe/winbros` (route handler path in project)

