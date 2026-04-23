-- Wave 2: Appointments tab support
-- UP
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS crew_salesman_id INTEGER REFERENCES cleaners(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_crew_salesman ON jobs(crew_salesman_id) WHERE crew_salesman_id IS NOT NULL;

-- DOWN
-- DROP INDEX IF EXISTS idx_jobs_crew_salesman;
-- ALTER TABLE jobs DROP COLUMN IF EXISTS crew_salesman_id;
-- ALTER TABLE jobs DROP COLUMN IF EXISTS end_time;
