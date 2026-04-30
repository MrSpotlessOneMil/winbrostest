import { describe, it, expect } from "vitest"
import { selectPerformanceSections } from "@/apps/window-washing/lib/performance-scope"

/**
 * Phase P (Blake call 2026-04-29) — Team Performance role split.
 * TL → only TL section, salesman → only sales section, admin → both.
 */
describe("selectPerformanceSections", () => {
  it("admin → both sections", () => {
    expect(
      selectPerformanceSections({
        isAdmin: true,
        isTeamLead: false,
        isSalesman: false,
        myTeamLeadRow: false,
        mySalesRow: false,
      })
    ).toEqual({ showTeamLeads: true, showSales: true })
  })

  it("team lead → TL section only", () => {
    expect(
      selectPerformanceSections({
        isAdmin: false,
        isTeamLead: true,
        isSalesman: false,
        myTeamLeadRow: true,
        mySalesRow: false,
      })
    ).toEqual({ showTeamLeads: true, showSales: false })
  })

  it("salesman → sales section only", () => {
    expect(
      selectPerformanceSections({
        isAdmin: false,
        isTeamLead: false,
        isSalesman: true,
        myTeamLeadRow: false,
        mySalesRow: true,
      })
    ).toEqual({ showTeamLeads: false, showSales: true })
  })

  it("dual-role (TL + salesman) → both sections", () => {
    // Owner-operator who closes their own deals shows up in both lists.
    expect(
      selectPerformanceSections({
        isAdmin: false,
        isTeamLead: true,
        isSalesman: true,
        myTeamLeadRow: true,
        mySalesRow: true,
      })
    ).toEqual({ showTeamLeads: true, showSales: true })
  })

  it("technician with no role flags falls back to whichever section they appear in", () => {
    // Defensive — a tech shouldn't reach this page, but if they do they
    // see whichever section has their name (or TL by default).
    expect(
      selectPerformanceSections({
        isAdmin: false,
        isTeamLead: false,
        isSalesman: false,
        myTeamLeadRow: false,
        mySalesRow: false,
      })
    ).toEqual({ showTeamLeads: true, showSales: false })

    expect(
      selectPerformanceSections({
        isAdmin: false,
        isTeamLead: false,
        isSalesman: false,
        myTeamLeadRow: false,
        mySalesRow: true,
      })
    ).toEqual({ showTeamLeads: false, showSales: true })
  })

  it("salesman wired as TL flag (drift) → still scoped to TL view", () => {
    // If auth-context drifts and a TL flag is set on a non-TL employee
    // type, we still trust the boolean — it's the source of truth.
    expect(
      selectPerformanceSections({
        isAdmin: false,
        isTeamLead: true,
        isSalesman: false,
        myTeamLeadRow: false,
        mySalesRow: false,
      })
    ).toEqual({ showTeamLeads: true, showSales: false })
  })
})
