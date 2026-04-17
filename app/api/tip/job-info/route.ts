import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getTenantById } from '@/lib/tenant'

/**
 * GET /api/tip/job-info?jobId=xxx
 * Fetch job information for the tip page (public endpoint)
 */
export async function GET(request: NextRequest) {
  try {
    const jobId = request.nextUrl.searchParams.get('jobId')

    if (!jobId) {
      return NextResponse.json(
        { success: false, error: 'Job ID required' },
        { status: 400 }
      )
    }

    const client = getSupabaseServiceClient()

    // Get job with cleaner info
    const { data: job, error: jobError } = await client
      .from('jobs')
      .select(`
        id,
        tenant_id,
        service_type,
        date,
        cleaner_id,
        customer_id,
        phone_number
      `)
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      return NextResponse.json(
        { success: false, error: 'Job not found' },
        { status: 404 }
      )
    }

    // Get cleaner name
    let cleanerName = 'Your Cleaner'
    if (job.cleaner_id) {
      const { data: cleaner } = await client
        .from('cleaners')
        .select('name')
        .eq('id', job.cleaner_id)
        .single()

      if (cleaner?.name) {
        cleanerName = cleaner.name
      }
    }

    // Get tenant/business name from the job's tenant_id
    const tenant = job.tenant_id ? await getTenantById(job.tenant_id) : null
    const businessName = tenant?.business_name || 'Cleaning Service'
    const tenantSlug = tenant?.slug || ''

    return NextResponse.json({
      success: true,
      data: {
        cleanerName,
        serviceType: job.service_type || 'Cleaning Service',
        date: job.date,
        businessName,
        tenantSlug,
      },
    })
  } catch (error) {
    console.error('[tip/job-info] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch job info' },
      { status: 500 }
    )
  }
}
