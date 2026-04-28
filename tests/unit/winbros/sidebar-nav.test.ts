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
  fieldNavBase,
  teamLeadOnlyNav,
} from '@/apps/window-washing/components/dashboard/sidebar-nav'
import { deriveRoleLabel } from '@/apps/window-washing/lib/auth-context'

describe('selectNavigation — sidebar role gating', () => {
  it('admin sees the full owner nav with Calendar above Sales Appointments', () => {
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
    const calendarIdx = labels.indexOf('Calendar')
    const apptIdx = labels.indexOf('Sales Appointments')
    const techSchedIdx = labels.indexOf('Technician Scheduling')
    expect(apptIdx).toBe(calendarIdx + 1)
    expect(techSchedIdx).toBe(apptIdx + 1)
  })

  it('team lead sees field base + Team Performance + Payroll', () => {
    const nav = selectNavigation({ isAdmin: false, isTeamLead: true })
    const labels = nav.map(n => n.name)
    expect(labels).toContain('Command Center')
    expect(labels).toContain('Calendar')
    expect(labels).toContain('Scheduling')
    expect(labels).toContain('Customers')
    expect(labels).toContain('Off Days')
    expect(labels).toContain('Team Performance')
    expect(labels).toContain('Payroll')
    expect(nav.length).toBe(fieldNavBase.length + teamLeadOnlyNav.length)
  })

  it('technician (not team lead) does NOT see Team Performance or Payroll', () => {
    const nav = selectNavigation({ isAdmin: false, isTeamLead: false })
    const labels = nav.map(n => n.name)
    expect(labels).not.toContain('Team Performance')
    expect(labels).not.toContain('Payroll')
    expect(labels).toContain('Command Center')
    expect(labels).toContain('Calendar')
    expect(labels).toContain('Scheduling')
    expect(nav.length).toBe(fieldNavBase.length)
  })

  it('salesman (not team lead) does NOT see Team Performance or Payroll', () => {
    // Salesman is the same gate as technician — both rely on isTeamLead=false.
    const nav = selectNavigation({ isAdmin: false, isTeamLead: false })
    const labels = nav.map(n => n.name)
    expect(labels).not.toContain('Team Performance')
    expect(labels).not.toContain('Payroll')
  })

  it('field nav puts Command Center first so post-login lands feel natural', () => {
    const nav = selectNavigation({ isAdmin: false, isTeamLead: false })
    expect(nav[0]?.name).toBe('Command Center')
    expect(nav[0]?.href).toBe('/my-day')
  })

  it('"Scheduling" entry replaces the legacy "Jobs" label', () => {
    const nav = selectNavigation({ isAdmin: false, isTeamLead: false })
    const labels = nav.map(n => n.name)
    expect(labels).toContain('Scheduling')
    expect(labels).not.toContain('Jobs')
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
