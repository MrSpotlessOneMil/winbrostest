-- ============================================================================
-- Migration 20: Employee Portal Authentication
-- Adds username/PIN login for cleaners, modifies sessions for employee support
-- ============================================================================

-- Add auth columns to cleaners
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS pin TEXT; -- plaintext 4-digit, so bot can retrieve
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS credentials_sent_at TIMESTAMPTZ;

-- Username must be unique globally (employees + owners share login form)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cleaners_username ON cleaners(username) WHERE username IS NOT NULL AND deleted_at IS NULL;

-- Add cleaner_id to sessions for employee sessions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cleaner_id INTEGER REFERENCES cleaners(id) ON DELETE CASCADE;
-- Make user_id nullable (employee sessions have cleaner_id instead)
ALTER TABLE sessions ALTER COLUMN user_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_cleaner ON sessions(cleaner_id) WHERE cleaner_id IS NOT NULL;

-- ============================================================================
-- Grandfather existing employees: set username = name, generate random 4-digit PIN
-- Handles collisions with users table and other cleaners
-- ============================================================================
DO $$
DECLARE
  rec RECORD;
  base_username TEXT;
  candidate TEXT;
  suffix INTEGER;
  collision BOOLEAN;
BEGIN
  FOR rec IN
    SELECT id, name FROM cleaners
    WHERE active = true AND deleted_at IS NULL AND username IS NULL
  LOOP
    base_username := rec.name;
    candidate := base_username;
    suffix := 2;

    LOOP
      -- Check collision with users table
      SELECT EXISTS(
        SELECT 1 FROM users WHERE username = candidate
      ) INTO collision;

      -- Check collision with other cleaners
      IF NOT collision THEN
        SELECT EXISTS(
          SELECT 1 FROM cleaners
          WHERE username = candidate AND id != rec.id AND deleted_at IS NULL
        ) INTO collision;
      END IF;

      EXIT WHEN NOT collision;

      candidate := base_username || ' ' || suffix;
      suffix := suffix + 1;
    END LOOP;

    -- Generate random 4-digit PIN (0000-9999)
    UPDATE cleaners
    SET username = candidate,
        pin = lpad(floor(random() * 10000)::text, 4, '0')
    WHERE id = rec.id;
  END LOOP;
END $$;
