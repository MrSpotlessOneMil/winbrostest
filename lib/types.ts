// OSIRIS × WinBros Type Definitions

// ==================== LEADS ====================
export type LeadSource = "phone" | "sms" | "meta" | "website" | "vapi"
export type LeadStatus = "new" | "contacted" | "qualified" | "booked" | "nurturing" | "escalated" | "lost"

export interface Lead {
  id: string
  name: string
  phone: string
  email?: string
  source: LeadSource
  status: LeadStatus
  service_interest: string
  estimated_value?: number
  notes?: string
  conversation_context?: string // AI conversation memory
  hcp_customer_id?: string // Housecall Pro customer ID
  created_at: string
  updated_at: string
  contacted_at?: string
  booked_at?: string
}

// ==================== JOBS ====================
export type JobStatus = "scheduled" | "confirmed" | "in-progress" | "completed" | "cancelled" | "rescheduled"
export type ServiceType = "window_cleaning" | "pressure_washing" | "gutter_cleaning" | "full_service"

export interface Job {
  id: string
  hcp_job_id: string // Housecall Pro job ID (source of truth)
  customer_id: string
  customer_name: string
  customer_phone: string
  address: string
  service_type: ServiceType
  scheduled_date: string
  scheduled_time: string
  duration_minutes: number
  estimated_value: number
  actual_value?: number
  status: JobStatus
  team_id?: string
  team_confirmed: boolean
  team_confirmed_at?: string
  notes?: string
  upsell_notes?: string
  completion_notes?: string
  created_at: string
  updated_at: string
}

// ==================== TEAMS ====================
export type TeamStatus = "available" | "on-job" | "traveling" | "off"

export interface TeamMember {
  id: string
  name: string
  phone: string
  telegram_id?: string
  role: "lead" | "technician"
  team_id: string
  is_active: boolean
}

export interface Team {
  id: string
  name: string
  lead_id: string
  members: TeamMember[]
  status: TeamStatus
  current_job_id?: string
  current_location?: {
    lat: number
    lng: number
  }
  daily_target: number // $1,200 default
  is_active: boolean
}

// ==================== PERFORMANCE ====================
export interface Tip {
  id: string
  job_id: string
  team_id: string
  team_lead_id: string
  amount: number
  reported_via: "telegram" | "manual"
  created_at: string
}

export interface Upsell {
  id: string
  job_id: string
  team_id: string
  team_lead_id: string
  upsell_type: string
  value: number
  reported_via: "telegram" | "manual"
  created_at: string
}

export interface GoogleReview {
  id: string
  job_id: string
  team_id: string
  team_lead_id: string
  review_url?: string
  incentive_amount: number // $10 per review
  created_at: string
}

// ==================== CALLS ====================
export type CallType = "inbound" | "outbound"
export type CallHandler = "human" | "vapi"
export type CallOutcome = "booked" | "escalated" | "voicemail" | "callback_scheduled" | "lost"

export interface Call {
  id: string
  caller_phone: string
  caller_name?: string
  call_type: CallType
  handler: CallHandler
  outcome?: CallOutcome
  duration_seconds?: number
  transcript?: string
  lead_id?: string
  job_id?: string
  is_business_hours: boolean
  created_at: string
}

// ==================== EXCEPTIONS ====================
export type ExceptionType = "no_team_confirm" | "high_value" | "routing_error" | "reschedule_failed" | "repeat_service"
export type ExceptionPriority = "high" | "medium" | "low"
export type ExceptionStatus = "open" | "acknowledged" | "resolved"

export interface Exception {
  id: string
  type: ExceptionType
  priority: ExceptionPriority
  status: ExceptionStatus
  title: string
  description: string
  related_job_id?: string
  related_lead_id?: string
  assigned_to?: string // ops user ID
  created_at: string
  resolved_at?: string
}

// ==================== RAIN DAY ====================
export interface RainDayReschedule {
  id: string
  affected_date: string
  target_date: string
  initiated_by: string // admin user ID
  jobs_affected: number
  jobs_successfully_rescheduled: number
  jobs_failed: string[] // job IDs that failed
  notifications_sent: number
  created_at: string
  completed_at?: string
}

// ==================== ROUTING ====================
export interface DailyRoute {
  id: string
  team_id: string
  date: string
  jobs: {
    job_id: string
    order: number
    estimated_arrival: string
    estimated_drive_time_minutes: number
  }[]
  total_drive_time_minutes: number
  total_job_time_minutes: number
  generated_at: string
}

// ==================== DASHBOARD METRICS ====================
export interface DailyMetrics {
  date: string
  total_revenue: number
  target_revenue: number
  jobs_completed: number
  jobs_scheduled: number
  leads_in: number
  leads_booked: number
  close_rate: number
  tips_collected: number
  upsells_value: number
  calls_handled: number
  after_hours_calls: number
}

export interface TeamDailyMetrics {
  team_id: string
  date: string
  revenue: number
  target: number
  jobs_completed: number
  jobs_scheduled: number
  tips: number
  upsells: number
  avg_rating?: number
}

// ==================== API RESPONSES ====================
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

// ==================== INTEGRATIONS ====================
export interface HousecallProWebhookPayload {
  event: string
  data: Record<string, unknown>
  timestamp: string
}

export interface TelegramBotMessage {
  chat_id: string
  team_id: string
  message_type: "job_assignment" | "morning_brief" | "tip_report" | "upsell_report" | "reschedule_notice"
  content: string
  sent_at: string
}

export interface OpenPhoneSmsPayload {
  to: string
  from: string
  body: string
  direction: "inbound" | "outbound"
}

// ==================== CONFIGURATION ====================
export interface SystemConfig {
  booking_rules: {
    rate_per_labor_hour: number // $150
    production_hours_per_day: number // 8
    daily_target_per_crew: number // $1,200
    min_job_value: number
    max_distance_minutes: number // 50
    high_value_threshold: number // $1,000
  }
  team_assignment: {
    initial_window_minutes: number // 10
    urgent_window_minutes: number // 3
    escalation_timeout_minutes: number // 10
  }
  lead_followup: {
    initial_text_delay_minutes: number // 0 (immediate)
    first_call_delay_minutes: number // 10
    double_call_delay_minutes: number // after first call
    second_text_delay_minutes: number
    final_call_delay_minutes: number
  }
  business_hours: {
    start: string // "09:00"
    end: string // "17:00"
    timezone: string // "America/Chicago"
  }
}
