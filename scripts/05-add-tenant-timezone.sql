-- Add timezone column to tenants table for timezone-aware cron scheduling
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Chicago';

-- Set known tenant timezones
UPDATE tenants SET timezone = 'America/Chicago' WHERE slug = 'winbros';
UPDATE tenants SET timezone = 'America/New_York' WHERE slug = 'spotless-scrubbers';
UPDATE tenants SET timezone = 'America/Chicago' WHERE slug = 'cedar-rapids-cleaning';
