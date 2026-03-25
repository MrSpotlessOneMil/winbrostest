# LIVE TENANTS - READ BEFORE PUSHING CODE

## DO NOT break these tenants. They are live, paying clients.

---

### Cedar Rapids House Cleaners (`cedar-rapids`)
- **Status:** LIVE as of Feb 25, 2026
- **Owner:** Caleb — cedarrapidshousecleaners@gmail.com / 319-826-4311
- **Service:** House cleaning — Cedar Rapids, Iowa City, Linn County, Johnson County
- **Integrations:** VAPI, OpenPhone (+1 319-261-9670), Stripe, Telegram
- **Invoicing:** Stripe (NOT Wave)
- **Dashboard login:** `cedar-rapids` / ask Dominic

### WinBros Window Cleaning (`winbros`)
- **Status:** LIVE
- **Owner:** Jack
- **Service:** Window washing — Illinois
- **Integrations:** VAPI, HCP (mirror), OpenPhone, Stripe, Telegram, Wave
- **Invoicing:** Wave

### Spotless Scrubbers (`spotless-scrubbers`)
- **Status:** LIVE as of Feb 25, 2026
- **Owner:** Dominic Lutz
- **Service:** House cleaning
- **Integrations:** VAPI, OpenPhone (+1 424-677-1146), Stripe, Telegram
- **Invoicing:** Stripe (NOT Wave)
- **Dashboard login:** `spotless-scrubbers` / ask Dominic

---

## Rules

1. **Test on a dev branch first.** Do not push untested code to `Test`.
2. **Never delete or modify tenant rows** in the DB without confirming with Dominic.
3. **Webhook routes are shared.** A bug in `/api/webhooks/openphone` affects ALL tenants.
4. **Stripe keys are per-tenant.** Never hardcode a Stripe key — always read from the tenant row.
5. **If you break something, roll back immediately.** Don't debug on production.

## Key Webhook URLs (all tenants share these)

| Service | URL |
|---------|-----|
| OpenPhone | `https://spotless-scrubbers-api.vercel.app/api/webhooks/openphone` |
| VAPI | `https://spotless-scrubbers-api.vercel.app/api/webhooks/vapi/{slug}` |
| Stripe | `https://spotless-scrubbers-api.vercel.app/api/webhooks/stripe` |
| Telegram | `https://spotless-scrubbers-api.vercel.app/api/webhooks/telegram/{slug}` |
