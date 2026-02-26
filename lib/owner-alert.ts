import { sendSMS } from './openphone'
import { logSystemEvent } from './system-events'
import type { Tenant } from './tenant'

const OWNER_PHONE = process.env.OWNER_PHONE || ''

export async function alertOwner(
  message: string,
  options?: { jobId?: string; metadata?: Record<string, unknown>; tenant?: Tenant | null }
): Promise<boolean> {
  const tenant = options?.tenant
  const ownerPhone = tenant?.owner_phone || OWNER_PHONE

  if (!ownerPhone) {
    return false
  }

  let sendResult: { success: boolean; error?: string } = { success: false, error: 'No tenant for SMS' }
  if (tenant) {
    sendResult = await sendSMS(tenant, ownerPhone, message)
  } else {
    console.error('[owner-alert] No tenant provided — cannot send owner alert SMS. Use Telegram alerting instead.')
  }

  await logSystemEvent({
    source: 'system',
    event_type: 'OWNER_ACTION_REQUIRED',
    message,
    job_id: options?.jobId,
    phone_number: ownerPhone,
    metadata: options?.metadata,
  })

  return sendResult.success
}
