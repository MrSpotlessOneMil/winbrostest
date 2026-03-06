/**
 * Schedule Membership Visits -- Daily Cron
 *
 * Scans for active memberships where next_visit_at is within 14 days
 * and no pending/scheduled job exists yet. Creates a job with status
 * `pending_approval` and sends the customer an SMS to confirm.
 *
 * Schedule: Daily at 3 PM UTC (10 AM CT)
 */

import { NextRequest, NextResponse } from "next/server"
import { verifyCronAuth, unauthorizedResponse } from "@/lib/cron-auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getAllActiveTenants } from "@/lib/tenant"
import { sendSMS } from "@/lib/openphone"

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()

  const horizon = new Date()
  horizon.setDate(horizon.getDate() + 14)

  let totalScheduled = 0
  let totalErrors = 0

  for (const tenant of tenants) {
    try {
      // Find active memberships with next_visit_at within 14 days
      const { data: memberships, error: membershipError } = await client
        .from("customer_memberships")
        .select(`
          id,
          tenant_id,
          customer_id,
          plan_id,
          next_visit_at,
          visits_completed,
          service_plans!inner (
            id,
            name,
            slug,
            interval_months,
            discount_per_visit,
            free_addons
          ),
          customers!inner (
            id,
            first_name,
            last_name,
            phone_number,
            address
          )
        `)
        .eq("tenant_id", tenant.id)
        .eq("status", "active")
        .not("next_visit_at", "is", null)
        .lte("next_visit_at", horizon.toISOString())

      if (membershipError) {
        console.error(`[Membership Cron] Error querying memberships for ${tenant.slug}:`, membershipError.message)
        totalErrors++
        continue
      }

      if (!memberships?.length) continue

      for (const membership of memberships) {
        try {
          const plan = membership.service_plans as any
          const customer = membership.customers as any

          if (!customer?.phone_number) {
            console.warn(`[Membership Cron] Skipping membership ${membership.id}: customer has no phone number`)
            continue
          }

          // Idempotency: check if a pending_approval or scheduled job already exists for this membership
          const { data: existingJobs, error: existingError } = await client
            .from("jobs")
            .select("id")
            .eq("membership_id", membership.id)
            .in("status", ["pending_approval", "scheduled", "pending"])
            .limit(1)

          if (existingError) {
            console.error(`[Membership Cron] Error checking existing jobs for membership ${membership.id}:`, existingError.message)
            totalErrors++
            continue
          }

          if (existingJobs && existingJobs.length > 0) {
            // Already has a pending/scheduled job, skip
            continue
          }

          // Format the visit date for display
          const visitDate = new Date(membership.next_visit_at!)
          const dateStr = visitDate.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            timeZone: tenant.timezone || "America/Chicago",
          })

          // Create a job with pending_approval status
          const { data: job, error: insertError } = await client
            .from("jobs")
            .insert({
              tenant_id: tenant.id,
              customer_id: membership.customer_id,
              phone_number: customer.phone_number,
              address: customer.address || null,
              service_type: plan.name || "Membership Visit",
              date: visitDate.toISOString().split("T")[0],
              status: "pending_approval",
              booked: false,
              membership_id: membership.id,
              notes: `Auto-generated from ${plan.name} membership. Visit #${(membership.visits_completed || 0) + 1}.`,
            })
            .select("id")
            .single()

          if (insertError) {
            console.error(`[Membership Cron] Error creating job for membership ${membership.id}:`, insertError.message)
            totalErrors++
            continue
          }

          // Send SMS to customer
          const customerName = customer.first_name || "there"
          const serviceName = tenant.service_description || "service"
          const smsMessage = `Hi ${customerName}! Your next ${serviceName} visit is coming up on ${dateStr}. Reply YES to confirm, or let us know a better time.`

          const smsResult = await sendSMS(tenant, customer.phone_number, smsMessage)
          if (!smsResult.success) {
            console.warn(`[Membership Cron] SMS failed for membership ${membership.id}: ${smsResult.error}`)
            // Job still created; SMS failure is non-fatal
          }

          totalScheduled++
          console.log(`[Membership Cron] Created job ${job?.id} for membership ${membership.id} (${tenant.slug}), visit on ${dateStr}`)
        } catch (err) {
          console.error(`[Membership Cron] Error processing membership ${membership.id}:`, err)
          totalErrors++
        }
      }
    } catch (err) {
      console.error(`[Membership Cron] Error for tenant ${tenant.slug}:`, err)
      totalErrors++
    }
  }

  console.log(`[Membership Cron] Done. Scheduled: ${totalScheduled}, Errors: ${totalErrors}`)

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    scheduled: totalScheduled,
    errors: totalErrors,
  })
}
