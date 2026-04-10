/**
 * Message Disposition Tracking
 *
 * Every inbound customer message gets a `disposition` in its metadata
 * that records what happened to it. This enables the ghost watchdog
 * to distinguish "still processing" from "silently dropped."
 */

export type MessageDisposition =
  | 'pending'                // Just stored, not yet processed (ghost watchdog target)
  | 'responded_ai'           // AI generated and sent response
  | 'responded_lifecycle'    // Post-job / recurring / membership handler responded
  | 'filtered_owner'         // Owner phone (intentional)
  | 'filtered_blocklist'     // Blocklisted contact (intentional)
  | 'filtered_cleaner'       // Cleaner phone (routed differently)
  | 'filtered_paused'        // Manual takeover active, staff conversing
  | 'filtered_human_handled' // Human resolved conversation <30 min ago
  | 'filtered_cold_noop'     // Cold contact, obviously not booking
  | 'filtered_dedup'         // Duplicate webhook
  | 'filtered_debounce'      // Newer message superseded this one
  | 'filtered_opt_out'       // Customer sent STOP/unsubscribe
  | 'skipped_ai_decision'    // AI decided shouldSend=false
  | 'skipped_sms_disabled'   // SMS auto-response disabled for tenant
  | 'skipped_lead_paused'    // followup_paused on lead
  | 'error_ai'               // AI response generation failed
  | 'error_sms_send'         // SMS delivery failed (retry scheduled)

/**
 * Update the disposition on a stored inbound message.
 * Merges into existing metadata without overwriting other fields.
 *
 * Safe to call even if messageId is null (no-op).
 */
export async function updateDisposition(
  client: { from: (table: string) => any },
  messageId: number | null | undefined,
  disposition: MessageDisposition,
): Promise<void> {
  if (!messageId) return
  const { data } = await client
    .from('messages')
    .select('metadata')
    .eq('id', messageId)
    .single()
  if (data) {
    await client
      .from('messages')
      .update({ metadata: { ...(data.metadata || {}), disposition } })
      .eq('id', messageId)
  }
}
