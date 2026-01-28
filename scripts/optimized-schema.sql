-- ============================================
-- CLEANING BUSINESS AUTOMATION - SCHEMA (TEAMS + CLEANER LOCATION)
-- ============================================
-- WARNING: THIS SCRIPT WIPES YOUR DATABASE.
-- It drops and recreates the public schema (ALL TABLES/DATA LOST).
-- Run in Supabase SQL editor with extreme care.

begin;

-- Wipe everything in public schema
drop schema if exists public cascade;
create schema public;

-- Needed extensions
create extension if not exists "pgcrypto";

-- Allow common roles to use public schema
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;

-- ============================================
-- TABLE: customers
-- ============================================
create table if not exists public.customers (
  id serial primary key,
  phone_number text not null unique,
  first_name text,
  last_name text,
  email text,
  address text,
  bedrooms integer check (bedrooms >= 0 and bedrooms <= 20),
  bathrooms integer check (bathrooms >= 0 and bathrooms <= 20),
  square_footage integer check (square_footage >= 0 and square_footage <= 50000),
  texting_transcript text default '',
  hubspot_contact_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Indexes for customers
create index if not exists idx_customers_phone on public.customers(phone_number);
create index if not exists idx_customers_email on public.customers(email) where email is not null;
create index if not exists idx_customers_created_at on public.customers(created_at desc);
create index if not exists idx_customers_hubspot_contact_id on public.customers(hubspot_contact_id)
  where hubspot_contact_id is not null;

comment on table public.customers is 'Customer contact information and property details';
comment on column public.customers.phone_number is 'E.164 format phone number (e.g., +15551234567)';
comment on column public.customers.texting_transcript is 'Full SMS conversation history with timestamps';

-- ============================================
-- TABLE: teams
-- ============================================
create table if not exists public.teams (
  id serial primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_teams_active on public.teams(active) where active = true;
create index if not exists idx_teams_created_at on public.teams(created_at desc);

comment on table public.teams is 'Crews/teams (contains multiple cleaners)';

-- ============================================
-- TABLE: jobs
-- ============================================
create table if not exists public.jobs (
  id serial primary key,
  customer_id integer not null references public.customers(id) on delete cascade,
  team_id integer references public.teams(id) on delete set null,
  phone_number text not null,
  service_type text not null default 'Standard cleaning',
  date date,
  scheduled_at time,
  address text,
  bedrooms integer,
  bathrooms integer,
  square_footage integer,
  price numeric(10, 2) check (price >= 0),
  hours numeric(4, 2) check (hours >= 0 and hours <= 24),
  cleaners integer check (cleaners >= 1 and cleaners <= 6),
  notes text,
  pricing_adjustment_pct numeric(5, 2) check (pricing_adjustment_pct between -50 and 50),
  pricing_strategy text,
  pricing_insights jsonb,
  status text not null default 'lead' check (
    status in ('lead', 'quoted', 'scheduled', 'in_progress', 'completed', 'cancelled')
  ),
  booked boolean not null default false,
  paid boolean not null default false,
  invoice_sent boolean not null default false,
  stripe_invoice_id text,
  hubspot_deal_id text,
  docusign_envelope_id text,
  docusign_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Indexes for jobs
create index if not exists idx_jobs_customer_id on public.jobs(customer_id);
create index if not exists idx_jobs_team_id on public.jobs(team_id) where team_id is not null;
create index if not exists idx_jobs_phone_number on public.jobs(phone_number);
create index if not exists idx_jobs_date on public.jobs(date) where date is not null;
create index if not exists idx_jobs_status on public.jobs(status);
create index if not exists idx_jobs_paid on public.jobs(paid) where paid = false;
create index if not exists idx_jobs_booked on public.jobs(booked) where booked = true;
create index if not exists idx_jobs_stripe_invoice on public.jobs(stripe_invoice_id) where stripe_invoice_id is not null;
create index if not exists idx_jobs_hubspot_deal_id on public.jobs(hubspot_deal_id) where hubspot_deal_id is not null;
create index if not exists idx_jobs_created_at on public.jobs(created_at desc);

comment on table public.jobs is 'Cleaning job bookings and service requests';
comment on column public.jobs.status is 'Job lifecycle: lead → quoted → scheduled → in_progress → completed';

-- ============================================
-- TABLE: cleaners (workers)
-- ============================================
create table if not exists public.cleaners (
  id serial primary key,
  name text not null,
  phone text,
  telegram_id text,
  telegram_username text,
  connecteam_user_id text,
  max_team_size integer not null default 1 check (max_team_size >= 1 and max_team_size <= 6),
  availability jsonb, -- JSONB format: {"tz": "America/Los_Angeles", "rules": [{"days": ["MO","TU"], "start": "09:00", "end": "17:00"}], "is24_7": false}
  last_location_lat double precision,
  last_location_lng double precision,
  last_location_accuracy_meters double precision,
  last_location_updated_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Indexes for cleaners
create index if not exists idx_cleaners_active on public.cleaners(active) where active = true;
create index if not exists idx_cleaners_telegram_id on public.cleaners(telegram_id) where telegram_id is not null;
create index if not exists idx_cleaners_connecteam_user_id on public.cleaners(connecteam_user_id)
  where connecteam_user_id is not null;
create index if not exists idx_cleaners_location_updated_at on public.cleaners(last_location_updated_at desc)
  where last_location_updated_at is not null;

comment on table public.cleaners is 'Team members who perform cleaning services';
comment on column public.cleaners.telegram_id is 'Telegram chat ID for job notifications';
comment on column public.cleaners.availability is 'JSONB availability rules with timezone and day/time windows';
comment on column public.cleaners.last_location_lat is 'Latest known latitude';
comment on column public.cleaners.last_location_lng is 'Latest known longitude';
comment on column public.cleaners.last_location_updated_at is 'Timestamp of last location update';

-- ============================================
-- TABLE: team_members (cleaners inside teams)
-- ============================================
create table if not exists public.team_members (
  id serial primary key,
  team_id integer not null references public.teams(id) on delete cascade,
  cleaner_id integer not null references public.cleaners(id) on delete cascade,
  role text not null default 'technician' check (role in ('lead', 'technician')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_team_members_team_cleaner on public.team_members(team_id, cleaner_id);
create index if not exists idx_team_members_team_id on public.team_members(team_id);
create index if not exists idx_team_members_cleaner_id on public.team_members(cleaner_id);
create index if not exists idx_team_members_role on public.team_members(role);
create index if not exists idx_team_members_active on public.team_members(is_active) where is_active = true;

comment on table public.team_members is 'Membership mapping of cleaners to teams';

-- ============================================
-- TABLE: cleaner_assignments (job ↔ cleaner, optional)
-- ============================================
-- This table is kept for compatibility with existing automation code.
-- If you only assign jobs to teams, you can keep this empty and just set jobs.team_id.
create table if not exists public.cleaner_assignments (
  id serial primary key,
  job_id integer not null references public.jobs(id) on delete cascade,
  cleaner_id integer not null references public.cleaners(id) on delete cascade,
  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'declined', 'confirmed', 'cancelled')
  ),
  connecteam_shift_id text,
  connecteam_shift_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_assignments_job_id on public.cleaner_assignments(job_id);
create index if not exists idx_assignments_cleaner_id on public.cleaner_assignments(cleaner_id);
create index if not exists idx_assignments_status on public.cleaner_assignments(status);
create index if not exists idx_assignments_pending on public.cleaner_assignments(job_id, status)
  where status = 'pending';
create index if not exists idx_assignments_created_at on public.cleaner_assignments(created_at);

comment on table public.cleaner_assignments is 'Tracks which individual cleaners are assigned to which jobs (optional)';

-- ============================================
-- TABLE: calls
-- ============================================
create table if not exists public.calls (
  id serial primary key,
  customer_id integer references public.customers(id) on delete set null,
  phone_number text not null,
  from_number text,
  to_number text,
  direction text,
  provider text,
  provider_call_id text unique,
  vapi_call_id text unique,
  caller_name text,
  transcript text,
  audio_url text,
  recording_url text,
  duration_seconds integer check (duration_seconds >= 0),
  outcome text check (outcome in ('booked', 'not_booked', 'voicemail')),
  status text,
  started_at timestamptz,
  date timestamptz,
  created_at timestamptz not null default now()
);

-- Indexes for calls
create index if not exists idx_calls_customer_id on public.calls(customer_id);
create index if not exists idx_calls_phone_number on public.calls(phone_number);
create index if not exists idx_calls_vapi_id on public.calls(vapi_call_id) where vapi_call_id is not null;
create index if not exists idx_calls_provider_call_id on public.calls(provider_call_id) where provider_call_id is not null;
create index if not exists idx_calls_created_at on public.calls(created_at desc);

comment on table public.calls is 'VAPI call records and transcripts';

-- ============================================
-- TABLE: system_events
-- ============================================
create table if not exists public.system_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  source text not null check (
    source in ('vapi', 'openphone', 'stripe', 'telegram', 'cron', 'actions', 'system', 'ghl', 'housecall_pro', 'job_updates')
  ),
  message text not null,
  job_id integer references public.jobs(id) on delete cascade,
  customer_id integer references public.customers(id) on delete cascade,
  cleaner_id integer references public.cleaners(id) on delete cascade,
  phone_number text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Indexes for system_events
create index if not exists idx_events_created_at on public.system_events(created_at desc);
create index if not exists idx_events_job_id on public.system_events(job_id) where job_id is not null;
create index if not exists idx_events_customer_id on public.system_events(customer_id) where customer_id is not null;
create index if not exists idx_events_cleaner_id on public.system_events(cleaner_id) where cleaner_id is not null;
create index if not exists idx_events_event_type on public.system_events(event_type);
create index if not exists idx_events_source on public.system_events(source);
create index if not exists idx_events_phone_number on public.system_events(phone_number) where phone_number is not null;

comment on table public.system_events is 'Real-time activity feed for dashboard and debugging';

-- ============================================
-- TABLE: leads (GHL/Meta Ads)
-- ============================================
create table if not exists public.leads (
  id serial primary key,
  source_id text not null, -- GHL contact ID or other source ID
  ghl_location_id text,
  phone_number text not null,
  customer_id integer references public.customers(id) on delete set null,
  job_id integer references public.jobs(id) on delete set null,
  first_name text,
  last_name text,
  email text,
  source text,
  ad_campaign text,
  ad_set text,
  ad_name text,
  form_data jsonb,
  brand text,
  status text default 'new',
  last_customer_response_at timestamptz,
  last_outreach_at timestamptz,
  next_followup_at timestamptz,
  call_attempt_count integer default 0,
  sms_attempt_count integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leads_phone_number on public.leads(phone_number);
create index if not exists idx_leads_source_id on public.leads(source_id);
create index if not exists idx_leads_status on public.leads(status);
create index if not exists idx_leads_next_followup_at on public.leads(next_followup_at) where next_followup_at is not null;

-- ============================================
-- TABLE: followup_queue (GHL follow-ups)
-- ============================================
create table if not exists public.followup_queue (
  id serial primary key,
  lead_id integer references public.leads(id) on delete cascade,
  phone_number text not null,
  followup_type text not null,
  scheduled_at timestamptz not null,
  executed_at timestamptz,
  status text default 'pending' check (status in ('pending', 'executed', 'cancelled', 'failed')),
  result jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_followup_queue_lead_id on public.followup_queue(lead_id);
create index if not exists idx_followup_queue_pending on public.followup_queue(scheduled_at)
  where status = 'pending';
create index if not exists idx_followup_queue_phone on public.followup_queue(phone_number);

-- ============================================
-- TABLE: reminder_notifications
-- ============================================
create table if not exists public.reminder_notifications (
  id serial primary key,
  cleaner_assignment_id integer not null references public.cleaner_assignments(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('daily_8am', 'one_hour_before', 'job_start')),
  job_date date not null,
  job_time time,
  created_at timestamptz not null default now(),
  unique(cleaner_assignment_id, reminder_type, job_date)
);

create index if not exists idx_reminders_assignment_id on public.reminder_notifications(cleaner_assignment_id);
create index if not exists idx_reminders_date_type on public.reminder_notifications(job_date, reminder_type);

-- ============================================
-- TABLE: cleaner_blocked_dates (Optional)
-- ============================================
create table if not exists public.cleaner_blocked_dates (
  id serial primary key,
  cleaner_id integer not null references public.cleaners(id) on delete cascade,
  date date not null,
  reason text,
  created_at timestamptz not null default now(),
  unique(cleaner_id, date)
);

create index if not exists idx_blocked_dates_cleaner_date on public.cleaner_blocked_dates(cleaner_id, date);

-- ============================================
-- TABLE: messages (for dashboard display)
-- ============================================
create table if not exists public.messages (
  id serial primary key,
  customer_id integer references public.customers(id) on delete cascade,
  call_id integer references public.calls(id) on delete set null,
  phone_number text not null,
  openphone_id text,
  role text check (role in ('client', 'business', 'bot')),
  content text not null,
  timestamp timestamptz not null default now(),
  direction text check (direction in ('inbound', 'outbound')),
  message_type text,
  ai_generated boolean default false,
  brand text,
  source text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_customer_id on public.messages(customer_id);
create index if not exists idx_messages_phone_number on public.messages(phone_number);
create index if not exists idx_messages_timestamp on public.messages(timestamp desc);

-- ============================================
-- AUTOMATIC UPDATED_AT TRIGGERS
-- ============================================

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_customers_updated_at on public.customers;
create trigger set_customers_updated_at
  before update on public.customers
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_jobs_updated_at on public.jobs;
create trigger set_jobs_updated_at
  before update on public.jobs
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_teams_updated_at on public.teams;
create trigger set_teams_updated_at
  before update on public.teams
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_cleaners_updated_at on public.cleaners;
create trigger set_cleaners_updated_at
  before update on public.cleaners
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_assignments_updated_at on public.cleaner_assignments;
create trigger set_assignments_updated_at
  before update on public.cleaner_assignments
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_team_members_updated_at on public.team_members;
create trigger set_team_members_updated_at
  before update on public.team_members
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_leads_updated_at on public.leads;
create trigger set_leads_updated_at
  before update on public.leads
  for each row
  execute function public.set_updated_at();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

alter table public.customers enable row level security;
alter table public.jobs enable row level security;
alter table public.teams enable row level security;
alter table public.cleaners enable row level security;
alter table public.team_members enable row level security;
alter table public.cleaner_assignments enable row level security;
alter table public.calls enable row level security;
alter table public.system_events enable row level security;
alter table public.leads enable row level security;
alter table public.followup_queue enable row level security;
alter table public.reminder_notifications enable row level security;
alter table public.messages enable row level security;

-- Service role has full access (for backend API)
create policy "Service role full access" on public.customers
  for all using (auth.role() = 'service_role');

create policy "Service role full access" on public.jobs
  for all using (auth.role() = 'service_role');

create policy "Service role full access" on public.teams
  for all using (auth.role() = 'service_role');

create policy "Service role full access" on public.cleaners
  for all using (auth.role() = 'service_role');

create policy "Service role full access" on public.team_members
  for all using (auth.role() = 'service_role');

create policy "Service role full access" on public.cleaner_assignments
  for all using (auth.role() = 'service_role');

create policy "Service role full access" on public.calls
  for all using (auth.role() = 'service_role');

create policy "Service role full access" on public.system_events
  for all using (auth.role() = 'service_role');

create policy "Service role full access" on public.leads
  for all using (auth.role() = 'service_role');

create policy "Service role full access" on public.followup_queue
  for all using (auth.role() = 'service_role');

create policy "Service role full access" on public.reminder_notifications
  for all using (auth.role() = 'service_role');

create policy "Service role full access" on public.messages
  for all using (auth.role() = 'service_role');

-- Authenticated users can read (for dashboard)
create policy "Authenticated read" on public.customers
  for select using (auth.role() = 'authenticated');

create policy "Authenticated read" on public.jobs
  for select using (auth.role() = 'authenticated');

create policy "Authenticated read" on public.teams
  for select using (auth.role() = 'authenticated');

create policy "Authenticated read" on public.cleaners
  for select using (auth.role() = 'authenticated');

create policy "Authenticated read" on public.team_members
  for select using (auth.role() = 'authenticated');

create policy "Authenticated read" on public.cleaner_assignments
  for select using (auth.role() = 'authenticated');

create policy "Authenticated read" on public.calls
  for select using (auth.role() = 'authenticated');

create policy "Authenticated read" on public.system_events
  for select using (auth.role() = 'authenticated');

-- ============================================
-- ENABLE REALTIME
-- ============================================

alter publication supabase_realtime add table public.system_events;
alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.cleaner_assignments;

-- ============================================
-- GRANTS & DEFAULT PRIVILEGES (IMPORTANT FOR SUPABASE API)
-- ============================================

-- Allow API roles to use schema
grant usage on schema public to anon, authenticated, service_role;

-- Allow API roles to read all current tables
grant select on all tables in schema public to anon, authenticated, service_role;

-- Allow API roles to use sequences for serial IDs
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- Ensure NEW tables/sequences also get readable by default
alter default privileges in schema public
  grant select on tables to anon, authenticated, service_role;

alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

commit;
