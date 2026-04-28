/**
 * Phase I — quote ↔ appointment ↔ salesman link guard.
 *
 * Locks the validator that runs in front of the
 * quotes_appointment_needs_salesman DB CHECK constraint. The constraint
 * is the backstop; this validator is what users actually see when they
 * try to save a bad combination.
 */

import { describe, it, expect } from 'vitest'
import {
  validateQuoteSalesmanLink,
  mergeQuoteLinkUpdate,
} from '@/apps/window-washing/lib/quote-link-validation'

describe('validateQuoteSalesmanLink', () => {
  it('passes when appointment_job_id is null (unrelated quote, no requirement)', () => {
    expect(
      validateQuoteSalesmanLink({ appointment_job_id: null, salesman_id: null })
    ).toEqual({ ok: true })
    expect(
      validateQuoteSalesmanLink({ appointment_job_id: null, salesman_id: 7 })
    ).toEqual({ ok: true })
  })

  it('passes when appointment_job_id is undefined (e.g. PATCH without touching the field)', () => {
    expect(
      validateQuoteSalesmanLink({ appointment_job_id: undefined, salesman_id: null })
    ).toEqual({ ok: true })
  })

  it('passes when appointment-linked AND salesman is set', () => {
    expect(
      validateQuoteSalesmanLink({ appointment_job_id: 42, salesman_id: 7 })
    ).toEqual({ ok: true })
  })

  it('fails when appointment-linked but salesman is null', () => {
    const r = validateQuoteSalesmanLink({ appointment_job_id: 42, salesman_id: null })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // Message should mention salesman so the UI can highlight the right field.
      expect(r.error.toLowerCase()).toContain('salesman')
      expect(r.error.toLowerCase()).toContain('appointment')
    }
  })

  it('fails when appointment-linked but salesman is undefined', () => {
    const r = validateQuoteSalesmanLink({ appointment_job_id: 42, salesman_id: undefined })
    expect(r.ok).toBe(false)
  })

  it('fails when appointment-linked but salesman is 0 (treat as unset)', () => {
    // Some legacy code uses 0 as a sentinel for "no salesman" — guard against it
    // sneaking past the validator. The DB constraint would also reject 0 if we
    // had a salesman_id=0 row, but bigint FKs resolve 0 as NOT NULL, so we
    // catch this case in the app layer instead.
    const r = validateQuoteSalesmanLink({ appointment_job_id: 42, salesman_id: 0 })
    expect(r.ok).toBe(false)
  })

  it('treats appointment_job_id=0 as "not linked" (legacy zero-sentinel)', () => {
    expect(
      validateQuoteSalesmanLink({ appointment_job_id: 0, salesman_id: null })
    ).toEqual({ ok: true })
  })
})

describe('mergeQuoteLinkUpdate — PATCH-aware validation', () => {
  it('PATCH that only sets salesman_id keeps the existing appointment_job_id', () => {
    const merged = mergeQuoteLinkUpdate({
      existing: { appointment_job_id: 42, salesman_id: null },
      update: { salesman_id: 7 },
    })
    expect(merged).toEqual({ appointment_job_id: 42, salesman_id: 7 })
    expect(validateQuoteSalesmanLink(merged)).toEqual({ ok: true })
  })

  it('PATCH that only sets appointment_job_id with no existing salesman fails validation', () => {
    const merged = mergeQuoteLinkUpdate({
      existing: { appointment_job_id: null, salesman_id: null },
      update: { appointment_job_id: 42 },
    })
    expect(merged).toEqual({ appointment_job_id: 42, salesman_id: null })
    const r = validateQuoteSalesmanLink(merged)
    expect(r.ok).toBe(false)
  })

  it('PATCH that intentionally unlinks (salesman_id: null) overrides existing salesman', () => {
    // If admin explicitly nulls salesman_id while appointment_job_id is set,
    // we want to fail — they need to either clear the appointment too, or
    // pick a different salesman.
    const merged = mergeQuoteLinkUpdate({
      existing: { appointment_job_id: 42, salesman_id: 7 },
      update: { salesman_id: null },
    })
    expect(merged).toEqual({ appointment_job_id: 42, salesman_id: null })
    const r = validateQuoteSalesmanLink(merged)
    expect(r.ok).toBe(false)
  })

  it('PATCH that unlinks appointment AND clears salesman is fine (back to a normal quote)', () => {
    const merged = mergeQuoteLinkUpdate({
      existing: { appointment_job_id: 42, salesman_id: 7 },
      update: { appointment_job_id: null, salesman_id: null },
    })
    expect(merged).toEqual({ appointment_job_id: null, salesman_id: null })
    expect(validateQuoteSalesmanLink(merged)).toEqual({ ok: true })
  })

  it('PATCH that touches neither field keeps existing state and passes', () => {
    const existing = { appointment_job_id: 42, salesman_id: 7 }
    const merged = mergeQuoteLinkUpdate({ existing, update: {} })
    expect(merged).toEqual(existing)
    expect(validateQuoteSalesmanLink(merged)).toEqual({ ok: true })
  })

  it('PATCH that touches neither field and the existing row is invalid stays invalid (no silent fix)', () => {
    // Hypothetical legacy row: appointment set, salesman missing. A PATCH
    // that doesn't touch either field shouldn't accidentally pass — it
    // would still fail when it hits the DB constraint, so the validator
    // surfaces it earlier.
    const existing = { appointment_job_id: 42, salesman_id: null }
    const merged = mergeQuoteLinkUpdate({ existing, update: {} })
    expect(validateQuoteSalesmanLink(merged).ok).toBe(false)
  })
})
