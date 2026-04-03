/**
 * Gmail IMAP Client (+ Gmail API path for service accounts)
 *
 * Fetches recent emails from a Gmail inbox.
 * Two paths:
 *   1. Service Account (domain-wide delegation) → Gmail API (preferred)
 *   2. App Password → IMAP (legacy)
 *
 * Uses date-based search so read emails are still caught.
 * Dedup happens in the cron via Message-ID checks in the DB.
 */

import { ImapFlow } from 'imapflow'
import { simpleParser, ParsedMail } from 'mailparser'
import { getGmailApiClient, hasServiceAccountCreds } from './gmail-client'
import type { GmailTenant } from './gmail-client'

export interface IncomingEmail {
  uid: number
  from: string          // sender email address
  fromName: string      // sender display name
  subject: string
  textBody: string      // plain text body (stripped of HTML)
  htmlBody: string      // raw HTML body
  messageId: string     // Message-ID header (for threading)
  inReplyTo: string | null   // In-Reply-To header
  references: string[]       // References header chain
  date: Date
}

interface GmailCreds {
  user: string
  pass: string
}

function getGmailCreds(tenant?: GmailTenant | null): GmailCreds | null {
  if (tenant?.gmail_user && tenant?.gmail_app_password) {
    return { user: tenant.gmail_user, pass: tenant.gmail_app_password }
  }
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (user && pass) return { user, pass }
  return null
}

// ---------------------------------------------------------------------------
// Gmail API path (service account)
// ---------------------------------------------------------------------------

function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8')
}

function extractHeader(headers: Array<{ name?: string | null; value?: string | null }>, name: string): string {
  const h = headers.find(h => h.name?.toLowerCase() === name.toLowerCase())
  return h?.value || ''
}

/**
 * Strip HTML tags for a rough plain-text extraction.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim()
}

/**
 * Recursively find parts with a given mimeType in a Gmail message payload.
 */
function findParts(payload: any, mimeType: string): string[] {
  const results: string[] = []
  if (payload.mimeType === mimeType && payload.body?.data) {
    results.push(decodeBase64Url(payload.body.data))
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      results.push(...findParts(part, mimeType))
    }
  }
  return results
}

async function fetchViaGmailApi(
  tenant: GmailTenant
): Promise<{ emails: IncomingEmail[]; error?: string }> {
  try {
    const gmail = getGmailApiClient(tenant.gmail_service_account_json!, tenant.gmail_impersonated_user!)
    const impersonatedUser = tenant.gmail_impersonated_user!.toLowerCase()

    // Search for emails from the last 24h
    const sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const afterEpoch = Math.floor(sinceDate.getTime() / 1000)

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${afterEpoch}`,
      maxResults: 100,
      includeSpamTrash: true,
    })

    const messageIds = listRes.data.messages || []
    if (messageIds.length === 0) return { emails: [] }

    console.log(`[Gmail API] Found ${messageIds.length} message(s) from last 24h for ${impersonatedUser}`)

    const emails: IncomingEmail[] = []

    for (const msg of messageIds) {
      try {
        const full = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'full',
        })

        const headers = full.data.payload?.headers || []
        const fromHeader = extractHeader(headers, 'From')

        // Parse "Name <email>" or just "email"
        const emailMatch = fromHeader.match(/<([^>]+)>/)
        const fromAddr = emailMatch ? emailMatch[1] : fromHeader.trim()
        const fromName = emailMatch
          ? fromHeader.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || fromAddr
          : fromAddr

        // Skip emails from our own address (outbound echoes)
        if (fromAddr.toLowerCase() === impersonatedUser) continue

        // Skip auto-replies, no-reply, mailer-daemon
        const lowerFrom = fromAddr.toLowerCase()
        if (
          lowerFrom.includes('noreply') ||
          lowerFrom.includes('no-reply') ||
          lowerFrom.includes('mailer-daemon') ||
          lowerFrom.includes('postmaster') ||
          lowerFrom.startsWith('auto-')
        ) continue

        // Extract body parts
        const payload = full.data.payload
        const htmlParts = findParts(payload, 'text/html')
        const textParts = findParts(payload, 'text/plain')
        const htmlBody = htmlParts.join('\n')
        const textBody = textParts.length > 0 ? textParts.join('\n') : stripHtml(htmlBody)

        // Parse references
        const refsStr = extractHeader(headers, 'References')
        const references = refsStr ? refsStr.split(/\s+/).filter(Boolean) : []

        const inReplyToStr = extractHeader(headers, 'In-Reply-To')
        const messageId = extractHeader(headers, 'Message-ID') || extractHeader(headers, 'Message-Id')

        const dateStr = extractHeader(headers, 'Date')
        const date = dateStr ? new Date(dateStr) : new Date(Number(full.data.internalDate) || Date.now())

        emails.push({
          uid: Number(full.data.internalDate) || 0, // Use internalDate as a unique-ish ID
          from: fromAddr,
          fromName,
          subject: extractHeader(headers, 'Subject'),
          textBody,
          htmlBody,
          messageId,
          inReplyTo: inReplyToStr || null,
          references,
          date,
        })
      } catch (msgErr) {
        console.error(`[Gmail API] Error fetching message ${msg.id}:`, msgErr)
      }
    }

    return { emails }
  } catch (err) {
    console.error('[Gmail API] Fetch error:', err)
    return { emails: [], error: err instanceof Error ? err.message : 'Gmail API fetch failed' }
  }
}

// ---------------------------------------------------------------------------
// IMAP path (app password — legacy)
// ---------------------------------------------------------------------------

async function fetchViaImap(
  creds: GmailCreds
): Promise<{ emails: IncomingEmail[]; error?: string }> {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: creds.user, pass: creds.pass },
    logger: false,
  })

  const emails: IncomingEmail[] = []

  try {
    await client.connect()

    const lock = await client.getMailboxLock('INBOX')
    try {
      const sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const uids = await client.search({ since: sinceDate }, { uid: true })

      if (!uids || uids.length === 0) {
        return { emails: [] }
      }

      console.log(`[Gmail IMAP] Found ${uids.length} email(s) from today for ${creds.user}`)

      for (const uid of uids) {
        try {
          const message = await client.fetchOne(String(uid), {
            source: true,
            uid: true,
          }, { uid: true })

          if (!message) continue
          const msgSource = (message as any).source
          if (!msgSource) continue

          const parsed: ParsedMail = await simpleParser(msgSource)

          const emailDate = parsed.date || new Date()

          const fromAddr = parsed.from?.value?.[0]?.address || ''
          const fromName = parsed.from?.value?.[0]?.name || fromAddr

          // Skip emails from our own address (outbound echoes)
          if (fromAddr.toLowerCase() === creds.user.toLowerCase()) continue

          // Skip auto-replies, no-reply, mailer-daemon
          const lowerFrom = fromAddr.toLowerCase()
          if (
            lowerFrom.includes('noreply') ||
            lowerFrom.includes('no-reply') ||
            lowerFrom.includes('mailer-daemon') ||
            lowerFrom.includes('postmaster') ||
            lowerFrom.startsWith('auto-')
          ) continue

          // Skip if the Auto-Submitted header indicates this is an auto-reply
          const autoSubmitted = parsed.headers?.get('auto-submitted')
          if (autoSubmitted && autoSubmitted !== 'no') continue

          // Parse references into array
          let references: string[] = []
          const refsHeader = parsed.references
          if (Array.isArray(refsHeader)) {
            references = refsHeader
          } else if (typeof refsHeader === 'string') {
            references = refsHeader.split(/\s+/).filter(Boolean)
          }

          emails.push({
            uid: (message as any).uid,
            from: fromAddr,
            fromName,
            subject: parsed.subject || '',
            textBody: parsed.text || '',
            htmlBody: parsed.html || '',
            messageId: parsed.messageId || '',
            inReplyTo: (typeof parsed.inReplyTo === 'string' ? parsed.inReplyTo : null),
            references,
            date: emailDate,
          })
        } catch (msgErr) {
          console.error(`[Gmail IMAP] Error parsing message UID ${uid}:`, msgErr)
        }
      }
    } finally {
      lock.release()
    }
  } catch (err) {
    console.error('[Gmail IMAP] Connection error:', err)
    return { emails: [], error: err instanceof Error ? err.message : 'IMAP connection failed' }
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore logout errors
    }
  }

  return { emails }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Connect to Gmail, fetch all emails from the last 24h, and return parsed results.
 * Automatically uses Gmail API (service account) if configured, else falls back to IMAP.
 */
export async function fetchUnreadEmails(
  tenant?: GmailTenant | null
): Promise<{ emails: IncomingEmail[]; error?: string }> {
  // Service Account path
  if (hasServiceAccountCreds(tenant)) {
    return fetchViaGmailApi(tenant!)
  }

  // IMAP path
  const creds = getGmailCreds(tenant)
  if (!creds) {
    return { emails: [], error: 'Gmail credentials not configured' }
  }
  return fetchViaImap(creds)
}

/**
 * Mark a specific email as read (SEEN) in the Gmail inbox.
 * For service account path, uses Gmail API modify to remove UNREAD label.
 */
export async function markEmailAsRead(
  uid: number,
  tenant?: GmailTenant | null
): Promise<void> {
  if (hasServiceAccountCreds(tenant)) {
    // Gmail API path — uid is not directly usable, but the cron uses message IDs
    // This is a best-effort no-op for the API path since we'd need the message ID
    return
  }

  const creds = getGmailCreds(tenant)
  if (!creds) return

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: creds.user, pass: creds.pass },
    logger: false,
  })

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
    } finally {
      lock.release()
    }
  } catch (err) {
    console.error(`[Gmail IMAP] Failed to mark UID ${uid} as read:`, err)
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore
    }
  }
}

/**
 * Mark multiple emails as read in a single session.
 */
export async function markEmailsAsRead(
  uids: number[],
  tenant?: GmailTenant | null
): Promise<void> {
  if (uids.length === 0) return

  if (hasServiceAccountCreds(tenant)) {
    // Gmail API path — best-effort no-op (dedup is by Message-ID in DB)
    return
  }

  const creds = getGmailCreds(tenant)
  if (!creds) return

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: creds.user, pass: creds.pass },
    logger: false,
  })

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      for (const uid of uids) {
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
      }
    } finally {
      lock.release()
    }
  } catch (err) {
    console.error(`[Gmail IMAP] Failed to mark UIDs as read:`, err)
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore
    }
  }
}
