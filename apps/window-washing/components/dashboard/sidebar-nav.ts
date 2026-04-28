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
  { name: "Technician Scheduling", href: "/schedule" },
  { name: "Service Plan Scheduling", href: "/service-plan-schedule" },
  { name: "Service Plan Hub", href: "/service-plan-hub" },
  { name: "Team Performance", href: "/performance" },
  { name: "Payroll", href: "/payroll" },
  { name: "Tech Upsells", href: "/tech-upsells" },
  { name: "Insights", href: "/insights" },
  { name: "Control Center", href: "/control-center" },
]

/** Field base set — every tech / team-lead sees these. Salesmen have a
 * different nav (see salesmanNav) — they don't run techs through Scheduling
 * and they don't need the FullCalendar Calendar; their day is appointments +
 * pipeline. */
export const fieldNavBase: NavEntry[] = [
  { name: "Command Center", href: "/my-day" },
  { name: "Calendar", href: "/jobs" },
  { name: "Scheduling", href: "/schedule" },
  { name: "My Customers", href: "/my-customers" },
  { name: "Customers", href: "/customers" },
  { name: "Off Days", href: "/my-schedule" },
]

/** Team-lead extras — appended on top of fieldNavBase for team leads only. */
export const teamLeadOnlyNav: NavEntry[] = [
  { name: "Team Performance", href: "/performance" },
  { name: "Payroll", href: "/payroll" },
]

/** Salesman portal — pipeline-first nav. My Pipeline replaces the techs'
 * Calendar entry (their day is appointments → quotes → jobs they own).
 * Team Schedules is read-only so they can see when crews are open before
 * promising a customer a date. My Customers is the chat inbox for every
 * non-closed lead/quote/job they own. */
export const salesmanNav: NavEntry[] = [
  { name: "Command Center", href: "/my-day" },
  { name: "My Pipeline", href: "/my-pipeline" },
  { name: "Team Schedules", href: "/team-schedules" },
  { name: "My Customers", href: "/my-customers" },
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
  if (args.isTeamLead) return [...fieldNavBase, ...teamLeadOnlyNav]
  if (args.employeeType === 'salesman') return salesmanNav
  return fieldNavBase
}
