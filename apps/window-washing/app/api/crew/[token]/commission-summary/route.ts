import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import {
  accumulateSalesmanRevenue,
  calculateSalesmanPay,
  type VisitForSalesmanPayroll,
} from "@/lib/payroll"

/**
 * GET /api/crew/[token]/commission-summary
 *
 * Token-authenticated read of this pay-period's pending commission for the
 * salesman who owns the token. Runs the same attribution logic as
 * generatePayrollWeek but without freezing a payroll week row, so the
 * salesman can see a live number in their portal without blocking the
 * admin's weekly run.
 *
 * Returns `{ range, revenue, total_pay, rate }`.
 * Only salesman-type cleaners get non-zero output; other roles get zeros.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const client = getSupabaseServiceClient()

  const { data: cleaner } = await client
    .from("cleaners")
    .select("id, tenant_id, employee_type, active")
    .eq("portal_token", token)
    .is("deleted_at", null)
    .maybeSingle()

  if (!cleaner || !cleaner.active) {
    return NextResponse.json(
      { success: false, error: "Invalid portal link" },
      { status: 404 }
    )
  }

  if (cleaner.employee_type !== "salesman") {
    return NextResponse.json({
      success: true,
      data: {
        revenue: { onetime: 0, triannual: 0, quarterly: 0 },
        total_pay: 0,
        rate: null,
      },
    })
  }

  // Current pay period = current ISO week Mon-Sun. Simplest safe floor.
  const now = new Date()
  const day = (now.getUTCDay() + 6) % 7 // Monday = 0
  const weekStartDate = new Date(now)
  weekStartDate.setUTCDate(now.getUTCDate() - day)
  weekStartDate.setUTCHours(0, 0, 0, 0)
  const weekEndDate = new Date(weekStartDate)
  weekEndDate.setUTCDate(weekStartDate.getUTCDate() + 6)
  const weekStart = weekStartDate.toISOString().slice(0, 10)
  const weekEnd = weekEndDate.toISOString().slice(0, 10)

  const { data: visits } = await client
    .from("visits")
    .select(
      `id,
       jobs(id, salesman_id, credited_salesman_id,
            service_plan_jobs(service_plans(recurrence))),
       visit_line_items(price, revenue_type)`
    )
    .eq("tenant_id", cleaner.tenant_id)
    .gte("visit_date", weekStart)
    .lte("visit_date", weekEnd)
    .in("status", ["closed", "payment_collected", "checklist_done", "completed"])

  const salesmanRevenue: Record<
    number,
    { onetime: number; triannual: number; quarterly: number }
  > = {}
  for (const v of visits ?? []) {
    accumulateSalesmanRevenue(v as unknown as VisitForSalesmanPayroll, salesmanRevenue)
  }

  const mine = salesmanRevenue[cleaner.id] ?? {
    onetime: 0,
    triannual: 0,
    quarterly: 0,
  }

  const { data: rate } = await client
    .from("pay_rates")
    .select(
      "commission_1time_pct, commission_triannual_pct, commission_quarterly_pct"
    )
    .eq("tenant_id", cleaner.tenant_id)
    .eq("cleaner_id", cleaner.id)
    .eq("role", "salesman")
    .maybeSingle()

  const totalPay = calculateSalesmanPay(
    mine.onetime,
    mine.triannual,
    mine.quarterly,
    rate?.commission_1time_pct ?? 0,
    rate?.commission_triannual_pct ?? 0,
    rate?.commission_quarterly_pct ?? 0
  )

  return NextResponse.json({
    success: true,
    data: {
      range: { start: weekStart, end: weekEnd },
      revenue: mine,
      total_pay: totalPay,
      rate: rate
        ? {
            onetime: rate.commission_1time_pct ?? 0,
            triannual: rate.commission_triannual_pct ?? 0,
            quarterly: rate.commission_quarterly_pct ?? 0,
          }
        : null,
    },
  })
}
