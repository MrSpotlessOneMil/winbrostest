/**
 * Crew Performance Tracking
 *
 * Tracks upsells, tips, and Google reviews per crew.
 * Handles review attribution and bonus calculations.
 */

import { createClient } from '@supabase/supabase-js'
import { REVIEW_BONUS_CONFIG } from '@/integrations/housecall-pro/constants'

// Lazy Supabase client — created on first call, not at module load time.
// Top-level createClient() crashes during `next build` because env vars
// aren't available when Vercel collects page data.
let _supabase: ReturnType<typeof createClient> | null = null
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _supabase
}

// Crew performance record
export interface CrewPerformance {
  id: string
  crew_id: string
  brand: string
  period_start: string
  period_end: string
  jobs_completed: number
  upsells_offered: number
  upsells_accepted: number
  upsell_revenue_cents: number
  tips_collected_cents: number
  google_reviews_earned: number
  review_bonus_cents: number
  created_at: string
  updated_at: string
}

// Performance stats summary
export interface PerformanceStats {
  crewId: string
  period: string
  jobsCompleted: number
  upsellRate: number
  upsellRevenue: number
  tipsCollected: number
  reviewsEarned: number
  reviewBonus: number
  totalBonus: number
}

// Review attribution record
export interface ReviewAttribution {
  id: string
  brand: string
  crew_id?: string
  job_id?: string
  customer_phone: string
  review_source: string
  review_rating?: number
  review_text?: string
  bonus_cents: number
  bonus_paid: boolean
  bonus_paid_at?: string
  created_at: string
}

/**
 * Get or create performance record for current period
 */
async function getOrCreatePerformanceRecord(
  crewId: string,
  date: Date = new Date()
): Promise<{ id: string; record: CrewPerformance }> {
  // Use week as period (Monday to Sunday)
  const periodStart = getWeekStart(date)
  const periodEnd = getWeekEnd(date)

  // Try to find existing record
  const { data: existing } = await getSupabase()
    .from('crew_performance')
    .select('*')
    .eq('crew_id', crewId)
    .eq('brand', 'winbros')
    .eq('period_start', periodStart)
    .single()

  if (existing) {
    return { id: existing.id, record: existing }
  }

  // Create new record
  const { data: newRecord, error } = await getSupabase()
    .from('crew_performance')
    .insert({
      crew_id: crewId,
      brand: 'winbros',
      period_start: periodStart,
      period_end: periodEnd,
    })
    .select('*')
    .single()

  if (error) {
    throw new Error(`Failed to create performance record: ${error.message}`)
  }

  return { id: newRecord.id, record: newRecord }
}

/**
 * Record a job completion
 */
export async function recordJobCompletion(
  jobId: string,
  crewId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { id, record } = await getOrCreatePerformanceRecord(crewId)

    const { error } = await supabase
      .from('crew_performance')
      .update({
        jobs_completed: record.jobs_completed + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) {
      return { success: false, error: error.message }
    }

    console.log(`[Performance] Recorded job completion for crew ${crewId}`)
    return { success: true }
  } catch (error) {
    console.error('[Performance] Failed to record job completion:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/**
 * Record an upsell offer and result
 */
export async function recordUpsell(
  jobId: string,
  crewId: string,
  accepted: boolean,
  revenueCents?: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const { id, record } = await getOrCreatePerformanceRecord(crewId)

    const updates: Partial<CrewPerformance> = {
      upsells_offered: record.upsells_offered + 1,
      updated_at: new Date().toISOString(),
    }

    if (accepted) {
      updates.upsells_accepted = record.upsells_accepted + 1
      if (revenueCents) {
        updates.upsell_revenue_cents = record.upsell_revenue_cents + revenueCents
      }
    }

    const { error } = await supabase
      .from('crew_performance')
      .update(updates)
      .eq('id', id)

    if (error) {
      return { success: false, error: error.message }
    }

    console.log(
      `[Performance] Recorded upsell for crew ${crewId}: ${accepted ? 'accepted' : 'declined'}`
    )
    return { success: true }
  } catch (error) {
    console.error('[Performance] Failed to record upsell:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/**
 * Record a tip
 */
export async function recordTip(
  jobId: string,
  crewId: string,
  amountCents: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const { id, record } = await getOrCreatePerformanceRecord(crewId)

    const { error } = await supabase
      .from('crew_performance')
      .update({
        tips_collected_cents: record.tips_collected_cents + amountCents,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) {
      return { success: false, error: error.message }
    }

    console.log(`[Performance] Recorded tip for crew ${crewId}: $${(amountCents / 100).toFixed(2)}`)
    return { success: true }
  } catch (error) {
    console.error('[Performance] Failed to record tip:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/**
 * Track review request sent (for attribution)
 */
export async function trackReviewSent(
  jobId: string,
  crewId: string,
  customerPhone: string
): Promise<{ success: boolean; attributionId?: string; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('review_attributions')
      .insert({
        brand: 'winbros',
        crew_id: crewId,
        job_id: jobId,
        customer_phone: customerPhone,
        review_source: 'google',
        bonus_cents: REVIEW_BONUS_CONFIG.AMOUNT_CENTS,
        bonus_paid: false,
      })
      .select('id')
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    console.log(`[Performance] Review request tracked for crew ${crewId}`)
    return { success: true, attributionId: data.id }
  } catch (error) {
    console.error('[Performance] Failed to track review sent:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/**
 * Record a Google review received (match by customer phone)
 */
export async function recordReviewReceived(
  customerPhone: string,
  rating: number,
  reviewText?: string
): Promise<{ success: boolean; crewId?: string; bonusCents?: number; error?: string }> {
  try {
    // Find pending attribution for this customer
    const { data: attribution, error: findError } = await supabase
      .from('review_attributions')
      .select('*')
      .eq('customer_phone', customerPhone)
      .eq('brand', 'winbros')
      .is('review_rating', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (findError || !attribution) {
      console.log(`[Performance] No attribution found for phone ${customerPhone}`)
      return { success: true } // Not an error, just no attribution
    }

    // Update attribution with review details
    const { error: updateError } = await supabase
      .from('review_attributions')
      .update({
        review_rating: rating,
        review_text: reviewText,
      })
      .eq('id', attribution.id)

    if (updateError) {
      return { success: false, error: updateError.message }
    }

    // Update crew performance with review earned
    if (attribution.crew_id) {
      const { id, record } = await getOrCreatePerformanceRecord(attribution.crew_id)

      await supabase
        .from('crew_performance')
        .update({
          google_reviews_earned: record.google_reviews_earned + 1,
          review_bonus_cents: record.review_bonus_cents + attribution.bonus_cents,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)

      console.log(
        `[Performance] Review attributed to crew ${attribution.crew_id}: ${rating} stars`
      )
    }

    return {
      success: true,
      crewId: attribution.crew_id,
      bonusCents: attribution.bonus_cents,
    }
  } catch (error) {
    console.error('[Performance] Failed to record review:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/**
 * Mark review bonuses as paid
 */
export async function markBonusesPaid(
  crewId: string,
  throughDate: string
): Promise<{ success: boolean; paidCount: number; totalCents: number }> {
  const { data: unpaid, error: fetchError } = await getSupabase()
    .from('review_attributions')
    .select('id, bonus_cents')
    .eq('crew_id', crewId)
    .eq('brand', 'winbros')
    .eq('bonus_paid', false)
    .not('review_rating', 'is', null)
    .lte('created_at', throughDate)

  if (fetchError || !unpaid) {
    return { success: false, paidCount: 0, totalCents: 0 }
  }

  const ids = unpaid.map((r) => r.id)
  const totalCents = unpaid.reduce((sum, r) => sum + r.bonus_cents, 0)

  if (ids.length === 0) {
    return { success: true, paidCount: 0, totalCents: 0 }
  }

  const { error } = await getSupabase()
    .from('review_attributions')
    .update({
      bonus_paid: true,
      bonus_paid_at: new Date().toISOString(),
    })
    .in('id', ids)

  if (error) {
    return { success: false, paidCount: 0, totalCents: 0 }
  }

  return { success: true, paidCount: ids.length, totalCents }
}

/**
 * Get crew performance stats
 */
export async function getCrewPerformance(
  crewId: string,
  period: 'week' | 'month' = 'week'
): Promise<PerformanceStats | null> {
  const now = new Date()
  const periodStart = period === 'week' ? getWeekStart(now) : getMonthStart(now)
  const periodEnd = period === 'week' ? getWeekEnd(now) : getMonthEnd(now)

  const { data, error } = await getSupabase()
    .from('crew_performance')
    .select('*')
    .eq('crew_id', crewId)
    .eq('brand', 'winbros')
    .gte('period_start', periodStart)
    .lte('period_end', periodEnd)

  if (error || !data || data.length === 0) {
    return null
  }

  // Aggregate if multiple periods in range
  const aggregated = data.reduce(
    (acc, record) => ({
      jobsCompleted: acc.jobsCompleted + record.jobs_completed,
      upsellsOffered: acc.upsellsOffered + record.upsells_offered,
      upsellsAccepted: acc.upsellsAccepted + record.upsells_accepted,
      upsellRevenue: acc.upsellRevenue + record.upsell_revenue_cents,
      tipsCollected: acc.tipsCollected + record.tips_collected_cents,
      reviewsEarned: acc.reviewsEarned + record.google_reviews_earned,
      reviewBonus: acc.reviewBonus + record.review_bonus_cents,
    }),
    {
      jobsCompleted: 0,
      upsellsOffered: 0,
      upsellsAccepted: 0,
      upsellRevenue: 0,
      tipsCollected: 0,
      reviewsEarned: 0,
      reviewBonus: 0,
    }
  )

  const upsellRate =
    aggregated.upsellsOffered > 0
      ? Math.round((aggregated.upsellsAccepted / aggregated.upsellsOffered) * 100)
      : 0

  return {
    crewId,
    period: `${periodStart} to ${periodEnd}`,
    jobsCompleted: aggregated.jobsCompleted,
    upsellRate,
    upsellRevenue: aggregated.upsellRevenue / 100,
    tipsCollected: aggregated.tipsCollected / 100,
    reviewsEarned: aggregated.reviewsEarned,
    reviewBonus: aggregated.reviewBonus / 100,
    totalBonus: (aggregated.tipsCollected + aggregated.reviewBonus) / 100,
  }
}

/**
 * Get leaderboard
 */
export async function getPerformanceLeaderboard(
  metric: 'jobs' | 'upsells' | 'reviews' | 'tips' = 'jobs',
  period: 'week' | 'month' = 'week'
): Promise<Array<{ crewId: string; value: number; rank: number }>> {
  const now = new Date()
  const periodStart = period === 'week' ? getWeekStart(now) : getMonthStart(now)

  const { data, error } = await getSupabase()
    .from('crew_performance')
    .select('crew_id, jobs_completed, upsells_accepted, google_reviews_earned, tips_collected_cents')
    .eq('brand', 'winbros')
    .gte('period_start', periodStart)

  if (error || !data) {
    return []
  }

  // Aggregate by crew
  const byCrewMap: Record<string, { jobs: number; upsells: number; reviews: number; tips: number }> = {}

  for (const record of data) {
    if (!byCrewMap[record.crew_id]) {
      byCrewMap[record.crew_id] = { jobs: 0, upsells: 0, reviews: 0, tips: 0 }
    }
    byCrewMap[record.crew_id].jobs += record.jobs_completed
    byCrewMap[record.crew_id].upsells += record.upsells_accepted
    byCrewMap[record.crew_id].reviews += record.google_reviews_earned
    byCrewMap[record.crew_id].tips += record.tips_collected_cents
  }

  // Sort by metric
  const sorted = Object.entries(byCrewMap)
    .map(([crewId, stats]) => ({
      crewId,
      value: stats[metric === 'tips' ? 'tips' : metric],
    }))
    .sort((a, b) => b.value - a.value)

  return sorted.map((item, index) => ({
    ...item,
    rank: index + 1,
  }))
}

// Helper functions for date periods
function getWeekStart(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday
  d.setDate(diff)
  return d.toISOString().split('T')[0]
}

function getWeekEnd(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? 0 : 7) // Sunday
  d.setDate(diff)
  return d.toISOString().split('T')[0]
}

function getMonthStart(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), 1)
  return d.toISOString().split('T')[0]
}

function getMonthEnd(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return d.toISOString().split('T')[0]
}
