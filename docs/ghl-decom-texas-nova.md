# GoHighLevel Decommissioning — Texas Nova Cleaning

**Status:** In progress (started 2026-04-20)
**Owner:** Patrick (Texas Nova GM) executes GHL-side; Dominic verifies Osiris-side.
**Why:** Texas Nova migrated to Osiris. GHL was still sending SMS and workflows, double-messaging customers (Bug T2). Every GHL integration point needs to be disabled so the legacy automation stops firing.

## Osiris-Side (Already Applied — 2026-04-20)

Both of these are live on branch `fix/11-bug-complete-2026-04-20` (merge to main after this runbook is executed):

1. **`/api/webhooks/ghl` returns 410 Gone for Texas Nova.** Any GHL-driven lead push is rejected. `apps/house-cleaning/app/api/webhooks/ghl/route.ts` — decommissioned slug set + `workflow_config.ghl_bridge_enabled === false` check.
2. **`/api/cron/ghl-followups` cancels all pending GHL follow-ups for Texas Nova.** `apps/house-cleaning/integrations/ghl/follow-up-scheduler.ts` — any pending row for the tenant gets `status='cancelled'` instead of executing.

To decommission another tenant in the future, add their slug to `GHL_DECOMMISSIONED_SLUGS` in both files OR flip `tenants.workflow_config.ghl_bridge_enabled` to `false`.

## GHL-Side Runbook (Patrick — do these in order)

Open the GHL sub-account for Texas Nova. Work top-to-bottom. Do NOT skip — GHL has many hidden outbound surfaces and any one of them can keep firing.

### Day 0 — Kill Automation Surface

- [ ] Automation → **Workflows** → For each workflow: click into it, toggle to **Inactive**. Do NOT delete yet (keep audit trail). Count workflows touched and paste the list into this doc below.
- [ ] Automation → **Triggers** → Disable every trigger.
- [ ] Automation → **Campaigns** → Pause every SMS and email campaign.
- [ ] Marketing → **Email** → Cancel any scheduled sends.
- [ ] Marketing → **SMS Broadcasts** → Cancel any scheduled sends.
- [ ] Reputation → **Review Requests** → Pause review-request automation.

### Day 0 — Kill Inbound Surface

- [ ] Sites → **Funnels/Forms** → For each form, either:
    - (preferred) change the submit target to `https://cleanmachine.live/api/webhooks/website/texas-nova`, OR
    - take the form offline and redirect the landing URL to Osiris.
- [ ] Sites → **Calendars** → Take public booking links offline. Redirect the URLs.
- [ ] Integrations → **Facebook Lead Ads** → Disconnect the page connection so new leads stop flowing into GHL. Reconnect the page to the Osiris Meta webhook instead.
- [ ] Integrations → **Google My Business / LSA** → Disconnect.
- [ ] Integrations → **Website chat widget** → Remove the GHL chat script from every page on the Texas Nova website (include `<head>` and GTM).
- [ ] Tracking pixels / GHL script tags → Remove GHL snippet from the site.

### Day 0 — Phone Number

- [ ] Settings → **Phone Numbers** → Choose ONE of:
    - **Preferred:** port the GHL-provisioned Twilio number to OpenPhone (keeps the number, customers saved contacts still work).
    - Or release the number entirely (customers will need to get the new number).
    - Or set call forwarding: GHL number → Osiris OpenPhone number (buys time during migration).
- [ ] If keeping the number temporarily on GHL: enable **email-on-inbound** so any straggler SMS is caught in email.

### Day 0 — Integrations & APIs

- [ ] Integrations → Disconnect: Stripe, HouseCallPro, Zapier, Make, Google Calendar, Gmail, Outlook, and any other OAuth.
- [ ] Settings → **API Keys** → Rotate every key (just in case something external uses them) then delete all keys.
- [ ] Settings → **Webhooks (incoming)** → Delete all.
- [ ] Settings → **Webhooks (outbound)** → Delete all.
- [ ] External Zapier/Make scenarios that target GHL → Pause or delete.

### Day 0 — Data Export

- [ ] Contacts → **Export** all contacts to CSV. File: `ghl-texas-nova-contacts-YYYY-MM-DD.csv`.
- [ ] Opportunities / Pipelines → Export.
- [ ] Conversations → Export transcripts (for any active thread that might have useful context).

Send the CSVs to Dominic. He imports to Osiris `customers` with `source='ghl_migration'`.

### Day 0 — Access

- [ ] Settings → **Team** → Remove every user except one owner (keeps the account open for audit but locks out activity).
- [ ] Remove Patrick's team's SMS and email sending rights.

### Day 3–7 — Monitor

- [ ] Daily: check the Conversations inbox for any residual inbound SMS/calls.
- [ ] Daily: check Email + SMS sent logs — count should be **zero**. If anything fired, find and disable the workflow/trigger that did it.

### Day 7 — Cancel

- [ ] If zero activity for 7 days, **cancel the GHL subscription**.

### Day 7 → Day 37 — Number Forward

- [ ] Keep the old GHL number → Osiris OpenPhone forward active for **30 days** after cancellation to catch any customer using the saved number.
- [ ] Day 37: release the forward.

## Verification — Before Declaring Done

Patrick and Dominic both verify:

1. Submit a test web form on the Texas Nova site → lead appears in Osiris `leads`, zero GHL activity.
2. Click a Facebook Lead Ad on Texas Nova → lead appears in Osiris via `/api/webhooks/meta/texas-nova`, zero GHL activity.
3. Call the old GHL number → either forwards to Osiris OpenPhone, or reaches a "number released" message.
4. Wait 48h. Confirm **zero** GHL-originated messages to Texas Nova customers over that window.
5. Monitor `system_events` in Osiris for `GHL_WEBHOOK_REJECTED_DECOMMISSIONED` events — these indicate GHL is STILL sending and needs further investigation on the GHL side.

## Rollback (If Something Breaks)

To temporarily re-enable GHL for Texas Nova:
1. Remove `'texas-nova'` from `GHL_DECOMMISSIONED_SLUGS` in both webhook + scheduler files.
2. Set `tenants.workflow_config.ghl_bridge_enabled = true` for Texas Nova.
3. Re-deploy.

## Reference

- Webhook route: `apps/house-cleaning/app/api/webhooks/ghl/route.ts`
- Follow-up cron: `apps/house-cleaning/app/api/cron/ghl-followups/route.ts`
- Scheduler lib: `apps/house-cleaning/integrations/ghl/follow-up-scheduler.ts`
- New Osiris lead intake paths for Texas Nova:
    - Web form: `POST https://cleanmachine.live/api/webhooks/website/texas-nova`
    - Meta Lead Ads: `POST https://cleanmachine.live/api/webhooks/meta/texas-nova`
    - OpenPhone SMS/voice: already routed via `/api/webhooks/openphone` using the tenant's phone number ID.
