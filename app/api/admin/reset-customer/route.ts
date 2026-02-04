import { NextRequest, NextResponse } from "next/server"
import { getSupabaseClient } from "@/lib/supabase"
import { getDefaultTenant } from "@/lib/tenant"
import { normalizePhone, toE164 } from "@/lib/phone-utils"

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
  const client = getSupabaseClient()
  const tenant = await getDefaultTenant()

  if (!tenant) {
    return NextResponse.json({ success: false, error: "No tenant found" }, { status: 500 })
  }

  const body = await request.json()
  const rawPhone = body.phoneNumber

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

  console.log(`[admin] Resetting all data for phone formats: ${phoneFormats.join(", ")}`)

  const deletionLog: string[] = []

  try {
    // 1. Find the customer (try all phone formats)
    const { data: customers } = await client
      .from("customers")
      .select("id, phone_number")
      .eq("tenant_id", tenant.id)
      .in("phone_number", phoneFormats)

    const customer = customers?.[0] || null
    console.log(`[admin] Found ${customers?.length || 0} customers with matching phone`)

    // 2. Find all leads for this phone number (try all phone formats)
    const { data: leads } = await client
      .from("leads")
      .select("id, phone_number")
      .eq("tenant_id", tenant.id)
      .in("phone_number", phoneFormats)

    const leadIds = leads?.map((l) => l.id) || []
    console.log(`[admin] Found ${leads?.length || 0} leads with matching phone`)

    // 3. Find all jobs for this phone number (try all phone formats)
    const { data: jobs } = await client
      .from("jobs")
      .select("id, phone_number")
      .eq("tenant_id", tenant.id)
      .in("phone_number", phoneFormats)

    const jobIds = jobs?.map((j) => j.id) || []
    console.log(`[admin] Found ${jobs?.length || 0} jobs with matching phone`)

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
    const { data: events } = await client
      .from("system_events")
      .select("id")
      .eq("tenant_id", tenant.id)
      .in("phone_number", phoneFormats)

    if (events && events.length > 0) {
      await client
        .from("system_events")
        .delete()
        .eq("tenant_id", tenant.id)
        .in("phone_number", phoneFormats)
      deletionLog.push(`Deleted ${events.length} system events`)
    }

    // 6. Count and delete messages for this phone number (all formats)
    const { data: messages } = await client
      .from("messages")
      .select("id")
      .eq("tenant_id", tenant.id)
      .in("phone_number", phoneFormats)

    if (messages && messages.length > 0) {
      await client
        .from("messages")
        .delete()
        .eq("tenant_id", tenant.id)
        .in("phone_number", phoneFormats)
      deletionLog.push(`Deleted ${messages.length} messages`)
    }

    // 7. Count and delete calls for this phone number (all formats)
    const { data: calls } = await client
      .from("calls")
      .select("id")
      .eq("tenant_id", tenant.id)
      .in("phone_number", phoneFormats)

    if (calls && calls.length > 0) {
      await client
        .from("calls")
        .delete()
        .eq("tenant_id", tenant.id)
        .in("phone_number", phoneFormats)
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
    const { data: followups } = await client
      .from("followup_queue")
      .select("id")
      .in("phone_number", phoneFormats)

    if (followups && followups.length > 0) {
      await client
        .from("followup_queue")
        .delete()
        .in("phone_number", phoneFormats)
      deletionLog.push(`Deleted ${followups.length} followup queue entries`)
    }

    // 13. Finally, delete the customer record
    if (customer) {
      await client
        .from("customers")
        .delete()
        .eq("id", customer.id)
      deletionLog.push(`Deleted customer record`)
    }

    console.log(`[admin] Reset complete for ${phone}:`, deletionLog)

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
