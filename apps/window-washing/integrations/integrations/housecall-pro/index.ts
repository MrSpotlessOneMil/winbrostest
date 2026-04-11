/**
 * Housecall Pro Integration
 *
 * Export all HCP integration functions for use in API routes and cron jobs.
 */

// API Client
export {
  getJob,
  listJobs,
  createJob,
  updateJob,
  cancelJob,
  completeJob,
  getCustomer,
  searchCustomers,
  createCustomer,
  updateCustomer,
  listEmployees,
  getEmployee,
  validateWebhookSignature,
  getJobsForDate,
  getUpcomingJobs,
} from './hcp-client'

// Webhook Handler
export { handleHCPWebhook } from './webhook-handler'

// Job Sync
export {
  syncJobFromHCP,
  syncJobsForDate,
  validateServiceRadius,
  checkUnderfillDays,
  getJobsNeedingAssignment,
  assignCrewToJob,
} from './job-sync'

// Types
export type {
  HCPJob,
  HCPCustomer,
  HCPEmployee,
  HCPAddress,
  HCPLineItem,
  HCPInvoice,
  HCPPayment,
  HCPLead,
  HCPJobStatus,
  HCPInvoiceStatus,
  HCPWebhookPayload,
  HCPWebhookEventType,
  HCPApiResult,
  JobSyncResult,
  CreateHCPJobInput,
  UpdateHCPJobInput,
  InternalJobStatus,
} from './types'

// Constants
export {
  HCP_API_CONFIG,
  HCP_ENDPOINTS,
  WEBHOOK_ACTIONS,
  SERVICE_RADIUS_CONFIG,
  HIGH_VALUE_CONFIG,
  REVIEW_BONUS_CONFIG,
  UNDERFILL_CONFIG,
  SYNC_CONFIG,
  WINDOW_CLEANING_CONFIG,
} from './constants'

export { HCP_STATUS_MAP, INTERNAL_STATUS_MAP } from './types'
