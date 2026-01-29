# Supabase Database Setup Guide

This guide will help you set up the Supabase database for the cleaning business automation system.

## Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Note your project URL and service role key from Settings → API

## Step 2: Run Database Schema

1. Open Supabase SQL Editor
2. Copy and paste the contents of `scripts/optimized-schema.sql` (from spotless-automation-main)
3. Execute the script

**OR** if you prefer to run the migration:

1. Copy `scripts/migrate-to-optimized-schema.sql`
2. **BACKUP YOUR DATABASE FIRST** (if you have existing data)
3. Run the migration script

## Step 3: Verify Tables Created

Run this query to verify all tables exist:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

You should see:
- `customers`
- `jobs`
- `cleaners`
- `cleaner_assignments`
- `calls`
- `system_events`
- `leads` (for GHL)
- `followup_queue` (for GHL)
- `reminder_notifications`
- `cleaner_blocked_dates` (optional)
- `automation_logs` (optional)

## Step 4: Set Up Row Level Security (RLS)

The schema script should have created RLS policies, but verify:

```sql
-- Check if RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';
```

All tables should have `rowsecurity = true`.

## Step 5: Configure Cleaners Table

Add your cleaners with availability rules:

```sql
INSERT INTO cleaners (name, phone, telegram_id, active, availability) VALUES
('Marcus Johnson', '+15551234567', '123456789', true, '{
  "tz": "America/Los_Angeles",
  "rules": [
    {"days": ["MO", "TU", "WE", "TH", "FR"], "start": "09:00", "end": "17:00"}
  ],
  "is24_7": false
}'::jsonb),
('David Martinez', '+15559876543', '987654321', true, '{
  "tz": "America/Los_Angeles",
  "rules": [
    {"days": ["MO", "TU", "WE", "TH", "FR"], "start": "08:00", "end": "16:00"}
  ],
  "is24_7": false
}'::jsonb);
```

## Step 6: Test Database Connection

Create a test file `test-db.ts`:

```typescript
import { getSupabaseClient } from './lib/supabase'

async function test() {
  const client = getSupabaseClient()
  const { data, error } = await client.from('cleaners').select('*')
  console.log('Cleaners:', data, error)
}

test()
```

## Step 7: Set Up System Events Table

If the schema script didn't create it, run:

```sql
-- Copy from spotless-automation-main/scripts/setup-system-events.sql
```

## Important Notes

1. **Phone Numbers**: All phone numbers should be stored in E.164 format (+1XXXXXXXXXX)
2. **Availability Format**: Cleaner availability is stored as JSONB with this structure:
   ```json
   {
     "tz": "America/Los_Angeles",
     "rules": [
       {"days": ["MO", "TU"], "start": "09:00", "end": "17:00"}
     ],
     "is24_7": false
   }
   ```
3. **Timezone**: Default timezone is America/Los_Angeles (PST/PDT)
4. **Indexes**: The schema includes 25+ optimized indexes for performance

## Verification Queries

```sql
-- Check customers table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'customers'
ORDER BY ordinal_position;

-- Check jobs table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'jobs'
ORDER BY ordinal_position;

-- Check cleaners table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'cleaners'
ORDER BY ordinal_position;

-- Check indexes
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

## Troubleshooting

1. **Foreign key errors**: Make sure parent tables exist before child tables
2. **RLS errors**: Policies are created automatically, but you may need to adjust for your use case
3. **Type errors**: Ensure all foreign keys match (integers, not UUIDs)
