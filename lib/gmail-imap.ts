/**
 * Gmail IMAP Client
 *
 * Fetches recent emails from a Gmail inbox using IMAP.
 * Uses date-based search (not UNSEEN) so read emails are still caught.
 * Dedup happens in the cron via Message-ID checks in the DB.
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
 * Connect to Gmail IMAP, fetch all emails from today, and return parsed results.
 * Uses date-based search (not UNSEEN) so read emails are still caught.
 * Dedup is handled by Message-ID checks in the cron — safe to return duplicates.
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
      // Search for emails from the last 24h — IMAP SINCE is date-only and uses
      // the email's Date header timezone, so we go back a full day to avoid
      // timezone mismatches between server (UTC) and email senders
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
            subject: parsed.subject || '(no subject)',
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
