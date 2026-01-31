-- ============================================================================
-- SEED WINBROS CLEANERS
-- ============================================================================
-- Run this after 03-seed-winbros.sql to add cleaners and teams.
-- ============================================================================

-- ============================================================================
-- CREATE DEFAULT TEAM
-- ============================================================================

INSERT INTO teams (tenant_id, name, active)
SELECT id, 'Main Team', true
FROM tenants
WHERE slug = 'winbros';

-- ============================================================================
-- ADD CLEANERS
-- ============================================================================

-- Team Lead
INSERT INTO cleaners (
  tenant_id,
  name,
  phone,
  telegram_id,
  is_team_lead,
  active
)
SELECT
  id,
  '{{TEAM_LEAD_NAME}}',
  '{{TEAM_LEAD_PHONE}}',
  '{{TEAM_LEAD_TELEGRAM_ID}}',
  true,  -- Team lead
  true
FROM tenants
WHERE slug = 'winbros';

-- ============================================================================
-- ASSIGN CLEANERS TO TEAM
-- ============================================================================

-- Assign team lead
INSERT INTO team_members (tenant_id, team_id, cleaner_id, role, is_active)
SELECT
  t.id as tenant_id,
  tm.id as team_id,
  c.id as cleaner_id,
  'lead' as role,
  true as is_active
FROM tenants t
JOIN teams tm ON tm.tenant_id = t.id AND tm.name = 'Main Team'
JOIN cleaners c ON c.tenant_id = t.id AND c.name = '{{TEAM_LEAD_NAME}}'
WHERE t.slug = 'winbros';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Show all cleaners
SELECT
  c.id,
  c.name,
  c.phone,
  c.telegram_id,
  c.is_team_lead,
  c.active,
  t.name as tenant_name
FROM cleaners c
JOIN tenants t ON t.id = c.tenant_id
WHERE t.slug = 'winbros';

-- Show team with members
SELECT
  tm.name as team_name,
  c.name as cleaner_name,
  tmm.role,
  c.is_team_lead,
  tmm.is_active
FROM teams tm
JOIN tenants t ON t.id = tm.tenant_id
LEFT JOIN team_members tmm ON tmm.team_id = tm.id
LEFT JOIN cleaners c ON c.id = tmm.cleaner_id
WHERE t.slug = 'winbros';

-- ============================================================================
-- NOTES
-- ============================================================================
--
-- To add more cleaners, use this template:
--
-- INSERT INTO cleaners (tenant_id, name, phone, telegram_id, is_team_lead, active)
-- SELECT id, 'Cleaner Name', '+1XXXXXXXXXX', 'TELEGRAM_ID', false, true
-- FROM tenants WHERE slug = 'winbros';
--
-- To add them to the team:
--
-- INSERT INTO team_members (tenant_id, team_id, cleaner_id, role, is_active)
-- SELECT t.id, tm.id, c.id, 'member', true
-- FROM tenants t
-- JOIN teams tm ON tm.tenant_id = t.id AND tm.name = 'Main Team'
-- JOIN cleaners c ON c.tenant_id = t.id AND c.name = 'Cleaner Name'
-- WHERE t.slug = 'winbros';
--
-- ============================================================================
