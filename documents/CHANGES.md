# Changes Log
**Last Updated:** 2026-02-18

## Recent Changes

### Phase 1: Remove Dead Code + Feature Flags (2026-02-18)
- **DELETED** `app/api/cron/post-cleaning-followup/route.ts` - orphaned cron (not in vercel.json), conflicted with post-job-followup on same `followup_sent_at` column
- **MODIFIED** `lib/tenant.ts` - Added `SeasonalCampaign` interface and lifecycle messaging fields to `WorkflowConfig` (seasonal_reminders_enabled, frequency_nudge_enabled, frequency_nudge_days, review_only_followup_enabled, seasonal_campaigns)
- **MODIFIED** `app/(dashboard)/admin/page.tsx` - Added matching client-side types for WorkflowConfig and SeasonalCampaign
- **CREATED** `scripts/migrations/20260218_lifecycle_messaging.sql` - Adds seasonal_reminder_tracker JSONB to customers, frequency_nudge_sent_at to jobs, backfills tenant workflow_config with defaults
- **MODIFIED** `app/api/cron/unified-daily/route.ts` - Removed stale post-cleaning-followup reference from comments
- **MODIFIED** `MULTI_TENANT_SETUP_GUIDE.md` - Updated cron job table to remove dead entry, add new seasonal-reminders and frequency-nudge crons

### Phase 2: Seasonal Campaign Admin UI (2026-02-18)
- **MODIFIED** `app/(dashboard)/admin/page.tsx` - Added "Campaigns" tab with:
  - Master toggle for seasonal reminders
  - Frequency nudge settings (enabled toggle + configurable days)
  - Review-only follow-up toggle
  - Campaign list with active/scheduled/ended status badges
  - Create/edit campaign modal with name, message (160 char limit), date range, target segment, enabled toggle
  - Delete and enable/disable per campaign
  - Segment options: All, Inactive 30/60/90 days, Past Completed

### Phase 3: Seasonal Reminder Cron Job (2026-02-18)
- **CREATED** `app/api/cron/seasonal-reminders/route.ts` - Daily cron that sends campaign SMS to targeted customers, with dedup via seasonal_reminder_tracker JSONB, batch limits (50/run), and segment-based targeting
- **MODIFIED** `lib/sms-templates.ts` - Added `seasonalReminder()`, `reviewOnlyFollowup()`, `frequencyNudge()` templates
- **MODIFIED** `vercel.json` - Added seasonal-reminders (6pm UTC) and frequency-nudge (6:30pm UTC) cron schedules

### Phase 4: Seasonal Reply Tagging (2026-02-18)
- **MODIFIED** `app/api/webhooks/openphone/route.ts` - Added seasonal reply detection (checks messages table for recent seasonal_reminder source within 48h), passes `isReturningCustomer` flag to AI auto-response, tags leads created from seasonal replies with `source: 'seasonal_reminder'`
- **MODIFIED** `lib/auto-response.ts` - Added `AutoResponseOptions` interface with `isReturningCustomer` flag, injects warm returning customer context into AI system prompt for both WinBros and house cleaning flows

### Phase 5: Review-Only Follow-up Logic (2026-02-18)
- **MODIFIED** `app/api/cron/post-job-followup/route.ts` - Added conditional logic: if job has no payment info AND tenant has review_only_followup_enabled, sends simpler review-only template instead of full combined message

### Phase 6: Frequency Nudge Cron Job (2026-02-18)
- **CREATED** `app/api/cron/frequency-nudge/route.ts` - Daily cron that nudges customers whose last completed job was within the tenant's configurable nudge window (default 21 days), with dedup via frequency_nudge_sent_at column and conflict avoidance with monthly re-engagement

---

## How to Use
Each time a file is modified, a new entry will be added here with:
- File path
- Timestamp
- Brief description of the change
