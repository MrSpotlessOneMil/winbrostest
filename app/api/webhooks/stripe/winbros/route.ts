import { NextRequest, NextResponse } from 'next/server'
import { validateStripeWebhook } from '@/lib/stripe-client'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { processStripeEvent } from '../route'

/**
 * WinBros-specific Stripe webhook endpoint.
 * Validates using WinBros's own webhook signing secret from the DB,
 * then delegates to the shared event processor.
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.text()
    const signature = request.headers.get('stripe-signature')

    // Fetch the WinBros tenant's webhook secret from DB
    let winbrosSecret: string | undefined
    try {
      const client = getSupabaseServiceClient()
      const { data } = await client
        .from('tenants')
        .select('stripe_webhook_secret')
        .eq('slug', 'winbros')
        .single()
      winbrosSecret = data?.stripe_webhook_secret || undefined
    } catch (err) {
      console.error('[Stripe/WinBros] Failed to fetch tenant webhook secret:', err)
    }

    const event = validateStripeWebhook(payload, signature, winbrosSecret)

    if (!event) {
      console.error('[Stripe/WinBros] Invalid webhook signature')
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 })
    }

    await processStripeEvent(event)

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[Stripe/WinBros] Error processing webhook:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
