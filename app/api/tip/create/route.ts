import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { logSystemEvent } from '@/lib/system-events'
import { getApiKey } from '@/lib/user-api-keys'
import { getClientConfig } from '@/lib/client-config'

function getStripeClient(): Stripe {
  const rawKey = getApiKey('stripeSecretKey')
  const secretKey = rawKey ? rawKey.replace(/[\r\n]/g, '').trim() : ''

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY not configured')
  }

  return new Stripe(secretKey, {
    apiVersion: '2025-02-24.acacia',
  })
}

function getClientDomain(): string {
  const domain = getClientConfig().domain
  return domain.endsWith('/') ? domain.slice(0, -1) : domain
}

/**
 * POST /api/tip/create
 * Create a Stripe checkout session for tipping a cleaner
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { jobId, amount } = body

    if (!jobId) {
      return NextResponse.json(
        { success: false, error: 'Job ID required' },
        { status: 400 }
      )
    }

    const tipAmount = parseFloat(amount)
    if (isNaN(tipAmount) || tipAmount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid tip amount' },
        { status: 400 }
      )
    }

    // Max tip of $500 for safety
    if (tipAmount > 500) {
      return NextResponse.json(
        { success: false, error: 'Tip amount exceeds maximum allowed' },
        { status: 400 }
      )
    }

    const client = getSupabaseServiceClient()

    // Get job with cleaner info — validate job exists and is in a tippable state
    const { data: job, error: jobError } = await client
      .from('jobs')
      .select('id, cleaner_id, phone_number, service_type, status')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      return NextResponse.json(
        { success: false, error: 'Job not found' },
        { status: 404 }
      )
    }

    // Only allow tips for completed or assigned jobs
    const tippableStatuses = ['completed', 'assigned', 'in_progress']
    if (!tippableStatuses.includes(job.status)) {
      return NextResponse.json(
        { success: false, error: 'Tips can only be created for active or completed jobs' },
        { status: 400 }
      )
    }

    // Rate limit: max 5 tip sessions per job per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString()
    const { count: recentTipCount } = await client
      .from('system_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'TIP_SESSION_CREATED')
      .eq('metadata->>job_id', jobId)
      .gte('created_at', oneHourAgo)

    if (recentTipCount && recentTipCount >= 5) {
      return NextResponse.json(
        { success: false, error: 'Too many tip attempts for this job. Please try again later.' },
        { status: 429 }
      )
    }

    // Get cleaner name for the payment description
    let cleanerName = 'Cleaner'
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

    // Create Stripe checkout session
    const stripe = getStripeClient()
    const domain = getClientDomain()
    const amountCents = Math.round(tipAmount * 100)

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Tip for ${cleanerName}`,
              description: `Thank you for your generosity! 100% goes to ${cleanerName}.`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${domain}/tip/${jobId}/success`,
      cancel_url: `${domain}/tip/${jobId}`,
      metadata: {
        job_id: jobId,
        cleaner_id: job.cleaner_id || '',
        payment_type: 'TIP',
        tip_amount: tipAmount.toFixed(2),
      },
    })

    console.log(`[tip/create] Created tip session ${session.id} for $${tipAmount.toFixed(2)}`)

    // Log for rate limiting
    await logSystemEvent({
      source: 'tip',
      event_type: 'TIP_SESSION_CREATED',
      message: `Tip session created for job ${jobId}: $${tipAmount.toFixed(2)}`,
      metadata: { job_id: jobId, session_id: session.id, amount: tipAmount },
    }).catch(() => {}) // fire-and-forget

    return NextResponse.json({
      success: true,
      url: session.url,
      sessionId: session.id,
    })
  } catch (error) {
    console.error('[tip/create] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create tip payment' },
      { status: 500 }
    )
  }
}
