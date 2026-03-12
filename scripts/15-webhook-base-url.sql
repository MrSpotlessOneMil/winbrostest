-- Add webhook_registered_base_url to track which domain webhooks were registered under.
-- When the app domain changes, this allows the admin UI to detect stale webhook URLs
-- and prompt re-registration.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS webhook_registered_base_url TEXT;

-- Backfill existing tenants that have at least one webhook registered.
UPDATE tenants
  SET webhook_registered_base_url = 'https://theosirisai.com'
  WHERE telegram_webhook_registered_at IS NOT NULL
     OR stripe_webhook_registered_at IS NOT NULL
     OR openphone_webhook_registered_at IS NOT NULL
     OR vapi_webhook_registered_at IS NOT NULL;
