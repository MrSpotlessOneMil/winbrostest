/**
 * Gmail IMAP Client
 *
 * Fetches unread emails from a Gmail inbox using IMAP.
 * Uses the same credential resolution as gmail-client.ts:
 * tenant-specific creds first, then env var fallback.
 */

import { ImapFlow } from 'imapflow'
import { simpleParser, ParsedMail } from 'mailparser'

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

function getGmailCreds(tenant?: { gmail_user?: string | null; gmail_app_password?: string | null }): GmailCreds | null {
  if (tenant?.gmail_user && tenant?.gmail_app_password) {
    return { user: tenant.gmail_user, pass: tenant.gmail_app_password }
  }
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (user && pass) return { user, pass }
  return null
}

/**
 * Connect to Gmail IMAP, fetch all UNSEEN emails, and return parsed results.
 * Does NOT mark emails as seen — call markEmailAsRead() after successful processing.
 */
export async function fetchUnreadEmails(
  tenant?: { gmail_user?: string | null; gmail_app_password?: string | null }
): Promise<{ emails: IncomingEmail[]; error?: string }> {
  const creds = getGmailCreds(tenant)
  if (!creds) {
    return { emails: [], error: 'Gmail credentials not configured' }
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: creds.user, pass: creds.pass },
    logger: false, // suppress verbose IMAP logging
  })

  const emails: IncomingEmail[] = []

  try {
    await client.connect()

    const lock = await client.getMailboxLock('INBOX')
    try {
      // Search for unseen messages
      const uids = await client.search({ seen: false }, { uid: true })

      if (!uids || uids.length === 0) {
        return { emails: [] }
      }

      // Fetch each unseen message
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
            subject: parsed.subject || '(no subject)',
            textBody: parsed.text || '',
            htmlBody: parsed.html || '',
            messageId: parsed.messageId || '',
            inReplyTo: (typeof parsed.inReplyTo === 'string' ? parsed.inReplyTo : null),
            references,
            date: parsed.date || new Date(),
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

/**
 * Mark a specific email as read (SEEN) in the Gmail inbox.
 * Call this after successfully processing an email.
 */
export async function markEmailAsRead(
  uid: number,
  tenant?: { gmail_user?: string | null; gmail_app_password?: string | null }
): Promise<void> {
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
 * Mark multiple emails as read in a single IMAP session.
 */
export async function markEmailsAsRead(
  uids: number[],
  tenant?: { gmail_user?: string | null; gmail_app_password?: string | null }
): Promise<void> {
  if (uids.length === 0) return

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
