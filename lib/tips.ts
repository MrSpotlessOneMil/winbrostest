/**
 * Tip Distribution Logic
 *
 * When a tip is reported for a job, splits it equally among all
 * cleaners assigned to that job (status: accepted or confirmed).
 * Inserts one tips row per cleaner with their individual share.
 */

import { createClient } from '@supabase/supabase-js'

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Distribute a tip equally among all assigned cleaners on a job.
 *
 * @param jobId - The job ID the tip is for
 * @param totalAmount - Total tip amount in dollars
 * @param teamId - The team ID (for team-level aggregation)
 * @param reportedVia - Source of the tip report ('telegram', 'stripe', 'dashboard', 'manual')
 * @param notes - Optional notes (e.g. telegram chat context)
 */
export async function distributeTip(
  jobId: number,
  totalAmount: number,
  teamId: number | null,
  reportedVia: string,
  notes?: string
): Promise<{ success: boolean; splitCount: number; amountEach: number; error?: string }> {
  const client = getSupabaseClient()

  // Find all accepted/confirmed cleaner assignments for this job
  const { data: assignments, error: assignErr } = await client
    .from('cleaner_assignments')
    .select('cleaner_id')
    .eq('job_id', jobId)
    .in('status', ['accepted', 'confirmed'])

  if (assignErr) {
    console.error('[Tips] Failed to fetch assignments for job', jobId, assignErr)
    return { success: false, splitCount: 0, amountEach: 0, error: assignErr.message }
  }

  const cleanerIds = (assignments || []).map((a: { cleaner_id: number }) => a.cleaner_id).filter(Boolean)
  const splitCount = cleanerIds.length || 1 // Minimum 1 to avoid division by zero

  // Split equally, give remainder cents to first cleaner
  const totalCents = Math.round(totalAmount * 100)
  const baseShareCents = Math.floor(totalCents / splitCount)
  const remainderCents = totalCents - baseShareCents * splitCount

  if (cleanerIds.length === 0) {
    // No assigned cleaners — insert one unattributed row for the team
    const { error: insertErr } = await client.from('tips').insert({
      job_id: jobId,
      team_id: teamId,
      cleaner_id: null,
      amount: totalAmount,
      reported_via: reportedVia,
      notes,
    })
    if (insertErr) {
      console.error('[Tips] Failed to insert unattributed tip:', insertErr)
      return { success: false, splitCount: 0, amountEach: totalAmount, error: insertErr.message }
    }
    return { success: true, splitCount: 0, amountEach: totalAmount }
  }

  // Insert one row per cleaner
  const rows = cleanerIds.map((cleanerId: number, idx: number) => {
    const shareCents = baseShareCents + (idx === 0 ? remainderCents : 0)
    return {
      job_id: jobId,
      team_id: teamId,
      cleaner_id: cleanerId,
      amount: shareCents / 100,
      reported_via: reportedVia,
      notes,
    }
  })

  const { error: insertErr } = await client.from('tips').insert(rows)
  if (insertErr) {
    console.error('[Tips] Failed to insert distributed tips:', insertErr)
    return { success: false, splitCount, amountEach: baseShareCents / 100, error: insertErr.message }
  }

  const amountEach = (baseShareCents + (remainderCents > 0 ? remainderCents / splitCount : 0)) / 100
  console.log(`[Tips] Distributed $${totalAmount} tip for job ${jobId} among ${splitCount} cleaner(s) ($${(baseShareCents / 100).toFixed(2)} each)`)

  return { success: true, splitCount, amountEach }
}
