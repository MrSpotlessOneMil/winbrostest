-- Migration: Add service_type column to tenants table
-- This enables filtering tenants by service type (house_cleaning vs window_washing)
-- for the monorepo split into two independently deployable apps.
--
-- Applied: 2026-04-10

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT 'house_cleaning';

-- Set WinBros to window washing (all others default to house_cleaning)
UPDATE tenants SET service_type = 'window_washing' WHERE slug = 'winbros';

-- Verify
-- SELECT slug, service_type FROM tenants ORDER BY slug;
-- cedar-rapids     | house_cleaning
-- spotless-scrubbers | house_cleaning
-- west-niagara     | house_cleaning
-- winbros          | window_washing
