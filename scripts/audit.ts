#!/usr/bin/env npx tsx
/**
 * System Health Audit CLI
 *
 * Quick dashboard showing scheduled tasks, paused customers,
 * retargeting status, and SMS volume.
 *
 * Usage:
 *   npm run audit              # Print dashboard
 *   npm run audit -- --cleanup  # Run cleanup + print dashboard
 */

const BASE = process.env.E2E_BASE_URL || 'https://cleanmachine.live'
const SECRET = process.env.CRON_SECRET

if (!SECRET) {
  console.error('CRON_SECRET not set. Add it to .env.local')
  process.exit(1)
}

const doCleanup = process.argv.includes('--cleanup')

async function main() {
  if (doCleanup) {
    console.log('Running cleanup...')
    const res = await fetch(`${BASE}/api/cron/audit-tasks`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cleanup_all' }),
    })
    const data = await res.json()
    console.log('  Stale tasks cancelled:', data.results?.staleTasks?.cancelled || 0)
    console.log('  Stuck leads reset:', data.results?.stuckLeads?.reset || 0)
    console.log('  Old sequences cleaned:', data.results?.oldSequences?.leadsReset || 0)
    console.log('  Retargeting cancelled:', data.results?.cancelledRetargeting?.cancelled || 0)
    console.log('')
  }

  const res = await fetch(`${BASE}/api/cron/audit-tasks`, {
    headers: { 'Authorization': `Bearer ${SECRET}` },
  })

  if (res.status !== 200) {
    console.error('Audit endpoint returned', res.status)
    process.exit(1)
  }

  const d = await res.json()
  const s = d.summary

  console.log('╔══════════════════════════════════════════╗')
  console.log('║         OSIRIS SYSTEM HEALTH             ║')
  console.log('╠══════════════════════════════════════════╣')
  console.log(`║  Pending tasks:      ${String(s.totalPendingTasks).padStart(6)}            ║`)
  console.log(`║  Paused customers:   ${String(s.pausedCustomers).padStart(6)}            ║`)
  console.log(`║  Active retargeting: ${String(s.activeRetargetingLeads).padStart(6)}            ║`)
  console.log(`║  Stale retargeting:  ${String(s.staleRetargetingLeads).padStart(6)}            ║`)
  console.log(`║  WinBros retarget:   ${String(s.winbrosRetargetingTasks).padStart(6)}            ║`)
  console.log(`║  SMS last 24h:       ${String(s.smsLast24h).padStart(6)}            ║`)
  console.log('╠══════════════════════════════════════════╣')

  // Tasks by tenant
  console.log('║  TASK QUEUE BY TENANT                    ║')
  for (const [tid, tasks] of Object.entries(d.tasksByTenant || {})) {
    const short = tid.slice(0, 8)
    const items = Object.entries(tasks as Record<string, number>)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ')
    console.log(`║  ${short}  ${items.padEnd(31)}║`)
  }

  // SMS by tenant
  console.log('╠══════════════════════════════════════════╣')
  console.log('║  SMS LAST 24H BY TENANT                  ║')
  for (const [tid, info] of Object.entries(d.smsByTenant || {})) {
    const short = tid.slice(0, 8)
    const i = info as { total: number; ai: number; sources: Record<string, number> }
    const topSources = Object.entries(i.sources)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ')
    console.log(`║  ${short}  total:${String(i.total).padStart(3)} ai:${String(i.ai).padStart(2)}  ${topSources.slice(0, 24).padEnd(14)}║`)
  }

  // Warnings
  const warnings: string[] = []
  if (s.pausedCustomers > 0) warnings.push(`${s.pausedCustomers} customers are PAUSED (ghosted)`)
  if (s.winbrosRetargetingTasks > 0) warnings.push(`WinBros has ${s.winbrosRetargetingTasks} retargeting tasks (should be 0)`)
  if (s.staleRetargetingLeads > 0) warnings.push(`${s.staleRetargetingLeads} stale retargeting leads (30+ days)`)
  if (s.totalPendingTasks > 500) warnings.push(`${s.totalPendingTasks} pending tasks (high)`)

  if (warnings.length > 0) {
    console.log('╠══════════════════════════════════════════╣')
    console.log('║  WARNINGS                                ║')
    for (const w of warnings) {
      console.log(`║  ⚠ ${w.slice(0, 37).padEnd(37)}║`)
    }
  }

  console.log('╚══════════════════════════════════════════╝')

  if (warnings.length > 0) {
    console.log('\nRun: npm run audit -- --cleanup')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
