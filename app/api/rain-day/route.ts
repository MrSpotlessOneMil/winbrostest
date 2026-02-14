import { NextRequest, NextResponse } from "next/server"
import type { RainDayReschedule, ApiResponse, Job } from "@/lib/types"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant, AuthUser } from "@/lib/auth"
import { updateJob as updateHCPJob } from "@/integrations/housecall-pro/hcp-client"
import { sendSMS } from "@/lib/openphone"
import { notifyScheduleChange } from "@/lib/telegram"

function mapDbStatusToApi(status: string | null | undefined): Job["status"] {
  switch ((status || "").toLowerCase()) {
    case "cancelled":
      return "cancelled"
    case "completed":
      return "completed"
    case "in_progress":
      return "in-progress"
    case "scheduled":
      return "scheduled"
    case "quoted":
      return "confirmed"
    case "lead":
      return "scheduled"
    default:
      return "scheduled"
  }
}

function mapDbServiceTypeToApi(serviceType: string | null | undefined): Job["service_type"] {
  const raw = (serviceType || "").toLowerCase()
  if (raw.includes("gutter")) return "gutter_cleaning"
  if (raw.includes("pressure")) return "pressure_washing"
  if (raw.includes("window")) return "window_cleaning"
  return "full_service"
}

function toIsoDateOnly(value: unknown): string {
  if (!value) return new Date().toISOString().slice(0, 10)
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
  return d.toISOString().slice(0, 10)
}

function toTimeHHMM(value: unknown): string {
  if (!value) return "09:00"
  const s = String(value)
  if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5)
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(11, 16)
  return "09:00"
}

async function getAffectedJobs(date: string, tenantId: string): Promise<Job[]> {
  const client = getSupabaseServiceClient()
  const { data, error } = await client
    .from("jobs")
    .select("*, customers (*), cleaner_assignments (*, cleaners (*))")
    .eq("tenant_id", tenantId)
    .eq("date", date)
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true })

  if (error) return []

  return (data || []).map((row: any) => {
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers
    const assignments = Array.isArray(row.cleaner_assignments) ? row.cleaner_assignments : []
    const primaryAssignment = assignments.find((a: any) => a?.status === "confirmed") || assignments[0]
    const cleaner = primaryAssignment?.cleaners

    const customerName = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim() || "Unknown"
    const durationMinutes = row.hours ? Math.round(Number(row.hours) * 60) : 120

    return {
      id: String(row.id),
      hcp_job_id: row.hcp_job_id ? String(row.hcp_job_id) : "",
      customer_id: customer?.id != null ? String(customer.id) : String(row.customer_id ?? ""),
      customer_name: customerName,
      customer_phone: String(customer?.phone_number || row.phone_number || ""),
      address: String(row.address || customer?.address || ""),
      service_type: mapDbServiceTypeToApi(row.service_type),
      scheduled_date: toIsoDateOnly(row.date || row.created_at),
      scheduled_time: toTimeHHMM(row.scheduled_at),
      duration_minutes: durationMinutes,
      estimated_value: row.price ? Number(row.price) : 0,
      status: mapDbStatusToApi(row.status),
      team_id:
        cleaner?.id != null
          ? String(cleaner.id)
          : primaryAssignment?.cleaner_id != null
            ? String(primaryAssignment.cleaner_id)
            : undefined,
      team_confirmed: Boolean(primaryAssignment && ["accepted", "confirmed"].includes(String(primaryAssignment.status))),
      team_confirmed_at: primaryAssignment?.updated_at ? String(primaryAssignment.updated_at) : undefined,
      created_at: row.created_at ? String(row.created_at) : new Date().toISOString(),
      updated_at: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
    }
  })
}

/**
 * Reschedule a single job to a new date and send notifications.
 * Returns true on success, false on failure.
 */
async function rescheduleJob(
  job: Job,
  targetDate: string,
  affectedDate: string,
  tenant: any,
  client: ReturnType<typeof getSupabaseServiceClient>,
): Promise<{ success: boolean; notifications: number }> {
  let notifications = 0
  const numericId = Number(job.id)
  if (!Number.isFinite(numericId)) throw new Error("Invalid job id")

  // 1. Update local database
  const { error: updateErr } = await client.from("jobs").update({ date: targetDate }).eq("id", numericId)
  if (updateErr) throw updateErr

  // 2. Sync with HousecallPro if job has HCP ID
  if (job.hcp_job_id && tenant.housecall_pro_api_key) {
    try {
      const newScheduledStart = `${targetDate}T${job.scheduled_time || "09:00"}:00Z`
      await updateHCPJob(job.hcp_job_id, { scheduled_start: newScheduledStart })
      console.log(`[Rain Day] Updated HCP job ${job.hcp_job_id} to ${targetDate}`)
    } catch (hcpErr) {
      console.error(`[Rain Day] Failed to update HCP job ${job.hcp_job_id}:`, hcpErr)
    }
  }

  // 3. Send SMS notification to customer
  if (job.customer_phone && tenant.openphone_api_key) {
    try {
      const oldDateFormatted = new Date(affectedDate + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
      const newDateFormatted = new Date(targetDate + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
      const businessName = tenant.business_name_short || tenant.name
      const smsMessage = `Hi ${job.customer_name}! Due to weather conditions, your ${businessName} cleaning originally scheduled for ${oldDateFormatted} has been rescheduled to ${newDateFormatted}. Same time: ${job.scheduled_time || "9:00 AM"}. Reply with any questions!`

      const smsResult = await sendSMS(tenant, job.customer_phone, smsMessage)
      if (smsResult.success) {
        notifications++
        console.log(`[Rain Day] SMS sent to customer ${job.customer_phone}`)

        // Log the outbound message to the database
        await client.from("messages").insert({
          tenant_id: tenant.id,
          customer_id: job.customer_id || null,
          phone_number: job.customer_phone,
          role: "assistant",
          content: smsMessage,
          direction: "outbound",
          message_type: "sms",
          ai_generated: false,
          source: "rain_day_reschedule",
          job_id: job.id ? Number(job.id) : null,
          timestamp: new Date().toISOString(),
        }).then(({ error: logErr }) => {
          if (logErr) console.error("[Rain Day] Failed to log reschedule message:", logErr)
        })
      }
    } catch (smsErr) {
      console.error(`[Rain Day] Failed to send SMS to ${job.customer_phone}:`, smsErr)
    }
  }

  // 4. Notify assigned cleaners via Telegram
  if (job.team_id) {
    try {
      const { data: cleaner } = await client
        .from("cleaners")
        .select("id, name, telegram_id, phone")
        .eq("id", job.team_id)
        .single()

      if (cleaner?.telegram_id) {
        const oldDateFormatted = new Date(affectedDate + "T12:00:00").toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        })
        const telegramResult = await notifyScheduleChange(
          tenant,
          { telegram_id: cleaner.telegram_id, name: cleaner.name, phone: cleaner.phone },
          { id: job.id, date: targetDate, scheduled_at: job.scheduled_time, address: job.address },
          oldDateFormatted,
          job.scheduled_time || "09:00"
        )
        if (telegramResult.success) {
          notifications++
          console.log(`[Rain Day] Telegram notification sent to cleaner ${cleaner.name}`)
        }
      }
    } catch (telegramErr) {
      console.error(`[Rain Day] Failed to notify cleaner ${job.team_id}:`, telegramErr)
    }
  }

  return { success: true, notifications }
}

/**
 * Generate candidate dates for auto-spread (skips Sundays and the affected date).
 */
function getCandidateDates(afterDate: string, count: number): string[] {
  const dates: string[] = []
  const start = new Date(afterDate + "T12:00:00")
  let current = new Date(start)
  current.setDate(current.getDate() + 1)

  while (dates.length < count) {
    // Skip Sundays (day 0)
    if (current.getDay() !== 0) {
      dates.push(current.toISOString().slice(0, 10))
    }
    current.setDate(current.getDate() + 1)
  }

  return dates
}

/**
 * Count existing non-cancelled jobs for each candidate date.
 */
async function getJobCountsByDate(
  dates: string[],
  tenantId: string,
  client: ReturnType<typeof getSupabaseServiceClient>,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const d of dates) counts[d] = 0

  const { data } = await client
    .from("jobs")
    .select("date")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .in("date", dates)

  if (data) {
    for (const row of data) {
      const d = String(row.date)
      if (counts[d] !== undefined) counts[d]++
    }
  }

  return counts
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)
  if (!tenant) {
    return NextResponse.json({ success: false, error: "No tenant configured" }, { status: 500 })
  }

  try {
    const body = await request.json()
    const { affected_date, target_date, auto_spread, spread_days, initiated_by } = body

    if (!affected_date) {
      return NextResponse.json(
        { success: false, error: "affected_date is required" },
        { status: 400 }
      )
    }

    if (!auto_spread && !target_date) {
      return NextResponse.json(
        { success: false, error: "target_date is required (or set auto_spread: true)" },
        { status: 400 }
      )
    }

    const affectedJobs = await getAffectedJobs(affected_date, tenant.id)
    if (affectedJobs.length === 0) {
      return NextResponse.json({
        success: true,
        data: { affected_date, jobs_affected: 0, spread_summary: {} },
        message: "No jobs found on this date",
      })
    }

    const client = getSupabaseServiceClient()
    const successfullyRescheduled: string[] = []
    const failedJobs: string[] = []
    let notificationsSent = 0
    const spreadSummary: Record<string, number> = {}

    if (auto_spread) {
      // Auto-spread: distribute jobs across the next N days (least-loaded first)
      const numDays = Math.min(Math.max(spread_days || 14, 7), 30)
      const candidateDates = getCandidateDates(affected_date, numDays)
      const jobCounts = await getJobCountsByDate(candidateDates, tenant.id, client)

      for (const job of affectedJobs) {
        // Find the date with the fewest existing jobs
        let bestDate = candidateDates[0]
        let bestCount = jobCounts[bestDate] ?? Infinity
        for (const d of candidateDates) {
          if ((jobCounts[d] ?? 0) < bestCount) {
            bestDate = d
            bestCount = jobCounts[d] ?? 0
          }
        }

        try {
          const result = await rescheduleJob(job, bestDate, affected_date, tenant, client)
          successfullyRescheduled.push(job.id)
          notificationsSent += result.notifications
          // Update counts so next job goes to a different day
          jobCounts[bestDate] = (jobCounts[bestDate] ?? 0) + 1
          spreadSummary[bestDate] = (spreadSummary[bestDate] || 0) + 1
          console.log(`[Rain Day] Job ${job.id} spread to ${bestDate} (day now has ${jobCounts[bestDate]} jobs)`)
        } catch {
          failedJobs.push(job.id)
        }
      }
    } else {
      // Single target date mode (original behavior)
      for (const job of affectedJobs) {
        try {
          const result = await rescheduleJob(job, target_date, affected_date, tenant, client)
          successfullyRescheduled.push(job.id)
          notificationsSent += result.notifications
          spreadSummary[target_date] = (spreadSummary[target_date] || 0) + 1
        } catch {
          failedJobs.push(job.id)
        }
      }
    }

    const reschedule: RainDayReschedule = {
      id: `reschedule-${Date.now()}`,
      affected_date,
      target_date: auto_spread ? "auto-spread" : target_date,
      initiated_by: initiated_by || "system",
      jobs_affected: affectedJobs.length,
      jobs_successfully_rescheduled: successfullyRescheduled.length,
      jobs_failed: failedJobs,
      notifications_sent: notificationsSent,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }

    return NextResponse.json({
      success: true,
      data: { ...reschedule, spread_summary: spreadSummary },
      message: `Successfully rescheduled ${successfullyRescheduled.length} of ${affectedJobs.length} jobs`,
    })
  } catch (error) {
    const response: ApiResponse<never> = {
      success: false,
      error: "Failed to process rain day reschedule",
    }
    return NextResponse.json(response, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  // Get the default tenant for multi-tenant filtering
  const tenant = await getAuthTenant(request)
  if (!tenant) {
    return NextResponse.json({ success: false, error: "No tenant configured" }, { status: 500 })
  }

  const searchParams = request.nextUrl.searchParams
  const date = searchParams.get("date")

  if (!date) {
    return NextResponse.json(
      { success: false, error: "date parameter is required" },
      { status: 400 }
    )
  }

  // Get preview of jobs that would be affected
  const affectedJobs = await getAffectedJobs(date, tenant.id)
  const totalRevenue = affectedJobs.reduce((sum, job) => sum + job.estimated_value, 0)

  return NextResponse.json({
    success: true,
    data: {
      date,
      jobs_count: affectedJobs.length,
      total_revenue: totalRevenue,
      jobs: affectedJobs.map((job) => ({
        id: job.id,
        customer_name: job.customer_name,
        time: job.scheduled_time,
        value: job.estimated_value,
        team_id: job.team_id,
        address: job.address,
      })),
    },
  })
}
