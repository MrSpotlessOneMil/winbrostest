-- 40-seed-texas-nova-pricing-tiers.sql
--
-- Seed pricing_tiers for Texas Nova (slug: texas-nova,
-- id: 617d0f83-dede-46b3-b1fb-298b59517046) using the rate card Dominic
-- confirmed 2026-04-20 (mirrors West Niagara's working tier structure).
--
-- 45 rows: 15 standard + 15 deep + 15 move, covering 1-6 beds × 1-6 baths.
--
-- NOT NULL columns populated: tenant_id, service_type, bedrooms, bathrooms,
-- max_sq_ft, price, labor_hours, cleaners (default 1).
--
-- Addresses T7 (Linda Kingcade's $562 inflated quote — formula fallback)
-- and unblocks T1 (form submit failing because quote compute threw with
-- no tier rows).

DO $$
DECLARE
  v_tenant_id UUID := '617d0f83-dede-46b3-b1fb-298b59517046';
  v_existing INT;
BEGIN
  SELECT count(*) INTO v_existing FROM pricing_tiers WHERE tenant_id = v_tenant_id;
  IF v_existing > 0 THEN
    RAISE NOTICE 'Texas Nova already has % pricing_tiers rows — skipping seed', v_existing;
    RETURN;
  END IF;

  INSERT INTO pricing_tiers
    (tenant_id, service_type, bedrooms, bathrooms, max_sq_ft, price, labor_hours, cleaners, hours_per_cleaner)
  VALUES
    -- Standard (15 rows) — labor baseline: ~1 cleaner for small, 2 for 4+bd
    (v_tenant_id, 'standard', 1, 1.0,  800, 160.00,  4.0, 1, 4.0),
    (v_tenant_id, 'standard', 2, 1.0, 1000, 190.00,  4.5, 1, 4.5),
    (v_tenant_id, 'standard', 2, 2.0, 1250, 215.00,  5.0, 1, 5.0),
    (v_tenant_id, 'standard', 3, 2.0, 1500, 255.00,  6.0, 1, 6.0),
    (v_tenant_id, 'standard', 3, 3.0, 1999, 290.00,  7.0, 2, 3.5),
    (v_tenant_id, 'standard', 4, 2.0, 2000, 290.00,  7.0, 2, 3.5),
    (v_tenant_id, 'standard', 4, 3.0, 2500, 340.00,  8.0, 2, 4.0),
    (v_tenant_id, 'standard', 4, 4.0, 2750, 375.00,  9.0, 2, 4.5),
    (v_tenant_id, 'standard', 5, 3.0, 2750, 380.00,  9.0, 2, 4.5),
    (v_tenant_id, 'standard', 5, 4.0, 3000, 415.00, 10.0, 2, 5.0),
    (v_tenant_id, 'standard', 5, 5.0, 3250, 450.00, 11.0, 2, 5.5),
    (v_tenant_id, 'standard', 6, 3.0, 3250, 430.00, 10.0, 2, 5.0),
    (v_tenant_id, 'standard', 6, 4.0, 3500, 465.00, 11.0, 2, 5.5),
    (v_tenant_id, 'standard', 6, 5.0, 3750, 500.00, 12.0, 2, 6.0),
    (v_tenant_id, 'standard', 6, 6.0, 4000, 540.00, 13.0, 2, 6.5),
    -- Deep (15 rows) — ~1.4x standard labor
    (v_tenant_id, 'deep',     1, 1.0,  800, 250.00,  5.5, 1, 5.5),
    (v_tenant_id, 'deep',     2, 1.0, 1000, 290.00,  6.0, 1, 6.0),
    (v_tenant_id, 'deep',     2, 2.0, 1250, 330.00,  7.0, 1, 7.0),
    (v_tenant_id, 'deep',     3, 2.0, 1500, 400.00,  8.5, 2, 4.25),
    (v_tenant_id, 'deep',     3, 3.0, 1999, 450.00, 10.0, 2, 5.0),
    (v_tenant_id, 'deep',     4, 2.0, 2000, 480.00, 10.0, 2, 5.0),
    (v_tenant_id, 'deep',     4, 3.0, 2500, 530.00, 11.5, 2, 5.75),
    (v_tenant_id, 'deep',     4, 4.0, 2750, 575.00, 13.0, 2, 6.5),
    (v_tenant_id, 'deep',     5, 3.0, 2750, 580.00, 13.0, 2, 6.5),
    (v_tenant_id, 'deep',     5, 4.0, 3000, 625.00, 14.0, 2, 7.0),
    (v_tenant_id, 'deep',     5, 5.0, 3250, 670.00, 15.5, 2, 7.75),
    (v_tenant_id, 'deep',     6, 3.0, 3250, 630.00, 14.0, 2, 7.0),
    (v_tenant_id, 'deep',     6, 4.0, 3500, 675.00, 15.5, 2, 7.75),
    (v_tenant_id, 'deep',     6, 5.0, 3750, 720.00, 17.0, 2, 8.5),
    (v_tenant_id, 'deep',     6, 6.0, 4000, 770.00, 18.5, 2, 9.25),
    -- Move (15 rows) — ~1.5-1.6x standard labor (move-in/out thorough)
    (v_tenant_id, 'move',     1, 1.0,  800, 280.00,  6.0, 1, 6.0),
    (v_tenant_id, 'move',     2, 1.0, 1000, 320.00,  7.0, 1, 7.0),
    (v_tenant_id, 'move',     2, 2.0, 1250, 420.00,  8.0, 1, 8.0),
    (v_tenant_id, 'move',     3, 2.0, 1500, 420.00,  9.0, 2, 4.5),
    (v_tenant_id, 'move',     3, 3.0, 1999, 475.00, 10.5, 2, 5.25),
    (v_tenant_id, 'move',     4, 2.0, 2000, 490.00, 10.5, 2, 5.25),
    (v_tenant_id, 'move',     4, 3.0, 2500, 540.00, 12.0, 2, 6.0),
    (v_tenant_id, 'move',     4, 4.0, 2750, 590.00, 13.5, 2, 6.75),
    (v_tenant_id, 'move',     5, 3.0, 2750, 600.00, 13.5, 2, 6.75),
    (v_tenant_id, 'move',     5, 4.0, 3000, 650.00, 15.0, 2, 7.5),
    (v_tenant_id, 'move',     5, 5.0, 3250, 700.00, 16.5, 2, 8.25),
    (v_tenant_id, 'move',     6, 3.0, 3250, 680.00, 15.0, 2, 7.5),
    (v_tenant_id, 'move',     6, 4.0, 3500, 730.00, 16.5, 2, 8.25),
    (v_tenant_id, 'move',     6, 5.0, 3750, 780.00, 18.0, 2, 9.0),
    (v_tenant_id, 'move',     6, 6.0, 4000, 830.00, 19.5, 2, 9.75);

  RAISE NOTICE 'Seeded 45 pricing_tiers for Texas Nova (tenant_id=%)', v_tenant_id;
END $$;
