-- Clean up garbage first_name records on Spotless customers
-- 2026-04-30
--
-- The cold_followup blast on 2026-04-21 / 2026-04-22 sent 191 SMS using
-- `Hey ${first_name}, no pressure...` template. 8+ confirmed garbage
-- greetings reached real customers (e.g. "Hey aza_98@ymail.com,",
-- "Hey 32 Apartment Rooms,", "Hey Old Lady,", "Hey No,").
--
-- This nukes the polluted first_names so any future automation falls
-- back to the safe "Hey there" / generic greeting. The runtime guard
-- added in packages/core/src/openphone.ts (sendSMS) blocks junky
-- greetings even if a stale first_name slips through.

BEGIN;

-- Specific cases I confirmed in production messages:
UPDATE customers
SET    first_name = NULL,
       updated_at = NOW(),
       notes      = COALESCE(notes || ' | ', '') || '2026-04-30 cleared polluted first_name'
WHERE  tenant_id = '2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df'
  AND  id IN (2368, 2371, 2374, 2415, 2460, 2461, 2465, 2466);

-- Catch-all for similar pollution on Spotless (regex):
--   - contains @, $, # or digits → not a real first name
--   - matches obvious non-name strings
UPDATE customers
SET    first_name = NULL,
       updated_at = NOW(),
       notes      = COALESCE(notes || ' | ', '') || '2026-04-30 auto-cleared polluted first_name'
WHERE  tenant_id = '2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df'
  AND  first_name IS NOT NULL
  AND  (
        first_name ~ '[@$#]'                                                  -- email/price-like
     OR first_name ~ '[0-9]'                                                  -- has digits
     OR LOWER(first_name) IN (
          'no','yes','maybe','none','n/a','hi','hello','address','old lady',
          'old man','not sure','idk','test','null','undefined','customer','client'
        )
     OR LENGTH(first_name) > 40                                               -- absurdly long
     OR ARRAY_LENGTH(STRING_TO_ARRAY(first_name, ' '), 1) > 3                 -- 4+ words
  );

COMMIT;

-- After running, re-check the result:
--   SELECT id, first_name FROM customers
--   WHERE tenant_id = '2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df' AND first_name IS NULL
--   ORDER BY id DESC LIMIT 20;
