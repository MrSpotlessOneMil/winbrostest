-- Quote corrections — Conner Thomerson + Ebony g
-- 2026-04-30
--
-- Conner (cust 20516, quote bf37ec10): AI promised $225 in SMS but quote
--   record stored $309 (move_in_out fallback formula). Honor what the
--   customer was told.
--
-- Ebony (cust 20889, quote 3f9d88dd): filled out the regular booking
--   widget for a 1bd/1ba deep clean but a stale utm_campaign=149-deep-clean
--   tag in her URL flipped her into the $149 Meta Promo flow. She should
--   get the regular 1bd/1ba deep ($225) with full deep addons (incl.
--   fridge/oven/baseboards), not the diluted $149.

BEGIN;

-- Conner — set total to the $225 he was promised, drop the $309 markup.
UPDATE quotes
SET    subtotal     = 225,
       total        = 225,
       total_price  = 225,
       updated_at   = NOW(),
       notes        = COALESCE(notes, '') ||
                      ' | 2026-04-30 corrected: AI quoted $225 in SMS, '
                      'previous DB $309 was a fallback-formula bug'
WHERE  id = 'bf37ec10-2fb0-4228-98af-b8d06024c860'
  AND  customer_id = 20516;

-- Ebony — strip the $149 promo treatment, restore as a regular deep clean.
-- Pricing for 1bd/1ba deep is $225 (per pricing_tiers).
UPDATE quotes
SET    custom_base_price = NULL,
       selected_addons   = '[]'::jsonb,
       custom_terms      = NULL,
       service_category  = 'standard',
       selected_tier     = 'deep',
       subtotal          = 225,
       total             = 225,
       total_price       = 225,
       updated_at        = NOW(),
       notes             = '2026-04-30 corrected: customer used regular '
                           'booking widget; stale utm_campaign=149-deep-clean '
                           'should not have applied promo. Restored to '
                           'standard 1bd/1ba deep pricing.'
WHERE  id = '3f9d88dd-2ccb-4a51-882c-679291d5b797'
  AND  customer_id = 20889;

COMMIT;
