/**
 * Service Plans Engine for WinBros
 *
 * Handles recurring service plan management:
 * - Plan creation with line items
 * - Customer contract sending + signature
 * - Auto-generation of future jobs into the "Service Plan Bank"
 * - Plan types: quarterly, triannual, triannual_exterior, monthly, biannual
 */

import { SupabaseClient } from '@supabase/supabase-js'

type PlanType = 'quarterly' | 'triannual' | 'triannual_exterior' | 'monthly' | 'biannual'

interface ServicePlan {
  id: number
  customer_id: number
  tenant_id: string
  plan_type: PlanType
  service_months: number[]
  plan_price: number
  normal_price: number | null
  status: string
  first_service_date: string | null
  salesman_id: number | null
}

/**
 * Calculate service months based on plan type and start month.
 *
 * - Quarterly: every 3 months from start (4 services/year)
 * - Triannual: every 4 months from start (3 services/year)
 * - Monthly: every month (12 services/year)
 * - Biannual: every 6 months from start (2 services/year)
 */
export function calculateServiceMonths(
  planType: PlanType,
  startMonth: number
): number[] {
  const months: number[] = []

  switch (planType) {
    case 'quarterly': {
      // Every 3 months
      for (let i = 0; i < 4; i++) {
        const month = ((startMonth - 1 + i * 3) % 12) + 1
        months.push(month)
      }
      break
    }
    case 'triannual':
    case 'triannual_exterior': {
      // Every 4 months
      for (let i = 0; i < 3; i++) {
        const month = ((startMonth - 1 + i * 4) % 12) + 1
        months.push(month)
      }
      break
    }
    case 'monthly': {
      for (let i = 1; i <= 12; i++) {
        months.push(i)
      }
      break
    }
    case 'biannual': {
      for (let i = 0; i < 2; i++) {
        const month = ((startMonth - 1 + i * 6) % 12) + 1
        months.push(month)
      }
      break
    }
  }

  return months.sort((a, b) => a - b)
}

/**
 * Get the target week (1-5) from a date.
 */
export function getWeekOfMonth(date: Date): number {
  const dayOfMonth = date.getUTCDate()
  return Math.ceil(dayOfMonth / 7)
}

/**
 * Generate service plan jobs (the "bank") for the next year from a given start date.
 * Jobs are placed in the unscheduled bank, organized by month and target week.
 */
export async function generateServicePlanJobs(
  client: SupabaseClient,
  planId: number
): Promise<{ success: boolean; jobs_created: number; error?: string }> {
  // Fetch plan
  const { data: plan, error: planError } = await client
    .from('service_plans')
    .select('*')
    .eq('id', planId)
    .single()

  if (planError || !plan) {
    return { success: false, jobs_created: 0, error: `Plan not found: ${planError?.message}` }
  }

  if (!plan.first_service_date) {
    return { success: false, jobs_created: 0, error: 'Plan has no first service date' }
  }

  const firstDate = new Date(plan.first_service_date)
  const targetWeek = getWeekOfMonth(firstDate)
  const currentYear = firstDate.getFullYear()
  const startMonth = firstDate.getMonth() + 1 // 1-indexed

  // Get the service months (either from plan or calculate)
  const serviceMonths: number[] = plan.service_months?.length > 0
    ? plan.service_months
    : calculateServiceMonths(plan.plan_type, startMonth)

  // Generate jobs for current year and next year
  const jobsToCreate: Array<{
    service_plan_id: number
    customer_id: number
    tenant_id: string
    scheduled_month: number
    scheduled_year: number
    target_week: number
    status: string
  }> = []

  for (const year of [currentYear, currentYear + 1]) {
    for (const month of serviceMonths) {
      // Skip months that are before the first service
      if (year === currentYear && month < startMonth) continue
      // Skip the first service month itself (that's the initial job)
      if (year === currentYear && month === startMonth) continue

      jobsToCreate.push({
        service_plan_id: plan.id,
        customer_id: plan.customer_id,
        tenant_id: plan.tenant_id,
        scheduled_month: month,
        scheduled_year: year,
        target_week: targetWeek,
        status: 'unscheduled',
      })
    }
  }

  if (jobsToCreate.length === 0) {
    return { success: true, jobs_created: 0 }
  }

  const { error: insertError } = await client
    .from('service_plan_jobs')
    .insert(jobsToCreate)

  if (insertError) {
    return { success: false, jobs_created: 0, error: `Failed to create plan jobs: ${insertError.message}` }
  }

  return { success: true, jobs_created: jobsToCreate.length }
}

/**
 * Activate a service plan after customer signature.
 * - Sets plan status to 'active'
 * - Generates future jobs into the bank
 */
export async function activateServicePlan(
  client: SupabaseClient,
  planId: number,
  signatureData: string
): Promise<{ success: boolean; jobs_created: number; error?: string }> {
  // Update plan status
  const { error: updateError } = await client
    .from('service_plans')
    .update({
      status: 'active',
      signature_data: signatureData,
      signed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', planId)
    .in('status', ['sent', 'draft']) // Sent or draft plans can be activated

  if (updateError) {
    return { success: false, jobs_created: 0, error: `Failed to activate: ${updateError.message}` }
  }

  // Generate future jobs
  return generateServicePlanJobs(client, planId)
}

/**
 * Get unscheduled service plan jobs for a tenant, grouped by month.
 */
export async function getUnscheduledPlanJobs(
  client: SupabaseClient,
  tenantId: string,
  year: number
): Promise<Record<number, Array<{
  id: number
  customer_id: number
  service_plan_id: number
  scheduled_month: number
  target_week: number
}>>> {
  const { data: jobs } = await client
    .from('service_plan_jobs')
    .select('id, customer_id, service_plan_id, scheduled_month, target_week')
    .eq('tenant_id', tenantId)
    .eq('scheduled_year', year)
    .eq('status', 'unscheduled')
    .order('scheduled_month', { ascending: true })

  // Group by month
  const grouped: Record<number, Array<{
    id: number
    customer_id: number
    service_plan_id: number
    scheduled_month: number
    target_week: number
  }>> = {}
  for (const job of jobs || []) {
    if (!grouped[job.scheduled_month]) {
      grouped[job.scheduled_month] = []
    }
    grouped[job.scheduled_month]!.push(job)
  }

  return grouped
}

/**
 * Calculate ARR (Annual Recurring Revenue) by plan type.
 */
export async function calculateARR(
  client: SupabaseClient,
  tenantId: string
): Promise<{
  quarterly: number
  triannual: number
  triannual_exterior: number
  monthly: number
  biannual: number
  total: number
}> {
  const { data: plans } = await client
    .from('service_plans')
    .select('plan_type, plan_price')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')

  const arr = {
    quarterly: 0,
    triannual: 0,
    triannual_exterior: 0,
    monthly: 0,
    biannual: 0,
    total: 0,
  }

  for (const plan of plans || []) {
    const annualRevenue = getAnnualRevenue(plan.plan_type as PlanType, Number(plan.plan_price))
    const type = plan.plan_type as PlanType
    if (type in arr) {
      arr[type] += annualRevenue
    }
    arr.total += annualRevenue
  }

  return arr
}

/**
 * Calculate annual revenue from a single plan price and type.
 */
export function getAnnualRevenue(planType: PlanType, pricePerVisit: number): number {
  switch (planType) {
    case 'quarterly':
      return pricePerVisit * 4
    case 'triannual':
    case 'triannual_exterior':
      return pricePerVisit * 3
    case 'monthly':
      return pricePerVisit * 12
    case 'biannual':
      return pricePerVisit * 2
    default:
      return pricePerVisit
  }
}
