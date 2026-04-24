/**
 * Customer picker helpers — Unit Tests (Round 2 Wave 3d)
 *
 * `mapsDirectionsUrl` is used by the New Appointment modal's "Click for
 * directions" button. `customerDisplayName` is used wherever the picker
 * chose a customer needs to render a name.
 */

import { describe, it, expect } from 'vitest'
import {
  customerDisplayName,
  mapsDirectionsUrl,
} from '@/apps/window-washing/components/winbros/customer-picker'

describe('customerDisplayName', () => {
  it('variant 1 (happy): first + last', () => {
    expect(
      customerDisplayName({
        id: 1,
        first_name: 'Max',
        last_name: 'Shoemaker',
        phone_number: null,
        email: null,
        address: null,
      })
    ).toBe('Max Shoemaker')
  })

  it('variant 2 (no name): falls back to phone', () => {
    expect(
      customerDisplayName({
        id: 2,
        first_name: null,
        last_name: null,
        phone_number: '+13095551234',
        email: null,
        address: null,
      })
    ).toBe('+13095551234')
  })

  it('variant 3 (nothing): falls back to Customer #id', () => {
    expect(
      customerDisplayName({
        id: 42,
        first_name: null,
        last_name: null,
        phone_number: null,
        email: null,
        address: null,
      })
    ).toBe('Customer #42')
  })
})

describe('mapsDirectionsUrl', () => {
  it('variant 1 (happy): encodes address for Google Maps', () => {
    const url = mapsDirectionsUrl('404 Eastwood, Morton, IL')
    expect(url).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=404%20Eastwood%2C%20Morton%2C%20IL'
    )
  })

  it('variant 2 (whitespace): trims before encoding', () => {
    const url = mapsDirectionsUrl('  123 Main St  ')
    expect(url).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=123%20Main%20St'
    )
  })

  it('variant 3 (empty/null): returns null so caller can hide the button', () => {
    expect(mapsDirectionsUrl('')).toBeNull()
    expect(mapsDirectionsUrl('   ')).toBeNull()
    expect(mapsDirectionsUrl(null)).toBeNull()
    expect(mapsDirectionsUrl(undefined)).toBeNull()
  })
})
