export interface JobCard {
  id: number
  date: string
  scheduled_at: string | null
  address: string | null
  service_type: string | null
  status: string
  job_type: string | null
  assignment_status: string
  assignment_id: string
  customer_first_name: string | null
  cleaner_omw_at: string | null
  cleaner_arrived_at: string | null
  payment_method: string | null
}

export interface PortalData {
  cleaner: { id: number; name: string; phone: string; availability: any; employee_type?: string }
  tenant: { name: string; slug: string }
  todaysJobs: JobCard[]
  upcomingJobs: JobCard[]
  pendingJobs: JobCard[]
  pastJobs: JobCard[]
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

export function formatTime(timeStr: string | null): string {
  if (!timeStr) return "TBD"
  try {
    const [h, m] = timeStr.split(":").map(Number)
    const ampm = h >= 12 ? "PM" : "AM"
    const hour12 = h % 12 || 12
    return `${hour12}:${m.toString().padStart(2, "0")} ${ampm}`
  } catch {
    return timeStr
  }
}

export function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getJobStatusDisplay(job: JobCard): { label: string; color: string; dotColor: string } {
  if (job.job_type === "estimate") return { label: "Estimate", color: "bg-purple-100 text-purple-800", dotColor: "#a855f7" }
  if (job.assignment_status === "pending") return { label: "Needs Response", color: "bg-amber-100 text-amber-800", dotColor: "#f59e0b" }
  if (job.status === "completed") return { label: "Done", color: "bg-green-100 text-green-800", dotColor: "#22c55e" }
  if (job.cleaner_arrived_at) return { label: "At Location", color: "bg-blue-100 text-blue-800", dotColor: "#3b82f6" }
  if (job.cleaner_omw_at) return { label: "On My Way", color: "bg-indigo-100 text-indigo-800", dotColor: "#6366f1" }
  return { label: "Upcoming", color: "bg-slate-100 text-slate-700", dotColor: "#94a3b8" }
}

export interface DesignProps {
  data: PortalData
  token: string
  onLogout: () => void
}
