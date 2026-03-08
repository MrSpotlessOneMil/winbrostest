-- 07-add-gmail-columns.sql
-- Adds per-tenant Gmail credentials used by the email lead-intake bot
-- (lib/gmail-client.ts, lib/gmail-imap.ts, cron/process-email-leads).
-- Uses IF NOT EXISTS because these columns were added manually in production
-- before this migration script was created.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS gmail_user TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS gmail_app_password TEXT;
