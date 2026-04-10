// @osiris/core — Shared infrastructure for all Osiris platform apps
// Re-exports from all shared modules so apps can import via '@osiris/core'

// Auth & tenant
export * from './auth'
export * from './tenant'
export * from './admin-auth'
export * from './admin-onboard'
export * from './user-api-keys'
export * from './cron-auth'

// Database
export * from './supabase'
export * from './db'

// Integrations — SMS, voice, payments
export * from './openphone'
export * from './stripe-client'
export * from './vapi'
export * from './vapi-utils'
export * from './vapi-webhook-handler'
export * from './vapi-choose-team'
export * from './vapi-estimate-scheduler'
export * from './vapi-templates'

// AI & LLM
export * from './ai-intent'
export * from './ai-responder'
export * from './auto-response'
export * from './assistant-memory'
export * from './osiris-brain'
export * from './email-bot-prompt'
export * from './llm-update-decider'
export * from './message-disposition'
export * from './conversation-scoring'
export * from './brand-detection'

// Scheduling & dispatch
export * from './scheduler'
export * from './cascade-scheduler'
export * from './cleaner-assignment'
export * from './cleaner-onboarding'
export * from './cleaner-sms'
export * from './recurring-detection'
export * from './maybe-mark-booked'

// Pricing & invoicing
export * from './quote-pricing'
export * from './pricing-db'
export * from './pricing-config'
export * from './pricing-insights'
export * from './pricebook'
export * from './pricebook-db'
export * from './quote-invoice'
export * from './invoices'
export * from './offers'
export * from './tips'

// Lifecycle & campaigns
export * from './lifecycle-engine'
export * from './sms-templates'
export * from './sms-opt-out'

// External integrations
export * from './gmail-client'
export * from './gmail-imap'
export * from './google-maps'
export * from './google-nlp'
export * from './hubspot'
export * from './connecteam'
export * from './docusign'
export * from './telegram-control'

// System & utilities
export * from './system-events'
export * from './system-control'
export * from './owner-alert'
export * from './crew-performance'
export * from './live-data'
export * from './client-config'
export * from './config'
export * from './utils'
export * from './json-utils'
export * from './phone-utils'

// Types
export * from './types'
