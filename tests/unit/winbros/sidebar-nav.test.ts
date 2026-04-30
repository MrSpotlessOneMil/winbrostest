/**
 * Sidebar role-gating — Unit Tests
 *
 * Locks down which sidebar entries a tech / salesman / team lead / admin
 * sees. Dominic explicitly does NOT want technicians or salesmen to see
 * Team Performance or Payroll; both are team-lead/admin only.
 *
 * Also locks `deriveRoleLabel` so the identity pill in the sidebar (e.g.
 * "Blake_TL — Team Lead") stays consistent with the rest of the app.
 */

import { describe, it, expect } from 'vitest'
import {
  selectNavigation,
  adminNav,
  technicianNav,
  teamLeadNav,
  salesmanNav,
} from '@/apps/window-washing/components/dashboard/sidebar-nav'
import { deriveRoleLabel } from '@/apps/window-washing/lib/auth-context'

describe('selectNavigation — sidebar role gating', () => {
  it('admin sees the full owner nav with Calendar above Sales Appointments and Crew Assignment', () => {
    const nav = selectNavigation({ isAdmin: true, isTeamLead: false })
    expect(nav).toBe(adminNav)
    const labels = nav.map(n => n.name)
    expect(labels).toContain('Command Center')
    expect(labels).toContain('Calendar')
    expect(labels).toContain('Sales Appointments')
    expect(labels).toContain('Technician Scheduling')
    expect(labels).toContain('Team Performance')
    expect(labels).toContain('Payroll')
    expect(labels).toContain('Insights')
    // The legacy bare "Scheduling" label is gone — admins now see
    // "Technician Scheduling" so it's distinct from "Sales Appointments"
    // and "Service Plan Scheduling".
    expect(labels).not.toContain('Scheduling')
    // 2026-04-27: Dominic asked Calendar to sit ABOVE Sales Appointments
    // — high-level "what's the day look like" before "who's booking sales
    // calls". Technician Scheduling stays right after Sales Appointments.
    // Phase K (2026-04-29): Crew Assignment slots between Sales Appointments
    // and Technician Scheduling — admin assigns the crew BEFORE laying out
    // the day's jobs across them.
    const calendarIdx = labels.indexOf('Calendar')
    const apptIdx = labels.indexOf('Sales Appointments')
    const crewIdx = labels.indexOf('Crew Assignment')
    const techSchedIdx = labels.indexOf('Technician Scheduling')
    expect(apptIdx).toBe(calendarIdx + 1)
    expect(crewIdx).toBe(apptIdx + 1)
    expect(techSchedIdx).toBe(crewIdx + 1)
    expect(nav.find(n => n.name === 'Crew Assignment')?.href).toBe('/crew-assignment')
  })

  it('team lead nav: Calendar + Scheduling + single Customers + Team Performance + Payroll', () => {
    // PRD #16: TL nav has ONE Customers tab (no separate "My Customers").
    const nav = selectNavigation({ isAdmin: false, isTeamLead: true })
    expect(nav).toBe(teamLeadNav)
    const labels = nav.map(n => n.name)
    expect(labels).toContain('Command Center')
    expect(labels).toContain('Calendar')
    expect(labels).toContain('Scheduling')
    expect(labels).toContain('Customers')
    expect(labels).toContain('Off Days')
    expect(labels).toContain('Team Performance')
    expect(labels).toContain('Payroll')
    // PRD #16: no duplicate My Customers
    expect(labels).not.toContain('My Customers')
  })

  it('PRD #11/#14/#16: every non-admin role has ONE Customers tab, not "My Customers"', () => {
    for (const role of [
      { isAdmin: false, isTeamLead: false },
      { isAdmin: false, isTeamLead: true },
      { isAdmin: false, isTeamLead: false, employeeType: 'salesman' as const },
    ]) {
      const nav = selectNavigation(role)
      const labels = nav.map(n => n.name)
      const hrefs = nav.map(n => n.href)
      expect(labels).toContain('Customers')
      expect(hrefs).toContain('/customers')
      // No separate "My Customers" entry — collapsed into the role-scoped Customers tab
      expect(labels).not.toContain('My Customers')
      expect(hrefs).not.toContain('/my-customers')
    }
  })

  it('PRD #10: technician does NOT see Scheduling (they execute jobs, they do not schedule)', () => {
    const nav = selectNavigation({ isAdmin: false, isTeamLead: false })
    const labels = nav.map(n => n.name)
    expect(labels).not.toContain('Scheduling')
    expect(nav.map(n => n.href)).not.toContain('/schedule')
  })

  it('technician (not team lead) does NOT see Team Performance or Payroll', () => {
    const nav = selectNavigation({ isAdmin: false, isTeamLead: false })
    const labels = nav.map(n => n.name)
    expect(labels).not.toContain('Team Performance')
    expect(labels).not.toContain('Payroll')
    expect(labels).toContain('Command Center')
    expect(labels).toContain('Calendar')
    expect(nav.length).toBe(technicianNav.length)
  })

  it('salesman (not team lead) does NOT see Team Performance or Payroll', () => {
    // Salesman has a dedicated portal nav — see "salesman gets pipeline-first
    // portal" below. They never see Team Performance or Payroll.
    const nav = selectNavigation({ isAdmin: false, isTeamLead: false, employeeType: 'salesman' })
    const labels = nav.map(n => n.name)
    expect(labels).not.toContain('Team Performance')
    expect(labels).not.toContain('Payroll')
  })

  it('salesman portal — My Pipeline + Team Schedules + single Customers tab', () => {
    // Phase H + PRD #14: salesman portal carries pipeline-first nav with
    // a SINGLE role-scoped Customers tab (no duplicate My Customers).
    const nav = selectNavigation({ isAdmin: false, isTeamLead: false, employeeType: 'salesman' })
    expect(nav).toBe(salesmanNav)
    const labels = nav.map(n => n.name)
    expect(labels).toContain('Command Center')
    expect(labels).toContain('My Pipeline')
    expect(labels).toContain('Team Schedules')
    expect(labels).toContain('Customers')
    expect(labels).toContain('Off Days')
    // Salesmen don't run techs, so they don't get the daily Scheduling Gantt
    // or the FullCalendar Calendar that techs use to see today's jobs.
    expect(labels).not.toContain('Scheduling')
    expect(labels).not.toContain('Calendar')
    // And they never see admin-only entries.
    expect(labels).not.toContain('Team Performance')
    expect(labels).not.toContain('Payroll')
    // PRD #14: no duplicate My Customers
    expect(labels).not.toContain('My Customers')
  })

  it('salesman+team_lead hybrid → team-lead nav wins (crew duties dominate the day)', () => {
    const nav = selectNavigation({ isAdmin: false, isTeamLead: true, employeeType: 'salesman' })
    expect(nav).toBe(teamLeadNav)
    const labels = nav.map(n => n.name)
    expect(labels).toContain('Team Performance')
    expect(labels).toContain('Payroll')
    expect(labels).not.toContain('My Pipeline')
    expect(labels).not.toContain('Team Schedules')
  })

  it('technician with employeeType=technician gets technicianNav', () => {
    const nav = selectNavigation({ isAdmin: false, isTeamLead: false, employeeType: 'technician' })
    expect(nav).toBe(technicianNav)
  })

  it('employeeType undefined falls back to technician nav', () => {
    const nav = selectNavigation({ isAdmin: false, isTeamLead: false })
    expect(nav).toBe(technicianNav)
  })

  it('every nav puts Command Center first so post-login lands feel natural', () => {
    for (const role of [
      { isAdmin: false, isTeamLead: false },
      { isAdmin: false, isTeamLead: true },
      { isAdmin: false, isTeamLead: false, employeeType: 'salesman' as const },
    ]) {
      const nav = selectNavigation(role)
      expect(nav[0]?.name).toBe('Command Center')
      expect(nav[0]?.href).toBe('/my-day')
    }
  })
})

describe('deriveRoleLabel — identity pill', () => {
  it('admin → Owner', () => {
    expect(deriveRoleLabel({ isAdmin: true, isTeamLead: false, employeeType: null })).toBe('Owner')
  })

  it('team lead (also has employeeType=technician) → Team Lead, not Technician', () => {
    expect(
      deriveRoleLabel({ isAdmin: false, isTeamLead: true, employeeType: 'technician' })
    ).toBe('Team Lead')
  })

  it('salesman → Salesman', () => {
    expect(
      deriveRoleLabel({ isAdmin: false, isTeamLead: false, employeeType: 'salesman' })
    ).toBe('Salesman')
  })

  it('technician (no team lead flag) → Technician', () => {
    expect(
      deriveRoleLabel({ isAdmin: false, isTeamLead: false, employeeType: 'technician' })
    ).toBe('Technician')
  })

  it('unauthenticated state → null', () => {
    expect(
      deriveRoleLabel({ isAdmin: false, isTeamLead: false, employeeType: null })
    ).toBeNull()
  })

  it('admin precedence beats team lead even if both flags are set', () => {
    // Owners that double as a team lead should still see "Owner" — admin is the
    // dominant identity in the dashboard.
    expect(
      deriveRoleLabel({ isAdmin: true, isTeamLead: true, employeeType: 'team_lead' })
    ).toBe('Owner')
  })
})
