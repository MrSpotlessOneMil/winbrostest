/**
 * Cedar Rapids — removed-cleaner guards (integration).
 *
 * Exercises the ACTUAL app/lib copies (the code that runs in prod) for the two
 * backend fixes reported by Caleb's team:
 *   1. Reminder crons must never text a removed/deactivated cleaner.
 *      → getJobsStartingSoon() must drop cleaners with active === false.
 *   2. notify_cleaners=false (manual assignment mode) must suppress auto-assignment.
 *      → triggerCleanerAssignment() must short-circuit without creating an
 *        assignment or sending SMS.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockSupabaseClient, MockSupabaseClient } from '../../../tests/mocks/supabase-mock'

// ── Mock the Supabase driver so all lib data access hits our in-memory store ──
let mockClient: MockSupabaseClient
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => mockClient.from(t),
    rpc: (fn: string, p: any) => mockClient.rpc(fn, p),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      admin: { generateLink: vi.fn().mockResolvedValue({ data: null, error: null }) },
    },
  }),
}))

// ── Mock OpenPhone so we can assert no SMS is sent. `@/lib/openphone` resolves
//    to app/lib/openphone — the SAME module the lib's relative `./openphone`
//    import resolves to — so this intercepts both. ──
const mockSendSMS = vi.fn().mockResolvedValue({ success: true, messageId: 'mock-1' })
vi.mock('@/lib/openphone', () => ({
  sendSMS: (...a: any[]) => mockSendSMS(...a),
  normalizePhoneNumber: (p: string) => p,
  saveOutboundMessage: vi.fn().mockResolvedValue(undefined),
  validateOpenPhoneWebhook: vi.fn().mockResolvedValue(true),
  extractMessageFromOpenPhonePayload: vi.fn(),
  SMS_TEMPLATES: {},
}))

const TENANT_ID = 'cedar-test-tenant'

/** Today's date in Cedar Rapids' timezone (matches getJobsStartingSoon's logic). */
function todayInChicago(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

beforeEach(() => {
  mockSendSMS.mockClear()
})

describe('getJobsStartingSoon — never reminds a removed cleaner', () => {
  it('includes the active cleaner and excludes the deactivated (active=false) one', async () => {
    const today = todayInChicago()
    mockClient = createMockSupabaseClient({
      cleaners: [
        { id: '1', tenant_id: TENANT_ID, name: 'Active One', active: true, deleted_at: null, phone: '+15550000001' },
        { id: '2', tenant_id: TENANT_ID, name: 'Removed Two', active: false, deleted_at: null, phone: '+15550000002' },
      ],
      jobs: [
        { id: 'jA', tenant_id: TENANT_ID, date: today, scheduled_at: '10:00', status: 'scheduled', phone_number: '+15551111111' },
        { id: 'jB', tenant_id: TENANT_ID, date: today, scheduled_at: '10:00', status: 'scheduled', phone_number: '+15552222222' },
      ],
      cleaner_assignments: [
        { id: 'a1', job_id: 'jA', cleaner_id: '1', status: 'confirmed' },
        { id: 'a2', job_id: 'jB', cleaner_id: '2', status: 'confirmed' },
      ],
      customers: [],
    })

    const { getJobsStartingSoon } = await import('@/lib/supabase')
    // Wide window (±24h) so the result depends only on the active-cleaner guard.
    const results = await getJobsStartingSoon(-1440, 1440, 'America/Chicago')

    const cleanerIds = results.map(r => String(r.cleaner.id))
    expect(cleanerIds).toContain('1')      // active cleaner still reminded
    expect(cleanerIds).not.toContain('2')  // removed cleaner suppressed
    const jobIds = results.map(r => String(r.job.id))
    expect(jobIds).toContain('jA')
    expect(jobIds).not.toContain('jB')
  })
})

describe('triggerCleanerAssignment — notify_cleaners=false suppresses auto-assignment', () => {
  function seed(workflow_config: Record<string, any>) {
    mockClient = createMockSupabaseClient({
      tenants: [
        { id: TENANT_ID, slug: 'cedar-rapids', name: 'Cedar Rapids', active: true, timezone: 'America/Chicago', workflow_config },
      ],
      jobs: [
        { id: 'jG', tenant_id: TENANT_ID, date: todayInChicago(), scheduled_at: '10:00', status: 'scheduled', phone_number: '+15553333333' },
      ],
      cleaner_assignments: [],
      cleaners: [],
      customers: [],
    })
  }

  it('manual mode: returns success, creates NO assignment, sends NO SMS', async () => {
    seed({ notify_cleaners: false, assignment_mode: 'broadcast' })
    const { triggerCleanerAssignment } = await import('@/lib/cleaner-assignment')

    const res = await triggerCleanerAssignment('jG')

    expect(res.success).toBe(true)
    expect(mockClient.getInserts('cleaner_assignments')).toHaveLength(0)
    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('control: with notify_cleaners unset the gate does NOT fire (proceeds into assignment logic)', async () => {
    seed({ assignment_mode: 'broadcast' }) // no notify_cleaners key
    const { triggerCleanerAssignment } = await import('@/lib/cleaner-assignment')

    const res = await triggerCleanerAssignment('jG')

    // No cleaners seeded → broadcast path reaches "no available cleaners".
    // The point: it did NOT short-circuit at the manual-mode gate (which would
    // have returned success:true). Reaching the no-cleaners branch proves that.
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/no available cleaners/i)
  })
})
