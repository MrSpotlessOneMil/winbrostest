-- Migration: Add phone column to users + allow login by email/phone
-- Already applied via direct SQL; this script is for documentation/reproducibility.

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

-- Backfill phone from tenants.owner_phone
UPDATE users u SET phone = t.owner_phone
FROM tenants t
WHERE u.tenant_id = t.id AND t.owner_phone IS NOT NULL AND u.phone IS NULL;

-- Backfill WinBros email
UPDATE users SET email = 'winbroswindows@gmail.com' WHERE username = 'winbros' AND email IS NULL;

-- Unique partial indexes for login lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL;
