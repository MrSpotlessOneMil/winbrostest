/**
 * Extend Recurring Jobs — Daily Cron
 *
 * Scans for recurring jobs (weekly, bi-weekly, monthly) and generates
 * new future instances to maintain a 52-week rolling horizon (effectively infinite).
 *
 * Schedule: Daily at 6 AM UTC (1 AM CT)
 */

import { NextRequest, NextResponse } from "next/server"
import { verifyCronAuth, unauthorizedResponse } from "@/lib/cron-auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getAllActiveTenants } from "@/lib/tenant"

const HORIZON_WEEKS = 52 // 1 year ahead — runs daily so horizon never shrinks

function calculateNextDate(dateStr: string, frequency: string): string {
  const d = new Date(dateStr + "T12:00:00")
  switch (frequency) {
    case "weekly":
      d.setDate(d.getDate() + 7)
      break
    case "bi-weekly":
      d.setDate(d.getDate() + 14)
      break
    case "monthly":
      d.setMonth(d.getMonth() + 1)
      break
    default:
      return dateStr
  }
  return d.toISOString().split("T")[0]
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()
  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + HORIZON_WEEKS * 7)
  const maxDateStr = maxDate.toISOString().split("T")[0]

  let totalGenerated = 0
  let totalErrors = 0

  for (const tenant of tenants) {
    try {
      // Find recurring parent jobs that need extending
      // (last_generated_date is within 2 weeks of today or null)
      const twoWeeksOut = new Date()
      twoWeeksOut.setDate(twoWeeksOut.getDate() + 14)
      const cutoff = twoWeeksOut.toISOString().split("T")[0]

      const { data: parentJobs, error } = await client
        .from("jobs")
        .select("id, tenant_id, customer_id, phone_number, address, service_type, scheduled_at, hours, price, notes, bedrooms, bathrooms, sqft, frequency, date, last_generated_date, addons")
        .eq("tenant_id", tenant.id)
        .neq("frequency", "one-time")
        .is("parent_job_id", null) // Only look at parent jobs
        .is("paused_at", null) // Skip paused recurring series
        .in("status", ["scheduled", "completed", "in_progress"])
        .or(`last_generated_date.is.null,last_generated_date.lt.${cutoff}`)

      if (error) {
        console.error(`[Extend Recurring] Error querying ${tenant.slug}:`, error.message)
        totalErrors++
        continue
      }

      if (!parentJobs?.length) continue

      for (const job of parentJobs) {
        try {
          // Start from last generated date or the original job date
          let startFrom = job.last_generated_date || job.date
          if (!startFrom) continue

          const instances: any[] = []
          let nextDate = calculateNextDate(startFrom, job.frequency)

          while (nextDate <= maxDateStr) {
            instances.push({
              tenant_id: job.tenant_id,
              customer_id: job.customer_id,
              phone_number: job.phone_number,
              address: job.address,
              service_type: job.service_type,
              date: nextDate,
              scheduled_at: job.scheduled_at,
              hours: job.hours,
              price: job.price,
              notes: job.notes,
              bedrooms: job.bedrooms,
              bathrooms: job.bathrooms,
              sqft: job.sqft,
              frequency: job.frequency,
              status: "scheduled",
              booked: true,
              parent_job_id: job.id,
              addons: job.addons,
            })
            nextDate = calculateNextDate(nextDate, job.frequency)
          }

          if (instances.length === 0) continue

          const { error: insertError } = await client.from("jobs").insert(instances)
          if (insertError) {
            console.error(`[Extend Recurring] Insert failed for job ${job.id}:`, insertError.message)
            totalErrors++
            continue
          }

          const lastDate = instances[instances.length - 1].date
          await client.from("jobs").update({ last_generated_date: lastDate }).eq("id", job.id)

          totalGenerated += instances.length
          console.log(`[Extend Recurring] Job ${job.id} (${tenant.slug}): +${instances.length} instances through ${lastDate}`)
        } catch (err) {
          console.error(`[Extend Recurring] Error processing job ${job.id}:`, err)
          totalErrors++
        }
      }
    } catch (err) {
      console.error(`[Extend Recurring] Error for tenant ${tenant.slug}:`, err)
      totalErrors++
    }
  }

  console.log(`[Extend Recurring] Done. Generated: ${totalGenerated}, Errors: ${totalErrors}`)

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    generated: totalGenerated,
    errors: totalErrors,
  })
}
