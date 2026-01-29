import { getClientConfig } from './client-config'
import type { Customer, Job } from './supabase'

export type DocuSignResult = {
  success: boolean
  envelopeId?: string
  error?: string
}

function isDocuSignEnabled(): boolean {
  const config = getClientConfig()
  return (
    config.features.docusign &&
    Boolean(process.env.DOCUSIGN_ACCESS_TOKEN) &&
    Boolean(process.env.DOCUSIGN_ACCOUNT_ID) &&
    Boolean(process.env.DOCUSIGN_TEMPLATE_ID)
  )
}

function buildCustomerName(customer: Customer): string {
  const parts = [customer.first_name, customer.last_name].filter(Boolean)
  if (parts.length > 0) {
    return parts.join(' ')
  }
  return customer.phone_number || 'Customer'
}

export async function sendDocuSignContract(
  job: Job,
  customer: Customer
): Promise<DocuSignResult> {
  if (!isDocuSignEnabled()) {
    return { success: false, error: 'DocuSign not enabled' }
  }

  if (!customer.email) {
    return { success: false, error: 'Customer email required for DocuSign' }
  }

  const accessToken = process.env.DOCUSIGN_ACCESS_TOKEN as string
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID as string
  const templateId = process.env.DOCUSIGN_TEMPLATE_ID as string
  const baseUrl = process.env.DOCUSIGN_BASE_URL || 'https://www.docusign.net/restapi'

  const clientRoleName = process.env.DOCUSIGN_CLIENT_ROLE_NAME || 'Client'
  const ceoRoleName = process.env.DOCUSIGN_CEO_ROLE_NAME || 'CEO'
  const ceoName = process.env.DOCUSIGN_CEO_NAME
  const ceoEmail = process.env.DOCUSIGN_CEO_EMAIL

  if (!ceoName || !ceoEmail) {
    return { success: false, error: 'DocuSign CEO name/email not configured' }
  }

  const emailSubject = process.env.DOCUSIGN_EMAIL_SUBJECT || 'Cleaning Services Agreement'
  const emailBlurb = process.env.DOCUSIGN_EMAIL_BLURB

  const payload: Record<string, unknown> = {
    templateId,
    status: 'sent',
    emailSubject,
    templateRoles: [
      {
        roleName: clientRoleName,
        name: buildCustomerName(customer),
        email: customer.email,
      },
      {
        roleName: ceoRoleName,
        name: ceoName,
        email: ceoEmail,
      },
    ],
  }

  if (emailBlurb) {
    payload.emailBlurb = emailBlurb
  }

  try {
    const response = await fetch(`${baseUrl}/v2.1/accounts/${accountId}/envelopes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const text = await response.text()
    if (!response.ok) {
      return { success: false, error: `DocuSign API error: ${response.status} ${text}` }
    }

    const data = text ? JSON.parse(text) : null
    const envelopeId = data?.envelopeId || data?.envelope_id
    return { success: true, envelopeId }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown DocuSign error'
    return { success: false, error: message }
  }
}
