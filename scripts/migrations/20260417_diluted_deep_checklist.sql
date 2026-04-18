-- ============================================================================
-- Migration: Seed `diluted_deep` cleaning checklist
--
-- Context: $149 Meta promo is a DILUTED deep clean — it includes everything in
-- a standard cleaning PLUS "inside microwave". It explicitly EXCLUDES the
-- expensive deep extras (inside oven, inside fridge, baseboards scrubbed,
-- grout, interior windows). Per promo-config.ts DEEP_CLEAN_TERMS and
-- feedback_149_diluted_deep.md.
--
-- Standard already covers: light fixtures & ceiling fans, windowsills & air
-- vents, baseboards wiped. So the only NEW item the cleaner needs vs standard
-- is "Inside microwave".
--
-- Seeded only for Spotless (the only tenant running the $149 promo today).
-- Cedar Rapids and West Niagara do not run this offer.
-- ============================================================================

DELETE FROM cleaning_checklists
  WHERE service_category = 'diluted_deep'
    AND tenant_id IN (SELECT id FROM tenants WHERE slug = 'spotless-scrubbers');

INSERT INTO cleaning_checklists (tenant_id, service_category, item_order, item_text, required)
SELECT t.id, 'diluted_deep', item_order, item_text, true
FROM tenants t
CROSS JOIN (VALUES
  -- Standard 17 items (verbatim from existing standard_cleaning rows so wording matches)
  (1,  'Countertops, backsplash & sink'),
  (2,  'Stovetop, burners & drip pans'),
  (3,  'Appliance exteriors, range hood & small appliances'),
  (4,  'Cabinet fronts wiped'),
  (5,  'Toilet scrubbed & sanitized inside and out'),
  (6,  'Shower/tub, sink & vanity cleaned'),
  (7,  'Fixtures, faucets & showerheads polished'),
  (8,  'Towel bars, TP holders & hooks wiped'),
  (9,  'Floors vacuumed (edges & corners)'),
  (10, 'Floors mopped (all hard surfaces)'),
  (11, 'Dusting - surfaces, shelves & mantels'),
  (12, 'Mirrors & glass streak-free'),
  (13, 'Light switches, door handles & high-touch surfaces'),
  (14, 'Light fixtures & ceiling fans'),
  (15, 'Windowsills & air vents'),
  (16, 'Baseboards wiped'),
  (17, 'Trash emptied, liners replaced, beds made & tidy'),
  -- 1 diluted-deep extra (the rest of the promo addons are already covered above)
  (18, 'Inside microwave')
) AS items(item_order, item_text)
WHERE t.slug = 'spotless-scrubbers';
