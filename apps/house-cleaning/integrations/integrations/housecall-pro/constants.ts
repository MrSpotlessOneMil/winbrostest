/**
 * Housecall Pro Integration Constants
 *
 * API endpoints, configuration, and timing constants.
 */

// HCP API Configuration
export const HCP_API_CONFIG = {
  BASE_URL: 'https://api.housecallpro.com',
  API_VERSION: 'v1',

  // Rate limiting
  MAX_REQUESTS_PER_MINUTE: 60,
  RETRY_DELAY_MS: 1000,
  MAX_RETRIES: 3,
}

// HCP API Endpoints
export const HCP_ENDPOINTS = {
  // Jobs
  JOBS: '/jobs',
  JOB_BY_ID: (id: string) => `/jobs/${id}`,

  // Customers
  CUSTOMERS: '/customers',
  CUSTOMER_BY_ID: (id: string) => `/customers/${id}`,
  CUSTOMER_SEARCH: '/customers/search',

  // Employees
  EMPLOYEES: '/employees',
  EMPLOYEE_BY_ID: (id: string) => `/employees/${id}`,

  // Invoices
  INVOICES: '/invoices',
  INVOICE_BY_ID: (id: string) => `/invoices/${id}`,

  // Estimates
  ESTIMATES: '/estimates',
  ESTIMATE_BY_ID: (id: string) => `/estimates/${id}`,
}

// Webhook event to action mapping
export const WEBHOOK_ACTIONS = {
  'job.created': 'sync_new_job',
  'job.updated': 'sync_job_update',
  'job.scheduled': 'sync_job_scheduled',
  'job.started': 'mark_job_in_progress',
  'job.completed': 'trigger_payment_and_review',
  'job.canceled': 'cancel_job',
  'customer.created': 'sync_new_customer',
  'customer.updated': 'sync_customer_update',
  'invoice.paid': 'mark_job_paid',
  'payment.received': 'process_payment',
} as const

// Service radius configuration (default: 50 minutes)
export const SERVICE_RADIUS_CONFIG = {
  DEFAULT_MAX_MINUTES: parseInt(process.env.WINBROS_SERVICE_RADIUS_MINUTES || '50', 10),
  ALERT_THRESHOLD_MINUTES: parseInt(process.env.WINBROS_SERVICE_RADIUS_MINUTES || '50', 10),
}

// High value job configuration (default: $1,000)
export const HIGH_VALUE_CONFIG = {
  THRESHOLD_CENTS: parseInt(process.env.WINBROS_HIGH_VALUE_THRESHOLD_CENTS || '100000', 10),
}

// Review bonus configuration (default: $10)
export const REVIEW_BONUS_CONFIG = {
  AMOUNT_CENTS: parseInt(process.env.WINBROS_REVIEW_BONUS_CENTS || '1000', 10),
}

// Underfill day configuration (default: 3 jobs minimum)
export const UNDERFILL_CONFIG = {
  MIN_JOBS: parseInt(process.env.WINBROS_UNDERFILL_THRESHOLD_JOBS || '3', 10),
}

// Job sync timing
export const SYNC_CONFIG = {
  // How often to poll HCP for updates (if webhooks fail)
  POLL_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes

  // Delay before sending review request after job completion
  REVIEW_REQUEST_DELAY_MS: 60 * 60 * 1000, // 1 hour

  // Delay before sending final payment after job completion
  FINAL_PAYMENT_DELAY_MS: 60 * 60 * 1000, // 1 hour
}

// Window cleaning specific constants
export const WINDOW_CLEANING_CONFIG = {
  // Price per window by type
  PRICE_PER_WINDOW: {
    standard: 10,
    french: 15,
    skylights: 25,
  },

  // Story multiplier
  STORY_MULTIPLIER: {
    1: 1.0,
    2: 1.25,
    3: 1.5,
  },

  // Add-ons
  SCREEN_CLEANING_PER_WINDOW: 3,
  TRACK_CLEANING_PER_WINDOW: 5,

  // Gutter cleaning (per linear foot)
  GUTTER_CLEANING_PER_FOOT: 2,
}
