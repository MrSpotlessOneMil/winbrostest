-- ============================================================
-- MIGRATION: Market-aligned pricing + currency support
-- Date: 2026-04-04
-- Run in Supabase SQL Editor
-- ============================================================

-- Step 1: Add currency column to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'usd';

-- Step 2: Set West Niagara to CAD
UPDATE tenants SET currency = 'cad' WHERE slug = 'west-niagara';

-- Step 3: Clear existing pricing_tiers for all 3 house cleaning tenants
DELETE FROM pricing_tiers WHERE tenant_id IN (
  '2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df',  -- Spotless Scrubbers
  '583eee3f-fc92-431b-b555-8f0ea5fe42c7',  -- Cedar Rapids
  'bf74b185-b731-4ecf-b4ce-ff81d90b8fb7'   -- West Niagara
);

-- ============================================================
-- SPOTLESS SCRUBBERS (LA) — USD
-- ============================================================
INSERT INTO pricing_tiers (tenant_id, service_type, bedrooms, bathrooms, price, labor_hours, cleaners, max_sq_ft) VALUES
-- Standard
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'standard', 1, 1, 150, 2.5, 1, 800),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'standard', 2, 1, 175, 3, 1, 1000),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'standard', 2, 2, 200, 3.5, 1, 1200),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'standard', 3, 2, 260, 3, 2, 1500),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'standard', 3, 3, 310, 3.5, 2, 2000),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'standard', 4, 2, 340, 3.5, 2, 2000),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'standard', 4, 3, 400, 4, 2, 2500),
-- Deep
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'deep', 1, 1, 250, 4, 1, 800),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'deep', 2, 1, 285, 4.5, 1, 1000),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'deep', 2, 2, 325, 5, 1, 1200),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'deep', 3, 2, 400, 4, 2, 1500),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'deep', 3, 3, 475, 4.5, 2, 2000),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'deep', 4, 2, 525, 5, 2, 2000),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'deep', 4, 3, 600, 5.5, 2, 2500),
-- Move In/Out
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'move', 1, 1, 295, 5, 1, 800),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'move', 2, 1, 350, 5, 1, 1000),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'move', 2, 2, 500, 5, 2, 1200),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'move', 3, 2, 500, 4.5, 2, 1500),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'move', 3, 3, 575, 5, 2, 2000),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'move', 4, 2, 625, 5.5, 2, 2000),
('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'move', 4, 3, 700, 6, 2, 2500);

-- ============================================================
-- CEDAR RAPIDS (Iowa) — USD (+25% bump)
-- ============================================================
INSERT INTO pricing_tiers (tenant_id, service_type, bedrooms, bathrooms, price, labor_hours, cleaners, max_sq_ft) VALUES
-- Standard
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'standard', 1, 1, 125, 2.5, 1, 800),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'standard', 2, 1, 150, 3, 1, 1000),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'standard', 2, 2, 175, 3.5, 1, 1200),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'standard', 3, 2, 205, 3, 1, 1500),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'standard', 3, 3, 245, 3.5, 1, 2000),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'standard', 4, 2, 245, 3.5, 1, 2000),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'standard', 4, 3, 280, 4, 1, 2500),
-- Deep
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'deep', 1, 1, 220, 4, 1, 800),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'deep', 2, 1, 250, 4.5, 1, 1000),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'deep', 2, 2, 290, 5, 1, 1200),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'deep', 3, 2, 350, 4, 1, 1500),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'deep', 3, 3, 405, 4.5, 1, 2000),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'deep', 4, 2, 425, 5, 1, 2000),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'deep', 4, 3, 480, 5.5, 1, 2500),
-- Move In/Out (+25% bump)
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'move', 1, 1, 245, 5, 1, 800),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'move', 2, 1, 290, 5, 1, 1000),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'move', 2, 2, 325, 5, 1, 1200),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'move', 3, 2, 400, 4.5, 1, 1500),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'move', 4, 2, 475, 5.5, 1, 2000),
('583eee3f-fc92-431b-b555-8f0ea5fe42c7', 'move', 4, 3, 540, 6, 1, 2500);

-- ============================================================
-- WEST NIAGARA (Ontario) — stored in CAD (tenant currency = 'cad')
-- ============================================================
INSERT INTO pricing_tiers (tenant_id, service_type, bedrooms, bathrooms, price, labor_hours, cleaners, max_sq_ft) VALUES
-- Standard (CAD)
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'standard', 1, 1, 160, 2.5, 1, 800),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'standard', 2, 1, 190, 3, 1, 1000),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'standard', 2, 2, 215, 3.5, 1, 1200),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'standard', 3, 2, 255, 3, 2, 1500),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'standard', 3, 3, 290, 3.5, 2, 2000),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'standard', 4, 2, 290, 3.5, 2, 2000),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'standard', 4, 3, 340, 4, 2, 2500),
-- Deep (CAD)
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'deep', 1, 1, 250, 4, 1, 800),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'deep', 2, 1, 290, 4.5, 1, 1000),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'deep', 2, 2, 330, 5, 1, 1200),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'deep', 3, 2, 400, 4, 2, 1500),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'deep', 3, 3, 450, 4.5, 2, 2000),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'deep', 4, 2, 480, 5, 2, 2000),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'deep', 4, 3, 530, 5.5, 2, 2500),
-- Move In/Out (CAD)
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'move', 1, 1, 280, 5, 1, 800),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'move', 2, 1, 320, 5, 1, 1000),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'move', 2, 2, 420, 5, 2, 1200),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'move', 3, 2, 420, 4.5, 2, 1500),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'move', 3, 3, 475, 5, 2, 2000),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'move', 4, 2, 490, 5.5, 2, 2000),
('bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', 'move', 4, 3, 540, 6, 2, 2500);

-- ============================================================
-- VERIFY
-- ============================================================
SELECT t.slug, t.currency, COUNT(pt.id) as pricing_rows
FROM tenants t
LEFT JOIN pricing_tiers pt ON pt.tenant_id = t.id
WHERE t.slug IN ('spotless-scrubbers', 'cedar-rapids', 'west-niagara')
GROUP BY t.slug, t.currency
ORDER BY t.slug;
