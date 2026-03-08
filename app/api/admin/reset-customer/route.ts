import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"
import { normalizePhone, toE164 } from "@/lib/phone-utils"
import { logSystemEvent } from "@/lib/system-events"

/**
 * Reset all data for a customer by phone number
 *
 * This deletes:
 * - All messages
 * - All calls
 * - All leads and their scheduled tasks
 * - All jobs and related assignments
 * - System events
 * - The customer record itself
 *
 * POST /api/admin/reset-customer
 * Body: { phoneNumber: string }
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const client = getSupabaseServiceClient()
  const tenant = await getAuthTenant(request)
  // Admin user (no tenant_id) deletes across all tenants
  const isAdmin = !tenant && authResult.user.username === 'admin'

  if (!tenant && !isAdmin) {
    return NextResponse.json({ success: false, error: "No tenant found" }, { status: 500 })
  }

  const body = await request.json()
  const rawPhone = body.phoneNumber
  const rawEmail = body.email?.trim().toLowerCase() as string | undefined

  if (!rawPhone) {
    return NextResponse.json({ success: false, error: "Phone number required" }, { status: 400 })
  }

  // Create multiple phone formats to search for
  // Database might have phone stored in different formats
  const digits10 = normalizePhone(rawPhone) // 4157204580
  const e164 = toE164(rawPhone) // +14157204580
  const digits11 = digits10 ? `1${digits10}` : "" // 14157204580

  // Build array of all possible phone formats to search
  const phoneFormats = [e164, digits10, digits11].filter(Boolean)
  const phone = e164 // Primary format for logging

  console.log(`[admin] Resetting all data for phone formats: ${phoneFormats.join(", ")}${rawEmail ? `, email: ${rawEmail}` : ""}`)

  const deletionLog: string[] = []

  // Helper: conditionally add tenant filter (admin deletes across all tenants)
  function withTenant<T extends { eq: (col: string, val: string) => T }>(query: T): T {
    return tenant ? query.eq("tenant_id", tenant.id) : query
  }

  try {
    // 1. Find customers by phone (try all phone formats, across all tenants for admin)
    const { data: customersByPhone } = await withTenant(
      client.from("customers").select("id, phone_number, tenant_id")
    ).in("phone_number", phoneFormats)

    // Also find customers by email (both the email column and the phone_number placeholder)
    let customersByEmail: typeof customersByPhone = []
    if (rawEmail) {
      const { data } = await withTenant(
        client.from("customers").select("id, phone_number, tenant_id")
      ).ilike("email", rawEmail)
      customersByEmail = data || []

      // Also check the phone_number placeholder pattern used by email leads
      const { data: byPlaceholder } = await withTenant(
        client.from("customers").select("id, phone_number, tenant_id")
      ).eq("phone_number", `email:${rawEmail}`)
      if (byPlaceholder?.length) {
        customersByEmail = [...customersByEmail, ...byPlaceholder]
      }
    }

    // Merge and deduplicate customer IDs
    const allCustomers = [...(customersByPhone || []), ...(customersByEmail || [])]
    const customerIds = [...new Set(allCustomers.map((c) => c.id))]
    // Collect all phone numbers from matched customers to cascade deletions
    const allPhoneFormats = [...new Set([
      ...phoneFormats,
      ...allCustomers.map((c) => c.phone_number).filter(Boolean),
    ])]
    console.log(`[admin] Found ${customerIds.length} customers (${customersByPhone?.length || 0} by phone, ${customersByEmail?.length || 0} by email)`)

    // 2. Find all leads by phone and email
    const { data: leadsByPhone } = await withTenant(
      client.from("leads").select("id, phone_number")
    ).in("phone_number", allPhoneFormats)

    let leadsByEmail: typeof leadsByPhone = []
    if (rawEmail) {
      const { data } = await withTenant(
        client.from("leads").select("id, phone_number")
      ).ilike("email", rawEmail)
      leadsByEmail = data || []
    }

    // Also find leads by customer_id (catches email leads with placeholder phone numbers)
    let leadsByCustomer: typeof leadsByPhone = []
    if (customerIds.length > 0) {
      const { data } = await withTenant(
        client.from("leads").select("id, phone_number")
      ).in("customer_id", customerIds)
      leadsByCustomer = data || []
    }

    const allLeads = [...(leadsByPhone || []), ...(leadsByEmail || []), ...(leadsByCustomer || [])]
    const leadIds = [...new Set(allLeads.map((l) => l.id))]
    console.log(`[admin] Found ${leadIds.length} leads (${leadsByPhone?.length || 0} by phone, ${leadsByEmail?.length || 0} by email, ${leadsByCustomer?.length || 0} by customer)`)

    // 3. Find all jobs by phone and by customer_id (catches email-only customers)
    const { data: jobsByPhone } = await withTenant(
      client.from("jobs").select("id, phone_number")
    ).in("phone_number", allPhoneFormats)

    let jobsByCustomer: typeof jobsByPhone = []
    if (customerIds.length > 0) {
      const { data } = await withTenant(
        client.from("jobs").select("id, phone_number")
      ).in("customer_id", customerIds)
      jobsByCustomer = data || []
    }

    const allJobs = [...(jobsByPhone || []), ...(jobsByCustomer || [])]
    const jobIds = [...new Set(allJobs.map((j) => j.id))]
    console.log(`[admin] Found ${jobIds.length} jobs (${jobsByPhone?.length || 0} by phone, ${jobsByCustomer?.length || 0} by customer)`)

    // 4. Delete scheduled_tasks for these leads
    if (leadIds.length > 0) {
      for (const leadId of leadIds) {
        const { error } = await client
          .from("scheduled_tasks")
          .delete()
          .like("task_key", `lead-${leadId}-%`)

        if (!error) {
          deletionLog.push(`Deleted scheduled tasks for lead ${leadId}`)
        }
      }
    }

    // 5. Count and delete system_events for this phone number (all formats)
    const { data: events } = await withTenant(
      client.from("system_events").select("id")
    ).in("phone_number", allPhoneFormats)

    if (events && events.length > 0) {
      await withTenant(
        client.from("system_events").delete()
      ).in("phone_number", allPhoneFormats)
      deletionLog.push(`Deleted ${events.length} system events`)
    }

    // 6. Count and delete messages by phone number (SMS) AND email address (email leads)
    const { data: messages } = await withTenant(
      client.from("messages").select("id")
    ).in("phone_number", allPhoneFormats)

    if (messages && messages.length > 0) {
      await withTenant(
        client.from("messages").delete()
      ).in("phone_number", allPhoneFormats)
      deletionLog.push(`Deleted ${messages.length} messages (by phone)`)
    }

    // Also delete email messages (keyed by email_address, not phone_number)
    if (rawEmail) {
      const { data: emailMessages } = await withTenant(
        client.from("messages").select("id")
      ).ilike("email_address", rawEmail)

      if (emailMessages && emailMessages.length > 0) {
        await withTenant(
          client.from("messages").delete()
        ).ilike("email_address", rawEmail)
        deletionLog.push(`Deleted ${emailMessages.length} email messages`)
      }
    }

    // 7. Count and delete calls for this phone number (all formats)
    const { data: calls } = await withTenant(
      client.from("calls").select("id")
    ).in("phone_number", allPhoneFormats)

    if (calls && calls.length > 0) {
      await withTenant(
        client.from("calls").delete()
      ).in("phone_number", allPhoneFormats)
      deletionLog.push(`Deleted ${calls.length} calls`)
    }

    // 8. Delete job-related data (cleaner_assignments, reviews, tips, upsells)
    if (jobIds.length > 0) {
      for (const jobId of jobIds) {
        await client.from("cleaner_assignments").delete().eq("job_id", jobId)
        await client.from("reviews").delete().eq("job_id", jobId)
        await client.from("tips").delete().eq("job_id", jobId)
        await client.from("upsells").delete().eq("job_id", jobId)
      }
      deletionLog.push(`Cleaned up related data for ${jobIds.length} jobs`)
    }

    // 9. Clear converted_to_job_id references in leads before deleting jobs
    if (jobIds.length > 0) {
      await client
        .from("leads")
        .update({ converted_to_job_id: null })
        .in("converted_to_job_id", jobIds)
    }

    // 10. Delete leads (use IDs we already found to ensure we delete all)
    if (leadIds.length > 0) {
      await client
        .from("leads")
        .delete()
        .in("id", leadIds)
      deletionLog.push(`Deleted ${leadIds.length} leads`)
    }

    // 11. Delete jobs (use IDs we already found to ensure we delete all)
    if (jobIds.length > 0) {
      await client
        .from("jobs")
        .delete()
        .in("id", jobIds)
      deletionLog.push(`Deleted ${jobIds.length} jobs`)
    }

    // 12. Delete followup_queue entries (all phone formats)
    const { data: followups } = await withTenant(
      client.from("followup_queue").select("id")
    ).in("phone_number", allPhoneFormats)

    if (followups && followups.length > 0) {
      await withTenant(
        client.from("followup_queue").delete()
      ).in("phone_number", allPhoneFormats)
      deletionLog.push(`Deleted ${followups.length} followup queue entries`)
    }

    // 13. Finally, delete the customer records (all matching, across tenants for admin)
    if (customerIds.length > 0) {
      await client
        .from("customers")
        .delete()
        .in("id", customerIds)
      deletionLog.push(`Deleted ${customerIds.length} customer record(s)`)
    }

    console.log(`[admin] Reset complete for ${phone}:`, deletionLog)

    // Log the reset as a system event so it's visible in the debug page
    // Include reset_email so the email cron can use it as a watermark
    await logSystemEvent({
      event_type: "SYSTEM_RESET" as any,
      source: "system" as any,
      message: `Reset all data for ${phone}${rawEmail ? ` / ${rawEmail}` : ''}`,
      phone_number: phone,
      metadata: { deletions: deletionLog, raw_phone: rawPhone, reset_email: rawEmail || null },
    })

    return NextResponse.json({
      success: true,
      data: {
        phoneNumber: phone,
        deletions: deletionLog,
      },
    })
  } catch (error) {
    console.error("[admin] Error resetting customer:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
