import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getInvoice } from "@/lib/stripe-client"
import { getQuotePricing } from "@/lib/quote-pricing"

/**
 * GET -- Fetch invoice details for a customer's jobs (Invoices tab)
 * Query params: customerId (required)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const customerId = request.nextUrl.searchParams.get("customerId")
  if (!customerId) {
    return NextResponse.json({ error: "customerId required" }, { status: 400 })
  }

  const serviceClient = getSupabaseServiceClient()

  // Cross-tenant check: verify customer belongs to this tenant
  const { data: customer } = await serviceClient
    .from("customers")
    .select("id, tenant_id")
    .eq("id", customerId)
    .single()

  if (!customer || customer.tenant_id !== tenant.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Fetch all jobs for this customer
  const { data: jobs, error: jobsError } = await serviceClient
    .from("jobs")
    .select("id, service_type, date, price, status, paid, payment_status, quote_id, stripe_invoice_id, invoice_sent, created_at")
    .eq("customer_id", Number(customerId))
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })

  if (jobsError) {
    console.error("[job-invoice-details] Error fetching jobs:", jobsError.message)
    return NextResponse.json({ error: "Failed to load jobs" }, { status: 500 })
  }

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ invoices: [] })
  }

  // Filter to jobs that have been invoiced
  const invoicedJobs = jobs.filter(j => j.invoice_sent || j.stripe_invoice_id)

  const invoices = []

  for (const job of invoicedJobs) {
    let tier: string | null = null
    let addons: string[] = []
    let subtotal: number | null = null
    let total: number | null = null
    let discount: number | null = null
    let invoiceUrl: string | null = null
    let invoicePdfUrl: string | null = null
    let invoiceStatus: string = "sent"

    // Get quote details if available (for tier/addon labels and pricing breakdown)
    if (job.quote_id) {
      const { data: quote } = await serviceClient
        .from("quotes")
        .select("selected_tier, selected_addons, subtotal, total, discount, service_category, bedrooms, bathrooms, sqft")
        .eq("id", job.quote_id)
        .single()

      if (quote) {
        subtotal = Number(quote.subtotal) || null
        total = Number(quote.total) || null
        discount = Number(quote.discount) || null

        // Get human-readable tier and addon names via the pricing engine
        const serviceCategory = (quote.service_category === "move_in_out" ? "move_in_out" : "standard") as "standard" | "move_in_out"
        try {
          const pricing = await getQuotePricing(
            tenant.id,
            tenant.slug,
            { squareFootage: quote.sqft, bedrooms: quote.bedrooms, bathrooms: quote.bathrooms },
            serviceCategory
          )
          const tierDef = pricing.tiers.find(t => t.key === quote.selected_tier)
          tier = tierDef?.name || quote.selected_tier || null

          if (quote.selected_addons && Array.isArray(quote.selected_addons)) {
            addons = quote.selected_addons.map((key: string) => {
              const addonDef = pricing.addons.find(a => a.key === key)
              return addonDef?.name || key
            })
          }
        } catch {
          // Fallback to raw keys if pricing engine fails
          tier = quote.selected_tier
          addons = quote.selected_addons || []
        }
      }
    }

    // Get Stripe invoice details if available
    if (job.stripe_invoice_id && tenant.stripe_secret_key) {
      try {
        const stripeInvoice = await getInvoice(job.stripe_invoice_id, tenant.stripe_secret_key)
        if (stripeInvoice) {
          invoiceUrl = stripeInvoice.hosted_invoice_url || null
          invoicePdfUrl = stripeInvoice.invoice_pdf || null
          invoiceStatus = stripeInvoice.status || "sent"
        }
      } catch (err) {
        console.warn(`[job-invoice-details] Failed to fetch Stripe invoice ${job.stripe_invoice_id}:`, err)
      }
    }

    invoices.push({
      jobId: job.id,
      serviceType: job.service_type,
      date: job.date,
      price: job.price,
      jobStatus: job.status,
      paid: job.paid,
      tier,
      addons,
      subtotal,
      total,
      discount,
      invoiceUrl,
      invoicePdfUrl,
      invoiceStatus,
    })
  }

  return NextResponse.json({ invoices })
}
