import { NextRequest, NextResponse } from "next/server"
import type { RainDayReschedule, ApiResponse, Job } from "@/lib/types"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth, AuthUser } from "@/lib/auth"
import { getDefaultTenant } from "@/lib/tenant"
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

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  // Get the default tenant for multi-tenant filtering
  const tenant = await getDefaultTenant()
  if (!tenant) {
    return NextResponse.json({ success: false, error: "No tenant configured" }, { status: 500 })
  }

  try {
    const body = await request.json()
    const { affected_date, target_date, initiated_by } = body

    if (!affected_date || !target_date) {
      return NextResponse.json(
        { success: false, error: "affected_date and target_date are required" },
        { status: 400 }
      )
    }

    // Get all affected jobs
    const affectedJobs = await getAffectedJobs(affected_date, tenant.id)
    const successfullyRescheduled: string[] = []
    const failedJobs: string[] = []

    // Process each job
    const client = getSupabaseServiceClient()
    let notificationsSent = 0

    for (const job of affectedJobs) {
      try {
        const numericId = Number(job.id)
        if (!Number.isFinite(numericId)) throw new Error("Invalid job id")

        // 1. Update local database
        const { error: updateErr } = await client.from("jobs").update({ date: target_date }).eq("id", numericId)
        if (updateErr) throw updateErr

        // 2. Sync with HousecallPro if job has HCP ID
        if (job.hcp_job_id && tenant.housecall_pro_api_key) {
          try {
            // Convert target_date to ISO datetime (keep same time, change date)
            const newScheduledStart = `${target_date}T${job.scheduled_time || "09:00"}:00Z`
            await updateHCPJob(job.hcp_job_id, { scheduled_start: newScheduledStart })
            console.log(`[Rain Day] Updated HCP job ${job.hcp_job_id} to ${target_date}`)
          } catch (hcpErr) {
            console.error(`[Rain Day] Failed to update HCP job ${job.hcp_job_id}:`, hcpErr)
            // Continue anyway - local DB is source of truth
          }
        }

        // 3. Send SMS notification to customer
        if (job.customer_phone && tenant.openphone_api_key) {
          try {
            const oldDateFormatted = new Date(affected_date + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })
            const newDateFormatted = new Date(target_date + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })
            const businessName = tenant.business_name_short || tenant.name
            const smsMessage = `Hi ${job.customer_name}! Due to weather conditions, your ${businessName} cleaning originally scheduled for ${oldDateFormatted} has been rescheduled to ${newDateFormatted}. Same time: ${job.scheduled_time || "9:00 AM"}. Reply with any questions!`

            const smsResult = await sendSMS(tenant, job.customer_phone, smsMessage)
            if (smsResult.success) {
              notificationsSent++
              console.log(`[Rain Day] SMS sent to customer ${job.customer_phone}`)
            }
          } catch (smsErr) {
            console.error(`[Rain Day] Failed to send SMS to ${job.customer_phone}:`, smsErr)
          }
        }

        // 4. Notify assigned cleaners via Telegram
        if (job.team_id) {
          try {
            // Fetch cleaner info from database
            const { data: cleaner } = await client
              .from("cleaners")
              .select("id, name, telegram_id, phone")
              .eq("id", job.team_id)
              .single()

            if (cleaner?.telegram_id) {
              const oldDateFormatted = new Date(affected_date + "T12:00:00").toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })
              const telegramResult = await notifyScheduleChange(
                tenant,
                { telegram_id: cleaner.telegram_id, name: cleaner.name, phone: cleaner.phone },
                { id: job.id, date: target_date, scheduled_at: job.scheduled_time, address: job.address },
                oldDateFormatted,
                job.scheduled_time || "09:00"
              )
              if (telegramResult.success) {
                notificationsSent++
                console.log(`[Rain Day] Telegram notification sent to cleaner ${cleaner.name}`)
              }
            }
          } catch (telegramErr) {
            console.error(`[Rain Day] Failed to notify cleaner ${job.team_id}:`, telegramErr)
          }
        }

        successfullyRescheduled.push(job.id)
      } catch {
        failedJobs.push(job.id)
      }
    }

    // Create reschedule record
    const reschedule: RainDayReschedule = {
      id: `reschedule-${Date.now()}`,
      affected_date,
      target_date,
      initiated_by: initiated_by || "system",
      jobs_affected: affectedJobs.length,
      jobs_successfully_rescheduled: successfullyRescheduled.length,
      jobs_failed: failedJobs,
      notifications_sent: notificationsSent,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }

    const response: ApiResponse<RainDayReschedule> = {
      success: true,
      data: reschedule,
      message: `Successfully rescheduled ${successfullyRescheduled.length} of ${affectedJobs.length} jobs`,
    }

    return NextResponse.json(response)
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
  const tenant = await getDefaultTenant()
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
