import { sendSMS } from './openphone'
import { logSystemEvent } from './system-events'

const OWNER_PHONE = process.env.OWNER_PHONE || ''

export async function alertOwner(
  message: string,
  options?: { jobId?: string; metadata?: Record<string, unknown> }
): Promise<boolean> {
  if (!OWNER_PHONE) {
    return false
  }

  const sendResult = await sendSMS(OWNER_PHONE, message)

  await logSystemEvent({
    source: 'system',
    event_type: 'OWNER_ACTION_REQUIRED',
    message,
    job_id: options?.jobId,
    phone_number: OWNER_PHONE,
    metadata: options?.metadata,
  })

  return sendResult.success
}
