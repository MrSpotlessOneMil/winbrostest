/**
 * Sidebar navigation maps — extracted from sidebar.tsx so the role-gating
 * logic can be unit-tested without rendering React or importing icons.
 *
 * Icons live in sidebar.tsx; this module is pure data + the role filter.
 */

export interface NavEntry {
  name: string
  href: string
}

/** Admin / owner — 13 tabs. Calendar (FullCalendar overview) sits next to
 * Technician Scheduling (the Gantt crew board) so the high-level view and
 * the detail view are adjacent. */
export const adminNav: NavEntry[] = [
  { name: "Command Center", href: "/overview" },
  { name: "Customers", href: "/customers" },
  { name: "Pipeline", href: "/quotes" },
  { name: "Sales Appointments", href: "/appointments" },
  { name: "Calendar", href: "/jobs" },
  { name: "Technician Scheduling", href: "/schedule" },
  { name: "Service Plan Scheduling", href: "/service-plan-schedule" },
  { name: "Service Plan Hub", href: "/service-plan-hub" },
  { name: "Team Performance", href: "/performance" },
  { name: "Payroll", href: "/payroll" },
  { name: "Tech Upsells", href: "/tech-upsells" },
  { name: "Insights", href: "/insights" },
  { name: "Control Center", href: "/control-center" },
]

/** Field base set — every tech / salesman / team-lead sees these. */
export const fieldNavBase: NavEntry[] = [
  { name: "Command Center", href: "/my-day" },
  { name: "Calendar", href: "/jobs" },
  { name: "Scheduling", href: "/schedule" },
  { name: "Customers", href: "/customers" },
  { name: "Off Days", href: "/my-schedule" },
]

/** Team-lead extras — appended on top of fieldNavBase for team leads only. */
export const teamLeadOnlyNav: NavEntry[] = [
  { name: "Team Performance", href: "/performance" },
  { name: "Payroll", href: "/payroll" },
]

/**
 * Resolve the sidebar items shown for a given role state. Admin gets the
 * full owner nav; team leads get the field base plus payroll/performance;
 * techs and salesmen get only the base set.
 */
export function selectNavigation(args: {
  isAdmin: boolean
  isTeamLead: boolean
}): NavEntry[] {
  if (args.isAdmin) return adminNav
  if (args.isTeamLead) return [...fieldNavBase, ...teamLeadOnlyNav]
  return fieldNavBase
}
