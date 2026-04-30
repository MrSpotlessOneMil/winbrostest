/**
 * Team Performance role-scoping.
 *
 * Phase P (Blake call 2026-04-29): TLs should see other TLs' performance
 * only; salesmen should see other salesmen's only. Admins (and dual-role
 * accounts that show up in both lists) keep the full view.
 *
 * Pure helper so we can pin the gate in unit tests — the page-level
 * useAuth + name-match data flow stays inline.
 */

export interface PerformanceScopeArgs {
  isAdmin: boolean
  isTeamLead: boolean
  isSalesman: boolean
  /** True if the logged-in user appears in the team_leads section. */
  myTeamLeadRow: boolean
  /** True if the logged-in user appears in the sales section. */
  mySalesRow: boolean
}

export function selectPerformanceSections(args: PerformanceScopeArgs): {
  showTeamLeads: boolean
  showSales: boolean
} {
  if (args.isAdmin) return { showTeamLeads: true, showSales: true }
  // Dual-role: someone who's been registered both as a TL and a salesman
  // sees both sections. Useful for owner-operators who close their own deals.
  if (args.myTeamLeadRow && args.mySalesRow) {
    return { showTeamLeads: true, showSales: true }
  }
  if (args.isTeamLead) return { showTeamLeads: true, showSales: false }
  if (args.isSalesman) return { showTeamLeads: false, showSales: true }
  // Fallback (technician landing on the page somehow): show whichever
  // section their name appears in, default to team leads.
  return {
    showTeamLeads: args.myTeamLeadRow || !args.mySalesRow,
    showSales: args.mySalesRow,
  }
}
