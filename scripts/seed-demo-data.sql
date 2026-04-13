-- =============================================================================
-- DEMO DATA SEED SCRIPT
-- Creates test accounts + realistic fake data for WinBros and Spotless Scrubbers
-- =============================================================================

-- Tenant IDs
-- WinBros:  e954fbd6-b3e1-4271-88b0-341c9df56beb
-- Spotless: 2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df

-- =============================================================================
-- 1. TEST LOGIN ACCOUNTS
-- Username: "test" / Password: "123" for each tenant
-- =============================================================================

-- WinBros test account
INSERT INTO users (username, password_hash, display_name, email, tenant_id, is_active)
VALUES (
  'test-winbros',
  crypt('123', gen_salt('bf')),
  'Test (WinBros)',
  'test@winbros.demo',
  'e954fbd6-b3e1-4271-88b0-341c9df56beb',
  true
)
ON CONFLICT (username) DO UPDATE SET
  password_hash = crypt('123', gen_salt('bf')),
  is_active = true;

-- Spotless test account
INSERT INTO users (username, password_hash, display_name, email, tenant_id, is_active)
VALUES (
  'test-spotless',
  crypt('123', gen_salt('bf')),
  'Test (Spotless)',
  'test@spotless.demo',
  '2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df',
  true
)
ON CONFLICT (username) DO UPDATE SET
  password_hash = crypt('123', gen_salt('bf')),
  is_active = true;

-- =============================================================================
-- 2. WINBROS CLEANERS (Morton, IL area)
-- =============================================================================

INSERT INTO cleaners (tenant_id, name, phone, email, is_team_lead, active, employee_type, role, username, pin, portal_token, hourly_rate, home_address, max_jobs_per_day)
VALUES
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Jake Miller', '+13095551001', 'jake@demo.com', true, true, 'team_lead', 'team_lead', 'jake.miller', '1111', gen_random_uuid()::text, 28.00, '205 W Jefferson St, Morton, IL 61550', 5),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Ryan Cooper', '+13095551002', 'ryan@demo.com', false, true, 'technician', 'technician', 'ryan.cooper', '2222', gen_random_uuid()::text, 22.00, '410 S Main St, Morton, IL 61550', 4),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Tyler Brooks', '+13095551003', 'tyler@demo.com', false, true, 'technician', 'technician', 'tyler.brooks', '3333', gen_random_uuid()::text, 22.00, '1200 E Washington St, East Peoria, IL 61611', 4),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Marcus Davis', '+13095551004', 'marcus@demo.com', true, true, 'team_lead', 'team_lead', 'marcus.davis', '4444', gen_random_uuid()::text, 28.00, '890 N Illinois Ave, Morton, IL 61550', 5),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Blake Thompson', '+13095551005', 'blake@demo.com', false, true, 'salesman', 'salesman', 'blake.thompson', '5555', gen_random_uuid()::text, 0, '320 Edgewood Dr, Morton, IL 61550', 6)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 3. SPOTLESS CLEANERS (LA area)
-- =============================================================================

INSERT INTO cleaners (tenant_id, name, phone, email, is_team_lead, active, employee_type, role, username, pin, portal_token, hourly_rate, home_address, max_jobs_per_day)
VALUES
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Maria Santos', '+13235551001', 'maria@demo.com', false, true, 'technician', 'technician', 'maria.santos', '6666', gen_random_uuid()::text, 25.00, '1420 W Pico Blvd, Los Angeles, CA 90015', 4),
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Jessica Reyes', '+13235551002', 'jessica@demo.com', false, true, 'technician', 'technician', 'jessica.reyes', '7777', gen_random_uuid()::text, 25.00, '3200 Wilshire Blvd, Los Angeles, CA 90010', 4),
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Rosa Martinez', '+13235551003', 'rosa@demo.com', true, true, 'team_lead', 'technician', 'rosa.martinez', '8888', gen_random_uuid()::text, 30.00, '5601 Santa Monica Blvd, Los Angeles, CA 90038', 5),
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Lucia Torres', '+13235551004', 'lucia@demo.com', false, true, 'technician', 'technician', 'lucia.torres', '9999', gen_random_uuid()::text, 25.00, '2100 S Vermont Ave, Los Angeles, CA 90007', 4)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 4. WINBROS CUSTOMERS (Morton / Peoria / East Peoria / Pekin IL)
-- =============================================================================

INSERT INTO customers (tenant_id, first_name, last_name, phone_number, email, address, lifecycle_stage, lead_source)
VALUES
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Tom', 'Henderson', '+13095550101', 'tom.henderson@demo.com', '445 W Adams St, Morton, IL 61550', 'active', 'referral'),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Sarah', 'Mitchell', '+13095550102', 'sarah.m@demo.com', '1820 N University St, Peoria, IL 61604', 'active', 'website'),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Dave', 'Larson', '+13095550103', null, '310 Springfield Rd, East Peoria, IL 61611', 'active', 'sms'),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Karen', 'O''Brien', '+13095550104', 'karen.ob@demo.com', '2200 W Glen Ave, Peoria, IL 61614', 'active', 'referral'),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Mike', 'Schneider', '+13095550105', null, '890 Court St, Pekin, IL 61554', 'new', 'website'),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Lisa', 'Hoffman', '+13095550106', 'lisa.h@demo.com', '1105 E Jackson St, Morton, IL 61550', 'active', 'referral'),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'James', 'Weber', '+13095550107', null, '750 War Memorial Dr, Peoria, IL 61614', 'active', 'sms'),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Nancy', 'Fischer', '+13095550108', 'nancy.f@demo.com', '455 S Main St, Morton, IL 61550', 'active', 'housecall_pro'),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Bob', 'Keller', '+13095550109', null, '1600 N Knoxville Ave, Peoria, IL 61603', 'new', 'website'),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Jennifer', 'Roth', '+13095550110', 'jen.roth@demo.com', '320 Detweiller Dr, Peoria, IL 61615', 'active', 'referral'),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Steve', 'Mueller', '+13095550111', null, '200 E Washington St, East Peoria, IL 61611', 'active', 'sms'),
  ('e954fbd6-b3e1-4271-88b0-341c9df56beb', 'Diane', 'Braun', '+13095550112', 'diane.b@demo.com', '615 N Seminary St, Pekin, IL 61554', 'active', 'referral')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 5. SPOTLESS CUSTOMERS (Los Angeles area)
-- =============================================================================

INSERT INTO customers (tenant_id, first_name, last_name, phone_number, email, address, lifecycle_stage, lead_source, bedrooms, bathrooms)
VALUES
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Ashley', 'Chen', '+13105550201', 'ashley.chen@demo.com', '1234 Wilshire Blvd, Santa Monica, CA 90403', 'active', 'meta', 3, 2),
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Brandon', 'Williams', '+13105550202', 'brandon.w@demo.com', '5678 Venice Blvd, Los Angeles, CA 90019', 'active', 'website', 4, 3),
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Christine', 'Park', '+13105550203', null, '910 S Figueroa St, Los Angeles, CA 90015', 'active', 'vapi', 2, 1),
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Daniel', 'Nguyen', '+13105550204', 'daniel.n@demo.com', '2345 Melrose Ave, Los Angeles, CA 90046', 'active', 'referral', 3, 2),
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Emily', 'Rodriguez', '+13105550205', 'emily.r@demo.com', '4567 Sunset Blvd, Los Angeles, CA 90027', 'active', 'meta', 5, 4),
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Frank', 'Kim', '+13105550206', null, '7890 Beverly Blvd, Los Angeles, CA 90048', 'new', 'website', 2, 2),
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Grace', 'Johnson', '+13105550207', 'grace.j@demo.com', '1111 Ocean Ave, Santa Monica, CA 90401', 'active', 'vapi', 4, 3),
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Henry', 'Lopez', '+13105550208', null, '3333 W 6th St, Los Angeles, CA 90020', 'active', 'sms', 3, 2),
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Isabella', 'Garcia', '+13105550209', 'isabella.g@demo.com', '5555 Franklin Ave, Los Angeles, CA 90028', 'active', 'meta', 3, 2),
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Kevin', 'Tanaka', '+13105550210', 'kevin.t@demo.com', '7777 W Olympic Blvd, Los Angeles, CA 90035', 'new', 'website', 4, 3),
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Laura', 'Patel', '+13105550211', null, '9999 Westwood Blvd, Los Angeles, CA 90024', 'active', 'referral', 2, 1),
  ('2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', 'Michael', 'Thompson', '+13105550212', 'mike.t@demo.com', '2222 N Highland Ave, Los Angeles, CA 90068', 'active', 'meta', 5, 4)
ON CONFLICT DO NOTHING;
