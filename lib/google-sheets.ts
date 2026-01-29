import { getLiveDashboardData } from './live-data';

export interface Job {
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
  invoiceSent?: boolean;
  invoiceDate?: string;
  paymentDate?: string;
  reviewReceived?: boolean;
  reviewRating?: number;
  reviewText?: string;
}

export interface Message {
  role: 'client' | 'business' | 'bot';
  content: string;
  timestamp: string;
}

export interface Call {
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
  calls?: Call[];
}

export interface DashboardData {
  jobsBooked: number;
  quotesSent: number;
  cleanersScheduled: number;
  callsAnswered: number;
  jobs: Job[];
  calls: Call[];
  profiles: CallerProfile[];
  isLiveData: boolean;
}

async function fetchGoogleSheetsData(): Promise<DashboardData | null> {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    console.log('❌ No SPREADSHEET_ID found in environment variables');
    return null;
  }

  console.log('🔍 Attempting to fetch Google Sheets data...');
  console.log('📋 Spreadsheet ID:', spreadsheetId);
  console.log('📧 Service Account:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  console.log('🔑 Private Key exists:', !!process.env.GOOGLE_PRIVATE_KEY);

  try {
    const { google } = await import('googleapis');

    // Initialize Google Sheets API with service account
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    console.log('✅ Google Sheets API client initialized');

    // Fetch Customers sheet (where the actual booking data is)
    console.log('📥 Fetching Customers sheet data...');
    const jobsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Customers!A:Z',
    });

    const jobsRows = jobsResponse.data.values || [];
    console.log(`✅ Received ${jobsRows.length} rows from Jobs sheet`);

    if (jobsRows.length === 0) {
      console.log('❌ Jobs sheet is empty');
      return null;
    }

    const jobsHeaders = jobsRows[0] || [];
    const jobsData = jobsRows.slice(1);
    console.log('📊 Headers:', jobsHeaders.join(', '));

    // Helper to get column index safely
    const getCol = (headers: string[], name: string): number => {
      const idx = headers.findIndex(h => h?.toLowerCase().includes(name.toLowerCase()));
      return idx >= 0 ? idx : -1;
    };

    // Transform to Job[]
    const jobs: Job[] = jobsData
      .filter(row => row && row.length > 0)
      .map((row, index) => {
        const titleIdx = getCol(jobsHeaders, 'title');
        const dateIdx = getCol(jobsHeaders, 'date');
        const statusIdx = getCol(jobsHeaders, 'status');
        const clientIdx = getCol(jobsHeaders, 'customer name') >= 0
          ? getCol(jobsHeaders, 'customer name')
          : getCol(jobsHeaders, 'client');
        const teamIdx = getCol(jobsHeaders, 'cleaning team');
        const bookedIdx = getCol(jobsHeaders, 'booked');
        const paidIdx = getCol(jobsHeaders, 'paid');
        const priceIdx = getCol(jobsHeaders, 'price');
        const phoneIdx = getCol(jobsHeaders, 'phone');
        const emailIdx = getCol(jobsHeaders, 'email');

        return {
          id: `gsheet-${index + 1}`,
          title: (titleIdx >= 0 ? row[titleIdx] : '') || 'Cleaning',
          date: (dateIdx >= 0 ? row[dateIdx] : '') || new Date().toISOString().split('T')[0],
          status: (statusIdx >= 0 && row[statusIdx]?.toLowerCase() === 'completed')
            ? 'completed' as const
            : (statusIdx >= 0 && row[statusIdx]?.toLowerCase() === 'cancelled')
            ? 'cancelled' as const
            : 'scheduled' as const,
          client: (clientIdx >= 0 ? row[clientIdx] : '') || 'Unknown',
          cleaningTeam: (teamIdx >= 0 && row[teamIdx])
            ? row[teamIdx].split(',').map((s: string) => s.trim()).filter(Boolean)
            : [],
          booked: bookedIdx >= 0 ? row[bookedIdx]?.toUpperCase() === 'TRUE' : false,
          paid: paidIdx >= 0 ? row[paidIdx]?.toUpperCase() === 'TRUE' : false,
          price: priceIdx >= 0 ? (parseFloat(row[priceIdx]) || 0) : 0,
          phoneNumber: (phoneIdx >= 0 ? row[phoneIdx] : '') || '',
          email: emailIdx >= 0 ? row[emailIdx] : undefined,
          callDurationSeconds: 0,
        };
      });

    // Try to fetch Calls sheet if it exists
    let calls: Call[] = [];
    try {
      const callsResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Calls!A:Z',
      });

      const callsRows = callsResponse.data.values || [];
      if (callsRows.length > 1) {
        const callsHeaders = callsRows[0] || [];
        const callsData = callsRows.slice(1);

        calls = callsData
          .filter(row => row && row.length > 0)
          .map((row, index) => {
            const phoneIdx = getCol(callsHeaders, 'phone');
            const nameIdx = getCol(callsHeaders, 'caller name') >= 0
              ? getCol(callsHeaders, 'caller name')
              : getCol(callsHeaders, 'name');
            const dateIdx = getCol(callsHeaders, 'date');
            const durationIdx = getCol(callsHeaders, 'duration');
            const outcomeIdx = getCol(callsHeaders, 'outcome');

            return {
              id: `call-${index + 1}`,
              phoneNumber: (phoneIdx >= 0 ? row[phoneIdx] : '') || '',
              callerName: (nameIdx >= 0 ? row[nameIdx] : '') || 'Unknown',
              date: (dateIdx >= 0 ? row[dateIdx] : '') || new Date().toISOString(),
              durationSeconds: durationIdx >= 0 ? (parseInt(row[durationIdx]) || 0) : 0,
              outcome: (outcomeIdx >= 0 && row[outcomeIdx])
                ? (row[outcomeIdx].toLowerCase() === 'booked' ? 'booked' as const
                  : row[outcomeIdx].toLowerCase() === 'voicemail' ? 'voicemail' as const
                  : 'not_booked' as const)
                : undefined,
            };
          });
      }
    } catch (callsError) {
      console.log('No Calls sheet found, skipping');
    }

    // Build profiles from jobs and calls
    const profileMap = new Map<string, CallerProfile>();

    jobs.forEach(job => {
      if (job.phoneNumber) {
        const existing = profileMap.get(job.phoneNumber);
        if (existing) {
          existing.totalCalls += 1;
        } else {
          profileMap.set(job.phoneNumber, {
            phoneNumber: job.phoneNumber,
            callerName: job.client,
            totalCalls: 1,
            messages: [],
            lastCallDate: job.date,
          });
        }
      }
    });

    calls.forEach(call => {
      if (call.phoneNumber) {
        const existing = profileMap.get(call.phoneNumber);
        if (existing) {
          existing.totalCalls += 1;
          if (call.date > existing.lastCallDate) {
            existing.lastCallDate = call.date;
          }
        } else {
          profileMap.set(call.phoneNumber, {
            phoneNumber: call.phoneNumber,
            callerName: call.callerName,
            totalCalls: 1,
            messages: [],
            lastCallDate: call.date,
          });
        }
      }
    });

    const profiles = Array.from(profileMap.values());

    console.log(`📊 Fetched ${jobs.length} jobs from Google Sheets`);

    return {
      jobsBooked: jobs.filter(j => j.booked).length,
      quotesSent: jobs.length,
      cleanersScheduled: jobs.filter(j => j.paid && j.cleaningTeam.length > 0).length,
      callsAnswered: calls.length,
      jobs,
      calls,
      profiles,
      isLiveData: true,
    };
  } catch (error: any) {
    console.error('❌ Error fetching Google Sheets data:', error);
    console.error('❌ Error message:', error?.message);
    console.error('❌ Error code:', error?.code);
    console.error('❌ Error details:', JSON.stringify(error?.errors || error?.response?.data, null, 2));
    return null;
  }
}

type DemoOverlay = {
  jobs: Job[];
  calls: Call[];
  profiles: CallerProfile[];
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function withTime(date: Date, hours: number, minutes = 0) {
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTime(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:00`;
}

function buildDemoOverlay(): DemoOverlay {
  const now = new Date();
  const leadDay = addDays(now, 1);
  const quoteDay = addDays(now, 2);
  const scheduledDay = addDays(now, 3);
  const extraDayOne = addDays(now, 5);
  const extraDayTwo = addDays(now, 7);
  const completedDay = addDays(now, -2);

  const leadCreated = formatDateTime(withTime(addDays(now, -1), 10, 30));
  const quoteCreated = formatDateTime(withTime(addDays(now, -1), 14, 0));
  const scheduledCreated = formatDateTime(withTime(addDays(now, -2), 9, 15));
  const completedCreated = formatDateTime(withTime(addDays(now, -4), 16, 0));

  const scheduledStart = formatDateTime(withTime(scheduledDay, 9, 0));
  const extraStartOne = formatDateTime(withTime(extraDayOne, 13, 0));
  const extraStartTwo = formatDateTime(withTime(extraDayTwo, 10, 30));
  const quoteStart = formatDateTime(withTime(quoteDay, 11, 0));
  const completedStart = formatDateTime(withTime(completedDay, 9, 0));

  const jobs: Job[] = [
    {
      id: "demo-lead-1",
      title: "Initial Walkthrough - Silver Lake Loft",
      date: formatDate(leadDay),
      status: "scheduled",
      client: "Ava Brooks",
      cleaningTeam: [],
      callDurationSeconds: 0,
      booked: false,
      paid: false,
      price: 0,
      phoneNumber: "3105559011",
      createdAt: leadCreated
    },
    {
      id: "demo-quote-1",
      title: "Deep Clean Quote - Canyon Residence",
      date: formatDate(quoteDay),
      scheduledAt: quoteStart,
      status: "scheduled",
      client: "Mia Patel",
      cleaningTeam: [],
      callDurationSeconds: 0,
      booked: true,
      paid: false,
      price: 480,
      phoneNumber: "3105559012",
      email: "mia.patel@example.com",
      createdAt: quoteCreated
    },
    {
      id: "demo-scheduled-1",
      title: "Premium Condo Service",
      date: formatDate(scheduledDay),
      scheduledAt: scheduledStart,
      status: "scheduled",
      client: "Jordan Lee",
      cleaningTeam: ["Alex", "Rosa"],
      callDurationSeconds: 0,
      booked: true,
      paid: false,
      price: 650,
      phoneNumber: "3105559013",
      email: "jordan.lee@example.com",
      createdAt: scheduledCreated
    },
    {
      id: "demo-scheduled-2",
      title: "Weekly Maintenance - Loft A",
      date: formatDate(extraDayOne),
      scheduledAt: extraStartOne,
      status: "scheduled",
      client: "Jordan Lee",
      cleaningTeam: ["Alex", "Rosa"],
      callDurationSeconds: 0,
      booked: true,
      paid: false,
      price: 420,
      phoneNumber: "3105559013",
      email: "jordan.lee@example.com",
      createdAt: scheduledCreated
    },
    {
      id: "demo-scheduled-3",
      title: "Move-In Prep - Lakeview Unit",
      date: formatDate(extraDayTwo),
      scheduledAt: extraStartTwo,
      status: "scheduled",
      client: "Jordan Lee",
      cleaningTeam: ["Alex", "Rosa"],
      callDurationSeconds: 0,
      booked: true,
      paid: false,
      price: 520,
      phoneNumber: "3105559013",
      email: "jordan.lee@example.com",
      createdAt: scheduledCreated
    },
    {
      id: "demo-completed-1",
      title: "Move-Out Refresh - Brentwood",
      date: formatDate(completedDay),
      scheduledAt: completedStart,
      status: "completed",
      client: "Carlos Vega",
      cleaningTeam: ["Maria", "Luis"],
      callDurationSeconds: 0,
      booked: true,
      paid: true,
      price: 980,
      phoneNumber: "3105559014",
      email: "carlos.vega@example.com",
      hours: 2.5,
      createdAt: completedCreated
    }
  ];

  const profiles: CallerProfile[] = [
    {
      phoneNumber: "3105559011",
      callerName: "Ava Brooks",
      totalCalls: 0,
      messages: [],
      lastCallDate: leadCreated
    },
    {
      phoneNumber: "3105559012",
      callerName: "Mia Patel",
      totalCalls: 0,
      messages: [],
      lastCallDate: quoteCreated
    },
    {
      phoneNumber: "3105559013",
      callerName: "Jordan Lee",
      totalCalls: 0,
      messages: [],
      lastCallDate: scheduledStart
    },
    {
      phoneNumber: "3105559014",
      callerName: "Carlos Vega",
      totalCalls: 0,
      messages: [],
      lastCallDate: completedStart
    }
  ];

  return { jobs, calls: [], profiles };
}

function applyDemoOverlay(data: DashboardData): DashboardData {
  const overlay = buildDemoOverlay();
  const jobs = [...data.jobs, ...overlay.jobs];
  const calls = [...data.calls, ...overlay.calls];
  const profiles = [...data.profiles, ...overlay.profiles];
  const addedBooked = overlay.jobs.filter((job) => job.booked).length;
  const addedPaid = overlay.jobs.filter((job) => job.paid).length;

  return {
    ...data,
    jobs,
    calls,
    profiles,
    jobsBooked: data.jobsBooked + addedBooked,
    quotesSent: data.quotesSent + overlay.jobs.length,
    cleanersScheduled: data.cleanersScheduled + addedPaid,
    callsAnswered: data.callsAnswered + overlay.calls.length
  };
}

export async function getDashboardData(brand?: string): Promise<DashboardData> {
  // 1. Try Supabase first
  const liveData = await getLiveDashboardData(brand);
  if (liveData) {
    return liveData;
  }

  // 2. Try Google Sheets
  const sheetsData = await fetchGoogleSheetsData();
  if (sheetsData) {
    return sheetsData;
  }

  // 3. Fallback to mock data - BIG NUMBERS
  const jobs: Job[] = [
    // December 2025 - Heavy month
    {
      id: 'j1',
      title: 'Executive Home Deep Clean',
      date: '2025-12-02',
      status: 'completed',
      client: 'Robert Chen',
      cleaningTeam: ['Maria', 'Luis', 'Sofia'],
      callDurationSeconds: 420,
      booked: true,
      paid: true,
      price: 2850,
      phoneNumber: '3105551234',
      invoiceSent: true,
      invoiceDate: '2025-12-02',
      paymentDate: '2025-12-03',
      reviewReceived: true,
      reviewRating: 5,
      reviewText: 'Absolutely phenomenal service. Maria and her team transformed our home. Will definitely be using again!'
    },
    {
      id: 'j2',
      title: 'Luxury Condo Turnover',
      date: '2025-12-05',
      status: 'completed',
      client: 'Sarah Kim',
      cleaningTeam: ['Alex', 'Maria'],
      callDurationSeconds: 300,
      booked: true,
      paid: true,
      price: 1650,
      phoneNumber: '4245559876',
      invoiceSent: true,
      invoiceDate: '2025-12-05',
      paymentDate: '2025-12-05',
      reviewReceived: true,
      reviewRating: 5,
      reviewText: 'Perfect timing and impeccable attention to detail. My guests were impressed!'
    },
    {
      id: 'j3',
      title: 'Commercial Office Suite',
      date: '2025-12-08',
      status: 'completed',
      client: 'Westfield Properties',
      cleaningTeam: ['Maria', 'Luis', 'Alex', 'Rosa'],
      callDurationSeconds: 540,
      booked: true,
      paid: true,
      price: 4200,
      phoneNumber: '8185552233',
      invoiceSent: true,
      invoiceDate: '2025-12-08',
      paymentDate: '2025-12-10',
      reviewReceived: true,
      reviewRating: 5,
      reviewText: 'Professional team, excellent communication. Our tenants are thrilled with the space.'
    },
    {
      id: 'j4',
      title: 'Post-Construction Cleanup',
      date: '2025-12-10',
      status: 'completed',
      client: 'Harbor Development',
      cleaningTeam: ['Luis', 'Carlos', 'Miguel'],
      callDurationSeconds: 380,
      booked: true,
      paid: true,
      price: 3750,
      phoneNumber: '3104447890',
      invoiceSent: true,
      invoiceDate: '2025-12-10',
      paymentDate: '2025-12-12',
      reviewReceived: true,
      reviewRating: 5,
      reviewText: 'They handled the post-construction mess like pros. Property was move-in ready!'
    },
    {
      id: 'j5',
      title: 'Estate Move-Out Deep Clean',
      date: '2025-12-12',
      status: 'completed',
      client: 'Jennifer Walsh',
      cleaningTeam: ['Maria', 'Sofia', 'Elena'],
      callDurationSeconds: 290,
      booked: true,
      paid: true,
      price: 2200,
      phoneNumber: '4248881234',
      invoiceSent: true,
      invoiceDate: '2025-12-12',
      paymentDate: '2025-12-13',
      reviewReceived: true,
      reviewRating: 5,
      reviewText: 'Got my full security deposit back thanks to them. Worth every penny!'
    },
    {
      id: 'j6',
      title: 'Holiday Party Prep - Mansion',
      date: '2025-12-15',
      status: 'completed',
      client: 'The Morrison Family',
      cleaningTeam: ['Maria', 'Luis', 'Alex', 'Sofia', 'Rosa'],
      callDurationSeconds: 600,
      booked: true,
      paid: true,
      price: 5500,
      phoneNumber: '3109992345',
      invoiceSent: true,
      invoiceDate: '2025-12-15',
      paymentDate: '2025-12-15',
      reviewReceived: true,
      reviewRating: 5,
      reviewText: 'Our holiday party was a huge success. The house was absolutely spotless. Thank you!'
    },
    {
      id: 'j7',
      title: 'Airbnb Turnover Package',
      date: '2025-12-16',
      status: 'completed',
      client: 'Premium Stays LLC',
      cleaningTeam: ['Alex', 'Elena'],
      callDurationSeconds: 180,
      booked: true,
      paid: true,
      price: 890,
      phoneNumber: '8187773456',
      invoiceSent: true,
      invoiceDate: '2025-12-16',
      paymentDate: '2025-12-16',
      reviewReceived: true,
      reviewRating: 4,
      reviewText: 'Quick turnaround and great quality. Will use for all our properties.'
    },
    {
      id: 'j8',
      title: 'Restaurant Deep Clean',
      date: '2025-12-18',
      status: 'completed',
      client: 'Coastal Kitchen',
      cleaningTeam: ['Luis', 'Carlos', 'Miguel', 'Rosa'],
      callDurationSeconds: 420,
      booked: true,
      paid: true,
      price: 3200,
      phoneNumber: '3106664567',
      invoiceSent: true,
      invoiceDate: '2025-12-18',
      paymentDate: '2025-12-20',
      reviewReceived: true,
      reviewRating: 5,
      reviewText: 'Kitchen passed health inspection with flying colors. These guys know commercial cleaning!'
    },
    {
      id: 'j9',
      title: 'Medical Office Sanitization',
      date: '2025-12-19',
      status: 'completed',
      client: 'Pacific Health Partners',
      cleaningTeam: ['Maria', 'Sofia'],
      callDurationSeconds: 350,
      booked: true,
      paid: true,
      price: 1850,
      phoneNumber: '4245555678',
      invoiceSent: true,
      invoiceDate: '2025-12-19',
      paymentDate: '2025-12-21',
      reviewReceived: true,
      reviewRating: 5,
      reviewText: 'Medical-grade sanitization done right. Our patients feel safe and comfortable.'
    },
    {
      id: 'j10',
      title: 'Penthouse Suite Weekly',
      date: '2025-12-20',
      status: 'completed',
      client: 'David Sterling',
      cleaningTeam: ['Maria', 'Elena'],
      callDurationSeconds: 240,
      booked: true,
      paid: true,
      price: 1200,
      phoneNumber: '3108886789',
      invoiceSent: true,
      invoiceDate: '2025-12-20',
      paymentDate: '2025-12-20',
      reviewReceived: true,
      reviewRating: 5,
      reviewText: 'Consistent excellence every week. Maria is a gem!'
    },
    {
      id: 'j11',
      title: 'Holiday Event Venue Prep',
      date: '2025-12-21',
      status: 'completed',
      client: 'Grand Events LA',
      cleaningTeam: ['Luis', 'Carlos', 'Miguel', 'Alex', 'Rosa'],
      callDurationSeconds: 480,
      booked: true,
      paid: true,
      price: 4800,
      phoneNumber: '8184447890',
      invoiceSent: true,
      invoiceDate: '2025-12-21',
      paymentDate: '2025-12-22',
      reviewReceived: true,
      reviewRating: 5,
      reviewText: 'Event venue was pristine. Our clients were blown away!'
    },
    {
      id: 'j12',
      title: 'Luxury Auto Showroom',
      date: '2025-12-22',
      status: 'completed',
      client: 'Beverly Hills Motors',
      cleaningTeam: ['Alex', 'Carlos'],
      callDurationSeconds: 320,
      booked: true,
      paid: true,
      price: 2100,
      phoneNumber: '3102228901',
      invoiceSent: true,
      invoiceDate: '2025-12-22',
      paymentDate: '2025-12-23',
      reviewReceived: true,
      reviewRating: 5,
      reviewText: 'Showroom floor is gleaming. Customers notice the difference!'
    },
    {
      id: 'j13',
      title: 'New Year Prep - Estate',
      date: '2025-12-28',
      status: 'completed',
      client: 'The Goldstein Residence',
      cleaningTeam: ['Maria', 'Luis', 'Sofia', 'Elena'],
      callDurationSeconds: 520,
      booked: true,
      paid: true,
      price: 4500,
      phoneNumber: '4249990123',
      invoiceSent: true,
      invoiceDate: '2025-12-28',
      paymentDate: '2025-12-28',
      reviewReceived: true,
      reviewRating: 5,
      reviewText: 'Perfect prep for our New Year celebration. Highly recommend!'
    },
    {
      id: 'j14',
      title: 'Corporate HQ Weekend Clean',
      date: '2025-12-29',
      status: 'completed',
      client: 'TechFlow Industries',
      cleaningTeam: ['Luis', 'Carlos', 'Miguel'],
      callDurationSeconds: 400,
      booked: true,
      paid: true,
      price: 2800,
      phoneNumber: '8181112345',
      invoiceSent: true,
      invoiceDate: '2025-12-29',
      paymentDate: '2025-12-30',
      reviewReceived: true,
      reviewRating: 5,
      reviewText: 'Office is spotless for the new year. Great weekend service!'
    },
    {
      id: 'j15',
      title: 'VIP Residence Monthly',
      date: '2025-12-30',
      status: 'completed',
      client: 'Marcus Thompson',
      cleaningTeam: ['Maria', 'Sofia'],
      callDurationSeconds: 280,
      booked: true,
      paid: true,
      price: 1450,
      phoneNumber: '3105554321',
      invoiceSent: true,
      invoiceDate: '2025-12-30',
      paymentDate: '2025-12-30',
      reviewReceived: true,
      reviewRating: 5,
      reviewText: 'Another excellent monthly visit. Consistency is key!'
    },
    // January 2026
    {
      id: 'j16',
      title: 'New Year Deep Clean',
      date: '2026-01-02',
      status: 'completed',
      client: 'Robert Chen',
      cleaningTeam: ['Maria', 'Luis'],
      callDurationSeconds: 420,
      booked: true,
      paid: true,
      price: 2850,
      phoneNumber: '3105551234',
      invoiceSent: true,
      invoiceDate: '2026-01-02',
      paymentDate: '2026-01-02',
      reviewReceived: true,
      reviewRating: 5,
      reviewText: 'Great way to start the new year with a fresh clean home!'
    },
    {
      id: 'j17',
      title: 'Premium Condo Service',
      date: '2026-01-03',
      status: 'scheduled',
      client: 'Sarah Kim',
      cleaningTeam: ['Alex'],
      callDurationSeconds: 300,
      booked: true,
      paid: false,
      price: 1650,
      phoneNumber: '4245559876',
      invoiceSent: true,
      invoiceDate: '2026-01-02'
    },
    {
      id: 'j18',
      title: 'Executive Move-Out',
      date: '2026-01-05',
      status: 'scheduled',
      client: 'Mike Johnson',
      cleaningTeam: ['Maria', 'Sofia'],
      callDurationSeconds: 180,
      booked: true,
      paid: false,
      price: 2400,
      phoneNumber: '8185552233',
      invoiceSent: true,
      invoiceDate: '2026-01-03'
    },
    {
      id: 'j19',
      title: 'Boutique Hotel Contract',
      date: '2026-01-06',
      status: 'scheduled',
      client: 'The Avalon Hotel',
      cleaningTeam: ['Luis', 'Carlos', 'Elena'],
      callDurationSeconds: 450,
      booked: true,
      paid: false,
      price: 6200,
      phoneNumber: '3107779012',
      invoiceSent: true,
      invoiceDate: '2026-01-04'
    },
    {
      id: 'j20',
      title: 'Wellness Spa Weekly',
      date: '2026-01-07',
      status: 'scheduled',
      client: 'Serenity Spa & Wellness',
      cleaningTeam: ['Maria', 'Rosa'],
      callDurationSeconds: 260,
      booked: true,
      paid: false,
      price: 1800,
      phoneNumber: '4243332109',
      invoiceSent: true,
      invoiceDate: '2026-01-05'
    }
  ];

  const calls: Call[] = [
    {
      id: 'c1',
      phoneNumber: '3105551234',
      callerName: 'Robert Chen',
      date: '2026-01-01T10:30:00Z',
      durationSeconds: 420,
      audioUrl: 'https://example.com/recordings/call-c1.mp3',
      outcome: 'booked'
    },
    {
      id: 'c2',
      phoneNumber: '4245559876',
      callerName: 'Sarah Kim',
      date: '2026-01-02T14:15:00Z',
      durationSeconds: 300,
      audioUrl: 'https://example.com/recordings/call-c2.mp3',
      outcome: 'booked'
    },
    {
      id: 'c3',
      phoneNumber: '3105551234',
      callerName: 'Robert Chen',
      date: '2025-12-28T16:45:00Z',
      durationSeconds: 180,
      audioUrl: 'https://example.com/recordings/call-c3.mp3',
      outcome: 'booked'
    },
    {
      id: 'c4',
      phoneNumber: '8185552233',
      callerName: 'Westfield Properties',
      date: '2025-12-07T11:20:00Z',
      durationSeconds: 540,
      audioUrl: 'https://example.com/recordings/call-c4.mp3',
      outcome: 'booked'
    },
    {
      id: 'c5',
      phoneNumber: '4245559876',
      callerName: 'Sarah Kim',
      date: '2025-12-04T09:00:00Z',
      durationSeconds: 120,
      audioUrl: 'https://example.com/recordings/call-c5.mp3',
      outcome: 'booked'
    },
    {
      id: 'c6',
      phoneNumber: '3109992345',
      callerName: 'The Morrison Family',
      date: '2025-12-13T10:00:00Z',
      durationSeconds: 600,
      audioUrl: 'https://example.com/recordings/call-c6.mp3',
      outcome: 'booked'
    },
    {
      id: 'c7',
      phoneNumber: '3107779012',
      callerName: 'The Avalon Hotel',
      date: '2026-01-04T15:30:00Z',
      durationSeconds: 450,
      audioUrl: 'https://example.com/recordings/call-c7.mp3',
      outcome: 'booked'
    },
    {
      id: 'c8',
      phoneNumber: '8184447890',
      callerName: 'Grand Events LA',
      date: '2025-12-19T11:00:00Z',
      durationSeconds: 480,
      audioUrl: 'https://example.com/recordings/call-c8.mp3',
      outcome: 'booked'
    },
    {
      id: 'c9',
      phoneNumber: '4249990123',
      callerName: 'The Goldstein Residence',
      date: '2025-12-26T14:00:00Z',
      durationSeconds: 520,
      audioUrl: 'https://example.com/recordings/call-c9.mp3',
      outcome: 'booked'
    },
    {
      id: 'c10',
      phoneNumber: '3106664567',
      callerName: 'Coastal Kitchen',
      date: '2025-12-16T09:30:00Z',
      durationSeconds: 420,
      audioUrl: 'https://example.com/recordings/call-c10.mp3',
      outcome: 'booked'
    },
    {
      id: 'c11',
      phoneNumber: '4243332109',
      callerName: 'Serenity Spa & Wellness',
      date: '2026-01-05T16:00:00Z',
      durationSeconds: 260,
      audioUrl: 'https://example.com/recordings/call-c11.mp3',
      outcome: 'booked'
    },
    {
      id: 'c12',
      phoneNumber: '3102228901',
      callerName: 'Beverly Hills Motors',
      date: '2025-12-20T13:00:00Z',
      durationSeconds: 320,
      audioUrl: 'https://example.com/recordings/call-c12.mp3',
      outcome: 'booked'
    }
  ];

  const profiles: CallerProfile[] = [
    {
      phoneNumber: '3105551234',
      callerName: 'Robert Chen',
      totalCalls: 3,
      lastCallDate: '2026-01-01T10:30:00Z',
      calls: calls.filter(c => c.phoneNumber === '3105551234'),
      messages: [
        {
          role: 'client',
          content: 'Hi, I need your premium deep cleaning service for my 6-bedroom estate in Bel Air.',
          timestamp: '2026-01-01T10:30:00Z'
        },
        {
          role: 'bot',
          content: 'Hello Mr. Chen! Wonderful to hear from you again. I can absolutely arrange our executive deep cleaning service. Would you like the same team as last time?',
          timestamp: '2026-01-01T10:30:30Z'
        },
        {
          role: 'client',
          content: 'Yes, Maria and her team were excellent. Can we do January 2nd?',
          timestamp: '2026-01-01T10:31:00Z'
        },
        {
          role: 'business',
          content: 'Perfect! I have Maria, Luis, and Sofia available on January 2nd. For the full estate service, that will be $2,850. Shall I confirm?',
          timestamp: '2026-01-01T10:32:00Z'
        },
        {
          role: 'client',
          content: 'Yes, please book it. Same payment method on file.',
          timestamp: '2026-01-01T10:32:30Z'
        }
      ]
    },
    {
      phoneNumber: '4245559876',
      callerName: 'Sarah Kim',
      totalCalls: 2,
      lastCallDate: '2026-01-02T14:15:00Z',
      calls: calls.filter(c => c.phoneNumber === '4245559876'),
      messages: [
        {
          role: 'client',
          content: 'I need the luxury condo turnover service again for my downtown penthouse.',
          timestamp: '2026-01-02T14:15:00Z'
        },
        {
          role: 'bot',
          content: 'Hi Sarah! Great to hear from you. Your penthouse at The Ritz Carlton, correct? When do you need the service?',
          timestamp: '2026-01-02T14:15:15Z'
        },
        {
          role: 'client',
          content: 'Yes, that\'s right. January 3rd before my guests arrive.',
          timestamp: '2026-01-02T14:16:00Z'
        },
        {
          role: 'business',
          content: 'I have Alex available for January 3rd. The premium condo service is $1,650. Shall I schedule it?',
          timestamp: '2026-01-02T14:17:00Z'
        },
        {
          role: 'client',
          content: 'Perfect, book it!',
          timestamp: '2026-01-02T14:17:30Z'
        }
      ]
    },
    {
      phoneNumber: '8185552233',
      callerName: 'Westfield Properties',
      totalCalls: 2,
      lastCallDate: '2026-01-03T11:20:00Z',
      calls: calls.filter(c => c.phoneNumber === '8185552233'),
      messages: [
        {
          role: 'client',
          content: 'We need a move-out cleaning for one of our executive rental units. 4 bed, 3 bath.',
          timestamp: '2026-01-03T11:20:00Z'
        },
        {
          role: 'bot',
          content: 'Hello! I can help with that executive move-out cleaning. When is the property available?',
          timestamp: '2026-01-03T11:20:20Z'
        },
        {
          role: 'client',
          content: 'January 5th. We need it spotless for the new tenant showing on the 6th.',
          timestamp: '2026-01-03T11:21:00Z'
        },
        {
          role: 'business',
          content: 'Understood - we\'ll make it immaculate. For the executive move-out service, that\'s $2,400. Maria and Sofia are available.',
          timestamp: '2026-01-03T11:22:00Z'
        },
        {
          role: 'client',
          content: 'Book it. Send the invoice to our property management email.',
          timestamp: '2026-01-03T11:22:30Z'
        }
      ]
    },
    {
      phoneNumber: '3109992345',
      callerName: 'The Morrison Family',
      totalCalls: 1,
      lastCallDate: '2025-12-13T10:00:00Z',
      calls: calls.filter(c => c.phoneNumber === '3109992345'),
      messages: [
        {
          role: 'client',
          content: 'We\'re hosting a 200-person holiday party at our estate. Need your best team.',
          timestamp: '2025-12-13T10:00:00Z'
        },
        {
          role: 'bot',
          content: 'What an exciting event! We\'d be honored to prepare your estate. How many square feet are we working with?',
          timestamp: '2025-12-13T10:00:30Z'
        },
        {
          role: 'client',
          content: 'About 12,000 sq ft main house plus the guest house and outdoor entertainment areas.',
          timestamp: '2025-12-13T10:01:30Z'
        },
        {
          role: 'business',
          content: 'For a property of that scale with full event prep, I\'ll send our A-team - Maria, Luis, Alex, Sofia, and Rosa. The comprehensive package is $5,500.',
          timestamp: '2025-12-13T10:02:30Z'
        },
        {
          role: 'client',
          content: 'Worth every penny. December 15th, please.',
          timestamp: '2025-12-13T10:03:00Z'
        }
      ]
    },
    {
      phoneNumber: '3107779012',
      callerName: 'The Avalon Hotel',
      totalCalls: 1,
      lastCallDate: '2026-01-04T15:30:00Z',
      calls: calls.filter(c => c.phoneNumber === '3107779012'),
      messages: [
        {
          role: 'client',
          content: 'We\'re interested in a contract for our boutique hotel. 24 rooms, daily turnover.',
          timestamp: '2026-01-04T15:30:00Z'
        },
        {
          role: 'bot',
          content: 'Excellent! We\'d love to partner with The Avalon. What service frequency are you looking for?',
          timestamp: '2026-01-04T15:30:30Z'
        },
        {
          role: 'client',
          content: 'We need 6 days a week coverage, premium service for a luxury property.',
          timestamp: '2026-01-04T15:31:30Z'
        },
        {
          role: 'business',
          content: 'For a dedicated team and premium boutique hotel service, we can offer a monthly contract at $6,200. That includes priority scheduling and our best staff.',
          timestamp: '2026-01-04T15:32:30Z'
        },
        {
          role: 'client',
          content: 'Let\'s start with January. Send over the contract.',
          timestamp: '2026-01-04T15:33:00Z'
        }
      ]
    },
    {
      phoneNumber: '4243332109',
      callerName: 'Serenity Spa & Wellness',
      totalCalls: 1,
      lastCallDate: '2026-01-05T16:00:00Z',
      calls: calls.filter(c => c.phoneNumber === '4243332109'),
      messages: [
        {
          role: 'client',
          content: 'Hi, we need weekly deep sanitization for our wellness spa. Very particular about cleanliness.',
          timestamp: '2026-01-05T16:00:00Z'
        },
        {
          role: 'bot',
          content: 'Of course! Wellness spaces require meticulous attention. How many treatment rooms and common areas?',
          timestamp: '2026-01-05T16:00:30Z'
        },
        {
          role: 'client',
          content: '8 treatment rooms, sauna, steam room, relaxation lounge, and reception. About 4,000 sq ft total.',
          timestamp: '2026-01-05T16:01:30Z'
        },
        {
          role: 'business',
          content: 'For a spa of that caliber, our weekly wellness facility service is $1,800. We use all eco-friendly, hypoallergenic products.',
          timestamp: '2026-01-05T16:02:30Z'
        },
        {
          role: 'client',
          content: 'That\'s exactly what we need. Book us for every Tuesday.',
          timestamp: '2026-01-05T16:03:00Z'
        }
      ]
    }
  ];

  const fallback: DashboardData = {
    jobsBooked: jobs.filter(j => j.booked).length,
    quotesSent: jobs.length + 3, // a few extra quotes
    cleanersScheduled: jobs.filter(j => j.paid).length,
    callsAnswered: calls.length + 15, // more calls answered
    jobs,
    calls,
    profiles,
    isLiveData: false
  };

  return fallback;
}

export function calculateTimeSaved(jobs: Job[]): number {
  // Time saved per booked job (in minutes):
  // - 15 min: Call handling
  // - 5 min: Invoice creation & payment link
  // - 5 min: Customer Q&A over text
  // - 10 min: Text cleaner to confirm availability
  // - 5 min: Send review request & post-client nurture
  // - 5 min: Send seasonal offers
  // Total: 45 minutes per job
  const minutesPerJob = 45;
  const bookedJobs = jobs.filter(j => j.booked).length;
  return Math.round((bookedJobs * minutesPerJob) / 60);
}
