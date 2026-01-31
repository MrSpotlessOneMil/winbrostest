import { NextRequest, NextResponse } from "next/server"
import { verifySignature } from "@/lib/qstash"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getDefaultTenant } from "@/lib/tenant"
import { sendSMS } from "@/lib/openphone"
import { sendJobReminder } from "@/lib/telegram"

interface ReminderPayload {
  type: "day_before" | "one_hour_before" | "job_start"
  job_id?: string
  date?: string // For batch day-before reminders
}

/**
 * POST /api/automation/send-reminder
 *
 * Handles reminder automation triggered by QStash cron:
 * - day_before: Send reminder SMS to customers for tomorrow's jobs
 * - one_hour_before: Send reminder to cleaners 1 hour before job
 * - job_start: Send "starting now" notification to cleaners
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("upstash-signature")
  const body = await request.text()

  // Verify QStash signature if present
  if (signature && !(await verifySignature(signature, body))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  const tenant = await getDefaultTenant()
  if (!tenant) {
    return NextResponse.json({ success: false, error: "No tenant configured" }, { status: 500 })
  }

  try {
    const payload: ReminderPayload = JSON.parse(body)
    const { type, job_id, date } = payload

    const client = getSupabaseServiceClient()
    let remindersSent = 0
    let errors = 0

    switch (type) {
      case "day_before": {
        // Get tomorrow's date or specified date
        const targetDate = date || getTomorrowDate()

        // Fetch all scheduled jobs for target date
        const { data: jobs, error } = await client
          .from("jobs")
          .select(`
            id, date, scheduled_at, address, service_type, notes,
            customers (id, first_name, last_name, phone_number, email)
          `)
          .eq("tenant_id", tenant.id)
          .eq("date", targetDate)
          .in("status", ["scheduled", "confirmed"])

        if (error) {
          console.error("[Reminder] Failed to fetch jobs:", error)
          return NextResponse.json({ success: false, error: "Failed to fetch jobs" }, { status: 500 })
        }

        // Send reminder SMS to each customer
        for (const job of jobs || []) {
          const customer = Array.isArray(job.customers) ? job.customers[0] : job.customers
          if (!customer?.phone_number) continue

          try {
            const dateFormatted = new Date(job.date + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })
            const businessName = tenant.business_name_short || tenant.name
            const customerName = customer.first_name || "there"
            const time = formatTime(job.scheduled_at)

            const message = `Hi ${customerName}! This is a reminder from ${businessName} that your cleaning is scheduled for tomorrow (${dateFormatted}) at ${time}. Please make sure someone is home or leave a key. Reply with any questions!`

            const result = await sendSMS(tenant, customer.phone_number, message)
            if (result.success) {
              remindersSent++
              console.log(`[Reminder] Day-before SMS sent to ${customer.phone_number}`)
            } else {
              errors++
            }
          } catch (err) {
            console.error(`[Reminder] Failed to send SMS to ${customer.phone_number}:`, err)
            errors++
          }
        }

        return NextResponse.json({
          success: true,
          type: "day_before",
          date: targetDate,
          jobs_count: jobs?.length || 0,
          reminders_sent: remindersSent,
          errors,
        })
      }

      case "one_hour_before":
      case "job_start": {
        // For specific job reminders, we need a job_id
        if (!job_id) {
          return NextResponse.json({ success: false, error: "job_id required for this reminder type" }, { status: 400 })
        }

        // Fetch job with cleaner assignment
        const { data: job, error } = await client
          .from("jobs")
          .select(`
            id, date, scheduled_at, address, service_type, notes, bedrooms, bathrooms, square_footage, hours,
            customers (id, first_name, last_name, phone_number),
            cleaner_assignments (
              id, status,
              cleaners (id, name, telegram_id, phone)
            )
          `)
          .eq("id", job_id)
          .eq("tenant_id", tenant.id)
          .single()

        if (error || !job) {
          console.error("[Reminder] Job not found:", job_id)
          return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 })
        }

        // Find confirmed cleaner assignment
        const assignments = Array.isArray(job.cleaner_assignments) ? job.cleaner_assignments : []
        const confirmedAssignment = assignments.find((a: any) => a.status === "confirmed" || a.status === "accepted")
        // cleaners can be an object or an array depending on the relation
        const cleanersData = confirmedAssignment?.cleaners
        const cleaner = Array.isArray(cleanersData) ? cleanersData[0] : cleanersData

        if (!cleaner?.telegram_id) {
          console.log(`[Reminder] No cleaner with Telegram ID for job ${job_id}`)
          return NextResponse.json({
            success: true,
            message: "No cleaner to notify",
            reminders_sent: 0,
          })
        }

        // Send Telegram reminder to cleaner
        const customer = Array.isArray(job.customers) ? job.customers[0] : job.customers
        const reminderType = type === "one_hour_before" ? "one_hour_before" : "job_start"

        const result = await sendJobReminder(
          tenant,
          { telegram_id: cleaner.telegram_id, name: cleaner.name, phone: cleaner.phone },
          {
            id: job.id,
            date: job.date,
            scheduled_at: job.scheduled_at,
            address: job.address,
            service_type: job.service_type,
            notes: job.notes,
            bedrooms: job.bedrooms,
            bathrooms: job.bathrooms,
            square_footage: job.square_footage,
            hours: job.hours,
          },
          customer ? { first_name: customer.first_name, last_name: customer.last_name } : undefined,
          reminderType
        )

        if (result.success) {
          remindersSent++
          console.log(`[Reminder] ${type} notification sent to cleaner ${cleaner.name}`)
        } else {
          errors++
          console.error(`[Reminder] Failed to send ${type} to cleaner:`, result.error)
        }

        return NextResponse.json({
          success: true,
          type,
          job_id,
          reminders_sent: remindersSent,
          errors,
        })
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown reminder type: ${type}` }, { status: 400 })
    }
  } catch (error) {
    console.error("[Reminder] Error processing reminder:", error)
    return NextResponse.json(
      { success: false, error: "Failed to process reminder" },
      { status: 500 }
    )
  }
}

function getTomorrowDate(): string {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return tomorrow.toISOString().split("T")[0]
}

function formatTime(time: string | null): string {
  if (!time) return "9:00 AM"
  const match = time.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return time
  let hour = parseInt(match[1], 10)
  const minute = match[2]
  const period = hour >= 12 ? "PM" : "AM"
  if (hour > 12) hour -= 12
  if (hour === 0) hour = 12
  return `${hour}:${minute} ${period}`
}
