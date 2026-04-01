-- 32-gmail-service-account.sql
-- Adds per-tenant Gmail Service Account columns for Gmail API (domain-wide delegation).
-- Tenants with these columns populated use the Gmail API instead of SMTP/IMAP.
-- Existing tenants using gmail_user + gmail_app_password continue to work unchanged.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS gmail_service_account_json TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS gmail_impersonated_user TEXT;
