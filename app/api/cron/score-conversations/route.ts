/**
 * Score Lost Conversations Cron
 *
 * Runs every 6 hours. Finds customers who had SMS conversations but never booked,
 * with no activity in 48+ hours. Scores them as losses with AI-classified reasons.
 *
 * Endpoint: GET /api/cron/score-conversations
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getAllActiveTenants } from '@/lib/tenant'
import { scoreConversation } from '@/lib/conversation-scoring'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'

// route-check:no-vercel-cron
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()
  let scored = 0
  let errors = 0

  for (const tenant of tenants) {
    try {
      // Find customers with messages but no job (quoted/scheduled/completed),
      // last message > 48 hours ago, not yet scored
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

      const { data: staleConversations } = await client
        .from('messages')
        .select('customer_id, phone_number, created_at')
        .eq('tenant_id', tenant.id)
        .eq('direction', 'inbound')
        .lt('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(100)

      if (!staleConversations?.length) continue

      // Deduplicate by customer_id
      const seen = new Set<number>()
      const uniqueCustomers = staleConversations.filter(m => {
        if (!m.customer_id || seen.has(m.customer_id)) return false
        seen.add(m.customer_id)
        return true
      })

      for (const conv of uniqueCustomers) {
        // Check if already scored
        const { data: existing } = await client
          .from('conversation_outcomes')
          .select('id')
          .eq('tenant_id', tenant.id)
          .eq('customer_id', conv.customer_id)
          .eq('conversation_type', 'sms')
          .limit(1)
          .maybeSingle()

        if (existing) continue

        // Check if customer has any booked/completed job
        const { data: hasJob } = await client
          .from('jobs')
          .select('id')
          .eq('tenant_id', tenant.id)
          .eq('customer_id', conv.customer_id)
          .in('status', ['quoted', 'scheduled', 'in_progress', 'completed'])
          .limit(1)
          .maybeSingle()

        if (hasJob) continue // They booked — will be scored as win via Stripe webhook

        // Load conversation history
        const { data: messages } = await client
          .from('messages')
          .select('direction, content, created_at')
          .eq('customer_id', conv.customer_id)
          .eq('tenant_id', tenant.id)
          .order('created_at', { ascending: true })
          .limit(50)

        if (!messages?.length || messages.length < 2) continue // Need at least a back-and-forth

        const conversationText = messages
          .map(m => `${m.direction === 'inbound' ? 'Customer' : 'Agent'}: ${m.content}`)
          .join('\n')

        const firstMsg = messages[0]
        const lastMsg = messages[messages.length - 1]

        try {
          await scoreConversation({
            tenantId: tenant.id,
            customerId: conv.customer_id,
            phone: conv.phone_number,
            conversationType: 'sms',
            conversationText,
            outcome: 'lost',
            messageCount: messages.length,
            conversationStartedAt: firstMsg.created_at,
          })
          scored++
        } catch (scoreErr) {
          console.error(`[ScoreConv] Failed to score customer ${conv.customer_id}:`, scoreErr)
          errors++
        }
      }
    } catch (tenantErr) {
      console.error(`[ScoreConv] Error processing tenant ${tenant.slug}:`, tenantErr)
      errors++
    }
  }

  console.log(`[ScoreConv] Done: ${scored} scored, ${errors} errors`)

  return NextResponse.json({
    success: true,
    scored,
    errors,
  })
}
