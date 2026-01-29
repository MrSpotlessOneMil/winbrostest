/**
 * GoHighLevel API Client
 *
 * Syncs lead status back to GHL so client can track ROI
 * in their GHL dashboard.
 */

import { GHL_API_CONFIG } from './constants'

// GHL API headers
function getHeaders(): HeadersInit {
  const apiKey = process.env.GHL_API_KEY
  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured')
  }

  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  }
}

// Get location ID from env
function getLocationId(): string {
  const locationId = process.env.GHL_LOCATION_ID
  if (!locationId) {
    throw new Error('GHL_LOCATION_ID not configured')
  }
  return locationId
}

/**
 * Update a contact in GHL
 */
export async function updateGHLContact(
  contactId: string,
  updates: {
    tags?: string[]
    customFields?: Array<{ key: string; value: string }>
    firstName?: string
    lastName?: string
    email?: string
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `${GHL_API_CONFIG.BASE_URL}/contacts/${contactId}`,
      {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(updates),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('GHL contact update failed:', response.status, errorText)
      return { success: false, error: `GHL API error: ${response.status}` }
    }

    return { success: true }
  } catch (error) {
    console.error('GHL contact update error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Add tags to a GHL contact
 */
export async function addGHLTags(
  contactId: string,
  tags: string[]
): Promise<{ success: boolean; error?: string }> {
  return updateGHLContact(contactId, { tags })
}

/**
 * Update lead status in GHL with tags
 * This makes it visible in GHL dashboard for ROI tracking
 */
export async function syncLeadStatusToGHL(
  contactId: string,
  status: 'booked' | 'lost' | 'in_conversation' | 'call_completed' | 'no_response',
  metadata?: {
    serviceType?: string
    jobDate?: string
    price?: number
  }
): Promise<{ success: boolean; error?: string }> {
  // Map our status to GHL tags
  const statusTags: Record<string, string[]> = {
    booked: ['ai-booked', 'converted', 'automation-success'],
    lost: ['ai-lost', 'no-conversion'],
    in_conversation: ['ai-active', 'in-progress'],
    call_completed: ['ai-called', 'call-completed'],
    no_response: ['ai-no-response', 'cold-lead'],
  }

  const tags = statusTags[status] || []

  // Add service type tag if provided
  if (metadata?.serviceType) {
    const serviceTag = `service-${metadata.serviceType.toLowerCase().replace(/\s+/g, '-')}`
    tags.push(serviceTag)
  }

  // Build custom fields for detailed tracking
  const customFields: Array<{ key: string; value: string }> = [
    { key: 'ai_lead_status', value: status },
    { key: 'ai_last_updated', value: new Date().toISOString() },
  ]

  if (metadata?.serviceType) {
    customFields.push({ key: 'ai_service_type', value: metadata.serviceType })
  }
  if (metadata?.jobDate) {
    customFields.push({ key: 'ai_job_date', value: metadata.jobDate })
  }
  if (metadata?.price) {
    customFields.push({ key: 'ai_quoted_price', value: metadata.price.toString() })
  }

  return updateGHLContact(contactId, { tags, customFields })
}

/**
 * Add a note to the contact's timeline in GHL
 */
export async function addGHLContactNote(
  contactId: string,
  note: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `${GHL_API_CONFIG.BASE_URL}/contacts/${contactId}/notes`,
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          body: note,
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('GHL note add failed:', response.status, errorText)
      return { success: false, error: `GHL API error: ${response.status}` }
    }

    return { success: true }
  } catch (error) {
    console.error('GHL note add error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Mark lead as booked in GHL - full sync with all details
 */
export async function markLeadBookedInGHL(
  contactId: string,
  bookingDetails: {
    serviceType: string
    jobDate: string
    price: number
    address?: string
    bedrooms?: number
    bathrooms?: number
  }
): Promise<{ success: boolean; error?: string }> {
  // Update status and tags
  const statusResult = await syncLeadStatusToGHL(contactId, 'booked', {
    serviceType: bookingDetails.serviceType,
    jobDate: bookingDetails.jobDate,
    price: bookingDetails.price,
  })

  if (!statusResult.success) {
    return statusResult
  }

  // Add detailed note to timeline
  const noteLines = [
    `BOOKED via AI Automation`,
    `Service: ${bookingDetails.serviceType}`,
    `Date: ${bookingDetails.jobDate}`,
    `Price: $${bookingDetails.price}`,
  ]

  if (bookingDetails.address) {
    noteLines.push(`Address: ${bookingDetails.address}`)
  }
  if (bookingDetails.bedrooms) {
    noteLines.push(`Bedrooms: ${bookingDetails.bedrooms}`)
  }
  if (bookingDetails.bathrooms) {
    noteLines.push(`Bathrooms: ${bookingDetails.bathrooms}`)
  }

  noteLines.push(``, `Automated by The Clean Machine`)

  return addGHLContactNote(contactId, noteLines.join('\n'))
}

/**
 * Mark lead as lost in GHL
 */
export async function markLeadLostInGHL(
  contactId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const statusResult = await syncLeadStatusToGHL(contactId, 'lost')

  if (!statusResult.success) {
    return statusResult
  }

  const note = reason
    ? `Lead marked as LOST\nReason: ${reason}\n\nAutomated by The Clean Machine`
    : `Lead marked as LOST (no response after max attempts)\n\nAutomated by The Clean Machine`

  return addGHLContactNote(contactId, note)
}

/**
 * Get contact details from GHL
 */
export async function getGHLContact(
  contactId: string
): Promise<{ success: boolean; contact?: Record<string, unknown>; error?: string }> {
  try {
    const response = await fetch(
      `${GHL_API_CONFIG.BASE_URL}/contacts/${contactId}`,
      {
        method: 'GET',
        headers: getHeaders(),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('GHL contact fetch failed:', response.status, errorText)
      return { success: false, error: `GHL API error: ${response.status}` }
    }

    const data = await response.json()
    return { success: true, contact: data.contact }
  } catch (error) {
    console.error('GHL contact fetch error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
