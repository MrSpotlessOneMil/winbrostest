import {
  UserX,
  FileQuestion,
  Zap,
  UserCheck,
  TimerOff,
  Ban,
  UserPlus,
  MessageCircle,
  FileText,
  CreditCard,
  CalendarCheck,
  CircleCheck,
  RotateCcw,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Pipeline Item (returned by /api/actions/pipeline)
// ---------------------------------------------------------------------------

export interface PipelineItem {
  id: string
  name: string
  phone: string
  value: number
  status: string
  substatus: string
  time: string
  days_in_stage?: number
  source_table: 'lead' | 'quote' | 'job' | 'customer'
  source?: string | null
  followup_stage?: number | null
  quote_token?: string | null
  cleaner_id?: number | null
  satisfaction_response?: string | null
  review_sent_at?: string | null
  retargeting_sequence?: string | null
  retargeting_step?: number | null
  lifecycle_stage?: string | null
  job_date?: string | null
  customer_id?: number | null
  last_message?: string | null
  next_action?: string | null
}

export interface PipelineStageData {
  count: number
  value: number
  items: PipelineItem[]
}

// ---------------------------------------------------------------------------
// Journey Pipeline Stages (7 stages, left to right)
// ---------------------------------------------------------------------------

export type PipelineStageKey =
  | "new_lead"
  | "engaged"
  | "quoted"
  | "paid"
  | "booked"
  | "completed"
  | "win_back"

export const PIPELINE_JOURNEY_STAGES: {
  key: PipelineStageKey
  label: string
  description: string
  icon: typeof UserPlus
  color: string
  bg: string
  border: string
  gradient: string
}[] = [
  {
    key: "new_lead",
    label: "New Lead",
    description: "First contact, not yet engaged",
    icon: UserPlus,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    gradient: "from-blue-500/20 to-blue-500/5",
  },
  {
    key: "engaged",
    label: "Engaged",
    description: "In conversation, quoted, or being qualified",
    icon: MessageCircle,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/30",
    gradient: "from-cyan-500/20 to-cyan-500/5",
  },
  {
    key: "paid",
    label: "Paid",
    description: "Deposit received, needs scheduling",
    icon: CreditCard,
    color: "text-green-400",
    bg: "bg-green-500/10",
    border: "border-green-500/30",
    gradient: "from-green-500/20 to-green-500/5",
  },
  {
    key: "booked",
    label: "Booked",
    description: "Scheduled and on the calendar",
    icon: CalendarCheck,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    gradient: "from-violet-500/20 to-violet-500/5",
  },
  {
    key: "win_back",
    label: "Win Back",
    description: "Retargeting or re-engagement eligible",
    icon: RotateCcw,
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    gradient: "from-orange-500/20 to-orange-500/5",
  },
]

// ---------------------------------------------------------------------------
// Sequence Previews - synced with lib/scheduler.ts RETARGETING_SEQUENCES
// ---------------------------------------------------------------------------

export const SEQUENCE_PREVIEWS: Record<string, {
  steps: { step: number; delay: string; type: 'sms' | 'call'; template: string }[]
  summary: string
}> = {
  unresponsive: {
    summary: "4 steps, 7 days",
    steps: [
      { step: 1, delay: "Day 0", type: 'sms', template: "Opener" },
      { step: 2, delay: "Day 3", type: 'sms', template: "Value Nudge" },
      { step: 3, delay: "Day 5", type: 'call', template: "Call" },
      { step: 4, delay: "Day 7", type: 'sms', template: "Closing" },
    ],
  },
  quoted_not_booked: {
    summary: "5 steps, 21 days",
    steps: [
      { step: 1, delay: "Day 1", type: 'sms', template: "Quote Follow-up" },
      { step: 2, delay: "Day 3", type: 'sms', template: "Question-Based" },
      { step: 3, delay: "Day 7", type: 'call', template: "Call" },
      { step: 4, delay: "Day 14", type: 'sms', template: "Social Proof" },
      { step: 5, delay: "Day 21", type: 'sms', template: "Closing" },
    ],
  },
  one_time: {
    summary: "4 steps, 14 days",
    steps: [
      { step: 1, delay: "Day 0", type: 'sms', template: "Miss You" },
      { step: 2, delay: "Day 3", type: 'call', template: "Call" },
      { step: 3, delay: "Day 7", type: 'sms', template: "Seasonal Nudge" },
      { step: 4, delay: "Day 14", type: 'sms', template: "Closing" },
    ],
  },
  lapsed: {
    summary: "4 steps, 10 days",
    steps: [
      { step: 1, delay: "Day 0", type: 'sms', template: "Feedback Ask" },
      { step: 2, delay: "Day 3", type: 'call', template: "Call" },
      { step: 3, delay: "Day 5", type: 'sms', template: "Incentive Offer" },
      { step: 4, delay: "Day 10", type: 'sms', template: "Closing" },
    ],
  },
  new_lead: {
    summary: "3 steps, 5 days",
    steps: [
      { step: 1, delay: "Day 0", type: 'sms', template: "Opener" },
      { step: 2, delay: "Day 2", type: 'sms', template: "Value Nudge" },
      { step: 3, delay: "Day 5", type: 'sms', template: "Closing" },
    ],
  },
  lost: {
    summary: "3 steps, 10 days",
    steps: [
      { step: 1, delay: "Day 0", type: 'sms', template: "Feedback Ask" },
      { step: 2, delay: "Day 5", type: 'sms', template: "Incentive Offer" },
      { step: 3, delay: "Day 10", type: 'sms', template: "Closing" },
    ],
  },
  repeat: {
    summary: "2 steps, 7 days",
    steps: [
      { step: 1, delay: "Day 0", type: 'sms', template: "Seasonal Nudge" },
      { step: 2, delay: "Day 7", type: 'sms', template: "Incentive Offer" },
    ],
  },
  active: {
    summary: "2 steps, 7 days",
    steps: [
      { step: 1, delay: "Day 0", type: 'sms', template: "Seasonal Nudge" },
      { step: 2, delay: "Day 7", type: 'sms', template: "Value Nudge" },
    ],
  },
}

// ---------------------------------------------------------------------------
// Source labels for leads
// ---------------------------------------------------------------------------

export const SOURCE_LABELS: Record<string, string> = {
  vapi: "VAPI",
  meta: "Meta",
  website: "Website",
  sms: "SMS",
  phone: "Phone",
  housecall_pro: "HCP",
  ghl: "GHL",
  manual: "Manual",
}

// ---------------------------------------------------------------------------
// Legacy types/exports (used by v1/v2 pages)
// ---------------------------------------------------------------------------

export interface PipelineStage {
  total: number
  in_sequence: number
  completed_sequence: number
  converted: number
}

export interface PipelineCustomer {
  id: number
  first_name: string
  last_name: string
  phone_number: string
  email: string | null
  retargeting_sequence: string | null
  retargeting_step: number | null
  retargeting_stopped_reason: string | null
  retargeting_enrolled_at: string | null
  retargeting_completed_at: string | null
  sms_opt_out?: boolean
  created_at: string
  updated_at: string
}

export type StageKey = "unresponsive" | "quoted_not_booked" | "new_lead" | "one_time" | "lapsed" | "lost"

export const PIPELINE_STAGES: {
  key: StageKey
  label: string
  description: string
  icon: typeof UserX
  color: string
  bg: string
  border: string
  sequence: StageKey
  group: string
}[] = [
  { key: "unresponsive", label: "Unresponsive", description: "Texted/called, no reply", icon: UserX, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", sequence: "unresponsive", group: "lead_dropoffs" },
  { key: "quoted_not_booked", label: "Quoted, Not Booked", description: "Got a quote, didn't pay", icon: FileQuestion, color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", sequence: "quoted_not_booked", group: "lead_dropoffs" },
  { key: "new_lead", label: "New Leads", description: "Completed follow-up, no response", icon: Zap, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", sequence: "new_lead", group: "lead_dropoffs" },
  { key: "one_time", label: "One-Time", description: "Booked once, hasn't returned", icon: UserCheck, color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20", sequence: "one_time", group: "win_back" },
  { key: "lapsed", label: "Lapsed", description: "Was active, gone 60+ days", icon: TimerOff, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20", sequence: "lapsed", group: "win_back" },
  { key: "lost", label: "Lost", description: "Said no / bad experience", icon: Ban, color: "text-zinc-500", bg: "bg-zinc-500/10", border: "border-zinc-500/20", sequence: "lost", group: "last_chance" },
]

export const PIPELINE_GROUPS = [
  { key: "lead_dropoffs", label: "Lead Drop-Offs", description: "Leads who showed interest but never booked" },
  { key: "win_back", label: "Past Customer Win-Back", description: "Customers who booked before but haven't returned" },
  { key: "last_chance", label: "Last Chance", description: "Re-engage or close the file" },
]

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function getCustomerStatus(c: PipelineCustomer): "eligible" | "active" | "completed" | "converted" | "stopped" {
  if (c.retargeting_stopped_reason === "converted") return "converted"
  if (c.retargeting_stopped_reason === "completed") return "completed"
  if (c.retargeting_stopped_reason) return "stopped"
  if (c.retargeting_sequence) return "active"
  return "eligible"
}

export function getCustomerStatusLabel(c: PipelineCustomer): string {
  const status = getCustomerStatus(c)
  if (status === "active") {
    const seq = SEQUENCE_PREVIEWS[c.retargeting_sequence || ""]
    const totalSteps = seq?.steps.length || 3
    return `Step ${c.retargeting_step || 1}/${totalSteps}`
  }
  if (status === "converted") return "Converted"
  if (status === "completed") return "Done"
  if (status === "stopped") return "Stopped"
  return "Eligible"
}

export function timeAgo(dateStr: string): string {
  if (!dateStr) return '-'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 0) return 'upcoming'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

export function formatCurrency(n: number): string {
  if (n === 0) return '-'
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toLocaleString()}`
}

export function formatPhone(phone: string): string {
  if (!phone) return '-'
  if (phone.length >= 4) return `***-${phone.slice(-4)}`
  return phone
}
