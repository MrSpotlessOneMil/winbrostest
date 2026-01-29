import { toE164 } from './phone-utils'
import { getClientConfig } from './client-config'
import type { Customer, Job } from './supabase'

const HUBSPOT_BASE_URL = 'https://api.hubapi.com'

export type HubSpotContactSyncResult = {
  success: boolean
  contactId?: string
  error?: string
}

export type HubSpotDealSyncResult = {
  success: boolean
  dealId?: string
  contactId?: string
  error?: string
}

function isHubSpotEnabled(): boolean {
  const config = getClientConfig()
  return config.features.hubspot && Boolean(process.env.HUBSPOT_ACCESS_TOKEN)
}

async function hubspotRequest<T>(
  path: string,
  options: RequestInit
): Promise<T> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN
  if (!token) {
    throw new Error('HUBSPOT_ACCESS_TOKEN not configured')
  }

  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('Accept', 'application/json')
  if (options.body) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${HUBSPOT_BASE_URL}${path}`, {
    ...options,
    headers,
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`HubSpot API error: ${response.status} ${text}`)
  }

  if (!text) {
    return {} as T
  }

  return JSON.parse(text) as T
}

function buildContactProperties(customer: Customer): Record<string, string> {
  const properties: Record<string, string> = {}
  if (customer.first_name) properties.firstname = customer.first_name
  if (customer.last_name) properties.lastname = customer.last_name
  if (customer.email) properties.email = customer.email
  if (customer.address) properties.address = customer.address

  const normalizedPhone = toE164(customer.phone_number)
  if (normalizedPhone) {
    properties.phone = normalizedPhone
  }

  return properties
}

function buildDealName(job: Job, customer?: Customer): string {
  const nameParts = []
  if (customer?.first_name || customer?.last_name) {
    const fullName = `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim()
    if (fullName) nameParts.push(fullName)
  } else if (job.phone_number) {
    nameParts.push(job.phone_number)
  }

  if (job.date) {
    nameParts.push(job.date)
  }

  const base = nameParts.length > 0 ? nameParts.join(' - ') : 'Cleaning Job'
  return `Cleaning - ${base}`
}

function resolveDealStage(job: Job): string | undefined {
  const status = job.status || 'lead'
  const mapping: Record<string, string | undefined> = {
    lead: process.env.HUBSPOT_STAGE_LEAD,
    quoted: process.env.HUBSPOT_STAGE_QUOTED,
    scheduled: process.env.HUBSPOT_STAGE_SCHEDULED,
    completed: process.env.HUBSPOT_STAGE_COMPLETED,
    cancelled: process.env.HUBSPOT_STAGE_CANCELLED,
  }

  return mapping[status] || process.env.HUBSPOT_STAGE_DEFAULT
}

function buildDealProperties(job: Job, customer?: Customer): Record<string, string> {
  const properties: Record<string, string> = {
    dealname: buildDealName(job, customer),
  }

  if (job.price !== undefined && job.price !== null) {
    properties.amount = String(job.price)
  }

  const pipelineId = process.env.HUBSPOT_PIPELINE_ID
  if (pipelineId) {
    properties.pipeline = pipelineId
  }

  const stageId = resolveDealStage(job)
  if (stageId) {
    properties.dealstage = stageId
  }

  if (job.status === 'completed') {
    properties.closedate = new Date().toISOString()
  }

  return properties
}

async function searchContactByEmailOrPhone(
  email?: string,
  phone?: string
): Promise<string | undefined> {
  const filterGroups = []
  if (email) {
    filterGroups.push({
      filters: [{ propertyName: 'email', operator: 'EQ', value: email }],
    })
  }
  if (phone) {
    filterGroups.push({
      filters: [{ propertyName: 'phone', operator: 'EQ', value: phone }],
    })
  }

  if (filterGroups.length === 0) {
    return undefined
  }

  const payload = {
    filterGroups,
    properties: ['email', 'phone', 'firstname', 'lastname'],
    limit: 1,
  }

  const result = await hubspotRequest<{
    results?: Array<{ id: string }>
  }>('/crm/v3/objects/contacts/search', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  return result.results?.[0]?.id
}

async function createContact(properties: Record<string, string>): Promise<string> {
  const result = await hubspotRequest<{ id: string }>('/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  })
  return result.id
}

async function updateContact(contactId: string, properties: Record<string, string>): Promise<void> {
  await hubspotRequest(`/crm/v3/objects/contacts/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  })
}

async function createDeal(
  properties: Record<string, string>,
  contactId?: string
): Promise<string> {
  const payload: {
    properties: Record<string, string>
    associations?: Array<{
      to: { id: string }
      types: Array<{ associationCategory: string; associationTypeId: number }>
    }>
  } = { properties }

  if (contactId) {
    payload.associations = [
      {
        to: { id: contactId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
      },
    ]
  }

  const result = await hubspotRequest<{ id: string }>('/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  return result.id
}

async function updateDeal(dealId: string, properties: Record<string, string>): Promise<void> {
  await hubspotRequest(`/crm/v3/objects/deals/${dealId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  })
}

export async function syncHubSpotContact(customer: Customer): Promise<HubSpotContactSyncResult> {
  if (!isHubSpotEnabled()) {
    return { success: false }
  }

  try {
    const properties = buildContactProperties(customer)
    const email = customer.email
    const phone = toE164(customer.phone_number)

    let contactId = customer.hubspot_contact_id
    if (!contactId) {
      contactId = await searchContactByEmailOrPhone(email, phone)
    }

    if (contactId) {
      if (Object.keys(properties).length > 0) {
        await updateContact(contactId, properties)
      }
      return { success: true, contactId }
    }

    if (Object.keys(properties).length === 0) {
      return { success: false, error: 'No contact properties to create' }
    }

    const createdId = await createContact(properties)
    return { success: true, contactId: createdId }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown HubSpot error'
    return { success: false, error: message }
  }
}

export async function syncHubSpotDeal(
  job: Job,
  customer?: Customer
): Promise<HubSpotDealSyncResult> {
  if (!isHubSpotEnabled()) {
    return { success: false }
  }

  try {
    let contactId = customer?.hubspot_contact_id
    if (customer) {
      const contactResult = await syncHubSpotContact(customer)
      if (contactResult.contactId) {
        contactId = contactResult.contactId
      }
    }

    const properties = buildDealProperties(job, customer)
    const dealId = job.hubspot_deal_id

    if (dealId) {
      await updateDeal(dealId, properties)
      return { success: true, dealId, contactId }
    }

    const createdId = await createDeal(properties, contactId)
    return { success: true, dealId: createdId, contactId }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown HubSpot error'
    return { success: false, error: message }
  }
}
