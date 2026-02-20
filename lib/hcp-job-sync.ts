/**
 * Centralized HouseCall Pro job sync.
 * Call this after creating a job from ANY source (VAPI, SMS, Stripe, dashboard)
 * to mirror it into HCP. Skips gracefully if HCP is not configured for the tenant.
 */

import { createHCPJob, findOrCreateHCPCustomer, listHCPEmployees, updateHCPJob } from './housecall-pro-api'
import { getSupabaseServiceClient } from './supabase'
import type { Tenant } from './tenant'

export async function syncNewJobToHCP(params: {
  tenant: Tenant
  jobId: number
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  address?: string | null
  serviceType?: string | null
  scheduledDate?: string | null
  scheduledTime?: string | null
  durationHours?: number | null
  price?: number | null
  notes?: string | null
}): Promise<void> {
  const { tenant, jobId } = params

  if (!tenant.housecall_pro_api_key) {
    return
  }

  try {
    const client = getSupabaseServiceClient()

    const { data: jobRow } = await client
      .from('jobs')
      .select(`
        id,
        customer_id,
        phone_number,
        address,
        service_type,
        date,
        scheduled_at,
        price,
        hours,
        notes,
        team_id,
        housecall_pro_job_id,
        customers (
          first_name,
          last_name,
          email,
          phone_number,
          address
        ),
        cleaner_assignments (
          status,
          cleaners (
            id,
            name,
            phone,
            email
          )
        )
      `)
      .eq('id', jobId)
      .maybeSingle()

    const customer = (jobRow as any)?.customers
    const firstName = params.firstName ?? customer?.first_name ?? undefined
    const lastName = params.lastName ?? customer?.last_name ?? undefined
    const email = params.email ?? customer?.email ?? undefined
    const phone = params.phone ?? (jobRow as any)?.phone_number ?? customer?.phone_number ?? ''
    const address = params.address ?? (jobRow as any)?.address ?? customer?.address ?? undefined
    const serviceType = params.serviceType ?? (jobRow as any)?.service_type ?? 'Cleaning Service'
    const scheduledDate = params.scheduledDate ?? (jobRow as any)?.date ?? undefined
    const scheduledTime = params.scheduledTime ?? (jobRow as any)?.scheduled_at ?? undefined
    const price = params.price ?? (jobRow as any)?.price ?? undefined
    const durationHours = params.durationHours ?? (jobRow as any)?.hours ?? undefined
    const baseNotes = params.notes ?? (jobRow as any)?.notes ?? null
    const teamId = (jobRow as any)?.team_id as number | null
    const existingHcpJobId = (jobRow as any)?.housecall_pro_job_id as string | null

    if (!phone) {
      console.error(`[HCP Sync] Missing phone for local job ${jobId}; cannot create HCP customer profile`)
      return
    }

    // Build assignment metadata from current OSIRIS state.
    const assignments = Array.isArray((jobRow as any)?.cleaner_assignments)
      ? (jobRow as any).cleaner_assignments
      : []
    const activeAssignments = assignments.filter((a: any) => {
      const status = String(a?.status || '').toLowerCase()
      return status === 'confirmed' || status === 'accepted' || status === 'pending'
    })
    const assignedCleaners = activeAssignments
      .map((a: any) => a?.cleaners)
      .filter((c: any) => c && (c.name || c.phone || c.email))

    let teamName: string | null = null
    if (teamId != null) {
      const { data: teamRow } = await client
        .from('teams')
        .select('name')
        .eq('id', teamId)
        .maybeSingle()
      teamName = (teamRow as any)?.name || null
    }

    const notesLines: string[] = []
    if (baseNotes && String(baseNotes).trim()) notesLines.push(String(baseNotes).trim())
    notesLines.push(`OSIRIS Job ID: ${jobId}`)
    if (teamName) notesLines.push(`Team: ${teamName}`)
    if (assignedCleaners.length > 0) {
      notesLines.push(
        `Assigned Cleaners: ${assignedCleaners.map((c: any) => c.name || c.phone || c.email).join(', ')}`
      )
    }
    if (price != null) notesLines.push(`Quoted Price: $${Number(price).toFixed(2)}`)
    const notes = notesLines.join('\n')

    // Ensure customer profile exists in HCP before creating/updating job.
    const hcpCustomer = await findOrCreateHCPCustomer(tenant, {
      firstName,
      lastName,
      phone,
      email,
      address,
    })

    if (!hcpCustomer.success || !hcpCustomer.customerId) {
      console.error(`[HCP Sync] Failed to find/create HCP customer for job ${jobId}: ${hcpCustomer.error}`)
      return
    }
    const hcpAddressId = hcpCustomer.addressId

    // Resolve HCP employees from assigned cleaners so the job lands on the right HCP calendar.
    let assignedEmployeeIds: string[] = []
    if (assignedCleaners.length > 0) {
      const employeesResult = await listHCPEmployees(tenant)
      if (employeesResult.success && employeesResult.employees?.length) {
        assignedEmployeeIds = matchCleanerAssignmentsToHcpEmployees(
          assignedCleaners,
          employeesResult.employees
        )
      }
    }

    const lineItems = price != null
      ? [{
          name: String(serviceType || 'Cleaning Service'),
          quantity: 1,
          unit_price: Number(price),
        }]
      : undefined

    if (existingHcpJobId) {
      const updated = await updateHCPJob(tenant, existingHcpJobId, {
        scheduledDate,
        scheduledTime,
        address,
        serviceType,
        price: price == null ? undefined : Number(price),
        durationHours: durationHours == null ? undefined : Number(durationHours),
        notes,
        lineItems,
        assignedEmployeeIds,
      })
      if (!updated.success) {
        console.error(`[HCP Sync] Failed updating HCP job ${existingHcpJobId} for local job ${jobId}: ${updated.error}`)
      } else {
        console.log(`[HCP Sync] Updated HCP job ${existingHcpJobId} from local job ${jobId}`)
      }
      return
    }

    if (!hcpAddressId) {
      console.error(
        `[HCP Sync] Cannot create HCP job for local job ${jobId}: missing address_id on HCP customer ${hcpCustomer.customerId}`
      )
      return
    }

    const created = await createHCPJob(tenant, {
      customerId: hcpCustomer.customerId,
      addressId: hcpAddressId,
      scheduledDate,
      scheduledTime,
      address,
      serviceType,
      price: price == null ? undefined : Number(price),
      durationHours: durationHours == null ? undefined : Number(durationHours),
      notes,
      lineItems,
      assignedEmployeeIds,
    })

    if (!created.success || !created.jobId) {
      console.error(`[HCP Sync] Failed to create HCP job for local job ${jobId}: ${created.error}`)
      return
    }

    const { error: updateErr } = await client
      .from('jobs')
      .update({ housecall_pro_job_id: created.jobId })
      .eq('id', jobId)

    if (updateErr) {
      console.error(`[HCP Sync] Job ${jobId} synced to HCP (${created.jobId}) but failed to store ID locally: ${updateErr.message}`)
    } else {
      console.log(`[HCP Sync] Job ${jobId} synced to HCP: ${created.jobId}`)
    }
  } catch (err) {
    console.error(`[HCP Sync] Unexpected error syncing job ${jobId} to HCP:`, err)
  }
}

function normalizePhoneForMatch(value: string | null | undefined): string {
  return (value || '').replace(/\D+/g, '').slice(-10)
}

function normalizeNameForMatch(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchCleanerAssignmentsToHcpEmployees(
  assignedCleaners: Array<{ name?: string; phone?: string; email?: string }>,
  employees: Array<{ id: string; first_name?: string; last_name?: string; email?: string; mobile_number?: string; phone?: string }>
): string[] {
  const employeeById = new Map(employees.map((e) => [e.id, e]))
  const matched = new Set<string>()

  for (const cleaner of assignedCleaners) {
    const cleanerPhone = normalizePhoneForMatch(cleaner.phone)
    const cleanerEmail = (cleaner.email || '').toLowerCase().trim()
    const cleanerName = normalizeNameForMatch(cleaner.name)

    for (const employee of employees) {
      const empPhone = normalizePhoneForMatch(employee.mobile_number || employee.phone)
      const empEmail = (employee.email || '').toLowerCase().trim()
      const empName = normalizeNameForMatch(`${employee.first_name || ''} ${employee.last_name || ''}`)

      const phoneMatch = cleanerPhone && empPhone && cleanerPhone === empPhone
      const emailMatch = cleanerEmail && empEmail && cleanerEmail === empEmail
      const nameMatch = cleanerName && empName && cleanerName === empName

      if (phoneMatch || emailMatch || nameMatch) {
        matched.add(employee.id)
        break
      }
    }
  }

  return [...matched].filter((id) => employeeById.has(id))
}
