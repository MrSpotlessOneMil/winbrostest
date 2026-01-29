/**
 * Housecall Pro Integration Types
 *
 * Types for HCP API responses, webhook payloads,
 * and job synchronization.
 */

// HCP Job status
export type HCPJobStatus =
  | 'unscheduled'
  | 'scheduled'
  | 'dispatched'
  | 'in_progress'
  | 'completed'
  | 'canceled'

// Mapped to our internal status
export type InternalJobStatus =
  | 'lead'
  | 'quoted'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

// HCP Invoice status
export type HCPInvoiceStatus =
  | 'none'
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'paid'
  | 'partial'
  | 'overdue'

// HCP Address
export interface HCPAddress {
  street: string
  street_line_2?: string
  city: string
  state: string
  zip: string
  country?: string
  latitude?: number
  longitude?: number
}

// HCP Phone number
export interface HCPPhoneNumber {
  type: 'mobile' | 'home' | 'work' | 'other'
  number: string
}

// HCP Customer
export interface HCPCustomer {
  id: string
  first_name: string
  last_name: string
  email?: string
  phone_numbers: HCPPhoneNumber[]
  addresses: HCPAddress[]
  company?: string
  notes?: string
  tags?: string[]
  created_at: string
  updated_at: string
}

// HCP Employee (crew member)
export interface HCPEmployee {
  id: string
  first_name: string
  last_name: string
  email?: string
  phone?: string
  role?: string
}

// HCP Line item
export interface HCPLineItem {
  id: string
  name: string
  description?: string
  quantity: number
  unit_price: number
  total: number
}

// HCP Job
export interface HCPJob {
  id: string
  customer_id: string
  address: HCPAddress
  scheduled_start?: string
  scheduled_end?: string
  work_status: HCPJobStatus
  invoice_status: HCPInvoiceStatus
  total_amount: number
  outstanding_balance?: number
  assigned_employees: HCPEmployee[]
  line_items: HCPLineItem[]
  notes?: string
  tags?: string[]
  lead_source?: string
  created_at: string
  updated_at: string
}

// HCP Lead
export interface HCPLead {
  id: string
  number?: number
  // HCP sends lead customer data nested under "customer"
  customer?: {
    id: string
    first_name?: string
    last_name?: string
    email?: string
    mobile_number?: string
    phone_number?: string
    notifications_enabled?: boolean
  }
  // Fallback fields (older API versions)
  first_name?: string
  last_name?: string
  email?: string
  phone_numbers?: HCPPhoneNumber[]
  address?: HCPAddress
  source?: string
  notes?: string
  tags?: string[]
  status?: string
  created_at?: string
  updated_at?: string
}

// HCP Webhook event types
export type HCPWebhookEventType =
  | 'job.created'
  | 'job.updated'
  | 'job.scheduled'
  | 'job.started'
  | 'job.completed'
  | 'job.canceled'
  | 'customer.created'
  | 'customer.updated'
  | 'invoice.created'
  | 'invoice.sent'
  | 'invoice.paid'
  | 'payment.received'
  | 'lead.created'
  | 'lead.updated'
  | 'lead.converted'
  | 'lead.lost'
  | 'lead.deleted'

// HCP Webhook payload
export interface HCPWebhookPayload {
  event: HCPWebhookEventType
  event_occurred_at?: string
  company_id: string
  // HCP sends data either at top level or nested under "data"
  data?: {
    job?: HCPJob
    customer?: HCPCustomer
    invoice?: HCPInvoice
    payment?: HCPPayment
    lead?: HCPLead
  }
  // Top-level fields (actual HCP webhook format)
  job?: HCPJob
  customer?: HCPCustomer
  invoice?: HCPInvoice
  payment?: HCPPayment
  lead?: HCPLead
  timestamp?: string
}

// HCP Invoice
export interface HCPInvoice {
  id: string
  job_id: string
  customer_id: string
  status: HCPInvoiceStatus
  subtotal: number
  tax: number
  total: number
  amount_paid: number
  amount_due: number
  due_date?: string
  sent_at?: string
  paid_at?: string
  line_items: HCPLineItem[]
}

// HCP Payment
export interface HCPPayment {
  id: string
  invoice_id: string
  amount: number
  payment_method: string
  status: 'completed' | 'pending' | 'failed' | 'refunded'
  transaction_id?: string
  created_at: string
}

// HCP Create Job input
export interface CreateHCPJobInput {
  customer_id: string
  address: HCPAddress
  scheduled_start?: string
  scheduled_end?: string
  line_items?: Array<{
    name: string
    description?: string
    quantity: number
    unit_price: number
  }>
  notes?: string
  tags?: string[]
  assigned_employee_ids?: string[]
}

// HCP Update Job input
export interface UpdateHCPJobInput {
  scheduled_start?: string
  scheduled_end?: string
  work_status?: HCPJobStatus
  notes?: string
  tags?: string[]
  assigned_employee_ids?: string[]
}

// Result type for API operations
export interface HCPApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

// Job sync result
export interface JobSyncResult {
  success: boolean
  localJobId?: string
  hcpJobId?: string
  action: 'created' | 'updated' | 'skipped'
  error?: string
}

// Status mapping from HCP to internal
export const HCP_STATUS_MAP: Record<HCPJobStatus, InternalJobStatus> = {
  unscheduled: 'lead',
  scheduled: 'scheduled',
  dispatched: 'scheduled',
  in_progress: 'in_progress',
  completed: 'completed',
  canceled: 'cancelled',
}

// Reverse mapping from internal to HCP
export const INTERNAL_STATUS_MAP: Record<InternalJobStatus, HCPJobStatus> = {
  lead: 'unscheduled',
  quoted: 'unscheduled',
  scheduled: 'scheduled',
  in_progress: 'in_progress',
  completed: 'completed',
  cancelled: 'canceled',
}
