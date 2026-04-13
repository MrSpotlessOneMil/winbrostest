---
type: community
cohesion: 0.05
members: 61
---

# Community 6

**Cohesion:** 0.05 - loosely connected
**Members:** 61 nodes

## Members
- [[01-email-detection.test.ts]] - code - tests\sms-regression\01-email-detection.test.ts
- [[01-vapi-booking.test.ts]] - code - tests\cedar-rapids\01-vapi-booking.test.ts
- [[02-sms-email-capture.test.ts]] - code - tests\cedar-rapids\02-sms-email-capture.test.ts
- [[03-sms-double-confirm.test.ts]] - code - tests\cedar-rapids\03-sms-double-confirm.test.ts
- [[04-cross-tenant-isolation.test.ts]] - code - tests\sms-regression\04-cross-tenant-isolation.test.ts
- [[04-sms-debounce.test.ts]] - code - tests\cedar-rapids\04-sms-debounce.test.ts
- [[05-sms-reschedule.test.ts]] - code - tests\cedar-rapids\05-sms-reschedule.test.ts
- [[05-stripe-double-send.test.ts]] - code - tests\sms-regression\05-stripe-double-send.test.ts
- [[06-sms-concurrent.test.ts]] - code - tests\cedar-rapids\06-sms-concurrent.test.ts
- [[07-stripe-deposit.test.ts]] - code - tests\cedar-rapids\07-stripe-deposit.test.ts
- [[08-stripe-failure.test.ts]] - code - tests\cedar-rapids\08-stripe-failure.test.ts
- [[09-telegram-accept.test.ts]] - code - tests\cedar-rapids\09-telegram-accept.test.ts
- [[10-telegram-decline-chain.test.ts]] - code - tests\cedar-rapids\10-telegram-decline-chain.test.ts
- [[11-telegram-all-decline.test.ts]] - code - tests\cedar-rapids\11-telegram-all-decline.test.ts
- [[12-cron-timeouts.test.ts]] - code - tests\cedar-rapids\12-cron-timeouts.test.ts
- [[13-cron-followup.test.ts]] - code - tests\cedar-rapids\13-cron-followup.test.ts
- [[14-cron-idempotency.test.ts]] - code - tests\cedar-rapids\14-cron-idempotency.test.ts
- [[15-tenant-isolation.test.ts]] - code - tests\cedar-rapids\15-tenant-isolation.test.ts
- [[16-missing-data.test.ts]] - code - tests\cedar-rapids\16-missing-data.test.ts
- [[17-webhook-dedup.test.ts]] - code - tests\cedar-rapids\17-webhook-dedup.test.ts
- [[18-full-lifecycle.test.ts]] - code - tests\cedar-rapids\18-full-lifecycle.test.ts
- [[admin-cleaners-crud.test.ts]] - code - tests\unit\admin-cleaners-crud.test.ts
- [[assertCalledWithTenant()]] - code - tests\helpers.ts
- [[assertNeverCalledWithTenant()]] - code - tests\helpers.ts
- [[cedar-rapids.ts]] - code - tests\fixtures\cedar-rapids.ts
- [[createCronPostRequest()]] - code - tests\helpers.ts
- [[createCronRequest()]] - code - tests\helpers.ts
- [[createMockRequest()]] - code - tests\helpers.ts
- [[createMockSupabaseClient()]] - code - tests\mocks\supabase-mock.ts
- [[crew-portal-workflows.test.ts]] - code - tests\unit\crew-portal-workflows.test.ts
- [[helpers.ts]] - code - tests\helpers.ts
- [[makeBookedJob()]] - code - tests\fixtures\cedar-rapids.ts
- [[makeCompletedJob()]] - code - tests\fixtures\cedar-rapids.ts
- [[makeCronHeaders()]] - code - tests\fixtures\payloads.ts
- [[makeDeleteRequest()]] - code - tests\unit\admin-cleaners-crud.test.ts
- [[makeGetRequest()]] - code - tests\unit\admin-cleaners-crud.test.ts
- [[makeOpenPhoneInbound()]] - code - tests\fixtures\payloads.ts
- [[makeOpenPhoneOutbound()]] - code - tests\fixtures\payloads.ts
- [[makeSeedData()]] - code - tests\fixtures\cedar-rapids.ts
- [[makeStripeCheckoutCompleted()]] - code - tests\fixtures\payloads.ts
- [[makeStripePaymentFailed()]] - code - tests\fixtures\payloads.ts
- [[makeStripeSetupIntentSucceeded()]] - code - tests\fixtures\payloads.ts
- [[makeTelegramCallbackQuery()]] - code - tests\fixtures\payloads.ts
- [[makeTelegramTextMessage()]] - code - tests\fixtures\payloads.ts
- [[makeVapiEndOfCallReport()]] - code - tests\fixtures\payloads.ts
- [[makeVapiNoBooking()]] - code - tests\fixtures\payloads.ts
- [[makeWinBrosAssignment()]] - code - tests\unit\crew-portal-workflows.test.ts
- [[makeWinBrosJob()]] - code - tests\unit\crew-portal-workflows.test.ts
- [[membership-lifecycle.test.ts]] - code - tests\unit\membership-lifecycle.test.ts
- [[membership-validation.test.ts]] - code - tests\unit\membership-validation.test.ts
- [[modules.ts]] - code - tests\mocks\modules.ts
- [[parseResponse()]] - code - tests\helpers.ts
- [[payloads.ts]] - code - tests\fixtures\payloads.ts
- [[resetAllMocks()]] - code - tests\mocks\modules.ts
- [[resetMockClient()]] - code - tests\mocks\modules.ts
- [[seedCleaners()]] - code - tests\unit\admin-cleaners-crud.test.ts
- [[seedData()]] - code - tests\unit\membership-validation.test.ts
- [[seedMembershipData()]] - code - tests\unit\membership-lifecycle.test.ts
- [[seedWinBrosData()]] - code - tests\unit\crew-portal-workflows.test.ts
- [[supabase-mock.ts]] - code - tests\mocks\supabase-mock.ts
- [[tenant-helpers.test.ts]] - code - tests\unit\tenant-helpers.test.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Community_6
SORT file.name ASC
```

## Connections to other communities
- 2 edges to [[_COMMUNITY_Community 4]]
- 2 edges to [[_COMMUNITY_Community 12]]
- 1 edge to [[_COMMUNITY_Community 2]]
- 1 edge to [[_COMMUNITY_Community 20]]

## Top bridge nodes
- [[cedar-rapids.ts]] - degree 32, connects to 2 communities
- [[supabase-mock.ts]] - degree 7, connects to 1 community
- [[admin-cleaners-crud.test.ts]] - degree 6, connects to 1 community
- [[tenant-helpers.test.ts]] - degree 3, connects to 1 community