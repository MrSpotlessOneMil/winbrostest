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

/** Admin / owner — 13 tabs. Calendar (FullCalendar overview) is the
 * top-level view; Sales Appointments sits below it, then Technician
 * Scheduling (the Gantt crew board). Keeps "what's the day look like"
 * before "who's scheduling sales calls". */
export const adminNav: NavEntry[] = [
  { name: "Command Center", href: "/overview" },
  { name: "Customers", href: "/customers" },
  { name: "Pipeline", href: "/quotes" },
  { name: "Calendar", href: "/jobs" },
  { name: "Sales Appointments", href: "/appointments" },
  { name: "Crew Assignment", href: "/crew-assignment" },
  { name: "Technician Scheduling", href: "/schedule" },
  { name: "Service Plan Scheduling", href: "/service-plan-schedule" },
  { name: "Service Plan Hub", href: "/service-plan-hub" },
  { name: "Team Performance", href: "/performance" },
  { name: "Payroll", href: "/payroll" },
  { name: "Tech Upsells", href: "/tech-upsells" },
  { name: "Insights", href: "/insights" },
  { name: "Control Center", href: "/control-center" },
]

/** Technician nav — they execute jobs, they don't schedule. Per PRD #10,
 * Scheduling is hidden. Per PRD #11, the duplicate My Customers + Customers
 * is collapsed to a single role-scoped Customers tab. */
export const technicianNav: NavEntry[] = [
  { name: "Command Center", href: "/my-day" },
  { name: "Calendar", href: "/jobs" },
  { name: "Customers", href: "/customers" },
  { name: "Off Days", href: "/my-schedule" },
]

/** Team-lead nav — same as tech plus Scheduling (TLs do schedule), Team
 * Performance, and Payroll. Per PRD #16 Customers is single, role-scoped
 * to the team's customers. */
export const teamLeadNav: NavEntry[] = [
  { name: "Command Center", href: "/my-day" },
  { name: "Calendar", href: "/jobs" },
  { name: "Scheduling", href: "/schedule" },
  { name: "Customers", href: "/customers" },
  { name: "Off Days", href: "/my-schedule" },
  { name: "Team Performance", href: "/performance" },
  { name: "Payroll", href: "/payroll" },
]

/** @deprecated kept for back-compat with existing imports — equals technicianNav. */
export const fieldNavBase: NavEntry[] = technicianNav

/** @deprecated kept for back-compat — TL extras now live in teamLeadNav. */
export const teamLeadOnlyNav: NavEntry[] = [
  { name: "Team Performance", href: "/performance" },
  { name: "Payroll", href: "/payroll" },
]

/** Salesman portal — pipeline-first nav. Per PRD #14 single Customers tab
 * scoped to customers this salesman has quoted or closed. */
export const salesmanNav: NavEntry[] = [
  { name: "Command Center", href: "/my-day" },
  { name: "My Pipeline", href: "/my-pipeline" },
  { name: "Team Schedules", href: "/team-schedules" },
  { name: "Customers", href: "/customers" },
  { name: "Off Days", href: "/my-schedule" },
]

/**
 * Resolve the sidebar items shown for a given role state. Admin gets the
 * full owner nav; team leads get the field base plus payroll/performance;
 * salesmen get the salesman portal; techs get the field base.
 *
 * Precedence: admin > team_lead > salesman > technician. A user that is
 * both team_lead and salesman is treated as team_lead (their crew-running
 * duties dominate their day).
 */
export function selectNavigation(args: {
  isAdmin: boolean
  isTeamLead: boolean
  employeeType?: 'technician' | 'salesman' | 'team_lead' | null
}): NavEntry[] {
  if (args.isAdmin) return adminNav
  if (args.isTeamLead) return teamLeadNav
  if (args.employeeType === 'salesman') return salesmanNav
  return technicianNav
}
