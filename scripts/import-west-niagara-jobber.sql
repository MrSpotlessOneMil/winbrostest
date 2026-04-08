-- ============================================================================
-- WEST NIAGARA CLEANING — Import from Jobber
-- ============================================================================
-- Imports 57 clients and 15 jobs. NO SMS, NO follow-ups, NO automation.
-- Safe to run — only INSERTs, uses ON CONFLICT to skip duplicates.
--
-- Phone numbers normalized to +1XXXXXXXXXX format.
-- Clients without phone numbers use email-based placeholder.
-- ============================================================================

DO $$
DECLARE
  tid UUID := (SELECT id FROM tenants WHERE slug = 'west-niagara');
BEGIN

-- ============================================================================
-- ACTIVE CLIENTS (with jobs in Jobber)
-- ============================================================================

INSERT INTO customers (tenant_id, phone_number, first_name, last_name, email, address, lead_source, notes)
VALUES
  -- TJ Dixon — 2 properties (owner)
  (tid, '+12894405365', 'TJ',          'Dixon',     'tjdixon100@hotmail.com',          '5095 Saint George''s Drive, Lincoln, Ontario L3J 0M1',          'jobber', 'Imported from Jobber — 2 properties'),
  -- Krystal Dixon
  (tid, '+19055167704', 'Krystal',     'Dixon',     'miss_k@hotmail.com',              '5095 North Service Road, Lincoln, Ontario L3J 1P7',             'jobber', 'Imported from Jobber'),
  -- Mike Sneath
  (tid, '+19053274822', 'Mike',        'Sneath',    'smikesneath@gmail.com',           '21 Frederick Street, St. Catharines, Ontario L2S 2S3',          'jobber', 'Imported from Jobber'),
  -- OH Nass
  (tid, '+19059333219', 'OH',          'Nass',      'oula_nassif@yahoo.com',           '28 Kenny Court, Thorold, Ontario L2V 5G4',                      'jobber', 'Imported from Jobber'),
  -- Joe Snilhur (no phone — use email placeholder)
  (tid, 'no-phone-snihurridge@gmail.com', 'Joe',    'Snilhur',   'snihurridge@gmail.com',           '3155 Staff Avenue, St. Catharines, Ontario L2R 6P7',            'jobber', 'Imported from Jobber — no phone on file'),
  -- Paul (Beamsville)
  (tid, '+19058459898', 'Paul',        NULL,        NULL,                              'Beamsville, Lincoln, Ontario L0R',                               'jobber', 'Imported from Jobber'),
  -- Saidah Azad
  (tid, '+14166594448', 'Saidah',      'Azad',      'saidah.azad@td.com',             '115 Sonoma Lane, Hamilton, Ontario L8E 0J9',                    'jobber', 'Imported from Jobber'),
  -- Gay Morrison
  (tid, '+12892418125', 'Gay',         'Morrison',  'morrison_gay@yahoo.com',         '4226 Queen Street, Lincoln, Ontario L3J 0K8',                   'jobber', 'Imported from Jobber'),
  -- Carl Buys
  (tid, '+19059750538', 'Carl',        'Buys',      'carl_buys@hotmail.com',          '5082 Park Avenue, Lincoln, Ontario L3J 0H9',                    'jobber', 'Imported from Jobber'),
  -- Stephanie Dychtiar
  (tid, '+19053517152', 'Stephanie',   'Dychtiar',  'stephaniedychtiar1@hotmial.com', '7141 Sauterne Place, Niagara Falls, Ontario L2J 3V3',           'jobber', 'Imported from Jobber'),
  -- Cara Heny
  (tid, '+12893037163', 'Cara',        'Heny',      'cara.specialevents@outlook.com', '4520 Huron Street, Niagara Falls, Ontario L2E 6Y9',             'jobber', 'Imported from Jobber'),
  -- Andrew (Frost Rd)
  (tid, '+16477108334', 'Andrew',      NULL,        'evrotas1@gmail.com',             '3360 Frost Road, Lincoln, Ontario L3J 2A4',                     'jobber', 'Imported from Jobber'),
  -- Grant Higginson
  (tid, '+14036718487', 'Grant',       'Higginson', 'grant@welbyconsulting.com',      '2 Stepney Street, St. Catharines, Ontario L2M 1P8',             'jobber', 'Imported from Jobber'),
  -- Subhabrata Dutta
  (tid, '+14165623793', 'Subhabrata',  'Dutta',     'subhabratadutta1988@gmail.com',  '33 Charleswood Crescent, Hannon, Hamilton, Ontario L0R 1P0',    'jobber', 'Imported from Jobber — standard biweekly clean 10% off'),
  -- Jim Carrick
  (tid, '+12393174287', 'Jim',         'Carrick',   'jamescarrick707@gmail.com',      '7298 Lakewood Crescent, Niagara Falls, Ontario L2G 7V1',        'jobber', 'Imported from Jobber — standard biweekly clean'),
  -- Amanda Laura
  (tid, '+19059238357', 'Amanda',      'Laura',     'amanda.l.leroux@gmail.com',      '195 Denistoun Street unit 196, Welland, Ontario L3C 6P1',       'jobber', 'Imported from Jobber'),
  -- Sylvia Hastey
  (tid, '+12504652360', 'Sylvia',      'Hastey',    'syl2005@hotmail.com',            '5 Wembly Drive, St. Catharines, Ontario L2P 3X1',               'jobber', 'Imported from Jobber — standard clean recurring biweekly')
ON CONFLICT (tenant_id, phone_number) DO NOTHING;

-- ============================================================================
-- LEAD CLIENTS (no jobs — status "Lead" in Jobber)
-- ============================================================================

INSERT INTO customers (tenant_id, phone_number, first_name, last_name, email, address, lead_source, notes)
VALUES
  (tid, '+19056502002', 'Seema',       NULL,        'sseema@me.com',                  'St. Catharines, Ontario',                                       'jobber', 'Imported from Jobber as lead'),
  -- Sharon — no phone, no email
  (tid, 'no-phone-sharon',             'Sharon',    NULL,        NULL,                              NULL,                                                            'jobber', 'Imported from Jobber as lead — no phone on file'),
  (tid, '+19055633012', 'Alisha Lynn', 'Brouwer',   'alishaschilstra@gmail.com',      '4210 Hixon Street, Lincoln, Ontario L3J 0L6',                   'jobber', 'Imported from Jobber as lead'),
  (tid, '+19053801414', 'Andrew',      'Miner',     'andrewminer0913@gmail.com',      '144 Esther Crescent, Thorold, Ontario L3B 0G6',                 'jobber', 'Imported from Jobber as lead'),
  (tid, '+19052209764', 'Jay',         NULL,        'jaygb48@gmail.com',              'Hamilton, Ontario',                                             'jobber', 'Imported from Jobber as lead'),
  (tid, '+19059414982', 'Brandon',     'Dallman',   'andraxeous1111@gmail.com',       '12 Spencer Street, Welland, Ontario L3B 3W2',                   'jobber', 'Imported from Jobber as lead'),
  (tid, '+19053519945', 'Jordan',      'Charron',   'jordancharron@gmail.com',        '137 Highland Ave, St. Catharines, Ontario L2R 4J5',             'jobber', 'Imported from Jobber as lead'),
  (tid, '+19055150888', 'Franca',      'Robbins',   'robbins8950@gmail.com',          '54 Heritage Drive, Hamilton, Ontario L8G 4H8',                  'jobber', 'Imported from Jobber as lead'),
  -- Lew Will — no phone
  (tid, 'no-phone-fords.4.fun@hotmail.com', 'Lew',  'Will',      'fords.4.fun@hotmail.com',        'Hamilton, Ontario',                                             'jobber', 'Imported from Jobber as lead — no phone on file'),
  (tid, '+19055312748', 'Dimitri',     'Goritsas',  'dimitrigoritsas@gmail.com',      '4893 Connor Drive, Lincoln, Ontario L3J 0T4',                   'jobber', 'Imported from Jobber as lead'),
  (tid, '+12507937312', 'Joe',         NULL,        'joe_hru@hotmail.com',            '10 William Johnson Street, Hamilton, Ontario L8J 1B2',          'jobber', 'Imported from Jobber as lead'),
  (tid, '+19056508747', 'Christina',   'Thomas',    'cdeangelis428@gmail.com',        '6 Sterling Street, St. Catharines, Ontario L2S 3T1',            'jobber', 'Imported from Jobber as lead'),
  (tid, '+12892148046', 'Elijah',      'Anger',     'elijahanger28@outlook.com',      '7331 Sherrilee Crescent, Niagara Falls, Ontario L2H 3T2',       'jobber', 'Imported from Jobber as lead'),
  (tid, '+19053288017', 'David',       'Siena',     'david@scalewsiena.com',          '10187 Lakeshore Road West, Wainfleet, Ontario L3K 5V4',         'jobber', 'Imported from Jobber as lead'),
  (tid, '+19059811443', 'Kyle',        'Rankin',    '92k.rankin@gmail.com',           '44 Royalvista Drive, Hamilton, Ontario L8W 3C4',                'jobber', 'Imported from Jobber as lead'),
  (tid, '+19053591808', 'Jim',         'Gilliam',   'jimjgilliam@gmail.com',          '6400 Huggins Street, Niagara Falls, Ontario L2J 3G5',           'jobber', 'Imported from Jobber as lead'),
  -- Jim Cottringer — no phone
  (tid, 'no-phone-jim.cottringer@gmail.com', 'Jim',  'Cottringer', 'jim.cottringer@gmail.com',       'Jordan, Lincoln, Ontario',                                      'jobber', 'Imported from Jobber as lead — no phone on file'),
  (tid, '+19056501043', 'Michel',      'Baiano',    'mgbaiano55@gmail.com',           '190 Highway 20 West, Pelham, Ontario L0S 1E5',                  'jobber', 'Imported from Jobber as lead'),
  (tid, '+19055801243', 'Aidan',       'Harris',    'aidan.c.harris@gmail.com',       'Grimsby, Ontario',                                              'jobber', 'Imported from Jobber as lead'),
  (tid, '+14169301521', 'Clair',       'Ward',      'claireannward@gmail.com',        '259 Sugarloaf Street, Port Colborne, Ontario L3K 2P1',          'jobber', 'Imported from Jobber as lead'),
  (tid, '+19054847696', 'John',        'Nadeau',    'nadeaujohnp@gmail.com',          'St. Catharines, Ontario',                                       'jobber', 'Imported from Jobber as lead'),
  (tid, '+19057887942', 'TJ',          'Vanbeveren','tvanbeveren@hotmail.com',        'Welland, Ontario',                                              'jobber', 'Imported from Jobber as lead'),
  (tid, '+16476213433', 'Sahar',       'Hajer',     'sahar_nabi@yahoo.com',           '4294 Simcoe Street, Niagara Falls, Ontario L2E 1T6',            'jobber', 'Imported from Jobber as lead'),
  (tid, '+19052461971', 'Lynn',        'Mines',     'linnielue@outlook.com',          '549 Warner Road, Niagara-on-the-Lake, Ontario L0S 1J0',         'jobber', 'Imported from Jobber as lead'),
  (tid, '+19053212977', 'Brad',        'Hutchings', 'bkhutch1@me.com',               'Mathews Road North, Fort Erie, Ontario L0S',                    'jobber', 'Imported from Jobber as lead'),
  (tid, '+19053513430', 'Amelia',      'Damore',    'sungrove@cogeco.ca',             'Niagara Falls, Ontario',                                        'jobber', 'Imported from Jobber as lead'),
  (tid, '+19053280153', 'Josie',       NULL,        'josievmorrow@gmail.com',         'Jordan, Lincoln, Ontario',                                      'jobber', 'Imported from Jobber as lead'),
  (tid, '+12896864560', 'William',     'Neufeld',   'williamneufeld@hotmail.com',     '129 Wall Road, Niagara-on-the-Lake, Ontario L0S 1J0',           'jobber', 'Imported from Jobber as lead'),
  (tid, '+19053510575', 'Jessica',     'Elaine',    'beautyquinn0606@gmail.com',      '52 Lampman Crescent, Thorold, Ontario L2V 4K7',                 'jobber', 'Imported from Jobber as lead'),
  (tid, '+19056508903', 'Justen',      'Cole',      'justen.wilson@gmail.com',        '157 Rolling Acres Drive, Welland, Ontario L3C 6K6',             'jobber', 'Imported from Jobber as lead'),
  (tid, '+14167290017', 'Kurera',      NULL,        'mithila.kurera@gmail.com',       '13 Cloy Drive, Thorold, Ontario L3B 0E9',                       'jobber', 'Imported from Jobber as lead'),
  (tid, '+14169128566', 'Harman',      'Tada',      'tadaharman@yahoo.com',           'Smithville, Ontario L0R',                                       'jobber', 'Imported from Jobber as lead'),
  (tid, '+14168198016', 'Melinda',     'Rios-Paul', 'melindariospaul@gmail.com',      '15 Sparkle Drive, Allanburg, Thorold, Ontario L0S 1A0',         'jobber', 'Imported from Jobber as lead'),
  (tid, '+12892192119', 'Carm',        'D''Elia',   'carm.delia@hotmail.com',         '12 Sapphire Court, St. Catharines, Ontario L2M 7A8',            'jobber', 'Imported from Jobber as lead'),
  (tid, '+16474029547', 'Rob',         'Fortuna',   NULL,                             'Grimsby, Ontario',                                              'jobber', 'Imported from Jobber as lead'),
  (tid, '+19056380329', 'Jimmie',      'Pegg',      'jimmiethepegg@yahoo.ca',         '4057 Regional Road 20, Saint Anns, Ontario L0R 1Y0',            'jobber', 'Imported from Jobber as lead'),
  (tid, '+13658898076', 'Rob',         'Welk',      'robwelk1983@gmail.com',          '20 Windle Village Crescent, Thorold, Ontario L2V 4Z5',          'jobber', 'Imported from Jobber as lead'),
  (tid, '+19053278350', 'Paul',        'Taylor',    'pitaylor@icloud.com',            '124 Parkway, Welland, Ontario L3C 4C3',                         'jobber', 'Imported from Jobber as lead'),
  (tid, '+19053591532', 'Rob',         'Cerroni',   'rcerroni44@gmail.com',           '4921 Tufford Road North, Lincoln, Ontario L3J 1G7',             'jobber', 'Imported from Jobber as lead'),
  (tid, '+19056585557', 'Billy',       'Baker',     'bbaker1960@live.com',            'Niagara-on-the-Lake, Ontario',                                  'jobber', 'Imported from Jobber as lead')
ON CONFLICT (tenant_id, phone_number) DO NOTHING;

-- ============================================================================
-- LEADS table entries (for "Lead" status clients — visible in dashboard, NO follow-up)
-- ============================================================================

INSERT INTO leads (tenant_id, phone_number, customer_id, first_name, last_name, source, source_id, status, form_data)
SELECT
  tid,
  c.phone_number,
  c.id,
  c.first_name,
  c.last_name,
  'manual',
  'jobber-import-' || c.id,
  'contacted',
  jsonb_build_object('imported_from', 'jobber', 'original_status', 'lead', 'import_date', '2026-04-08')
FROM customers c
WHERE c.tenant_id = tid
  AND c.lead_source = 'jobber'
  AND c.notes LIKE '%as lead%'
  AND NOT EXISTS (
    SELECT 1 FROM leads l WHERE l.tenant_id = tid AND l.phone_number = c.phone_number
  );

-- ============================================================================
-- JOBS — 15 jobs from Jobber (NO automation, NO SMS, NO follow-ups)
-- ============================================================================

-- #10 Cara Heny — Deep clean, April 5 (late)
INSERT INTO jobs (tenant_id, customer_id, phone_number, address, service_type, date, price, status, booked, notes)
SELECT tid, c.id, c.phone_number, '4520 Huron Street, Niagara Falls, Ontario L2E 6Y9',
  'Deep Cleaning', '2026-04-05', 136.00, 'scheduled', TRUE, 'Jobber job #10 — deep clean'
FROM customers c WHERE c.tenant_id = tid AND c.phone_number = '+12893037163';

-- #7 Grant Higginson — Deep clean, April 7 (late)
INSERT INTO jobs (tenant_id, customer_id, phone_number, address, service_type, date, price, status, booked, notes)
SELECT tid, c.id, c.phone_number, '2 Stepney Street, St. Catharines, Ontario L2M 1P8',
  'Deep Cleaning', '2026-04-07', 435.00, 'scheduled', TRUE, 'Jobber job #7 — deep clean'
FROM customers c WHERE c.tenant_id = tid AND c.phone_number = '+14036718487';

-- #1 OH Nass — Deep clean (action required, no date)
INSERT INTO jobs (tenant_id, customer_id, phone_number, address, service_type, price, status, booked, notes)
SELECT tid, c.id, c.phone_number, '28 Kenny Court, Thorold, Ontario L2V 5G4',
  'Deep Cleaning', 225.00, 'pending', FALSE, 'Jobber job #1 — deep clean — action required'
FROM customers c WHERE c.tenant_id = tid AND c.phone_number = '+19059333219';

-- #4 Paul — (action required, no date)
INSERT INTO jobs (tenant_id, customer_id, phone_number, address, service_type, price, status, booked, notes)
SELECT tid, c.id, c.phone_number, 'Beamsville, Lincoln, Ontario L0R',
  'Standard Cleaning', 204.00, 'pending', FALSE, 'Jobber job #4 — action required'
FROM customers c WHERE c.tenant_id = tid AND c.phone_number = '+19058459898';

-- #2 Mike Sneath — Deep clean, April 8
INSERT INTO jobs (tenant_id, customer_id, phone_number, address, service_type, date, price, status, booked, notes)
SELECT tid, c.id, c.phone_number, '21 Frederick Street, St. Catharines, Ontario L2S 2S3',
  'Deep Cleaning', '2026-04-08', 114.00, 'scheduled', TRUE, 'Jobber job #2 — deep clean'
FROM customers c WHERE c.tenant_id = tid AND c.phone_number = '+19053274822';

-- #8 Carl Buys — April 10
INSERT INTO jobs (tenant_id, customer_id, phone_number, address, service_type, date, price, status, booked, notes)
SELECT tid, c.id, c.phone_number, '5082 Park Avenue, Lincoln, Ontario L3J 0H9',
  'Standard Cleaning', '2026-04-10', 170.00, 'scheduled', TRUE, 'Jobber job #8'
FROM customers c WHERE c.tenant_id = tid AND c.phone_number = '+19059750538';

-- #13 Subhabrata Dutta — Standard biweekly 10% off, April 12
INSERT INTO jobs (tenant_id, customer_id, phone_number, address, service_type, date, price, status, booked, notes)
SELECT tid, c.id, c.phone_number, '33 Charleswood Crescent, Hannon, Hamilton, Ontario L0R 1P0',
  'Standard Cleaning', '2026-04-12', 255.00, 'scheduled', TRUE, 'Jobber job #13 — standard biweekly clean 10% off'
FROM customers c WHERE c.tenant_id = tid AND c.phone_number = '+14165623793';

-- #15 Amanda Laura — April 15
INSERT INTO jobs (tenant_id, customer_id, phone_number, address, service_type, date, price, status, booked, notes)
SELECT tid, c.id, c.phone_number, '195 Denistoun Street unit 196, Welland, Ontario L3C 6P1',
  'Standard Cleaning', '2026-04-15', 170.00, 'scheduled', TRUE, 'Jobber job #15'
FROM customers c WHERE c.tenant_id = tid AND c.phone_number = '+19059238357';

-- #9 Stephanie Dychtiar — April 17
INSERT INTO jobs (tenant_id, customer_id, phone_number, address, service_type, date, price, status, booked, notes)
SELECT tid, c.id, c.phone_number, '7141 Sauterne Place, Niagara Falls, Ontario L2J 3V3',
  'Standard Cleaning', '2026-04-17', 255.00, 'scheduled', TRUE, 'Jobber job #9'
FROM customers c WHERE c.tenant_id = tid AND c.phone_number = '+19053517152';

-- #6 Gay Morrison — Deep clean, April 22
INSERT INTO jobs (tenant_id, customer_id, phone_number, address, service_type, date, price, status, booked, notes)
SELECT tid, c.id, c.phone_number, '4226 Queen Street, Lincoln, Ontario L3J 0K8',
  'Deep Cleaning', '2026-04-22', 210.00, 'scheduled', TRUE, 'Jobber job #6 — deep clean'
FROM customers c WHERE c.tenant_id = tid AND c.phone_number = '+12892418125';

-- #11 Andrew — Deep clean, April 27
INSERT INTO jobs (tenant_id, customer_id, phone_number, address, service_type, date, price, status, booked, notes)
SELECT tid, c.id, c.phone_number, '3360 Frost Road, Lincoln, Ontario L3J 2A4',
  'Deep Cleaning', '2026-04-27', 442.00, 'scheduled', TRUE, 'Jobber job #11 — deep clean'
FROM customers c WHERE c.tenant_id = tid AND c.phone_number = '+16477108334';

-- #14 Jim Carrick — Standard biweekly, April 28
INSERT INTO jobs (tenant_id, customer_id, phone_number, address, service_type, date, price, status, booked, notes)
SELECT tid, c.id, c.phone_number, '7298 Lakewood Crescent, Niagara Falls, Ontario L2G 7V1',
  'Standard Cleaning', '2026-04-28', 156.65, 'scheduled', TRUE, 'Jobber job #14 — standard biweekly clean'
FROM customers c WHERE c.tenant_id = tid AND c.phone_number = '+12393174287';

-- #12 Sylvia Hastey — Standard recurring biweekly, April 29
INSERT INTO jobs (tenant_id, customer_id, phone_number, address, service_type, date, price, status, booked, notes)
SELECT tid, c.id, c.phone_number, '5 Wembly Drive, St. Catharines, Ontario L2P 3X1',
  'Standard Cleaning', '2026-04-29', 150.00, 'scheduled', TRUE, 'Jobber job #12 — standard clean recurring biweekly'
FROM customers c WHERE c.tenant_id = tid AND c.phone_number = '+12504652360';

-- #5 Saidah Azad — Deep clean, May 1
INSERT INTO jobs (tenant_id, customer_id, phone_number, address, service_type, date, price, status, booked, notes)
SELECT tid, c.id, c.phone_number, '115 Sonoma Lane, Hamilton, Ontario L8E 0J9',
  'Deep Cleaning', '2026-05-01', 210.00, 'scheduled', TRUE, 'Jobber job #5 — deep clean'
FROM customers c WHERE c.tenant_id = tid AND c.phone_number = '+14166594448';

-- #3 Joe Snilhur — Deep clean, March 31 (COMPLETED)
INSERT INTO jobs (tenant_id, customer_id, phone_number, address, service_type, date, price, status, booked, completed_at, notes)
SELECT tid, c.id, c.phone_number, '3155 Staff Avenue, St. Catharines, Ontario L2R 6P7',
  'Deep Cleaning', '2026-03-31', 256.00, 'completed', TRUE, '2026-03-31T23:59:00Z', 'Jobber job #3 — deep clean — completed'
FROM customers c WHERE c.tenant_id = tid AND c.phone_number = 'no-phone-snihurridge@gmail.com';

END $$;
