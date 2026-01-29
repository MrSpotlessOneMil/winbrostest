"use server"

/**
 * QStash Client for Background Jobs & Scheduled Tasks
 * Handles delayed messages, scheduled callbacks, and workflow orchestration
 */

const QSTASH_URL = process.env.QSTASH_URL || "https://qstash.upstash.io"

interface QStashRequestOptions {
  method?: "GET" | "POST" | "DELETE"
  headers?: Record<string, string>
  body?: unknown
}

async function qstashRequest<T>(
  endpoint: string,
  options: QStashRequestOptions = {}
): Promise<T> {
  const token = process.env.QSTASH_TOKEN
  if (!token) {
    throw new Error("QSTASH_TOKEN is not configured")
  }

  const response = await fetch(`${QSTASH_URL}${endpoint}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`QStash Error: ${response.status} - ${error}`)
  }

  // Some endpoints return empty responses
  const text = await response.text()
  return text ? JSON.parse(text) : ({} as T)
}

export interface QStashMessage {
  messageId: string
  url: string
  createdAt: number
  state: "CREATED" | "ACTIVE" | "DELIVERED" | "ERROR" | "RETRY" | "FAILED"
}

export interface PublishOptions {
  url: string
  body?: unknown
  delay?: number // Delay in seconds
  notBefore?: number // Unix timestamp
  retries?: number
  callback?: string
  failureCallback?: string
  deduplicationId?: string
  contentBasedDeduplication?: boolean
}

/**
 * Publish a message to be delivered immediately or with a delay
 */
export async function publish(options: PublishOptions): Promise<QStashMessage> {
  const headers: Record<string, string> = {}

  if (options.delay) {
    headers["Upstash-Delay"] = `${options.delay}s`
  }

  if (options.notBefore) {
    headers["Upstash-Not-Before"] = options.notBefore.toString()
  }

  if (options.retries !== undefined) {
    headers["Upstash-Retries"] = options.retries.toString()
  }

  if (options.callback) {
    headers["Upstash-Callback"] = options.callback
  }

  if (options.failureCallback) {
    headers["Upstash-Failure-Callback"] = options.failureCallback
  }

  if (options.deduplicationId) {
    headers["Upstash-Deduplication-Id"] = options.deduplicationId
  }

  if (options.contentBasedDeduplication) {
    headers["Upstash-Content-Based-Deduplication"] = "true"
  }

  return qstashRequest<QStashMessage>(`/v2/publish/${options.url}`, {
    method: "POST",
    headers,
    body: options.body,
  })
}

/**
 * Schedule a recurring task using cron syntax
 */
export async function createSchedule(options: {
  destination: string
  cron: string
  body?: unknown
  retries?: number
}): Promise<{ scheduleId: string }> {
  const headers: Record<string, string> = {
    "Upstash-Cron": options.cron,
  }

  if (options.retries !== undefined) {
    headers["Upstash-Retries"] = options.retries.toString()
  }

  return qstashRequest<{ scheduleId: string }>(`/v2/schedules/${options.destination}`, {
    method: "POST",
    headers,
    body: options.body,
  })
}

/**
 * Delete a scheduled task
 */
export async function deleteSchedule(scheduleId: string): Promise<void> {
  await qstashRequest(`/v2/schedules/${scheduleId}`, {
    method: "DELETE",
  })
}

/**
 * List all schedules
 */
export async function listSchedules(): Promise<
  Array<{
    scheduleId: string
    cron: string
    destination: string
    createdAt: number
  }>
> {
  return qstashRequest("/v2/schedules")
}

// ============================================
// OSIRIS-Specific Scheduled Tasks
// ============================================

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL

function getFullUrl(path: string): string {
  const baseUrl = APP_URL?.startsWith("http") ? APP_URL : `https://${APP_URL}`
  return `${baseUrl}${path}`
}

/**
 * Schedule lead follow-up sequence
 * Based on OSIRIS contract: immediate text, 10min call, 5min double call, etc.
 */
export async function scheduleLeadFollowUp(
  leadId: string,
  leadPhone: string,
  leadName: string
): Promise<{ messageIds: string[] }> {
  const basePayload = { leadId, leadPhone, leadName }
  const messageIds: string[] = []

  // Stage 1: Immediate text (0 seconds)
  const msg1 = await publish({
    url: getFullUrl("/api/automation/lead-followup"),
    body: { ...basePayload, stage: 1, action: "text" },
    deduplicationId: `lead-${leadId}-stage-1`,
  })
  messageIds.push(msg1.messageId)

  // Stage 2: First call if no reply (10 minutes)
  const msg2 = await publish({
    url: getFullUrl("/api/automation/lead-followup"),
    body: { ...basePayload, stage: 2, action: "call" },
    delay: 10 * 60,
    deduplicationId: `lead-${leadId}-stage-2`,
  })
  messageIds.push(msg2.messageId)

  // Stage 3: Double call if no answer (15 minutes total)
  const msg3 = await publish({
    url: getFullUrl("/api/automation/lead-followup"),
    body: { ...basePayload, stage: 3, action: "double_call" },
    delay: 15 * 60,
    deduplicationId: `lead-${leadId}-stage-3`,
  })
  messageIds.push(msg3.messageId)

  // Stage 4: Second text (20 minutes total)
  const msg4 = await publish({
    url: getFullUrl("/api/automation/lead-followup"),
    body: { ...basePayload, stage: 4, action: "text" },
    delay: 20 * 60,
    deduplicationId: `lead-${leadId}-stage-4`,
  })
  messageIds.push(msg4.messageId)

  // Stage 5: Final call (30 minutes total)
  const msg5 = await publish({
    url: getFullUrl("/api/automation/lead-followup"),
    body: { ...basePayload, stage: 5, action: "call" },
    delay: 30 * 60,
    deduplicationId: `lead-${leadId}-stage-5`,
  })
  messageIds.push(msg5.messageId)

  return { messageIds }
}

/**
 * Schedule job assignment broadcast with escalation
 */
export async function scheduleJobBroadcast(
  jobId: string,
  teamLeadIds: string[]
): Promise<{ messageIds: string[] }> {
  const messageIds: string[] = []

  // Initial broadcast (immediate)
  const msg1 = await publish({
    url: getFullUrl("/api/automation/job-broadcast"),
    body: { jobId, teamLeadIds, phase: "initial" },
    deduplicationId: `job-${jobId}-broadcast-initial`,
  })
  messageIds.push(msg1.messageId)

  // Urgent follow-up (10 minutes)
  const msg2 = await publish({
    url: getFullUrl("/api/automation/job-broadcast"),
    body: { jobId, teamLeadIds, phase: "urgent" },
    delay: 10 * 60,
    deduplicationId: `job-${jobId}-broadcast-urgent`,
  })
  messageIds.push(msg2.messageId)

  // Escalation to ops (20 minutes)
  const msg3 = await publish({
    url: getFullUrl("/api/automation/job-broadcast"),
    body: { jobId, phase: "escalate" },
    delay: 20 * 60,
    deduplicationId: `job-${jobId}-broadcast-escalate`,
  })
  messageIds.push(msg3.messageId)

  return { messageIds }
}

/**
 * Schedule day-before reminder
 */
export async function scheduleDayBeforeReminder(
  jobId: string,
  customerPhone: string,
  customerName: string,
  appointmentDate: string
): Promise<QStashMessage> {
  // Calculate timestamp for day before at 4 PM
  const appointmentDateObj = new Date(appointmentDate)
  appointmentDateObj.setDate(appointmentDateObj.getDate() - 1)
  appointmentDateObj.setHours(16, 0, 0, 0)

  return publish({
    url: getFullUrl("/api/automation/send-reminder"),
    body: { jobId, customerPhone, customerName, type: "day_before" },
    notBefore: Math.floor(appointmentDateObj.getTime() / 1000),
    deduplicationId: `reminder-${jobId}-day-before`,
  })
}

/**
 * Verify QStash webhook signature
 */
export async function verifySignature(
  signature: string,
  body: string
): Promise<boolean> {
  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY

  if (!currentKey) {
    console.warn("QStash signing keys not configured, skipping verification")
    return true
  }

  // Try current key first, then next key (for key rotation)
  for (const key of [currentKey, nextKey].filter(Boolean)) {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(key)
    const messageData = encoder.encode(body)

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    )

    const signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0))

    const isValid = await crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      signatureBytes,
      messageData
    )

    if (isValid) return true
  }

  return false
}
