/**
 * GoHighLevel Integration Module
 *
 * Detachable "DLC" for capturing and processing
 * Meta Ads leads from GoHighLevel.
 */

// Types
export * from './types'

// Constants and helpers
export {
  GHL_TIMING,
  GHL_SMS_TEMPLATES,
  GHL_API_CONFIG,
  GHL_LEAD_SOURCES,
  getClientServices,
  getClientFrequencies,
  isWithinBusinessHours,
  getNextBusinessHour,
  calculateSilenceDuration,
  shouldTriggerCall,
} from './constants'

// Webhook handler
export { processGHLWebhook, extractContactData } from './webhook-handler'

// Lead processor
export { processNewLead, createLeadFromContact } from './lead-processor'

// Follow-up scheduler
export {
  scheduleFollowUp,
  cancelPendingFollowups,
  getPendingFollowups,
  processFollowUp,
  checkAndTriggerSilenceFollowups,
} from './follow-up-scheduler'

// SDR prompts
export { generateSDRResponse, buildSDRSystemPrompt } from './sdr-prompts'

// GHL API - sync status back to GHL for ROI tracking
export {
  updateGHLContact,
  addGHLTags,
  syncLeadStatusToGHL,
  addGHLContactNote,
  markLeadBookedInGHL,
  markLeadLostInGHL,
  getGHLContact,
} from './ghl-api'
