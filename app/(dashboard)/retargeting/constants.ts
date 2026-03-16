import {
  UserX,
  FileQuestion,
  Zap,
  UserCheck,
  TimerOff,
  Ban,
} from "lucide-react"

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

export const SEQUENCE_PREVIEWS: Record<string, { steps: { step: number; delay: string; template: string }[]; summary: string }> = {
  unresponsive: {
    summary: "3 steps, 7 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Opener" },
      { step: 2, delay: "Day 3", template: "Value Nudge" },
      { step: 3, delay: "Day 7", template: "Last Check" },
    ],
  },
  quoted_not_booked: {
    summary: "6 steps, 14 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Quote Follow-up" },
      { step: 2, delay: "Day 2", template: "Question-Based" },
      { step: 3, delay: "Day 4", template: "Limited Time" },
      { step: 4, delay: "Day 7", template: "Check-In" },
      { step: 5, delay: "Day 10", template: "Social Proof" },
      { step: 6, delay: "Day 14", template: "Last Check" },
    ],
  },
  one_time: {
    summary: "3 steps, 14 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Check-In" },
      { step: 2, delay: "Day 7", template: "Seasonal Nudge" },
      { step: 3, delay: "Day 14", template: "Last Check" },
    ],
  },
  lapsed: {
    summary: "3 steps, 10 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Feedback Ask" },
      { step: 2, delay: "Day 5", template: "Priority Offer" },
      { step: 3, delay: "Day 10", template: "Last Check" },
    ],
  },
  new_lead: {
    summary: "3 steps, 5 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Opener" },
      { step: 2, delay: "Day 2", template: "Value Nudge" },
      { step: 3, delay: "Day 5", template: "Last Check" },
    ],
  },
  lost: {
    summary: "3 steps, 10 days",
    steps: [
      { step: 1, delay: "Immediately", template: "Feedback Ask" },
      { step: 2, delay: "Day 5", template: "Priority Offer" },
      { step: 3, delay: "Day 10", template: "Last Check" },
    ],
  },
}

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
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}
