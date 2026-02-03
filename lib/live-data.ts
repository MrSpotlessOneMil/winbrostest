import { Pool } from 'pg';
import { getSupabaseClient } from './supabase';

// Dashboard data types (previously from google-sheets.ts)
export interface DashboardJob {
  id: string;
  title: string;
  date: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  client: string;
  cleaningTeam: string[];
  callDurationSeconds: number;
  booked: boolean;
  paid: boolean;
  price: number;
  phoneNumber: string;
  email?: string;
  hours?: number;
  createdAt?: string;
  scheduledAt?: string;
}

export interface Message {
  role: 'client' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface DashboardCall {
  id: string;
  phoneNumber: string;
  callerName: string;
  date: string;
  durationSeconds: number;
  audioUrl?: string;
  transcript?: string;
  outcome?: 'booked' | 'not_booked' | 'voicemail';
}

export interface CallerProfile {
  phoneNumber: string;
  callerName: string;
  totalCalls: number;
  messages: Message[];
  lastCallDate: string;
  calls?: DashboardCall[];
}

export interface DashboardData {
  jobsBooked: number;
  quotesSent: number;
  cleanersScheduled: number;
  callsAnswered: number;
  jobs: DashboardJob[];
  calls: DashboardCall[];
  profiles: CallerProfile[];
  isLiveData: boolean;
}

// Connection pool - only created if DATABASE_URL exists
let pool: Pool | null = null;

function resolveCustomerName(customer: any): string {
  if (!customer) {
    return 'Unknown';
  }
  if (typeof customer.name === 'string' && customer.name.trim()) {
    return customer.name;
  }
  const first = typeof customer.first_name === 'string' ? customer.first_name.trim() : '';
  const last = typeof customer.last_name === 'string' ? customer.last_name.trim() : '';
  const combined = `${first} ${last}`.trim();
  return combined || 'Unknown';
}

function normalizeStatus(value: unknown): DashboardJob['status'] {
  const raw = typeof value === 'string' ? value.toLowerCase() : '';
  if (raw === 'completed') {
    return 'completed';
  }
  if (raw === 'cancelled') {
    return 'cancelled';
  }
  return 'scheduled';
}

function normalizeCleaningTeam(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

async function getSupabaseDashboardData(brand?: string): Promise<DashboardData | null> {
  let client;
  try {
    client = getSupabaseClient();
  } catch (error) {
    return null;
  }

  try {
    let jobsQuery = client
      .from('jobs')
      .select('*, customers (*)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (brand) jobsQuery = jobsQuery.or(`brand.eq.${brand},brand.is.null`);

    const jobsResult = await jobsQuery;

    if (jobsResult.error) {
      console.error('Supabase jobs fetch error:', jobsResult.error);
      return null;
    }

    let callsQuery = client
      .from('calls')
      .select('*, customers (*)')
      .order('date', { ascending: false })
      .limit(500);
    if (brand) callsQuery = callsQuery.or(`brand.eq.${brand},brand.is.null`);

    const callsResult = await callsQuery;

    if (callsResult.error) {
      console.warn('Supabase calls fetch error:', callsResult.error);
    }

    let messagesQuery = client
      .from('messages')
      .select('*, customers (*)')
      .order('timestamp', { ascending: true })
      .limit(2000);
    if (brand) messagesQuery = messagesQuery.or(`brand.eq.${brand},brand.is.null`);

    const messagesResult = await messagesQuery;

    if (messagesResult.error) {
      console.warn('Supabase messages fetch error:', messagesResult.error);
    }

    const jobs: DashboardJob[] = (jobsResult.data || []).map((row: any) => {
      const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
      const dateValue = row.scheduled_at ?? row.date ?? row.created_at;
      const dateString = dateValue ? String(dateValue) : new Date().toISOString();
      const createdAt = row.created_at ? String(row.created_at) : undefined;
      const scheduledAt = row.scheduled_at ? String(row.scheduled_at) : undefined;
      const phoneNumber =
        customer?.phone_number || row.phone_number || row.from_number || '';

      return {
        id: String(row.id),
        title: row.title || row.service_type || 'Cleaning',
        date: dateString,
        status: normalizeStatus(row.status),
        client: resolveCustomerName(customer),
        cleaningTeam: normalizeCleaningTeam(row.cleaning_team),
        callDurationSeconds: 0,
        booked: Boolean(row.booked),
        paid: Boolean(row.paid),
        price: row.price ? Number(row.price) : 0,
        phoneNumber,
        email: customer?.email || undefined,
        hours: row.hours ? Number(row.hours) : undefined,
        createdAt,
        scheduledAt
      };
    });

    const calls: DashboardCall[] = (callsResult.data || []).map((row: any) => {
      const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
      const phoneNumber =
        customer?.phone_number || row.phone_number || row.from_number || '';
      const callerName = row.caller_name || resolveCustomerName(customer);
      const dateValue = row.date || row.started_at || row.created_at;

      return {
        id: String(row.id),
        phoneNumber,
        callerName,
        date: dateValue ? String(dateValue) : new Date().toISOString(),
        durationSeconds: row.duration_seconds ? Number(row.duration_seconds) : 0,
        audioUrl: row.audio_url || row.recording_url || undefined,
        transcript: row.transcript || undefined,
        outcome: row.outcome || undefined
      };
    });

    // Fetch all customers directly from the customers table
    let customersQuery = client
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (brand) customersQuery = customersQuery.or(`brand.eq.${brand},brand.is.null`);

    const customersResult = await customersQuery;

    const profileMap = new Map<string, CallerProfile>();

    // Build initial profiles from the customers table
    for (const row of customersResult.data || []) {
      const phoneNumber = row.phone_number || '';
      if (phoneNumber && !profileMap.has(phoneNumber)) {
        profileMap.set(phoneNumber, {
          phoneNumber,
          callerName: resolveCustomerName(row),
          totalCalls: 0,
          messages: [],
          lastCallDate: row.created_at || new Date().toISOString(),
          calls: []
        });
      }
    }

    // Enrich with call data
    for (const call of calls) {
      if (!profileMap.has(call.phoneNumber)) {
        profileMap.set(call.phoneNumber, {
          phoneNumber: call.phoneNumber,
          callerName: call.callerName,
          totalCalls: 0,
          messages: [],
          lastCallDate: call.date,
          calls: []
        });
      }
      const profile = profileMap.get(call.phoneNumber)!;
      profile.totalCalls++;
      profile.calls!.push(call);
      if (new Date(call.date) > new Date(profile.lastCallDate)) {
        profile.lastCallDate = call.date;
      }
    }

    // Enrich with message data
    for (const row of messagesResult.data || []) {
      const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
      const phoneNumber =
        customer?.phone_number || row.phone_number || row.from_number || '';
      let profile = profileMap.get(phoneNumber);
      if (!profile && phoneNumber) {
        profileMap.set(phoneNumber, {
          phoneNumber,
          callerName: resolveCustomerName(customer),
          totalCalls: 0,
          messages: [],
          lastCallDate: row.timestamp || new Date().toISOString(),
          calls: []
        });
        profile = profileMap.get(phoneNumber)!;
      }
      if (profile) {
        const role =
          row.role ||
          (row.direction === 'inbound' ? 'client' : 'business') ||
          'client';
        profile.messages.push({
          role,
          content: row.content || '',
          timestamp: row.timestamp ? String(row.timestamp) : String(row.created_at || new Date().toISOString())
        });
      }
    }

    const profiles = Array.from(profileMap.values());

    const jobsBooked = jobs.filter((job) => job.booked).length;
    const callsAnswered = calls.length;

    return {
      jobsBooked,
      quotesSent: jobs.filter((job) => job.booked).length,
      cleanersScheduled: jobs.filter((job) => job.paid).length,
      callsAnswered,
      jobs,
      calls,
      profiles,
      isLiveData: true
    };
  } catch (error) {
    console.error('Supabase live data fetch error:', error);
    return null;
  }
}

function getPool(): Pool | null {
  console.log('🔍 [DEBUG] getPool called');
  console.log('🔍 [DEBUG] DATABASE_URL exists:', !!process.env.DATABASE_URL);
  console.log('🔍 [DEBUG] NODE_ENV:', process.env.NODE_ENV);

  if (!process.env.DATABASE_URL) {
    console.log('❌ [DEBUG] No DATABASE_URL found, returning null');
    return null;
  }

  if (!pool) {
    console.log('✅ [DEBUG] Creating new connection pool');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    console.log('✅ [DEBUG] Pool created');
  } else {
    console.log('✅ [DEBUG] Reusing existing pool');
  }

  return pool;
}

export async function getLiveDashboardData(brand?: string): Promise<DashboardData | null> {
  console.log('🚀 [DEBUG] getLiveDashboardData called, brand:', brand || 'all');
  const supabaseData = await getSupabaseDashboardData(brand);
  if (supabaseData) {
    console.log('✅ [DEBUG] Loaded dashboard data from Supabase');
    return supabaseData;
  }

  const db = getPool();
  if (!db) {
    console.log('❌ [DEBUG] No pool available, returning null');
    return null;
  }

  try {
    console.log('📊 [DEBUG] Querying jobs table...');
    // Fetch jobs with customer info
    const jobsResult = await db.query(`
      SELECT j.*, c.phone_number, c.name as client_name, c.email as client_email
      FROM jobs j
      JOIN customers c ON j.customer_id = c.id
      ORDER BY j.created_at DESC
    `);
    console.log(`✅ [DEBUG] Found ${jobsResult.rows.length} jobs`);

    // Fetch calls with audio URLs
    const callsResult = await db.query(`
      SELECT cl.*, c.phone_number, c.name as caller_name
      FROM calls cl
      JOIN customers c ON cl.customer_id = c.id
      ORDER BY cl.date DESC
    `);

    // Fetch messages grouped by customer
    const messagesResult = await db.query(`
      SELECT m.*, c.phone_number, c.name as caller_name
      FROM messages m
      JOIN customers c ON m.customer_id = c.id
      ORDER BY m.timestamp ASC
    `);

    // Transform jobs to app format
    const jobs: DashboardJob[] = jobsResult.rows.map(row => {
      const dateValue = row.scheduled_at ?? row.date ?? row.created_at;
      const dateString = dateValue instanceof Date ? dateValue.toISOString() : String(dateValue);
      const createdValue = row.created_at;
      const createdAt = createdValue instanceof Date ? createdValue.toISOString() : createdValue ? String(createdValue) : undefined;
      const scheduledValue = row.scheduled_at;
      const scheduledAt = scheduledValue instanceof Date ? scheduledValue.toISOString() : scheduledValue ? String(scheduledValue) : undefined;

      return {
        id: row.id.toString(),
        title: row.title,
        date: dateString,
        status: row.status,
        client: row.client_name,
        cleaningTeam: row.cleaning_team || [],
        callDurationSeconds: 0,
        booked: row.booked,
        paid: row.paid,
        price: parseFloat(row.price) || 0,
        phoneNumber: row.phone_number,
        email: row.client_email || undefined,
        hours: row.hours ? parseFloat(row.hours) : undefined,
        createdAt,
        scheduledAt
      };
    });

    // Transform calls to app format
    const calls: DashboardCall[] = callsResult.rows.map(row => ({
      id: row.id.toString(),
      phoneNumber: row.phone_number,
      callerName: row.caller_name,
      date: row.date,
      durationSeconds: row.duration_seconds || 0,
      audioUrl: row.audio_url,
      transcript: row.transcript,
      outcome: row.outcome
    }));

    // Build caller profiles from calls and messages
    const profileMap = new Map<string, CallerProfile>();

    for (const call of calls) {
      if (!profileMap.has(call.phoneNumber)) {
        profileMap.set(call.phoneNumber, {
          phoneNumber: call.phoneNumber,
          callerName: call.callerName,
          totalCalls: 0,
          messages: [],
          lastCallDate: call.date,
          calls: []
        });
      }
      const profile = profileMap.get(call.phoneNumber)!;
      profile.totalCalls++;
      profile.calls!.push(call);
      if (new Date(call.date) > new Date(profile.lastCallDate)) {
        profile.lastCallDate = call.date;
      }
    }

    // Add messages to profiles
    for (const msg of messagesResult.rows) {
      const profile = profileMap.get(msg.phone_number);
      if (profile) {
        profile.messages.push({
          role: msg.role as 'client' | 'assistant' | 'system',
          content: msg.content,
          timestamp: msg.timestamp
        });
      }
    }

    const profiles = Array.from(profileMap.values());

    // Calculate metrics (never show negatives)
    const jobsBooked = jobs.filter(j => j.booked).length;
    const callsAnswered = calls.length;

    console.log('✅ [DEBUG] Successfully fetched live data:');
    console.log(`   - Jobs: ${jobs.length} (${jobsBooked} booked)`);
    console.log(`   - Calls: ${calls.length}`);
    console.log(`   - Profiles: ${profiles.length}`);

    return {
      jobsBooked,
      quotesSent: jobs.filter(j => j.booked).length,
      cleanersScheduled: jobs.filter(j => j.paid).length,
      callsAnswered,
      jobs,
      calls,
      profiles,
      isLiveData: true
    };
  } catch (error) {
    console.error('❌ [DEBUG] Live data fetch error:', error);
    if (error instanceof Error) {
      console.error('❌ [DEBUG] Error name:', error.name);
      console.error('❌ [DEBUG] Error message:', error.message);
      console.error('❌ [DEBUG] Error stack:', error.stack);
    }
    return null;
  }
}

export async function getLiveSettings(): Promise<{ spreadsheetId: string; hourlyRate: number; costPerJob: number } | null> {
  const db = getPool();
  if (!db) {
    return null;
  }

  try {
    const result = await db.query('SELECT * FROM settings LIMIT 1');
    if (result.rows[0]) {
      return {
        spreadsheetId: result.rows[0].spreadsheet_id || '',
        hourlyRate: parseFloat(result.rows[0].hourly_rate) || 25,
        costPerJob: parseFloat(result.rows[0].cost_per_job) || 50
      };
    }
    return null;
  } catch (error) {
    console.error('Settings fetch error:', error);
    return null;
  }
}

export async function saveLiveSettings(settings: { spreadsheetId: string; hourlyRate: number; costPerJob: number }): Promise<boolean> {
  const db = getPool();
  if (!db) {
    return false;
  }

  try {
    await db.query(`
      INSERT INTO settings (id, spreadsheet_id, hourly_rate, cost_per_job)
      VALUES (1, $1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET
        spreadsheet_id = $1,
        hourly_rate = $2,
        cost_per_job = $3,
        updated_at = NOW()
    `, [settings.spreadsheetId, settings.hourlyRate, settings.costPerJob]);
    return true;
  } catch (error) {
    console.error('Settings save error:', error);
    return false;
  }
}

export { pool };
