-- ============================================================================
-- Migration: Fix cleaning checklists to match website service descriptions
--
-- Problem: Deep cleaning had only 12 abbreviated items (fewer than standard's 17).
-- Move-in/out had the same abbreviated base. Neither matched spotlessscrubbers.org.
--
-- Fix: Deep = all standard items + deep extras (inside appliances, grout, windows)
--       Move = all deep items + move extras (cabinets, closets, garage, etc.)
-- ============================================================================

-- Clear existing deep_cleaning and move_in_out checklists for all tenants
-- (standard_cleaning stays as-is — it's already correct)
DELETE FROM cleaning_checklists WHERE service_category IN ('deep_cleaning', 'move_in_out');

-- Deep Cleaning = full standard checklist + deep-specific extras
INSERT INTO cleaning_checklists (tenant_id, service_category, item_order, item_text, required)
SELECT t.id, 'deep_cleaning', item_order, item_text, true
FROM tenants t
CROSS JOIN (VALUES
  -- Standard items (full detail)
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
  (16, 'Baseboards scrubbed'),
  (17, 'Trash emptied, liners replaced, beds made & tidy'),
  -- Deep-specific extras
  (18, 'Inside oven & microwave'),
  (19, 'Inside fridge'),
  (20, 'Grout scrubbed & detailed'),
  (21, 'Interior windows washed')
) AS items(item_order, item_text)
WHERE t.active = true;

-- Move-in/Move-out = full deep checklist + move-specific extras
INSERT INTO cleaning_checklists (tenant_id, service_category, item_order, item_text, required)
SELECT t.id, 'move_in_out', item_order, item_text, true
FROM tenants t
CROSS JOIN (VALUES
  -- All deep cleaning items
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
  (16, 'Baseboards scrubbed'),
  (17, 'Trash emptied, liners replaced, beds made & tidy'),
  (18, 'Inside oven & microwave'),
  (19, 'Inside fridge'),
  (20, 'Grout scrubbed & detailed'),
  (21, 'Interior windows washed'),
  -- Move-specific extras
  (22, 'Inside all cabinets & drawers'),
  (23, 'Inside closets'),
  (24, 'Garage sweep'),
  (25, 'Patio/balcony'),
  (26, 'Wall spot cleaning')
) AS items(item_order, item_text)
WHERE t.active = true;
