/**
 * Cedar Rapids test fixtures — tenant config, seed data, and a WinBros
 * tenant for isolation tests.
 */

import type { Tenant, WorkflowConfig } from '@/lib/tenant'

// ─── Cedar Rapids Tenant ───────────────────────────────────────────────

export const CEDAR_RAPIDS_ID = '999a1379-31f5-41db-a59b-bd1f3bd1b2c9'

export const CEDAR_RAPIDS_WORKFLOW: WorkflowConfig = {
  use_housecall_pro: false,
  use_vapi_inbound: true,
  use_vapi_outbound: false,
  use_ghl: false,
  use_stripe: true,
  use_wave: false,
  lead_followup_enabled: true,
  lead_followup_stages: 5,
  skip_calls_for_sms_leads: false,
  followup_delays_minutes: [5, 30, 120, 480, 1440],
  post_cleaning_followup_enabled: true,
  post_cleaning_delay_hours: 2,
  monthly_followup_enabled: true,
  monthly_followup_days: 30,
  monthly_followup_discount: '15%',
  cleaner_assignment_auto: true,
  require_deposit: true,
  deposit_percentage: 50,
  use_route_optimization: false,
  sms_auto_response_enabled: true,
  use_hcp_mirror: false,
  use_rainy_day_reschedule: false,
  use_team_routing: false,
  use_cleaner_dispatch: true,
  use_review_request: true,
  use_retargeting: true,
  use_payment_collection: true,
}

export const CEDAR_RAPIDS_TENANT: Tenant = {
  id: CEDAR_RAPIDS_ID,
  name: 'Hook and Ladder Exteriors',
  slug: 'cedar-rapids',
  email: 'admin@hookandladderexteriors.com',
  password_hash: null,
  business_name: 'Hook and Ladder Exteriors',
  business_name_short: 'H&L',
  service_area: 'Cedar Rapids, IA',
  sdr_persona: 'Mary',
  service_description: 'house cleaning',
  timezone: 'America/Chicago',
  openphone_api_key: 'op_test_cedar_key',
  openphone_phone_id: 'PN_cedar_test',
  openphone_phone_number: '+13195551234',
  vapi_api_key: 'vapi_test_cedar_key',
  vapi_assistant_id: 'vapi_asst_cedar',
  vapi_outbound_assistant_id: null,
  vapi_phone_id: null,
  housecall_pro_api_key: null,
  housecall_pro_company_id: null,
  housecall_pro_webhook_secret: null,
  stripe_secret_key: 'sk_test_cedar_xxx',
  stripe_webhook_secret: 'whsec_test_cedar',
  ghl_location_id: null,
  ghl_webhook_secret: null,
  telegram_bot_token: 'bot123456:CEDAR_TEST_TOKEN',
  owner_telegram_chat_id: '9999',
  wave_api_token: null,
  wave_business_id: null,
  wave_income_account_id: null,
  workflow_config: CEDAR_RAPIDS_WORKFLOW,
  owner_phone: '+13195559999',
  owner_email: 'owner@hookandladderexteriors.com',
  google_review_link: 'https://g.page/cedar-rapids-test-review',
  website_url: 'https://hookandladderexteriors.com',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
}

// ─── WinBros Tenant (for isolation tests) ──────────────────────────────

export const WINBROS_ID = 'e954fbd6-b3e1-4271-88b0-341c9df56beb'

export const WINBROS_TENANT: Tenant = {
  id: WINBROS_ID,
  name: 'WinBros Window Cleaning',
  slug: 'winbros',
  email: 'admin@winbrosservices.com',
  password_hash: null,
  business_name: 'WinBros Services',
  business_name_short: 'WinBros',
  service_area: 'Chicagoland, IL',
  sdr_persona: 'Lisa',
  service_description: 'window cleaning',
  timezone: 'America/Chicago',
  openphone_api_key: 'op_test_winbros_key',
  openphone_phone_id: 'PN_winbros_test',
  openphone_phone_number: '+16305551234',
  vapi_api_key: 'vapi_test_winbros_key',
  vapi_assistant_id: 'vapi_asst_winbros',
  vapi_outbound_assistant_id: 'vapi_ob_winbros',
  vapi_phone_id: null,
  housecall_pro_api_key: 'hcp_winbros_key',
  housecall_pro_company_id: 'hcp_winbros_co',
  housecall_pro_webhook_secret: 'hcp_secret',
  stripe_secret_key: 'sk_test_winbros_xxx',
  stripe_webhook_secret: 'whsec_test_winbros',
  ghl_location_id: null,
  ghl_webhook_secret: null,
  telegram_bot_token: 'bot999:WINBROS_TEST_TOKEN',
  owner_telegram_chat_id: '8888',
  wave_api_token: null,
  wave_business_id: null,
  wave_income_account_id: null,
  workflow_config: {
    ...CEDAR_RAPIDS_WORKFLOW,
    use_housecall_pro: true,
    use_hcp_mirror: true,
    use_rainy_day_reschedule: true,
    use_team_routing: true,
    use_route_optimization: true,
  },
  owner_phone: '+16305559999',
  owner_email: 'owner@winbrosservices.com',
  google_review_link: 'https://g.page/winbros-test-review',
  website_url: 'https://winbrosservices.com',
  active: true,
  created_at: '2025-06-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
}

// ─── Seed Data Factory ─────────────────────────────────────────────────

export function makeSeedData() {
  return {
    tenants: [CEDAR_RAPIDS_TENANT, WINBROS_TENANT],

    customers: [
      {
        id: '100',
        tenant_id: CEDAR_RAPIDS_ID,
        phone_number: '+13195550001',
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
        address: '456 Oak Ave, Cedar Rapids, IA 52402',
        bedrooms: 2,
        bathrooms: 1,
        created_at: '2026-02-01T00:00:00Z',
      },
      {
        id: '101',
        tenant_id: CEDAR_RAPIDS_ID,
        phone_number: '+13195550002',
        first_name: 'Bob',
        last_name: 'Smith',
        email: null,
        address: null,
        created_at: '2026-02-10T00:00:00Z',
      },
      // WinBros customer with same phone (for isolation test)
      {
        id: '500',
        tenant_id: WINBROS_ID,
        phone_number: '+13195550001',
        first_name: 'Jane',
        last_name: 'Doe-WinBros',
        email: 'jane-wb@example.com',
        created_at: '2026-02-01T00:00:00Z',
      },
    ],

    cleaners: [
      {
        id: '200',
        tenant_id: CEDAR_RAPIDS_ID,
        name: 'Alice Cleaner',
        phone: '+13195550010',
        telegram_id: '5001',
        active: true,
        is_team_lead: true,
        home_lat: 41.97,
        home_lng: -91.66,
        employee_type: 'technician',
      },
      {
        id: '201',
        tenant_id: CEDAR_RAPIDS_ID,
        name: 'Bob Cleaner',
        phone: '+13195550011',
        telegram_id: '5002',
        active: true,
        is_team_lead: false,
        home_lat: 41.98,
        home_lng: -91.67,
        employee_type: 'technician',
      },
      {
        id: '202',
        tenant_id: CEDAR_RAPIDS_ID,
        name: 'Charlie Cleaner',
        phone: '+13195550012',
        telegram_id: '5003',
        active: true,
        is_team_lead: false,
        home_lat: 41.99,
        home_lng: -91.68,
        employee_type: 'technician',
      },
      // WinBros cleaner (isolation test)
      {
        id: '600',
        tenant_id: WINBROS_ID,
        name: 'WinBros Tech',
        phone: '+16305550010',
        telegram_id: '6001',
        active: true,
        is_team_lead: true,
        employee_type: 'technician',
      },
    ],

    teams: [
      { id: 1, tenant_id: CEDAR_RAPIDS_ID, name: 'Crew 1', active: true },
      { id: 2, tenant_id: WINBROS_ID, name: 'WinBros Crew', active: true },
    ],

    team_members: [
      { tenant_id: CEDAR_RAPIDS_ID, team_id: 1, cleaner_id: '200', role: 'lead', is_active: true },
      { tenant_id: CEDAR_RAPIDS_ID, team_id: 1, cleaner_id: '201', role: 'member', is_active: true },
      { tenant_id: CEDAR_RAPIDS_ID, team_id: 1, cleaner_id: '202', role: 'member', is_active: true },
      { tenant_id: WINBROS_ID, team_id: 2, cleaner_id: '600', role: 'lead', is_active: true },
    ],

    leads: [] as any[],
    jobs: [] as any[],
    calls: [] as any[],
    messages: [] as any[],
    cleaner_assignments: [] as any[],
    system_events: [] as any[],
    scheduled_tasks: [] as any[],
    upsells: [] as any[],
    tips: [] as any[],
    reminders_sent: [] as any[],

    pricing_tiers: [
      { id: '300', tenant_id: CEDAR_RAPIDS_ID, service_type: 'standard', bedrooms: 1, bathrooms: 1, price: 200, deep_clean_price: 225 },
      { id: '301', tenant_id: CEDAR_RAPIDS_ID, service_type: 'standard', bedrooms: 2, bathrooms: 1, price: 250, deep_clean_price: 300 },
      { id: '302', tenant_id: CEDAR_RAPIDS_ID, service_type: 'standard', bedrooms: 3, bathrooms: 2, price: 375, deep_clean_price: 475 },
    ],
  }
}

// ─── Helper: make a booked job for Cedar Rapids ────────────────────────

export function makeBookedJob(overrides: Record<string, any> = {}) {
  return {
    id: 'job-cr-001',
    tenant_id: CEDAR_RAPIDS_ID,
    customer_id: '100',
    phone_number: '+13195550001',
    service_type: 'standard',
    date: '2026-03-01',
    scheduled_at: '10:00',
    address: '456 Oak Ave, Cedar Rapids, IA 52402',
    bedrooms: 2,
    bathrooms: 1,
    status: 'scheduled',
    booked: true,
    paid: false,
    payment_status: 'pending',
    price: 250,
    team_id: 1,
    job_type: 'cleaning',
    notes: null,
    created_at: '2026-02-20T10:00:00Z',
    ...overrides,
  }
}

export function makeCompletedJob(overrides: Record<string, any> = {}) {
  return makeBookedJob({
    id: 'job-cr-done',
    status: 'completed',
    paid: true,
    payment_status: 'fully_paid',
    completed_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
    followup_sent_at: null,
    ...overrides,
  })
}
