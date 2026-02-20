import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabaseServiceClient } from '@/lib/supabase'
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

    // Get job with cleaner info
    const { data: job, error: jobError } = await client
      .from('jobs')
      .select('id, cleaner_id, phone_number, service_type')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      return NextResponse.json(
        { success: false, error: 'Job not found' },
        { status: 404 }
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
