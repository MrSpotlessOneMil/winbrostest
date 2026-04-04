import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { toE164 } from "@/lib/phone-utils"
import Anthropic from "@anthropic-ai/sdk"
import { getTenantById, tenantHasIntegration, getTenantServiceDescription, tenantUsesFeature, type Tenant } from "@/lib/tenant"
import { hasAssistantMemory, buildMemoryContext, saveConversation, extractAndStoreFacts, recordToolUsage } from "@/lib/assistant-memory"

export const maxDuration = 300

// =====================================================================
// TOOL DEFINITIONS
// =====================================================================

// Build tenant-aware tools — window cleaning tenants get different pricing fields
function buildTools(tenant: Tenant | null): Anthropic.Tool[] {
  const serviceType = tenant ? getTenantServiceDescription(tenant) : "cleaning"
  const isWindowCleaning = serviceType.toLowerCase().includes("window")

  const TOOLS: Anthropic.Tool[] = [
  {
    name: "lookup_customer",
    description:
      "Look up a customer by phone number. Returns their name, email, address, property details, and recent job history.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: {
          type: "string",
          description: "The customer's phone number (any format)",
        },
      },
      required: ["phone_number"],
    },
  },
  {
    name: "search_customers",
    description:
      "Search for customers by name. Returns matching customers with their details and property info from leads. Use this when someone asks about a customer by name instead of phone number.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Customer name to search for (first name, last name, or both)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "create_customer",
    description:
      "Create a new customer in the system. Phone number is required. Can also include their name, email, and address.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: {
          type: "string",
          description: "Customer's phone number (required)",
        },
        first_name: { type: "string", description: "Customer's first name" },
        last_name: { type: "string", description: "Customer's last name" },
        email: { type: "string", description: "Customer's email address" },
        address: { type: "string", description: "Customer's service address" },
      },
      required: ["phone_number"],
    },
  },
  {
    name: "calculate_price",
    description: isWindowCleaning
      ? "Calculate a price estimate for a window cleaning job based on service type, number of exterior windows/panes, stories, and any extras like screens or construction residue. Returns a detailed pricing breakdown."
      : "Calculate a price estimate for a cleaning job based on service type, bedrooms, and bathrooms. Returns a detailed pricing breakdown.",
    input_schema: {
      type: "object" as const,
      properties: isWindowCleaning
        ? {
            service_type: {
              type: "string",
              description: "Type of service: 'Window cleaning', 'Pressure washing', or 'Gutter cleaning'",
            },
            notes: {
              type: "string",
              description: "Job details: number of panes/windows, stories, screens, construction residue, building type, square footage, and any other relevant info",
            },
          }
        : {
            service_type: {
              type: "string",
              description: "Type of cleaning: 'Standard cleaning', 'Deep cleaning', or 'Move in/out'",
            },
            bedrooms: { type: "number", description: "Number of bedrooms" },
            bathrooms: {
              type: "number",
              description: "Number of bathrooms (can be 1.5, 2.5, etc.)",
            },
            notes: {
              type: "string",
              description: "Optional notes with add-on requests like 'inside fridge, inside oven'",
            },
          },
      required: isWindowCleaning ? ["service_type", "notes"] : ["service_type", "bedrooms", "bathrooms"],
    },
  },
  {
    name: "create_job",
    description: isWindowCleaning
      ? "Create a new window cleaning job in the system. Requires customer phone, service type, and date. Include job details like pane count, stories, and extras in notes."
      : "Create a new job in the system. Automatically calculates pricing. Requires customer phone, service type, and date.",
    input_schema: {
      type: "object" as const,
      properties: isWindowCleaning
        ? {
            phone_number: { type: "string", description: "Customer's phone number" },
            service_type: {
              type: "string",
              description: "Type of service: 'Window cleaning', 'Pressure washing', or 'Gutter cleaning'",
            },
            date: {
              type: "string",
              description: "Job date in YYYY-MM-DD format",
            },
            time: {
              type: "string",
              description: "Job time in HH:MM format (24-hour), e.g. '09:00' or '14:30'",
            },
            address: {
              type: "string",
              description: "Service address (uses customer address if not provided)",
            },
            notes: { type: "string", description: "Job details: number of panes/windows, stories, screens, construction residue, building type, square footage, and any other relevant info" },
          }
        : {
            phone_number: { type: "string", description: "Customer's phone number" },
            service_type: {
              type: "string",
              description: "Type of cleaning: 'Standard cleaning', 'Deep cleaning', or 'Move in/out'",
            },
            date: {
              type: "string",
              description: "Job date in YYYY-MM-DD format",
            },
            time: {
              type: "string",
              description: "Job time in HH:MM format (24-hour), e.g. '09:00' or '14:30'",
            },
            bedrooms: { type: "number", description: "Number of bedrooms" },
            bathrooms: { type: "number", description: "Number of bathrooms" },
            address: {
              type: "string",
              description: "Service address (uses customer address if not provided)",
            },
            notes: { type: "string", description: "Special instructions or add-on requests" },
          },
      required: ["phone_number", "service_type", "date"],
    },
  },
  {
    name: "generate_stripe_link",
    description:
      "Generate a Stripe link for a customer. Supports card-on-file (saves card), deposit (50% + 3% fee), or payment (any custom amount). Looks up the customer by phone number.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: {
          type: "string",
          description: "The customer's phone number",
        },
        link_type: {
          type: "string",
          enum: ["card_on_file", "deposit", "payment"],
          description:
            "Type of link: 'card_on_file' saves their card for later charges, 'deposit' collects 50% upfront + 3% fee, 'payment' collects a custom dollar amount. Default: card_on_file",
        },
        amount: {
          type: "number",
          description: "Dollar amount to charge (required when link_type is 'payment'). E.g. 150 for $150.",
        },
        description: {
          type: "string",
          description: "Description shown on the payment page (required when link_type is 'payment'). E.g. 'Deep clean service'",
        },
      },
      required: ["phone_number"],
    },
  },
  {
    name: "create_wave_invoice",
    description:
      "Create and send a Wave invoice for a job. Requires the customer to have an email and the job to have a price. Only available if Wave is configured.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: {
          type: "string",
          description: "Customer's phone number (used to look up customer and their latest job)",
        },
        job_id: {
          type: "string",
          description: "Optional specific job ID. If not provided, uses the most recent job.",
        },
      },
      required: ["phone_number"],
    },
  },
  {
    name: "create_cleaner",
    description:
      "Add a new cleaner/technician to the team. Name is required, phone and email are optional.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Cleaner's full name" },
        phone: { type: "string", description: "Cleaner's phone number" },
        email: { type: "string", description: "Cleaner's email address" },
        is_team_lead: {
          type: "boolean",
          description: "Whether this cleaner is a team lead (default: false)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "list_cleaners",
    description: "List all active cleaners on the team with their contact info and roles.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "compose_message",
    description:
      "Draft a professional SMS message that the business owner can copy and send to a customer or cleaner. The message will be formatted for easy copying.",
    input_schema: {
      type: "object" as const,
      properties: {
        purpose: {
          type: "string",
          description:
            "What the message is for, e.g. 'booking confirmation', 'payment reminder', 'reschedule notice', 'welcome new customer', 'follow-up after cleaning', 'onboard new cleaner'",
        },
        recipient_name: {
          type: "string",
          description: "Recipient's first name",
        },
        details: {
          type: "string",
          description: "Any specific details to include (date, time, price, link, etc.)",
        },
      },
      required: ["purpose"],
    },
  },
  {
    name: "dashboard_tutorial",
    description:
      "Explain how to use a specific part of the dashboard. Provides step-by-step guidance based on the business's specific workflow.",
    input_schema: {
      type: "object" as const,
      properties: {
        topic: {
          type: "string",
          description:
            "What to learn about: 'overview', 'calendar', 'leads', 'teams', 'customers', 'pricing', 'invoices', 'settings', 'sms bot', 'stripe', 'adding cleaners'",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "get_today_summary",
    description:
      "Get a summary of today's business activity: jobs scheduled, expected revenue, pending leads, and any issues.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "reset_customer",
    description:
      "Fully reset a customer's data by phone number. Deletes ALL their data: messages, calls, jobs (and related assignments/reviews/tips), leads, scheduled tasks, system events, followup queue entries, and the customer record itself. This is a complete wipe — they'll be gone from the system entirely.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: {
          type: "string",
          description: "The customer's phone number (any format)",
        },
      },
      required: ["phone_number"],
    },
  },
  {
    name: "toggle_system",
    description:
      "Turn the entire business automation system on or off. When off, all automated responses, follow-ups, and SMS are paused.",
    input_schema: {
      type: "object" as const,
      properties: {
        active: {
          type: "boolean",
          description: "true to turn the system on, false to turn it off",
        },
      },
      required: ["active"],
    },
  },
  {
    name: "send_sms",
    description:
      "Send an SMS message directly to a customer's phone number via OpenPhone. Use this to send confirmations, updates, or any custom message.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: {
          type: "string",
          description: "The customer's phone number",
        },
        message: {
          type: "string",
          description: "The message to send (keep under 300 characters for SMS)",
        },
      },
      required: ["phone_number", "message"],
    },
  },
  {
    name: "assign_cleaner",
    description:
      "Assign a cleaner to a job. IMPORTANT: You MUST look up the customer first (via search_customers or lookup_customer) to get a real job ID — NEVER guess or make up job IDs. Use list_cleaners to get the cleaner ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: {
          type: "number",
          description: "The job ID to assign the cleaner to",
        },
        cleaner_id: {
          type: "number",
          description: "The cleaner's ID (use list_cleaners to find it)",
        },
        notify_cleaner: {
          type: "boolean",
          description: "Send Telegram notification to the cleaner (default: true). Customer is notified automatically when the cleaner accepts.",
        },
      },
      required: ["job_id", "cleaner_id"],
    },
  },
  {
    name: "send_payment_link",
    description:
      "Generate a Stripe link AND send it to the customer via SMS in one step. Supports card-on-file, deposit, or custom payment amount. Requires the customer to have an email on file.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: {
          type: "string",
          description: "The customer's phone number",
        },
        link_type: {
          type: "string",
          enum: ["card_on_file", "deposit", "payment"],
          description:
            "Type of link: 'deposit' collects 50% upfront + 3% fee (default), 'card_on_file' saves card for later, 'payment' collects a custom dollar amount",
        },
        amount: {
          type: "number",
          description: "Dollar amount to charge (required when link_type is 'payment'). E.g. 150 for $150.",
        },
        description: {
          type: "string",
          description: "Description shown on the payment page (required when link_type is 'payment'). E.g. 'Deep clean service'",
        },
      },
      required: ["phone_number"],
    },
  },
  {
    name: "send_review_request",
    description:
      "Send a review request SMS to a customer after their job is completed. Uses the business's Google review link if configured.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: {
          type: "string",
          description: "The customer's phone number",
        },
      },
      required: ["phone_number"],
    },
  },
  {
    name: "update_job",
    description:
      "Update an existing job. Can reschedule (change date/time), change status (complete, cancel, in_progress), update price, address, notes, service type, bedrooms, bathrooms. If rescheduled with a cleaner assigned, they'll be notified.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: { type: "number", description: "The job ID to update" },
        status: { type: "string", enum: ["scheduled", "in_progress", "completed", "cancelled", "pending"], description: "New job status" },
        date: { type: "string", description: "New date in YYYY-MM-DD format" },
        time: { type: "string", description: "New time in HH:MM format (24-hour)" },
        price: { type: "number", description: "New price in dollars" },
        notes: { type: "string", description: "Updated notes/instructions" },
        address: { type: "string", description: "Updated service address" },
        service_type: { type: "string", description: "New service type" },
        bedrooms: { type: "number", description: "Number of bedrooms" },
        bathrooms: { type: "number", description: "Number of bathrooms" },
      },
      required: ["job_id"],
    },
  },
  {
    name: "update_customer",
    description:
      "Update a customer's details: name, email, address, bedrooms, bathrooms, sqft, notes. Useful for adding info before generating payment links or improving pricing accuracy.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: { type: "string", description: "The customer's phone number (used to find them)" },
        first_name: { type: "string", description: "Updated first name" },
        last_name: { type: "string", description: "Updated last name" },
        email: { type: "string", description: "Updated email address" },
        address: { type: "string", description: "Updated service address" },
        bedrooms: { type: "number", description: "Number of bedrooms" },
        bathrooms: { type: "number", description: "Number of bathrooms" },
        sqft: { type: "number", description: "Square footage" },
        notes: { type: "string", description: "Customer notes" },
      },
      required: ["phone_number"],
    },
  },
  // ===== NEW AGENT TOOLS =====
  {
    name: "send_email",
    description:
      "Send an email to a customer or anyone. Can look up customer email by phone number if not provided directly.",
    input_schema: {
      type: "object" as const,
      properties: {
        to_email: {
          type: "string",
          description: "Email address to send to. If not provided, will look up by customer_phone.",
        },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body (plain text — will be wrapped in HTML)" },
        customer_phone: {
          type: "string",
          description: "Optional customer phone number to auto-lookup their email if to_email not provided",
        },
      },
      required: ["subject", "body"],
    },
  },
  {
    name: "get_message_history",
    description:
      "Read the SMS conversation history with a phone number. Returns recent inbound and outbound messages so you can see what's been said.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: {
          type: "string",
          description: "The phone number to get message history for",
        },
        limit: {
          type: "number",
          description: "Number of messages to return (default 20, max 50)",
        },
      },
      required: ["phone_number"],
    },
  },
  {
    name: "get_lead_details",
    description:
      "Look up a lead's status and pipeline info. Shows source, service interest, follow-up stage, and full journey context.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: {
          type: "string",
          description: "The lead's phone number",
        },
        lead_id: {
          type: "string",
          description: "Or the lead ID directly",
        },
      },
      required: [],
    },
  },
  {
    name: "schedule_followup",
    description:
      "Schedule a future follow-up task (SMS, reminder, etc.) that the system will automatically execute at the scheduled time.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: {
          type: "string",
          description: "Customer/lead phone number",
        },
        task_type: {
          type: "string",
          enum: ["lead_followup", "day_before_reminder", "post_cleaning_followup"],
          description: "Type of follow-up to schedule",
        },
        delay_hours: {
          type: "number",
          description: "Hours from now to schedule the task (e.g. 24 = tomorrow same time)",
        },
        message: {
          type: "string",
          description: "Optional custom message to include in the follow-up",
        },
      },
      required: ["phone_number", "task_type", "delay_hours"],
    },
  },
  {
    name: "get_scheduled_tasks",
    description:
      "View pending or upcoming scheduled tasks. Can filter by phone number to see what's scheduled for a specific customer.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: {
          type: "string",
          description: "Optional: filter tasks by this customer's phone number",
        },
        status: {
          type: "string",
          enum: ["pending", "processing", "completed", "failed", "cancelled"],
          description: "Filter by status (default: pending)",
        },
      },
      required: [],
    },
  },
  {
    name: "cancel_scheduled_task",
    description:
      "Cancel a pending scheduled task by its ID. The task will not be executed.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: {
          type: "string",
          description: "The scheduled task ID to cancel",
        },
      },
      required: ["task_id"],
    },
  },
  // ===== LEAD MANAGEMENT TOOLS =====
  {
    name: "create_lead",
    description:
      "Create a new lead in the pipeline. Use this EVERY TIME the owner says 'save as a lead', 'save this lead', or wants to track a potential customer. Stores source, status, service interest, quote details, and property info.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: { type: "string", description: "Lead's phone number (required)" },
        first_name: { type: "string", description: "Lead's first name" },
        last_name: { type: "string", description: "Lead's last name" },
        email: { type: "string", description: "Lead's email address" },
        source: {
          type: "string",
          description: "Where the lead came from. Use exactly as the owner says it: 'Facebook', 'Instagram', 'Google', 'Thumbtack', 'Inbound Call', 'Realtor', 'Referral', 'Website', 'SMS', etc.",
        },
        status: {
          type: "string",
          description: "Lead stage. Use exactly as the owner says it: 'New', 'Quoted', 'Still Deciding', 'No Response', 'Booked', 'Lost', etc.",
        },
        service_interest: {
          type: "string",
          description: "What services they're interested in, e.g. 'Deep Cleaning / Bi-Weekly Standard' or 'Move Out Cleaning'",
        },
        quote_details: {
          type: "string",
          description: "Quote amounts given, e.g. '$385 deep / $215 bi-weekly / $245 monthly'",
        },
        property_details: {
          type: "string",
          description: "Property info, e.g. '3 bed / 2 bath, ~1,704 sq ft' or '2 bed condo'",
        },
        notes: { type: "string", description: "Any additional notes about this lead" },
      },
      required: ["phone_number"],
    },
  },
  {
    name: "update_lead",
    description:
      "Update an existing lead's status, source, quote details, service interest, or other info. Find the lead by phone number or lead ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: { type: "string", description: "Lead's phone number (to find them)" },
        lead_id: { type: "number", description: "Or the lead ID directly" },
        status: { type: "string", description: "New status: 'Quoted', 'Still Deciding', 'Booked', 'No Response', 'Lost', etc." },
        source: { type: "string", description: "Updated source: 'Facebook', 'Google', 'Realtor', etc." },
        service_interest: { type: "string", description: "Updated service interest" },
        quote_details: { type: "string", description: "Updated quote amounts" },
        property_details: { type: "string", description: "Updated property info" },
        notes: { type: "string", description: "Updated notes" },
        email: { type: "string", description: "Updated email" },
      },
      required: [],
    },
  },
  {
    name: "list_leads",
    description:
      "List all leads in the pipeline. Use this EVERY TIME the owner asks to see their leads, pipeline, or lead list. Can filter by status or source.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string", description: "Filter by status: 'New', 'Quoted', 'Still Deciding', 'Booked', 'No Response', 'Lost', etc. Leave empty for all." },
        source: { type: "string", description: "Filter by source: 'Facebook', 'Google', 'Realtor', etc. Leave empty for all." },
        limit: { type: "number", description: "Max leads to return (default 50, max 100)" },
      },
      required: [],
    },
  },
  // ===== CLEANER MANAGEMENT =====
  {
    name: "unassign_cleaner",
    description:
      "Remove a cleaner's assignment from a job. Cancels the assignment and clears the job's assigned cleaner. Use this when the owner wants to unassign a cleaner or put a job as 'unassigned'.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: { type: "number", description: "The job ID to unassign from" },
        cleaner_id: { type: "number", description: "Optional: specific cleaner ID to unassign. If not provided, unassigns ALL cleaners from the job." },
      },
      required: ["job_id"],
    },
  },
  // ===== BUSINESS DATA / ANALYTICS =====
  {
    name: "query_business_data",
    description:
      "Query business data from any table for analytics, revenue, pipeline reports, cleaner performance, or any data question. Returns raw data you can analyze and summarize.\n\nAvailable tables and key columns:\n- jobs: id, phone_number, customer_id, service_type, date, scheduled_at, status (scheduled/in_progress/completed/cancelled), price, hours, cleaners, address, assigned_cleaner_id, notes, booked, created_at\n- leads: id, phone_number, first_name, last_name, email, source, status, followup_stage, form_data (JSONB), converted_to_job_id, created_at\n- customers: id, phone_number, first_name, last_name, email, address, created_at\n- cleaner_assignments: id, job_id, cleaner_id, status (pending/confirmed/declined/cancelled), created_at\n- cleaners: id, name, phone, email, is_team_lead, active, created_at\n- messages: id, phone_number, direction (inbound/outbound), body, channel, created_at",
    input_schema: {
      type: "object" as const,
      properties: {
        table: {
          type: "string",
          description: "Table to query: 'jobs', 'leads', 'customers', 'cleaner_assignments', 'cleaners', 'messages'",
        },
        select: {
          type: "string",
          description: "Columns to select (Supabase select syntax). Examples: '*', 'id, price, status, date', 'id, price, service_type, date, assigned_cleaner_id'",
        },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              column: { type: "string", description: "Column name" },
              operator: { type: "string", description: "Operator: eq, neq, gt, gte, lt, lte, like, ilike, in, is, not" },
              value: { type: "string", description: "Value to compare (for 'in' operator, use JSON array string like '[\"a\",\"b\"]')" },
            },
            required: ["column", "operator", "value"],
          },
          description: "Array of filters to apply",
        },
        order_by: {
          type: "string",
          description: "Column to order by. Prefix with '-' for descending. Examples: '-created_at', 'date', '-price'",
        },
        limit: {
          type: "number",
          description: "Max rows to return (default 50, max 200)",
        },
      },
      required: ["table", "select"],
    },
  },
  // ── NEW POWER TOOLS ─────────────────────────────────────────────
  {
    name: "charge_card",
    description:
      "Charge a customer's saved card on file. Requires the customer to have previously saved a card via Stripe. Use lookup_customer to verify they have a card on file first.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: { type: "string", description: "Customer's phone number" },
        amount: { type: "number", description: "Amount to charge in dollars (e.g. 250 for $250)" },
        description: { type: "string", description: "What the charge is for (e.g. 'Deep cleaning service')" },
        job_id: { type: "number", description: "Optional job ID to associate with payment" },
      },
      required: ["phone_number", "amount"],
    },
  },
  {
    name: "check_availability",
    description:
      "Check cleaner availability for a date or date range. Shows who is free, who is busy, and how many jobs each cleaner has. Useful before assigning a cleaner.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "Date to check in YYYY-MM-DD format" },
        end_date: { type: "string", description: "Optional end date for range check (YYYY-MM-DD). If omitted, checks single date." },
      },
      required: ["date"],
    },
  },
  {
    name: "view_schedule",
    description:
      "View the job schedule/calendar for a date range. Shows all jobs with customer info, cleaner assignments, times, and statuses. Like looking at the dashboard calendar.",
    input_schema: {
      type: "object" as const,
      properties: {
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format (defaults to 7 days from start)" },
        status: {
          type: "string",
          enum: ["all", "scheduled", "in_progress", "completed", "cancelled", "pending"],
          description: "Filter by job status (default: all active jobs)",
        },
      },
      required: ["start_date"],
    },
  },
  {
    name: "create_quote",
    description:
      "Create a formal quote for a customer with Good/Better/Best tier pricing. Generates a shareable quote link. The customer can review, pick a date, save their card, and book through the link.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: { type: "string", description: "Customer's phone number" },
        selected_tier: {
          type: "string",
          description: "Pricing tier: 'good', 'better', or 'best'",
        },
        selected_addons: {
          type: "array",
          items: { type: "string" },
          description: "Array of addon keys to include (e.g. ['inside_fridge', 'inside_oven'])",
        },
        custom_price: { type: "number", description: "Override price instead of using tier pricing (in dollars)" },
        notes: { type: "string", description: "Notes for the customer" },
        send_sms: { type: "boolean", description: "Whether to text the quote link to the customer (default: true)" },
      },
      required: ["phone_number"],
    },
  },
  {
    name: "setup_recurring",
    description:
      "Set up a recurring job schedule for a customer. Creates a parent recurring job that auto-generates future instances. Requires an existing job or customer phone.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: { type: "number", description: "Existing job ID to make recurring (copies all details)" },
        phone_number: { type: "string", description: "Customer phone (alternative to job_id — creates new recurring job)" },
        frequency: {
          type: "string",
          enum: ["weekly", "bi-weekly", "monthly", "every_6_weeks"],
          description: "How often the job should recur",
        },
        start_date: { type: "string", description: "First occurrence date in YYYY-MM-DD format (uses job date if job_id provided)" },
        preferred_day: { type: "string", description: "Preferred day of week (e.g. 'monday', 'friday')" },
      },
      required: ["frequency"],
    },
  },
]

  return TOOLS
}

// =====================================================================
// HELPERS
// =====================================================================

// Robust customer lookup - tries E164, then last-10-digit match
async function findCustomerByPhone(client: ReturnType<typeof getSupabaseServiceClient>, phone: string, tenantId?: string, select = "*") {
  const e164 = toE164(phone)

  // Try exact E164 match first (scoped to tenant if available)
  if (e164) {
    let query = client.from("customers").select(select).eq("phone_number", e164)
    if (tenantId) query = query.eq("tenant_id", tenantId)
    const { data } = await query.single()
    if (data) return data
  }

  // Fallback: match by last 10 digits
  const digits = phone.replace(/\D/g, "")
  const last10 = digits.slice(-10)
  if (last10.length === 10) {
    let query = client.from("customers").select(select).like("phone_number", `%${last10}`)
    if (tenantId) query = query.eq("tenant_id", tenantId)
    const { data: matches } = await query
    if (matches && matches.length >= 1) return matches[0]
  }

  return null
}

// =====================================================================
// TOOL EXECUTION
// =====================================================================

async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
  userId: number,
  tenant: Tenant | null
): Promise<string> {
  const client = getSupabaseServiceClient()
  const tenantId = tenant?.id

  // ----- LOOKUP CUSTOMER -----
  if (toolName === "lookup_customer") {
    try {
      const phone = toolInput.phone_number as string
      const customer: any = await findCustomerByPhone(client, phone, tenantId)

      if (!customer) {
        return `No customer found with phone number ${phone}. Would you like me to create one?`
      }

      let jobsQuery = client
        .from("jobs")
        .select("id, service_type, date, status, price, scheduled_at")
        .eq("phone_number", customer.phone_number)
      if (tenantId) jobsQuery = jobsQuery.eq("tenant_id", tenantId)
      const { data: jobs } = await jobsQuery
        .order("created_at", { ascending: false })
        .limit(5)

      // Load lead form_data for property details (sqft, scope, etc.)
      const { data: lead } = await client
        .from("leads")
        .select("form_data")
        .eq("phone_number", customer.phone_number)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      const formData = lead?.form_data as Record<string, any> || {}
      const bookingData = formData.booking_data as Record<string, any> || {}

      const name = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "Unknown"
      return JSON.stringify({
        name,
        phone: customer.phone_number,
        email: customer.email || "Not on file",
        address: customer.address || bookingData.address || "Not on file",
        square_footage: formData.square_footage || formData.squareFootage || bookingData.squareFootage || "Unknown",
        bedrooms: formData.bedrooms || bookingData.bedrooms || "Unknown",
        bathrooms: formData.bathrooms || bookingData.bathrooms || "Unknown",
        exterior_windows: formData.exterior_windows ?? null,
        french_panes: formData.french_panes ?? null,
        frequency: formData.frequency || bookingData.planType || null,
        scope: bookingData.scope || null,
        recent_jobs: (jobs || []).map((j: any) => ({
          id: j.id,
          service: j.service_type || "Cleaning",
          date: j.date || "No date",
          time: j.scheduled_at || "No time",
          status: j.status || "unknown",
          price: j.price ? `$${j.price}` : "No price",
        })),
      })
    } catch (err: any) {
      return `Error looking up customer: ${err.message}`
    }
  }

  // ----- SEARCH CUSTOMERS BY NAME -----
  if (toolName === "search_customers") {
    try {
      const searchName = (toolInput.name as string).trim()
      const parts = searchName.split(/\s+/)
      const firstName = parts[0]
      const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null

      // Search by first name OR last name using ILIKE for case-insensitive match
      let query = client.from("customers").select("id, first_name, last_name, phone_number, email, address")
      if (tenantId) query = query.eq("tenant_id", tenantId)

      if (lastName) {
        // Full name provided — match both
        query = query.ilike("first_name", `%${firstName}%`).ilike("last_name", `%${lastName}%`)
      } else {
        // Single name — search first_name OR last_name
        query = query.or(`first_name.ilike.%${firstName}%,last_name.ilike.%${firstName}%`)
      }

      const { data: customers } = await query.limit(10)

      if (!customers || customers.length === 0) {
        return `No customers found matching "${searchName}". Try a different name or look them up by phone number.`
      }

      // For each match, load lead form_data for property details
      const results = await Promise.all(customers.map(async (c: any) => {
        let leadQuery = client
          .from("leads")
          .select("form_data")
          .eq("phone_number", c.phone_number)
        if (tenantId) leadQuery = leadQuery.eq("tenant_id", tenantId)
        const { data: lead } = await leadQuery
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        const formData = lead?.form_data as Record<string, any> || {}
        const bookingData = formData.booking_data as Record<string, any> || {}

        return {
          name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Unknown",
          phone: c.phone_number,
          email: c.email || "Not on file",
          address: c.address || bookingData.address || "Not on file",
          square_footage: formData.square_footage || formData.squareFootage || bookingData.squareFootage || "Unknown",
          bedrooms: formData.bedrooms || bookingData.bedrooms || null,
          bathrooms: formData.bathrooms || bookingData.bathrooms || null,
          exterior_windows: formData.exterior_windows ?? null,
          french_panes: formData.french_panes ?? null,
          frequency: formData.frequency || bookingData.planType || null,
          scope: bookingData.scope || null,
        }
      }))

      if (results.length === 1) {
        return JSON.stringify({ match: "exact", customer: results[0] })
      }
      return JSON.stringify({ match: "multiple", count: results.length, customers: results })
    } catch (err: any) {
      return `Error searching customers: ${err.message}`
    }
  }

  // ----- CREATE CUSTOMER -----
  if (toolName === "create_customer") {
    try {
      const { upsertCustomer } = await import("@/lib/supabase")
      const customerData: Record<string, any> = {}
      if (toolInput.first_name) customerData.first_name = toolInput.first_name
      if (toolInput.last_name) customerData.last_name = toolInput.last_name
      if (toolInput.email) customerData.email = toolInput.email
      if (toolInput.address) customerData.address = toolInput.address
      if (tenantId) customerData.tenant_id = tenantId

      const customer = await upsertCustomer(toolInput.phone_number, customerData)
      if (!customer) return "Failed to create customer. The phone number may be invalid."

      const name = `${customer.first_name || ""} ${customer.last_name || ""}`.trim()
      return `Customer created successfully!\n- Name: ${name || "Not set"}\n- Phone: ${customer.phone_number}\n- Email: ${customer.email || "Not set"}\n- Address: ${customer.address || "Not set"}`
    } catch (err: any) {
      return `Error creating customer: ${err.message}`
    }
  }

  // ----- CALCULATE PRICE -----
  if (toolName === "calculate_price") {
    try {
      const { calculateJobEstimateAsync } = await import("@/lib/stripe-client")
      const estimate = await calculateJobEstimateAsync(
        { service_type: toolInput.service_type, notes: toolInput.notes || "" },
        { bedrooms: toolInput.bedrooms, bathrooms: toolInput.bathrooms },
        tenantId
      )

      const depositAmount = Math.round((estimate.totalPrice / 2) * 1.03 * 100) / 100
      return JSON.stringify({
        service_type: toolInput.service_type,
        bedrooms: toolInput.bedrooms,
        bathrooms: toolInput.bathrooms,
        base_price: `$${estimate.basePrice}`,
        add_on_price: `$${estimate.addOnPrice}`,
        total_price: `$${estimate.totalPrice}`,
        estimated_hours: estimate.totalHours,
        cleaners_needed: estimate.cleaners,
        hours_per_cleaner: estimate.hoursPerCleaner,
        deposit_amount: `$${depositAmount}`,
        add_ons: estimate.addOns,
      })
    } catch (err: any) {
      return `Error calculating price: ${err.message}`
    }
  }

  // ----- CREATE JOB -----
  if (toolName === "create_job") {
    try {
      const customer: any = await findCustomerByPhone(client, toolInput.phone_number, tenantId)
      const bedrooms = toolInput.bedrooms || customer?.bedrooms
      const bathrooms = toolInput.bathrooms || customer?.bathrooms
      const address = toolInput.address || customer?.address
      const phoneE164 = customer?.phone_number || toE164(toolInput.phone_number) || toolInput.phone_number

      // Auto-calculate price
      const { calculateJobEstimateAsync } = await import("@/lib/stripe-client")
      const estimate = await calculateJobEstimateAsync(
        { service_type: toolInput.service_type, notes: toolInput.notes || "" },
        { bedrooms, bathrooms },
        tenantId
      )

      // Create the customer if they don't exist
      if (!customer) {
        const { upsertCustomer } = await import("@/lib/supabase")
        await upsertCustomer(toolInput.phone_number, { tenant_id: tenantId } as any)
      }

      // Get customer ID (may have just been created)
      const customerRecord: any = await findCustomerByPhone(client, toolInput.phone_number, tenantId, "id, phone_number")

      const { createJob } = await import("@/lib/supabase")
      const job = await createJob(
        {
          phone_number: phoneE164,
          customer_id: customerRecord?.id,
          tenant_id: tenantId,
          service_type: toolInput.service_type,
          date: toolInput.date,
          scheduled_at: toolInput.time || null,
          address: address || null,
          bedrooms: bedrooms || null,
          bathrooms: bathrooms || null,
          price: estimate.totalPrice,
          hours: estimate.totalHours,
          cleaners: estimate.cleaners,
          notes: toolInput.notes || null,
          status: "quoted",
          booked: false,
        } as any,
        {},
        userId
      )

      if (!job) return "Failed to create job. Check that the phone number and date are valid."

      return `Job created successfully!\n- Job ID: ${job.id}\n- Service: ${job.service_type}\n- Date: ${job.date}\n- Time: ${job.scheduled_at || "Not set"}\n- Address: ${job.address || "Not set"}\n- Price: $${job.price}\n- Hours: ${estimate.totalHours}\n- Cleaners: ${estimate.cleaners}`
    } catch (err: any) {
      return `Error creating job: ${err.message}`
    }
  }

  // ----- GENERATE STRIPE LINK -----
  if (toolName === "generate_stripe_link") {
    try {
      const phone = toolInput.phone_number as string
      const linkType = (toolInput.link_type as string) || "card_on_file"
      const customer: any = await findCustomerByPhone(client, phone, tenantId)

      if (!customer) {
        return `No customer found with phone number ${phone}. Would you like me to create one first?`
      }

      if (!customer.email) {
        return `${customer.first_name || "This customer"} doesn't have an email on file yet. I'll need their email to generate a Stripe link — could you share it so I can update their record?`
      }

      // Get latest job (optional for 'payment' type)
      let stripeJobsQuery = client
        .from("jobs")
        .select("*")
        .eq("phone_number", customer.phone_number)
      if (tenantId) stripeJobsQuery = stripeJobsQuery.eq("tenant_id", tenantId)
      const { data: jobs } = await stripeJobsQuery
        .order("created_at", { ascending: false })
        .limit(1)

      const job = jobs?.[0]
      if (!job && linkType !== "payment") {
        return `${customer.first_name || "This customer"} doesn't have any jobs yet. Would you like me to create one first?`
      }

      if (linkType === "payment") {
        const paymentAmount = toolInput.amount as number
        const paymentDesc = (toolInput.description as string) || "Payment"
        if (!paymentAmount || paymentAmount <= 0) {
          return "Please specify an amount for the payment link. E.g. 'generate a $150 payment link for Dale'"
        }
        if (!tenant?.stripe_secret_key || !tenantId) {
          return "Stripe is not configured for this tenant. Please add a Stripe secret key in admin settings."
        }
        const { createCustomPaymentLink } = await import("@/lib/stripe-client")
        const result = await createCustomPaymentLink(customer, paymentAmount, paymentDesc, tenantId, tenant.stripe_secret_key, job ? String(job.id) : undefined)
        if (result.success && result.url) {
          return `Here's the payment link for ${customer.first_name || phone}:\n\n${result.url}\n\nAmount: $${paymentAmount.toFixed(2)} — ${paymentDesc}`
        }
        return `Failed to generate payment link: ${result.error || "Unknown error"}`
      } else if (linkType === "deposit") {
        if (!tenant?.stripe_secret_key || !tenantId) {
          return "Stripe is not configured for this tenant. Please add a Stripe secret key in admin settings."
        }
        const { createDepositPaymentLink } = await import("@/lib/stripe-client")
        const result = await createDepositPaymentLink(customer, job, undefined, tenantId, tenant.stripe_secret_key)
        if (result.success && result.url) {
          const depositAmt = result.amount ? `$${result.amount.toFixed(2)}` : `$${(Math.round((job.price / 2) * 1.03 * 100) / 100).toFixed(2)}`
          return `Here's the deposit payment link for ${customer.first_name || phone}:\n\n${result.url}\n\nDeposit amount: ${depositAmt} (50% of $${job.price} + 3% processing fee)`
        }
        return `Failed to generate deposit link: ${result.error || "Unknown error"}`
      } else {
        if (!tenant?.stripe_secret_key || !tenantId) {
          return "Stripe is not configured for this tenant. Please add a Stripe secret key in admin settings."
        }
        const { createCardOnFileLink } = await import("@/lib/stripe-client")
        const result = await createCardOnFileLink(customer, String(job.id), tenantId, tenant.stripe_secret_key)
        if (result.success && result.url) {
          return `Here's the card-on-file link for ${customer.first_name || phone}:\n\n${result.url}\n\nThis saves their card for future charges — no payment is taken now.`
        }
        return `Failed to generate Stripe link: ${result.error || "Unknown error"}`
      }
    } catch (err: any) {
      return `Error generating Stripe link: ${err.message}`
    }
  }

  // ----- CREATE INVOICE (Stripe or Wave based on tenant config) -----
  if (toolName === "create_wave_invoice") {
    try {
      // Check if tenant has any invoicing provider configured
      const hasWave = tenant ? tenantHasIntegration(tenant, "wave") : false
      const hasStripe = tenant ? tenantHasIntegration(tenant, "stripe") : false
      if (!tenant || (!hasWave && !hasStripe)) {
        return "Invoicing isn't configured for your business yet. You can set it up in Settings > Integrations by adding your Stripe or Wave credentials."
      }

      const phone = toolInput.phone_number as string
      const customer: any = await findCustomerByPhone(client, phone, tenantId)
      if (!customer) return `No customer found with phone number ${phone}. Would you like me to create one?`
      if (!customer.email) return `${customer.first_name || "This customer"} doesn't have an email on file. An email is required to send an invoice — could you share it?`

      // Get job
      let job: any
      if (toolInput.job_id) {
        const { getJobById } = await import("@/lib/supabase")
        job = await getJobById(toolInput.job_id)
      } else {
        let waveJobsQuery = client
          .from("jobs")
          .select("*")
          .eq("phone_number", customer.phone_number)
        if (tenantId) waveJobsQuery = waveJobsQuery.eq("tenant_id", tenantId)
        const { data: jobs } = await waveJobsQuery
          .order("created_at", { ascending: false })
          .limit(1)
        job = jobs?.[0]
      }

      if (!job) return "No job found for this customer. Would you like me to create one first?"
      if (!job.price || job.price <= 0) return "The job doesn't have a price set yet. Let me know the service details and I'll calculate the pricing."

      const { createInvoice } = await import("@/lib/invoices")
      const result = await createInvoice(job, customer, tenant)

      if (result.success) {
        const providerLabel = result.provider === 'stripe' ? 'Stripe' : 'Wave'
        return `${providerLabel} invoice created and sent to ${customer.email}!\n- Invoice ID: ${result.invoiceId}\n- Amount: $${job.price}\n- Service: ${job.service_type || "Cleaning"}\n${result.invoiceUrl ? `- View invoice: ${result.invoiceUrl}` : ""}`
      }
      return `Failed to create invoice: ${result.error}`
    } catch (err: any) {
      return `Error creating invoice: ${err.message}`
    }
  }

  // ----- CREATE CLEANER -----
  if (toolName === "create_cleaner") {
    try {
      if (!tenantId) return "Cannot create cleaner: your account isn't linked to a business yet."

      const { data: cleaner, error } = await client
        .from("cleaners")
        .insert({
          tenant_id: tenantId,
          name: toolInput.name,
          phone: toolInput.phone || null,
          email: toolInput.email || null,
          is_team_lead: toolInput.is_team_lead || false,
          active: true,
        })
        .select("id, name, phone, email, is_team_lead")
        .single()

      if (error) return `Failed to create cleaner: ${error.message}`

      return `Cleaner added to the team!\n- Name: ${cleaner.name}\n- Phone: ${cleaner.phone || "Not set"}\n- Email: ${cleaner.email || "Not set"}\n- Team Lead: ${cleaner.is_team_lead ? "Yes" : "No"}\n\nWould you like me to compose a welcome message you can send them?`
    } catch (err: any) {
      return `Error creating cleaner: ${err.message}`
    }
  }

  // ----- LIST CLEANERS -----
  if (toolName === "list_cleaners") {
    try {
      if (!tenantId) return "Cannot list cleaners: your account isn't linked to a business yet."

      const { data: cleaners, error } = await client
        .from("cleaners")
        .select("id, name, phone, email, telegram_id, is_team_lead, active")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })

      if (error) return `Failed to fetch cleaners: ${error.message}`
      if (!cleaners || cleaners.length === 0) return "No active cleaners on the team yet. Would you like to add one?"

      return JSON.stringify(
        cleaners.map((c: any) => ({
          id: c.id,
          name: c.name,
          phone: c.phone || "Not set",
          email: c.email || "Not set",
          telegram: c.telegram_id ? "Connected" : "Not connected",
          team_lead: c.is_team_lead || false,
        }))
      )
    } catch (err: any) {
      return `Error listing cleaners: ${err.message}`
    }
  }

  // ----- COMPOSE MESSAGE -----
  if (toolName === "compose_message") {
    const businessName = tenant?.business_name_short || tenant?.name || "the business"
    return `COMPOSE_MESSAGE: Write a professional, warm ${toolInput.purpose} message from ${businessName} to ${toolInput.recipient_name || "the recipient"}. Details: ${toolInput.details || "none specified"}. Put the complete ready-to-send message inside a markdown code block so the user can easily copy it. Keep it under 300 characters for SMS. Make it sound natural and on-brand — warm but professional.`
  }

  // ----- DASHBOARD TUTORIAL -----
  if (toolName === "dashboard_tutorial") {
    const usesRouteOpt = tenant ? tenantUsesFeature(tenant, 'use_team_routing') : false
    const flowType = usesRouteOpt ? "route optimization (auto-assign)" : "accept/decline cascade"
    const businessName = tenant?.business_name_short || tenant?.name || "your business"
    const serviceType = tenant ? getTenantServiceDescription(tenant) : "cleaning"

    const topic = (toolInput.topic as string || "").toLowerCase()

    const tutorials: Record<string, string> = {
      overview: `TUTORIAL: Here's your ${businessName} dashboard overview:\n\n**Main Sections:**\n- **Calendar** — View and manage upcoming jobs by day/week\n- **Leads** — Track incoming customer inquiries from SMS, calls, HCP, and Meta ads\n- **Teams** — Manage your cleaners and crew assignments\n- **Customers** — Full customer database with job history\n- **Settings** — Configure integrations (Stripe, Wave, Telegram, etc.)\n- **Assistant** (you're here!) — Get help with any task\n\n**Your Workflow:** ${businessName} uses the **${flowType}** flow for job assignment. ${usesRouteOpt ? "Jobs are auto-assigned to your team after payment — no accept/decline buttons needed." : "After payment, cleaners receive Telegram notifications and can accept or decline jobs."}`,
      calendar: `TUTORIAL: **Calendar Page**\n\n1. Navigate to the Calendar tab in the sidebar\n2. You'll see jobs organized by date\n3. Click any job to see details (customer, time, price, status)\n4. You can drag jobs to reschedule them\n5. Color coding: Green = completed, Blue = scheduled, Purple = assigned, Yellow = pending\n\n**Tips:**\n- Use the week/day toggle to change views\n- Jobs show the customer name, service type, and time\n- Click a job to edit details or reassign cleaners`,
      leads: `TUTORIAL: **Leads Page**\n\n1. Leads come in from multiple sources: SMS texts, phone calls (VAPI), Housecall Pro, and Meta/GHL ads\n2. Each lead card shows the customer name, phone, source, and current status\n3. Lead statuses: New → Contacted → Qualified → Booked → Assigned\n4. Click a lead to see the full conversation history\n5. Drag leads between columns to update their status\n\n**Automation:** The SMS bot automatically engages new leads and walks them through the booking flow. Once they provide all details and an email, it sends pricing and payment links automatically.`,
      teams: `TUTORIAL: **Teams Page**\n\n1. View all your cleaning teams and their members\n2. Each team shows the lead cleaner and team members\n3. Click "View Full Details" to see member info, edit contacts, or view message history\n\n**Adding a Cleaner:**\n1. Click "Add Cleaner" or ask me to create one\n2. Enter their name, phone, and email\n3. If using Telegram: Have them message your Telegram bot to connect\n4. Assign them to a team using the team management controls`,
      customers: `TUTORIAL: **Customers Page**\n\n1. View all customers in your database\n2. Each customer card shows their name, phone, and job history\n3. Click a customer to see full details: address, property info, past jobs, messages\n4. The Jobs tab shows all jobs for that customer with status badges\n\n**Quick Actions:** You can ask me to look up any customer by phone number, create new customers, or reset their booking data.`,
      pricing: usesRouteOpt
        ? `TUTORIAL: **How Pricing Works**\n\nPricing for window cleaning is calculated based on:\n- **Service type**: Window cleaning, Pressure washing, or Gutter cleaning\n- **Number of panes/windows**: How many exterior windows\n- **Stories**: Single-story, two-story, etc.\n- **Extras**: Screens, construction residue, french panes\n- **Building type**: Residential or commercial\n\nThe system auto-calculates prices during the SMS booking flow. You can also ask me for a price estimate anytime — just tell me the service type and job details (panes, stories, screens, etc.).\n\n**Payment Options:**\n- **Card on file**: Saves the customer's card (no immediate charge)`
        : `TUTORIAL: **How Pricing Works**\n\nPricing is calculated based on:\n- **Service type**: Standard, Deep, or Move-in/Move-out\n- **Property size**: Bedrooms and bathrooms\n- **Add-ons**: Inside fridge, inside oven, laundry, etc.\n\nThe system auto-calculates prices during the SMS booking flow. You can also ask me for a price estimate anytime — just tell me the service type, bedrooms, and bathrooms.\n\n**Payment Options:**\n- **Card on file**: Saves the customer's card (no immediate charge)\n- **Deposit**: Collects 50% + 3% processing fee upfront\n- **Wave invoice**: Sends a professional invoice via email`,
      "adding cleaners": `TUTORIAL: **How to Add a New Cleaner**\n\n**Option 1 — Ask me:**\nJust say "Add a cleaner named [Name]" and I'll create them. I can also compose a welcome message for you to send them.\n\n**Option 2 — Teams Page:**\n1. Go to Teams in the sidebar\n2. Click "Add Cleaner"\n3. Enter their name, phone, email\n4. Assign them to a team\n\n**Setting Up Telegram:**\n${tenant?.telegram_bot_token ? "Your Telegram bot is configured. Have the new cleaner:\n1. Search for your bot on Telegram\n2. Send /start\n3. They'll automatically be linked and will receive job notifications" : "Telegram isn't configured yet. Set it up in Settings > Integrations to enable cleaner notifications."}`,
      stripe: `TUTORIAL: **Stripe Integration**\n\n${tenant?.stripe_secret_key ? "Stripe is configured for your business." : "Stripe is not configured yet. Add your Stripe API keys in Settings > Integrations."}\n\n**Types of Stripe Links:**\n- **Card on File**: Saves the customer's card without charging. Used after the booking flow completes.\n- **Deposit Link**: Charges 50% of the job price + 3% processing fee upfront.\n\n**How to Generate:**\nJust ask me! Say "Generate a card-on-file link for [phone]" or "Create a deposit link for [phone]".`,
      "sms bot": `TUTORIAL: **SMS Bot**\n\nThe SMS bot automatically responds to customer texts and walks them through the booking flow:\n\n${usesRouteOpt ? "**WinBros Flow:**\n1. Service type (Window/Pressure/Gutter)\n2. Scope & building type\n3. French panes check\n4. Square footage\n5. Pane count confirmation\n6. Pricing plans\n7. Name, address, referral source\n8. Preferred date/time\n9. Email → booking complete → payment links sent" : "**Cleaning Flow:**\n1. Service type (Standard/Deep/Move)\n2. Name\n3. Address\n4. Bedrooms/bathrooms/sqft\n5. Frequency\n6. Special requests\n7. Preferred date/time\n8. Email → booking complete → pricing & payment links sent"}\n\n**Note:** The bot uses Claude AI and is designed to sound like a real person, not a robot.`,
    }

    return tutorials[topic] || `I can help you learn about: overview, calendar, leads, teams, customers, pricing, adding cleaners, SMS bot, or Stripe. Which would you like to know about?`
  }

  // ----- GET TODAY SUMMARY -----
  if (toolName === "get_today_summary") {
    try {
      if (!tenantId) return "Cannot get summary: your account isn't linked to a business yet."

      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" })

      const { data: todayJobs } = await client
        .from("jobs")
        .select("id, service_type, status, price, date, scheduled_at, phone_number, address")
        .eq("tenant_id", tenantId)
        .eq("date", today)
        .not("status", "eq", "cancelled")

      const jobs = todayJobs || []
      const totalRevenue = jobs.reduce((sum: number, j: any) => sum + (j.price || 0), 0)
      const statusCounts: Record<string, number> = {}
      for (const j of jobs) {
        const s = (j as any).status || "unknown"
        statusCounts[s] = (statusCounts[s] || 0) + 1
      }

      const { data: pendingLeads } = await client
        .from("leads")
        .select("id")
        .eq("tenant_id", tenantId)
        .in("status", ["new", "contacted"])

      return JSON.stringify({
        date: today,
        total_jobs: jobs.length,
        expected_revenue: `$${totalRevenue}`,
        by_status: statusCounts,
        pending_leads: pendingLeads?.length || 0,
        jobs: jobs.map((j: any) => ({
          service: j.service_type || "Cleaning",
          time: j.scheduled_at || "No time set",
          price: j.price ? `$${j.price}` : "No price",
          status: j.status || "unknown",
          address: j.address || "No address",
        })),
      })
    } catch (err: any) {
      return `Error getting today's summary: ${err.message}`
    }
  }

  // ----- RESET CUSTOMER -----
  if (toolName === "reset_customer") {
    try {
      const phone = toolInput.phone_number as string
      const { normalizePhone } = await import("@/lib/phone-utils")

      // Build multiple phone formats to match all possible stored formats
      const digits10 = normalizePhone(phone)
      const e164 = toE164(phone)
      const digits11 = digits10 ? `1${digits10}` : ""
      const phoneFormats = [e164, digits10, digits11].filter(Boolean) as string[]

      if (phoneFormats.length === 0) {
        return `Invalid phone number: ${phone}. Double-check the number and try again!`
      }

      // Find customer to get their name for the response
      const customer: any = await findCustomerByPhone(client, phone, tenantId, "id, first_name, last_name, phone_number")
      const name = customer ? [customer.first_name, customer.last_name].filter(Boolean).join(" ") || customer.phone_number : phone

      const deletionLog: string[] = []

      // Helper: add tenant filter to queries
      const withTenant = <T extends { eq: (col: string, val: string) => T }>(query: T): T => {
        return tenantId ? query.eq("tenant_id", tenantId) : query
      }

      // 1. Find all customer IDs
      const { data: customers } = await withTenant(
        client.from("customers").select("id, phone_number")
      ).in("phone_number", phoneFormats)
      const customerIds = customers?.map((c: any) => c.id) || []

      // 2. Find all leads
      const { data: leads } = await withTenant(
        client.from("leads").select("id")
      ).in("phone_number", phoneFormats)
      const leadIds = leads?.map((l: any) => l.id) || []

      // 3. Find all jobs
      const { data: jobs } = await withTenant(
        client.from("jobs").select("id")
      ).in("phone_number", phoneFormats)
      const jobIds = jobs?.map((j: any) => j.id) || []

      // 4. Delete scheduled tasks for leads
      if (leadIds.length > 0) {
        for (const leadId of leadIds) {
          await client.from("scheduled_tasks").delete().like("task_key", `lead-${leadId}-%`)
        }
        deletionLog.push(`${leadIds.length} lead scheduled tasks`)
      }

      // 5. Delete system events
      const { data: events } = await withTenant(
        client.from("system_events").select("id")
      ).in("phone_number", phoneFormats)
      if (events && events.length > 0) {
        await withTenant(client.from("system_events").delete()).in("phone_number", phoneFormats)
        deletionLog.push(`${events.length} system events`)
      }

      // 6. Delete messages
      const { data: msgs } = await withTenant(
        client.from("messages").select("id")
      ).in("phone_number", phoneFormats)
      if (msgs && msgs.length > 0) {
        await withTenant(client.from("messages").delete()).in("phone_number", phoneFormats)
        deletionLog.push(`${msgs.length} messages`)
      }

      // 7. Delete calls
      const { data: calls } = await withTenant(
        client.from("calls").select("id")
      ).in("phone_number", phoneFormats)
      if (calls && calls.length > 0) {
        await withTenant(client.from("calls").delete()).in("phone_number", phoneFormats)
        deletionLog.push(`${calls.length} calls`)
      }

      // 8. Delete job-related data
      if (jobIds.length > 0) {
        for (const jobId of jobIds) {
          await client.from("cleaner_assignments").delete().eq("job_id", jobId)
          await client.from("reviews").delete().eq("job_id", jobId)
          await client.from("tips").delete().eq("job_id", jobId)
          await client.from("upsells").delete().eq("job_id", jobId)
        }
        // Clear converted_to_job_id references in leads before deleting jobs
        await client.from("leads").update({ converted_to_job_id: null }).in("converted_to_job_id", jobIds)
        deletionLog.push(`${jobIds.length} jobs + related data`)
      }

      // 9. Delete leads
      if (leadIds.length > 0) {
        await client.from("leads").delete().in("id", leadIds)
        deletionLog.push(`${leadIds.length} leads`)
      }

      // 10. Delete jobs
      if (jobIds.length > 0) {
        await client.from("jobs").delete().in("id", jobIds)
      }

      // 11. Delete followup queue entries
      const { data: followups } = await client.from("followup_queue").select("id").in("phone_number", phoneFormats)
      if (followups && followups.length > 0) {
        await client.from("followup_queue").delete().in("phone_number", phoneFormats)
        deletionLog.push(`${followups.length} followup queue entries`)
      }

      // 12. Delete customer records
      if (customerIds.length > 0) {
        await client.from("customers").delete().in("id", customerIds)
        deletionLog.push(`${customerIds.length} customer record(s)`)
      }

      // Log the reset as a system event
      const { logSystemEvent } = await import("@/lib/system-events")
      await logSystemEvent({
        event_type: "SYSTEM_RESET" as any,
        source: "system" as any,
        message: `Reset all data for ${e164 || phone} via assistant`,
        phone_number: e164 || phone,
        metadata: { deletions: deletionLog, triggered_by: "assistant" },
      }).catch(() => {}) // Don't fail if event logging fails

      if (deletionLog.length === 0) {
        return `No data found to delete for "${name}" (${phone}). They may have already been reset, or the phone number doesn't match any records.`
      }

      return `Fully reset "${name}" (${phone}). Deleted: ${deletionLog.join(", ")}. They're completely wiped from the system — if they text in again, they'll start the booking flow from scratch as a brand new lead.`
    } catch (err: any) {
      return `Error resetting customer: ${err.message}`
    }
  }

  // ----- TOGGLE SYSTEM -----
  if (toolName === "toggle_system") {
    const active = toolInput.active as boolean

    const { data: user } = await client.from("users").select("tenant_id").eq("id", userId).single()
    if (!user?.tenant_id) return "Couldn't determine your business. Your account may not be linked to a tenant yet."

    const { data: tenantData, error } = await client
      .from("tenants")
      .update({ active, updated_at: new Date().toISOString() })
      .eq("id", user.tenant_id)
      .select("name, active")
      .single()

    if (error) return `Failed to update system status: ${error.message}`

    return active
      ? `System is now **ON** for ${tenantData.name}! All automated responses, follow-ups, and SMS are active and running.`
      : `System is now **OFF** for ${tenantData.name}. All automated responses, follow-ups, and SMS are paused. Just let me know when you want to turn it back on!`
  }

  // ----- SEND SMS -----
  if (toolName === "send_sms") {
    try {
      if (!tenant) return "Cannot send SMS: your account isn't linked to a business yet."
      const phone = toolInput.phone_number as string
      const message = toolInput.message as string

      const { sendSMS } = await import("@/lib/openphone")
      const result = await sendSMS(tenant, phone, message)

      if (!result.success) {
        return `Failed to send SMS: ${result.error}`
      }

      return `SMS sent to ${phone}: "${message.slice(0, 100)}${message.length > 100 ? "..." : ""}"`
    } catch (err: any) {
      return `Error sending SMS: ${err.message}`
    }
  }

  // ----- ASSIGN CLEANER -----
  if (toolName === "assign_cleaner") {
    try {
      if (!tenantId) return "Cannot assign cleaner: your account isn't linked to a business yet."

      const jobId = toolInput.job_id as number
      const cleanerId = toolInput.cleaner_id as number
      const notifyCleaner = toolInput.notify_cleaner !== false
      const notifyCustomer = toolInput.notify_customer !== false

      // Fetch job
      const { data: job } = await client
        .from("jobs")
        .select("*")
        .eq("id", jobId)
        .eq("tenant_id", tenantId)
        .single()
      if (!job) return `Job #${jobId} not found.`

      // Fetch cleaner
      const { data: cleaner } = await client
        .from("cleaners")
        .select("*")
        .eq("id", cleanerId)
        .eq("tenant_id", tenantId)
        .single()
      if (!cleaner) return `Cleaner #${cleanerId} not found. Use list_cleaners to see available cleaners.`

      // Check for existing active assignment (prevent duplicates)
      const { data: existingAssignment } = await client
        .from("cleaner_assignments")
        .select("id, status")
        .eq("job_id", jobId)
        .eq("cleaner_id", cleanerId)
        .in("status", ["pending", "confirmed"])
        .maybeSingle()

      if (existingAssignment) {
        return `**${cleaner.name}** is already assigned to job #${jobId} (status: ${existingAssignment.status}). No duplicate assignment created.`
      }

      // Create assignment as pending — cleaner confirms via Telegram accept button
      const { data: assignment, error: assignErr } = await client
        .from("cleaner_assignments")
        .insert({
          tenant_id: tenantId,
          job_id: jobId,
          cleaner_id: cleanerId,
          status: "pending",
        })
        .select("id")
        .single()

      if (assignErr) return `Failed to create assignment: ${assignErr.message}`

      // Update job with assigned cleaner
      await client
        .from("jobs")
        .update({ assigned_cleaner_id: cleanerId, updated_at: new Date().toISOString() })
        .eq("id", jobId)

      const results: string[] = [`Assigned **${cleaner.name}** to job #${jobId}`]

      // Notify cleaner via SMS
      if (notifyCleaner && cleaner.phone && tenant) {
        const { notifyCleanerAssignment } = await import("@/lib/cleaner-sms")
        const customer: any = job.phone_number
          ? await findCustomerByPhone(client, job.phone_number, tenantId, "first_name, last_name, address")
          : null
        await notifyCleanerAssignment(tenant, cleaner, job, customer, assignment.id?.toString())
        results.push("Cleaner notified via SMS")
      } else if (notifyCleaner && !cleaner.phone) {
        results.push("Cleaner does NOT have a phone number — no notification sent")
      }

      // Customer SMS is sent automatically when the cleaner accepts
      results.push("Customer will be notified via SMS once the cleaner accepts")

      return results.join("\n")
    } catch (err: any) {
      return `Error assigning cleaner: ${err.message}`
    }
  }

  // ----- SEND PAYMENT LINK -----
  if (toolName === "send_payment_link") {
    try {
      if (!tenant) return "Cannot send payment link: your account isn't linked to a business yet."
      const phone = toolInput.phone_number as string
      const linkType = (toolInput.link_type as string) || "deposit"
      const customer: any = await findCustomerByPhone(client, phone, tenantId)

      if (!customer) return `No customer found with phone number ${phone}. Create one first.`
      if (!customer.email) return `${customer.first_name || "This customer"} doesn't have an email on file. Use update_customer to add their email first.`

      // Get latest job
      const { data: jobs } = await client
        .from("jobs")
        .select("*")
        .eq("phone_number", customer.phone_number)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1)

      const job = jobs?.[0]
      if (!job && linkType !== "payment") return `${customer.first_name || "This customer"} doesn't have any jobs yet. Create one first.`

      let linkUrl = ""
      let amount = 0
      let linkLabel = ""

      if (linkType === "payment") {
        const paymentAmount = toolInput.amount as number
        const paymentDesc = (toolInput.description as string) || "Payment"
        if (!paymentAmount || paymentAmount <= 0) {
          return "Please specify an amount for the payment link. E.g. 'send Dale a $150 payment link for deep clean'"
        }
        if (!tenant?.stripe_secret_key || !tenantId) {
          return "Stripe is not configured for this tenant. Please add a Stripe secret key in admin settings."
        }
        const { createCustomPaymentLink } = await import("@/lib/stripe-client")
        const result = await createCustomPaymentLink(customer, paymentAmount, paymentDesc, tenantId, tenant.stripe_secret_key, job ? String(job.id) : undefined)
        if (!result.success || !result.url) return `Failed to generate payment link: ${result.error || "Unknown error"}`
        linkUrl = result.url
        amount = paymentAmount
        linkLabel = `$${paymentAmount.toFixed(2)} payment`
      } else if (linkType === "deposit") {
        if (!tenant?.stripe_secret_key || !tenantId) {
          return "Stripe is not configured for this tenant. Please add a Stripe secret key in admin settings."
        }
        const { createDepositPaymentLink } = await import("@/lib/stripe-client")
        const result = await createDepositPaymentLink(customer, job, undefined, tenantId, tenant.stripe_secret_key)
        if (!result.success || !result.url) return `Failed to generate deposit link: ${result.error || "Unknown error"}`
        linkUrl = result.url
        amount = result.amount || Math.round((job.price / 2) * 1.03 * 100) / 100
        linkLabel = `$${amount.toFixed(2)} deposit`
      } else {
        if (!tenant?.stripe_secret_key || !tenantId) {
          return "Stripe is not configured for this tenant. Please add a Stripe secret key in admin settings."
        }
        const { createCardOnFileLink } = await import("@/lib/stripe-client")
        const result = await createCardOnFileLink(customer, String(job.id), tenantId, tenant.stripe_secret_key)
        if (!result.success || !result.url) return `Failed to generate card-on-file link: ${result.error || "Unknown error"}`
        linkUrl = result.url
        linkLabel = "card-on-file"
      }

      // Send via SMS
      const { sendSMS } = await import("@/lib/openphone")
      const { paymentLink } = await import("@/lib/sms-templates")
      const name = customer.first_name || "there"
      const smsAmount = amount || job.price || 0
      const msg = linkType === "card_on_file"
        ? `Hi ${name}, please save your card on file to confirm your appointment: ${linkUrl}`
        : paymentLink(name, smsAmount, linkUrl)
      const smsResult = await sendSMS(tenant, customer.phone_number, msg)

      if (!smsResult.success) {
        return `Link created but SMS failed: ${smsResult.error}\n\nLink: ${linkUrl}`
      }

      return `${linkLabel} link sent to ${customer.first_name || phone} via SMS!\n- Type: ${linkLabel}\n- Link: ${linkUrl}`
    } catch (err: any) {
      return `Error sending payment link: ${err.message}`
    }
  }

  // ----- SEND REVIEW REQUEST -----
  if (toolName === "send_review_request") {
    try {
      if (!tenant) return "Cannot send review: your account isn't linked to a business yet."
      const phone = toolInput.phone_number as string
      const customer: any = await findCustomerByPhone(client, phone, tenantId, "first_name, phone_number")

      if (!customer) return `No customer found with phone number ${phone}.`

      const { sendSMS } = await import("@/lib/openphone")
      const reviewLink = tenant.google_review_link

      let msg: string
      if (reviewLink) {
        const { postCleaningReview } = await import("@/lib/sms-templates")
        msg = postCleaningReview(customer.first_name || "there", reviewLink)
      } else {
        const { reviewOnlyFollowup } = await import("@/lib/sms-templates")
        msg = reviewOnlyFollowup(customer.first_name || "there", "")
      }

      const result = await sendSMS(tenant, customer.phone_number, msg)

      if (!result.success) return `Failed to send review request: ${result.error}`
      return `Review request sent to ${customer.first_name || phone} via SMS!${!reviewLink ? "\n\n**Note:** No Google review link is configured for your business. Set one up in the tenants table to include it in review requests." : ""}`
    } catch (err: any) {
      return `Error sending review request: ${err.message}`
    }
  }

  // ----- UPDATE JOB -----
  if (toolName === "update_job") {
    try {
      if (!tenantId) return "Cannot update job: your account isn't linked to a business yet."

      const jobId = toolInput.job_id as number
      const updates: Record<string, any> = {}

      if (toolInput.status) updates.status = toolInput.status
      if (toolInput.date) updates.date = toolInput.date
      if (toolInput.time) updates.scheduled_at = toolInput.time
      if (toolInput.notes) updates.notes = toolInput.notes
      if (toolInput.address) updates.address = toolInput.address
      if (toolInput.price != null) updates.price = toolInput.price
      if (toolInput.service_type) updates.service_type = toolInput.service_type
      if (toolInput.bedrooms != null) updates.bedrooms = toolInput.bedrooms
      if (toolInput.bathrooms != null) updates.bathrooms = toolInput.bathrooms
      updates.updated_at = new Date().toISOString()

      if (Object.keys(updates).length === 1) return "No updates provided. Specify at least one field to change."

      // Fetch current job for comparison
      const { data: oldJob } = await client
        .from("jobs")
        .select("*, assigned_cleaner_id")
        .eq("id", jobId)
        .eq("tenant_id", tenantId)
        .single()

      if (!oldJob) return `Job #${jobId} not found.`

      // Completion/cancellation side effects
      if (toolInput.status === "completed" && !oldJob.completed_at) {
        updates.completed_at = new Date().toISOString()
      }
      if (toolInput.status === "cancelled") {
        updates.booked = false
      }

      const { data: updatedJob, error } = await client
        .from("jobs")
        .update(updates)
        .eq("id", jobId)
        .eq("tenant_id", tenantId)
        .select("*")
        .single()

      if (error) return `Failed to update job: ${error.message}`

      const results: string[] = [`Job #${jobId} updated!`]
      if (toolInput.status) results.push(`- Status: ${updatedJob.status}`)
      if (toolInput.date) results.push(`- Date: ${updatedJob.date}`)
      if (toolInput.time) results.push(`- Time: ${updatedJob.scheduled_at}`)
      if (toolInput.notes) results.push(`- Notes: ${updatedJob.notes}`)
      if (toolInput.address) results.push(`- Address: ${updatedJob.address}`)

      // Notify cleaner if date/time changed
      if ((toolInput.date || toolInput.time) && oldJob.assigned_cleaner_id && tenant) {
        const { data: cleaner } = await client
          .from("cleaners")
          .select("name, phone")
          .eq("id", oldJob.assigned_cleaner_id)
          .single()

        if (cleaner?.phone) {
          const { notifyScheduleChange } = await import("@/lib/cleaner-sms")
          await notifyScheduleChange(
            tenant,
            cleaner as any,
            updatedJob as any,
            oldJob.date || "",
            oldJob.scheduled_at || ""
          )
          results.push(`- ${cleaner.name} notified of schedule change via SMS`)
        }
      }

      return results.join("\n")
    } catch (err: any) {
      return `Error updating job: ${err.message}`
    }
  }

  // ----- UPDATE CUSTOMER -----
  if (toolName === "update_customer") {
    try {
      if (!tenantId) return "Cannot update customer: your account isn't linked to a business yet."

      const phone = toolInput.phone_number as string
      const customer: any = await findCustomerByPhone(client, phone, tenantId, "id, first_name, last_name, phone_number")

      if (!customer) return `No customer found with phone number ${phone}.`

      const updates: Record<string, any> = {}
      if (toolInput.first_name) updates.first_name = toolInput.first_name
      if (toolInput.last_name) updates.last_name = toolInput.last_name
      if (toolInput.email) updates.email = toolInput.email
      if (toolInput.address) updates.address = toolInput.address
      if (toolInput.bedrooms != null) updates.bedrooms = toolInput.bedrooms
      if (toolInput.bathrooms != null) updates.bathrooms = toolInput.bathrooms
      if (toolInput.sqft != null) updates.sqft = toolInput.sqft
      if (toolInput.notes) updates.notes = toolInput.notes
      updates.updated_at = new Date().toISOString()

      if (Object.keys(updates).length === 1) return "No updates provided. Specify at least one field to change."

      const { error } = await client
        .from("customers")
        .update(updates)
        .eq("id", customer.id)

      if (error) return `Failed to update customer: ${error.message}`

      const name = [toolInput.first_name || customer.first_name, toolInput.last_name || customer.last_name].filter(Boolean).join(" ") || customer.phone_number
      const changed = Object.keys(updates).filter(k => k !== "updated_at").join(", ")
      return `Updated ${name}: ${changed}`
    } catch (err: any) {
      return `Error updating customer: ${err.message}`
    }
  }

  // ----- SEND EMAIL -----
  if (toolName === "send_email") {
    try {
      let toEmail = toolInput.to_email as string | undefined

      // Auto-lookup email from customer phone if not provided
      if (!toEmail && toolInput.customer_phone) {
        const customer: any = await findCustomerByPhone(client, toolInput.customer_phone, tenantId, "email, first_name")
        if (!customer) return `No customer found with phone ${toolInput.customer_phone}. Provide the email directly or create the customer first.`
        if (!customer.email) return `${customer.first_name || "This customer"} doesn't have an email on file. Provide the email directly or use update_customer to add it.`
        toEmail = customer.email
      }

      if (!toEmail) return "No email address provided. Either provide to_email directly or customer_phone to auto-lookup."

      const { sendCustomEmail } = await import("@/lib/gmail-client")
      const businessName = tenant?.business_name_short || tenant?.name || undefined
      const result = await sendCustomEmail({
        to: toEmail,
        subject: toolInput.subject,
        body: toolInput.body,
        fromName: businessName,
        tenant: tenant as any,
      })

      if (!result.success) return `Failed to send email: ${result.error}`
      return `Email sent to ${toEmail}!\n- Subject: ${toolInput.subject}`
    } catch (err: any) {
      return `Error sending email: ${err.message}`
    }
  }

  // ----- GET MESSAGE HISTORY -----
  if (toolName === "get_message_history") {
    try {
      if (!tenantId) return "Cannot get messages: your account isn't linked to a business yet."

      const phone = toolInput.phone_number as string
      const limit = Math.min(toolInput.limit || 20, 50)
      const e164 = toE164(phone)
      const digits = phone.replace(/\D/g, "")
      const last10 = digits.slice(-10)

      let query = client
        .from("messages")
        .select("direction, body, created_at, channel")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit)

      // Match by E164 or last-10 digits
      if (e164) {
        query = query.eq("phone_number", e164)
      } else if (last10.length === 10) {
        query = query.like("phone_number", `%${last10}`)
      } else {
        return `Invalid phone number: ${phone}`
      }

      const { data: messages, error } = await query
      if (error) return `Error fetching messages: ${error.message}`
      if (!messages || messages.length === 0) return `No message history found for ${phone}.`

      return JSON.stringify({
        phone: e164 || phone,
        count: messages.length,
        messages: messages.reverse().map((m: any) => ({
          direction: m.direction || "unknown",
          body: m.body || "",
          time: m.created_at,
          channel: m.channel || "sms",
        })),
      })
    } catch (err: any) {
      return `Error getting message history: ${err.message}`
    }
  }

  // ----- GET LEAD DETAILS -----
  if (toolName === "get_lead_details") {
    try {
      if (!tenantId) return "Cannot get lead: your account isn't linked to a business yet."

      let lead: any = null

      if (toolInput.lead_id) {
        const { data } = await client
          .from("leads")
          .select("*")
          .eq("id", toolInput.lead_id)
          .eq("tenant_id", tenantId)
          .single()
        lead = data
      } else if (toolInput.phone_number) {
        const phone = toolInput.phone_number as string
        const e164 = toE164(phone)
        const digits = phone.replace(/\D/g, "")
        const last10 = digits.slice(-10)

        let query = client
          .from("leads")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(1)

        if (e164) {
          query = query.eq("phone_number", e164)
        } else if (last10.length === 10) {
          query = query.like("phone_number", `%${last10}`)
        }

        const { data } = await query
        lead = data?.[0]
      } else {
        return "Please provide either a phone_number or lead_id to look up."
      }

      if (!lead) return `No lead found. They may not have entered the system yet.`

      return JSON.stringify({
        id: lead.id,
        phone: lead.phone_number,
        name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown",
        status: lead.status,
        source: lead.source,
        service_interest: lead.service_interest || lead.form_data?.service_type || "Unknown",
        follow_up_stage: lead.follow_up_stage,
        form_data: lead.form_data || {},
        created_at: lead.created_at,
        updated_at: lead.updated_at,
        converted_to_job_id: lead.converted_to_job_id,
      })
    } catch (err: any) {
      return `Error getting lead details: ${err.message}`
    }
  }

  // ----- SCHEDULE FOLLOWUP -----
  if (toolName === "schedule_followup") {
    try {
      if (!tenantId) return "Cannot schedule task: your account isn't linked to a business yet."

      const phone = toolInput.phone_number as string
      const taskType = toolInput.task_type as string
      const delayHours = toolInput.delay_hours as number
      const customMessage = toolInput.message as string | undefined

      const scheduledFor = new Date(Date.now() + delayHours * 60 * 60 * 1000)

      const { scheduleTask } = await import("@/lib/scheduler")
      const result = await scheduleTask({
        tenantId,
        taskType: taskType as any,
        taskKey: `assistant-${taskType}-${phone}-${Date.now()}`,
        scheduledFor,
        payload: {
          phone_number: toE164(phone) || phone,
          custom_message: customMessage,
          source: "assistant",
        },
      })

      if (!result.success) return `Failed to schedule task: ${result.error}`

      const timeStr = scheduledFor.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })

      return `Follow-up scheduled!\n- Type: ${taskType}\n- For: ${phone}\n- When: ${timeStr} (${delayHours}h from now)\n- Task ID: ${result.taskId}${customMessage ? `\n- Message: "${customMessage}"` : ""}`
    } catch (err: any) {
      return `Error scheduling follow-up: ${err.message}`
    }
  }

  // ----- GET SCHEDULED TASKS -----
  if (toolName === "get_scheduled_tasks") {
    try {
      if (!tenantId) return "Cannot get tasks: your account isn't linked to a business yet."

      const status = (toolInput.status as string) || "pending"

      let query = client
        .from("scheduled_tasks")
        .select("id, task_type, task_key, scheduled_for, status, payload, created_at")
        .eq("tenant_id", tenantId)
        .eq("status", status)
        .order("scheduled_for", { ascending: true })
        .limit(20)

      // Filter by phone if provided
      if (toolInput.phone_number) {
        const phone = toolInput.phone_number as string
        const e164 = toE164(phone)
        if (e164) {
          query = query.contains("payload", { phone_number: e164 })
        }
      }

      const { data: tasks, error } = await query
      if (error) return `Error fetching tasks: ${error.message}`
      if (!tasks || tasks.length === 0) return `No ${status} scheduled tasks found.`

      return JSON.stringify({
        count: tasks.length,
        tasks: tasks.map((t: any) => ({
          id: t.id,
          type: t.task_type,
          scheduled_for: t.scheduled_for,
          status: t.status,
          phone: t.payload?.phone_number || t.payload?.customerPhone || t.payload?.leadPhone || "N/A",
          details: t.payload?.custom_message || t.payload?.type || "",
        })),
      })
    } catch (err: any) {
      return `Error getting scheduled tasks: ${err.message}`
    }
  }

  // ----- CANCEL SCHEDULED TASK -----
  if (toolName === "cancel_scheduled_task") {
    try {
      if (!tenantId) return "Cannot cancel task: your account isn't linked to a business yet."

      const taskId = toolInput.task_id as string

      // Verify task belongs to this tenant and is pending
      const { data: task } = await client
        .from("scheduled_tasks")
        .select("id, task_type, status, scheduled_for")
        .eq("id", taskId)
        .eq("tenant_id", tenantId)
        .single()

      if (!task) return `Task ${taskId} not found.`
      if (task.status !== "pending") return `Task ${taskId} is already ${task.status} — can only cancel pending tasks.`

      const { error } = await client
        .from("scheduled_tasks")
        .update({ status: "cancelled" })
        .eq("id", taskId)
        .eq("status", "pending")

      if (error) return `Failed to cancel task: ${error.message}`

      return `Task cancelled!\n- ID: ${taskId}\n- Type: ${task.task_type}\n- Was scheduled for: ${task.scheduled_for}`
    } catch (err: any) {
      return `Error cancelling task: ${err.message}`
    }
  }

  // ----- CREATE LEAD -----
  if (toolName === "create_lead") {
    try {
      if (!tenantId) return "Cannot create lead: your account isn't linked to a business yet."

      const phone = toolInput.phone_number as string
      const e164 = toE164(phone)
      if (!e164) return `Invalid phone number: ${phone}`

      // Map user-friendly source to DB enum
      const sourceMapping: Record<string, string> = {
        facebook: 'meta', instagram: 'meta', meta: 'meta',
        google: 'website', thumbtack: 'website', yelp: 'website', website: 'website',
        phone: 'phone', 'inbound call': 'phone', call: 'phone', vapi: 'vapi',
        sms: 'sms', text: 'sms',
        housecall_pro: 'housecall_pro', hcp: 'housecall_pro',
        ghl: 'ghl', gohighlevel: 'ghl',
        manual: 'manual', referral: 'manual', realtor: 'manual', other: 'manual',
      }
      const rawSource = (toolInput.source as string || 'manual').toLowerCase().trim()
      const dbSource = sourceMapping[rawSource] || 'manual'

      // Map user-friendly status to DB enum
      const statusMapping: Record<string, string> = {
        new: 'new', 'new lead': 'new',
        contacted: 'contacted', quoted: 'contacted',
        qualified: 'qualified',
        booked: 'booked',
        assigned: 'assigned',
        lost: 'lost',
        'no response': 'unresponsive', 'no response yet': 'unresponsive', unresponsive: 'unresponsive',
        'still deciding': 'nurturing', nurturing: 'nurturing',
        escalated: 'escalated',
      }
      const rawStatus = (toolInput.status as string || 'new').toLowerCase().trim()
      const dbStatus = statusMapping[rawStatus] || 'new'

      // Build form_data JSONB with all the rich details
      const formData: Record<string, any> = {
        created_by: 'assistant',
        source_label: toolInput.source || rawSource,
        stage_label: toolInput.status || rawStatus,
      }
      if (toolInput.service_interest) formData.service_type = toolInput.service_interest
      if (toolInput.quote_details) formData.quote_details = toolInput.quote_details
      if (toolInput.property_details) formData.property_details = toolInput.property_details
      if (toolInput.notes) formData.notes = toolInput.notes

      // Also ensure customer record exists
      const { upsertCustomer } = await import("@/lib/supabase")
      const customerData: Record<string, any> = { tenant_id: tenantId }
      if (toolInput.first_name) customerData.first_name = toolInput.first_name
      if (toolInput.last_name) customerData.last_name = toolInput.last_name
      if (toolInput.email) customerData.email = toolInput.email
      const customer = await upsertCustomer(phone, customerData)

      const { data: lead, error } = await client
        .from("leads")
        .insert({
          tenant_id: tenantId,
          phone_number: e164,
          customer_id: customer?.id || null,
          first_name: toolInput.first_name || null,
          last_name: toolInput.last_name || null,
          email: toolInput.email || null,
          source: dbSource,
          status: dbStatus,
          form_data: formData,
          followup_stage: 0,
          followup_started_at: new Date().toISOString(),
        })
        .select("id, phone_number, first_name, last_name, source, status")
        .single()

      if (error) return `Failed to create lead: ${error.message}`

      const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown"

      // Schedule the 5-stage follow-up sequence (text → call → double call → text → call)
      const { scheduleLeadFollowUp } = await import("@/lib/scheduler")
      const followupResult = await scheduleLeadFollowUp(tenantId, lead.id.toString(), e164, name)
      const followupMsg = followupResult.success
        ? `\n- Follow-up: Auto-text sequence scheduled (${followupResult.taskIds.length} stages)`
        : `\n- Follow-up: ⚠️ Failed to schedule auto-texts`

      return `Lead created!\n- ID: ${lead.id}\n- Name: ${name}\n- Phone: ${lead.phone_number}\n- Source: ${toolInput.source || rawSource}\n- Status: ${toolInput.status || rawStatus}\n- Service: ${toolInput.service_interest || "Not specified"}\n- Quote: ${toolInput.quote_details || "Not specified"}\n- Property: ${toolInput.property_details || "Not specified"}${followupMsg}`
    } catch (err: any) {
      return `Error creating lead: ${err.message}`
    }
  }

  // ----- UPDATE LEAD -----
  if (toolName === "update_lead") {
    try {
      if (!tenantId) return "Cannot update lead: your account isn't linked to a business yet."

      let lead: any = null
      if (toolInput.lead_id) {
        const { data } = await client.from("leads").select("*").eq("id", toolInput.lead_id).eq("tenant_id", tenantId).single()
        lead = data
      } else if (toolInput.phone_number) {
        const phone = toolInput.phone_number as string
        const e164 = toE164(phone)
        const digits = phone.replace(/\D/g, "")
        const last10 = digits.slice(-10)
        let query = client.from("leads").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1)
        if (e164) query = query.eq("phone_number", e164)
        else if (last10.length === 10) query = query.like("phone_number", `%${last10}`)
        const { data } = await query
        lead = data?.[0]
      }

      if (!lead) return "Lead not found. Check the phone number or lead ID."

      const updates: Record<string, any> = { updated_at: new Date().toISOString() }
      const formData = { ...(lead.form_data || {}) }

      if (toolInput.status) {
        const statusMapping: Record<string, string> = {
          new: 'new', 'new lead': 'new', contacted: 'contacted', quoted: 'contacted',
          qualified: 'qualified', booked: 'booked', assigned: 'assigned', lost: 'lost',
          'no response': 'unresponsive', 'no response yet': 'unresponsive', unresponsive: 'unresponsive',
          'still deciding': 'nurturing', nurturing: 'nurturing', escalated: 'escalated',
        }
        const mapped = statusMapping[(toolInput.status as string).toLowerCase().trim()]
        if (!mapped) return `Invalid lead status: "${toolInput.status}". Valid statuses: New, Quoted, Still Deciding, Booked, No Response, Lost, Qualified, Assigned, Escalated, Nurturing`
        updates.status = mapped
        formData.stage_label = toolInput.status
      }
      if (toolInput.source) {
        const sourceMapping: Record<string, string> = {
          facebook: 'meta', instagram: 'meta', meta: 'meta',
          google: 'website', thumbtack: 'website', yelp: 'website', website: 'website',
          phone: 'phone', 'inbound call': 'phone', call: 'phone', vapi: 'vapi',
          sms: 'sms', text: 'sms', manual: 'manual', referral: 'manual', realtor: 'manual',
        }
        updates.source = sourceMapping[(toolInput.source as string).toLowerCase().trim()] || 'manual'
        formData.source_label = toolInput.source
      }
      if (toolInput.service_interest) formData.service_type = toolInput.service_interest
      if (toolInput.quote_details) formData.quote_details = toolInput.quote_details
      if (toolInput.property_details) formData.property_details = toolInput.property_details
      if (toolInput.notes) formData.notes = toolInput.notes
      if (toolInput.email) updates.email = toolInput.email
      updates.form_data = formData

      const { error } = await client.from("leads").update(updates).eq("id", lead.id).eq("tenant_id", tenantId)
      if (error) return `Failed to update lead: ${error.message}`

      const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.phone_number
      return `Lead updated for ${name}!`
    } catch (err: any) {
      return `Error updating lead: ${err.message}`
    }
  }

  // ----- LIST LEADS -----
  if (toolName === "list_leads") {
    try {
      if (!tenantId) return "Cannot list leads: your account isn't linked to a business yet."

      let query = client
        .from("leads")
        .select("id, phone_number, first_name, last_name, email, source, status, form_data, created_at, updated_at, converted_to_job_id")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })

      if (toolInput.status) {
        const statusMapping: Record<string, string> = {
          new: 'new', 'new lead': 'new', contacted: 'contacted', quoted: 'contacted',
          qualified: 'qualified', booked: 'booked', assigned: 'assigned', lost: 'lost',
          'no response': 'unresponsive', 'no response yet': 'unresponsive', unresponsive: 'unresponsive',
          'still deciding': 'nurturing', nurturing: 'nurturing', escalated: 'escalated',
        }
        const rawStatus = (toolInput.status as string).toLowerCase().trim()
        query = query.eq("status", statusMapping[rawStatus] || rawStatus)
      }
      if (toolInput.source) {
        const sourceMapping: Record<string, string> = {
          facebook: 'meta', instagram: 'meta', meta: 'meta',
          google: 'website', thumbtack: 'website', yelp: 'website', website: 'website',
          phone: 'phone', 'inbound call': 'phone', call: 'phone',
          manual: 'manual', referral: 'manual', realtor: 'manual',
        }
        const rawSource = (toolInput.source as string).toLowerCase().trim()
        query = query.eq("source", sourceMapping[rawSource] || rawSource)
      }

      const limit = Math.min((toolInput.limit as number) || 50, 100)
      query = query.limit(limit)

      const { data: leads, error } = await query
      if (error) return `Failed to list leads: ${error.message}`
      if (!leads || leads.length === 0) return "No leads found matching your criteria."

      return JSON.stringify({
        count: leads.length,
        leads: leads.map((l: any) => ({
          id: l.id,
          name: [l.first_name, l.last_name].filter(Boolean).join(" ") || "Unknown",
          phone: l.phone_number,
          email: l.email || null,
          source: l.form_data?.source_label || l.source,
          status: l.form_data?.stage_label || l.status,
          service_interest: l.form_data?.service_type || l.form_data?.booking_data?.service_type || null,
          quote_details: l.form_data?.quote_details || null,
          property_details: l.form_data?.property_details || null,
          notes: l.form_data?.notes || null,
          converted_to_job: l.converted_to_job_id || null,
          created_at: l.created_at,
        })),
      })
    } catch (err: any) {
      return `Error listing leads: ${err.message}`
    }
  }

  // ----- UNASSIGN CLEANER -----
  if (toolName === "unassign_cleaner") {
    try {
      if (!tenantId) return "Cannot unassign cleaner: your account isn't linked to a business yet."

      const jobId = toolInput.job_id as number
      const cleanerId = toolInput.cleaner_id as number | undefined

      // Fetch job
      const { data: job } = await client
        .from("jobs")
        .select("id, assigned_cleaner_id")
        .eq("id", jobId)
        .eq("tenant_id", tenantId)
        .single()
      if (!job) return `Job #${jobId} not found.`

      // Cancel matching assignments
      let assignQuery = client
        .from("cleaner_assignments")
        .update({ status: "cancelled" })
        .eq("job_id", jobId)
        .in("status", ["pending", "confirmed"])
      if (cleanerId) assignQuery = assignQuery.eq("cleaner_id", cleanerId)

      const { data: cancelled, error: assignErr } = await assignQuery.select("id, cleaner_id")
      if (assignErr) return `Failed to cancel assignments: ${assignErr.message}`

      // Clear job's assigned_cleaner_id
      if (!cleanerId || job.assigned_cleaner_id === cleanerId) {
        await client
          .from("jobs")
          .update({ assigned_cleaner_id: null, updated_at: new Date().toISOString() })
          .eq("id", jobId)
      }

      const count = cancelled?.length || 0
      if (count === 0) return `No active assignments found for job #${jobId}${cleanerId ? ` with cleaner #${cleanerId}` : ""}.`

      // Get cleaner names for response
      const cleanerIds = cancelled!.map((a: any) => a.cleaner_id)
      const { data: cleanerRecords } = await client
        .from("cleaners")
        .select("id, name")
        .in("id", cleanerIds)
      const names = cleanerRecords?.map((c: any) => c.name).join(", ") || "Unknown"

      return `Unassigned ${count} cleaner(s) from job #${jobId}: ${names}. Job is now unassigned.`
    } catch (err: any) {
      return `Error unassigning cleaner: ${err.message}`
    }
  }

  // ----- QUERY BUSINESS DATA -----
  if (toolName === "query_business_data") {
    try {
      if (!tenantId) return "Cannot query data: your account isn't linked to a business yet."

      const allowedTables = ['jobs', 'leads', 'customers', 'cleaner_assignments', 'cleaners', 'messages']
      const table = toolInput.table as string
      if (!allowedTables.includes(table)) return `Invalid table "${table}". Allowed: ${allowedTables.join(', ')}`

      let query = client.from(table).select(toolInput.select || '*')
      query = query.eq('tenant_id', tenantId)

      // Apply filters
      for (const filter of (toolInput.filters as any[] || [])) {
        const { column, operator, value } = filter
        switch (operator) {
          case 'eq': query = query.eq(column, value); break
          case 'neq': query = query.neq(column, value); break
          case 'gt': query = query.gt(column, value); break
          case 'gte': query = query.gte(column, value); break
          case 'lt': query = query.lt(column, value); break
          case 'lte': query = query.lte(column, value); break
          case 'like': query = query.like(column, value); break
          case 'ilike': query = query.ilike(column, value); break
          case 'in': query = query.in(column, JSON.parse(value)); break
          case 'is': query = query.is(column, value === 'null' ? null : value); break
          case 'not': query = query.not(column, 'eq', value); break
        }
      }

      // Apply ordering
      if (toolInput.order_by) {
        const desc = (toolInput.order_by as string).startsWith('-')
        const col = desc ? (toolInput.order_by as string).slice(1) : toolInput.order_by as string
        query = query.order(col, { ascending: !desc })
      }

      const limit = Math.min((toolInput.limit as number) || 50, 200)
      query = query.limit(limit)

      const { data, error } = await query
      if (error) return `Query error: ${error.message}`
      if (!data || data.length === 0) return `No results found in ${table} matching your filters.`

      return JSON.stringify({ table, count: data.length, rows: data })
    } catch (err: any) {
      return `Error querying data: ${err.message}`
    }
  }

  // ── CHARGE CARD ON FILE ──────────────────────────────────────────
  if (toolName === "charge_card") {
    try {
      const customer: any = await findCustomerByPhone(client, toolInput.phone_number, tenantId)
      if (!customer) return `No customer found with phone ${toolInput.phone_number}.`
      if (!customer.stripe_customer_id) return `${customer.first_name || "This customer"} doesn't have a card on file. Generate a card-on-file link first using generate_stripe_link.`
      if (!customer.card_on_file_at) return `${customer.first_name || "This customer"} hasn't saved a card yet. Send them a card-on-file link first.`

      if (!tenant) return "Cannot charge — no tenant context."
      const stripeKey = (tenant as any).stripe_secret_key
      if (!stripeKey) return "Stripe is not configured for this business."

      const amountCents = Math.round(toolInput.amount * 100)
      const description = toolInput.description || "Service charge"

      const { chargeCardOnFile } = await import("@/lib/stripe-client")
      const metadata: Record<string, string> = {
        tenant_id: tenantId || "",
        customer_id: String(customer.id),
        description,
      }
      if (toolInput.job_id) metadata.job_id = String(toolInput.job_id)

      const result = await chargeCardOnFile(stripeKey, customer.stripe_customer_id, amountCents, metadata)
      if (!result.success) return `Charge failed: ${result.error}`

      // Mark job as paid if job_id provided
      if (toolInput.job_id) {
        await client.from("jobs").update({
          paid: true,
          payment_status: "paid",
          stripe_payment_intent_id: result.paymentIntentId,
          updated_at: new Date().toISOString(),
        }).eq("id", toolInput.job_id)
      }

      return `Successfully charged $${toolInput.amount.toFixed(2)} to ${customer.first_name || "customer"}'s card on file!\n- Payment ID: ${result.paymentIntentId}\n- Description: ${description}${toolInput.job_id ? `\n- Job #${toolInput.job_id} marked as paid` : ""}`
    } catch (err: any) {
      return `Error charging card: ${err.message}`
    }
  }

  // ── CHECK AVAILABILITY ───────────────────────────────────────────
  if (toolName === "check_availability") {
    try {
      const startDate = toolInput.date
      const endDate = toolInput.end_date || startDate

      // Get all cleaners
      const { getCleaners } = await import("@/lib/supabase")
      const cleaners = await getCleaners(undefined, tenantId)
      if (!cleaners || cleaners.length === 0) return "No cleaners found."

      // Get all jobs in date range
      let jobsQuery = client.from("jobs").select("id, date, scheduled_at, cleaner_id, service_type, status, hours, address")
        .gte("date", startDate).lte("date", endDate)
        .in("status", ["scheduled", "in_progress", "pending"])
      if (tenantId) jobsQuery = jobsQuery.eq("tenant_id", tenantId)
      const { data: jobs } = await jobsQuery

      // Get assignments
      const jobIds = (jobs || []).map(j => j.id)
      let assignments: any[] = []
      if (jobIds.length > 0) {
        const { data: a } = await client.from("cleaner_assignments").select("cleaner_id, job_id, status")
          .in("job_id", jobIds).in("status", ["accepted", "confirmed", "pending"])
        assignments = a || []
      }

      // Build availability map
      const result: any[] = []
      for (const cleaner of cleaners) {
        const cleanerJobs = (jobs || []).filter(j =>
          j.cleaner_id === cleaner.id || assignments.some(a => a.cleaner_id === cleaner.id && a.job_id === j.id)
        )
        result.push({
          id: cleaner.id,
          name: cleaner.name,
          phone: cleaner.phone,
          jobCount: cleanerJobs.length,
          jobs: cleanerJobs.map(j => ({
            id: j.id,
            date: j.date,
            time: j.scheduled_at,
            service: j.service_type,
            address: j.address,
            hours: j.hours,
          })),
          available: cleanerJobs.length === 0,
        })
      }

      return JSON.stringify({
        dateRange: startDate === endDate ? startDate : `${startDate} to ${endDate}`,
        cleaners: result.sort((a, b) => a.jobCount - b.jobCount),
        totalJobs: (jobs || []).length,
      })
    } catch (err: any) {
      return `Error checking availability: ${err.message}`
    }
  }

  // ── VIEW SCHEDULE ────────────────────────────────────────────────
  if (toolName === "view_schedule") {
    try {
      const startDate = toolInput.start_date
      const endDate = toolInput.end_date || new Date(new Date(startDate).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

      let query = client.from("jobs").select(`
        id, date, scheduled_at, status, service_type, job_type, price, hours, address, phone_number, notes, cleaner_id,
        customers!inner(id, first_name, last_name, phone_number)
      `).gte("date", startDate).lte("date", endDate)
        .order("date", { ascending: true }).order("scheduled_at", { ascending: true })

      if (tenantId) query = query.eq("tenant_id", tenantId)

      const statusFilter = toolInput.status || "all"
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter)
      } else {
        query = query.in("status", ["scheduled", "in_progress", "completed", "pending"])
      }

      const { data: jobs, error } = await query.limit(100)
      if (error) return `Error loading schedule: ${error.message}`
      if (!jobs || jobs.length === 0) return `No jobs found between ${startDate} and ${endDate}.`

      // Get cleaner names
      const cleanerIds = [...new Set((jobs as any[]).map(j => j.cleaner_id).filter(Boolean))]
      let cleanerMap: Record<number, string> = {}
      if (cleanerIds.length > 0) {
        const { data: cleaners } = await client.from("cleaners").select("id, name").in("id", cleanerIds)
        for (const c of cleaners || []) cleanerMap[c.id] = c.name
      }

      // Group by date
      const byDate: Record<string, any[]> = {}
      for (const job of jobs as any[]) {
        const d = job.date
        if (!byDate[d]) byDate[d] = []
        const cust = job.customers
        byDate[d].push({
          id: job.id,
          time: job.scheduled_at || "TBD",
          status: job.status,
          service: job.service_type,
          customer: cust ? `${cust.first_name || ""} ${cust.last_name || ""}`.trim() : "Unknown",
          phone: job.phone_number,
          address: job.address,
          price: job.price,
          cleaner: job.cleaner_id ? (cleanerMap[job.cleaner_id] || `ID:${job.cleaner_id}`) : "Unassigned",
          notes: job.notes,
        })
      }

      return JSON.stringify({ dateRange: `${startDate} to ${endDate}`, totalJobs: jobs.length, schedule: byDate })
    } catch (err: any) {
      return `Error viewing schedule: ${err.message}`
    }
  }

  // ── CREATE QUOTE ─────────────────────────────────────────────────
  if (toolName === "create_quote") {
    try {
      const customer: any = await findCustomerByPhone(client, toolInput.phone_number, tenantId)
      if (!customer) return `No customer found with phone ${toolInput.phone_number}. Create the customer first.`
      if (!tenant) return "Cannot create quote — no tenant context."

      const { getQuotePricing } = await import("@/lib/quote-pricing")
      const pricing = await getQuotePricing(tenant.id, tenant.slug || "", {
        squareFootage: customer.sqft || null,
        bedrooms: customer.bedrooms || null,
        bathrooms: customer.bathrooms || null,
      }, "standard")

      const selectedTier = toolInput.selected_tier || "better"
      const selectedAddons = toolInput.selected_addons || []
      const customPrice = toolInput.custom_price

      // Calculate price
      let total: number
      if (customPrice != null && customPrice > 0) {
        total = customPrice
      } else if (pricing.tierPrices[selectedTier]) {
        total = pricing.tierPrices[selectedTier].price
        const tierDef = pricing.tiers.find((t: any) => t.key === selectedTier)
        for (const key of selectedAddons) {
          if (tierDef && tierDef.included.includes(key)) continue
          const addon = pricing.addons.find((a: any) => a.key === key)
          if (addon) total += addon.price
        }
      } else {
        return `Invalid tier "${selectedTier}". Available: ${Object.keys(pricing.tierPrices).join(", ")}`
      }

      const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(" ") || "Customer"

      const quoteInsert = {
        tenant_id: tenant.id,
        customer_id: customer.id,
        customer_name: customerName,
        customer_phone: customer.phone_number,
        customer_email: customer.email,
        customer_address: customer.address,
        square_footage: customer.sqft,
        service_category: "standard",
        notes: toolInput.notes || null,
        selected_tier: customPrice != null ? "custom" : selectedTier,
        selected_addons: selectedAddons.map((k: string) => ({ key: k, quantity: 1 })),
        custom_base_price: customPrice != null ? customPrice : null,
        subtotal: total,
        total,
        status: "pending",
        valid_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }

      const { data: quote, error: quoteError } = await client
        .from("quotes").insert(quoteInsert).select("id, token").single()

      if (quoteError || !quote) return `Failed to create quote: ${quoteError?.message}`

      // Always use Osiris app domain for quote links — website_url may be a marketing site
      const domain = process.env.NEXT_PUBLIC_SITE_URL || "https://cleanmachine.live"
      const quoteLink = `${domain}/quote/${quote.token}`

      // Send SMS if requested (default: true)
      if (toolInput.send_sms !== false) {
        const { sendSMS } = await import("@/lib/openphone")
        const businessName = tenant.business_name_short || tenant.name
        const message = `Hey ${customer.first_name || "there"}! Here's your custom quote from ${businessName}. Review and book when you're ready: ${quoteLink}`
        await sendSMS(tenant, customer.phone_number, message)
      }

      return `Quote created!\n- Quote ID: ${quote.id}\n- Tier: ${customPrice ? "Custom" : selectedTier}\n- Total: $${total.toFixed(2)}\n- Link: ${quoteLink}\n${toolInput.send_sms !== false ? "- SMS sent to customer" : "- SMS not sent (as requested)"}`
    } catch (err: any) {
      return `Error creating quote: ${err.message}`
    }
  }

  // ── SETUP RECURRING ──────────────────────────────────────────────
  if (toolName === "setup_recurring") {
    try {
      const frequency = toolInput.frequency
      const { getJobById } = await import("@/lib/supabase")

      let baseJob: any = null
      let customerId: number | null = null
      let phone: string | null = null

      if (toolInput.job_id) {
        baseJob = await getJobById(String(toolInput.job_id))
        if (!baseJob) return `No job found with ID ${toolInput.job_id}.`
        if (tenantId && baseJob.tenant_id !== tenantId) return `No job found with ID ${toolInput.job_id}.`
        customerId = baseJob.customer_id
        phone = baseJob.phone_number
      } else if (toolInput.phone_number) {
        const customer: any = await findCustomerByPhone(client, toolInput.phone_number, tenantId)
        if (!customer) return `No customer found with phone ${toolInput.phone_number}.`
        customerId = customer.id
        phone = customer.phone_number

        // Find their most recent job to use as template
        let q = client.from("jobs").select("*").eq("customer_id", customer.id)
          .order("created_at", { ascending: false }).limit(1)
        if (tenantId) q = q.eq("tenant_id", tenantId)
        const { data: recentJobs } = await q
        if (recentJobs && recentJobs.length > 0) baseJob = recentJobs[0]
      }

      if (!baseJob && !phone) return "Need either a job_id or phone_number to set up recurring."

      const startDate = toolInput.start_date || baseJob?.date || new Date().toISOString().split("T")[0]

      // Create the recurring parent job
      const recurringInsert: Record<string, any> = {
        tenant_id: tenantId,
        customer_id: customerId,
        phone_number: phone,
        address: baseJob?.address || null,
        service_type: baseJob?.service_type || "Standard cleaning",
        job_type: "cleaning",
        status: "scheduled",
        booked: false,
        paid: false,
        date: startDate,
        scheduled_at: baseJob?.scheduled_at || null,
        price: baseJob?.price || null,
        hours: baseJob?.hours || null,
        cleaners: baseJob?.cleaners || null,
        bedrooms: baseJob?.bedrooms || null,
        bathrooms: baseJob?.bathrooms || null,
        frequency,
        notes: `Recurring ${frequency}${baseJob?.notes ? ". " + baseJob.notes : ""}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const { data: recurringJob, error: recurError } = await client
        .from("jobs").insert(recurringInsert).select("id").single()

      if (recurError || !recurringJob) return `Failed to create recurring job: ${recurError?.message}`

      // If we based it on an existing job, mark that job's parent
      if (toolInput.job_id && baseJob) {
        await client.from("jobs").update({ parent_job_id: recurringJob.id }).eq("id", baseJob.id)
      }

      const freqLabel: Record<string, string> = {
        weekly: "every week",
        "bi-weekly": "every 2 weeks",
        monthly: "every month",
        every_6_weeks: "every 6 weeks",
      }

      return `Recurring schedule set up!\n- Recurring Job ID: ${recurringJob.id}\n- Frequency: ${freqLabel[frequency] || frequency}\n- Starting: ${startDate}\n- Service: ${recurringInsert.service_type}\n- Price: $${recurringInsert.price || "TBD"}\n${baseJob ? `- Based on Job #${baseJob.id}` : ""}`
    } catch (err: any) {
      return `Error setting up recurring: ${err.message}`
    }
  }

  return `Unknown tool: ${toolName}`
}

// =====================================================================
// SYSTEM PROMPT BUILDER
// =====================================================================

function buildSystemPrompt(tenant: Tenant | null): string {
  const businessName = tenant?.business_name_short || tenant?.name || "your business"
  const serviceType = tenant ? getTenantServiceDescription(tenant) : "cleaning"
  const isWindowCleaning = serviceType.toLowerCase().includes("window")
  const serviceArea = tenant?.service_area || "your area"
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" })
  const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Chicago" })

  const stripeEnabled = tenant?.stripe_secret_key ? "Yes" : "No"
  const waveEnabled = tenant ? tenantHasIntegration(tenant, "wave") ? "Yes" : "No" : "No"
  const telegramEnabled = tenant?.telegram_bot_token ? "Yes" : "No"

  // Tenant-specific pricing/job details
  const priceEstimateDesc = isWindowCleaning
    ? "**Price estimate** — Calculate pricing by service type (window cleaning, pressure washing, gutter cleaning), number of panes/windows, stories, screens, construction residue, etc."
    : "**Price estimate** — Calculate pricing by service type, bedrooms, bathrooms"
  const createJobDesc = isWindowCleaning
    ? "**Create a job** — Set up a window cleaning job with service details (panes, stories, screens, etc.)"
    : "**Create a job** — Set up a job with auto-pricing"

  const bookingFlowStep2 = isWindowCleaning
    ? "2. **Create the job** — service type (window cleaning/pressure washing/gutter cleaning), date, and job details (panes, stories, screens, construction residue, building type) in notes"
    : "2. **Create the job** — service type, date, beds/baths → auto-calculates price"

  const creatingJobsSection = isWindowCleaning
    ? `## CREATING JOBS
- Ask for: customer phone, service type (window cleaning, pressure washing, or gutter cleaning), date
- Important details to collect: number of exterior windows/panes, number of stories, screens (yes/no), construction residue (yes/no), building type (residential/commercial), square footage
- Put all job details in the notes field
- Convert natural dates: "next Tuesday" = the upcoming Tuesday from today (${today}), "tomorrow" = the day after today
- The date parameter MUST be YYYY-MM-DD format`
    : `## CREATING JOBS
- Ask for: customer phone, service type, date
- Bedrooms/bathrooms are optional but improve pricing accuracy
- Convert natural dates: "next Tuesday" = the upcoming Tuesday from today (${today}), "tomorrow" = the day after today
- The date parameter MUST be YYYY-MM-DD format`

  return `You are Osiris, the AI assistant for ${businessName} — a professional ${serviceType} business serving ${serviceArea}.

You're warm, helpful, and genuinely enthusiastic about helping run the business. You speak like a knowledgeable colleague who cares — not a robotic tool.

Today is ${dayOfWeek}, ${today}.

## PERSONALITY
- Be warm, encouraging, and professional — never curt or robotic
- After completing actions, give a brief, positive confirmation
- Use the customer's first name when you know it
- If something fails, be empathetic and suggest next steps
- Use markdown: **bold** for key info, bullet lists for summaries, \`code\` for links/IDs

## CRITICAL RULES
- **NEVER fabricate data.** Do not invent job IDs, customer details, prices, or any information. Every piece of data you reference MUST come from a tool result.
- If you don't have the information you need, call the appropriate tool first (search_customers, lookup_customer, list_cleaners, etc.)
- If a tool returns no results, say so honestly — never fill in gaps with made-up data
- **NEVER truncate, abbreviate, or shorten URLs.** When a tool generates a link, say "Here's the link:" and the full URL will be attached automatically. Do NOT try to reproduce the URL yourself.

## HONESTY — READ THIS CAREFULLY
- **NEVER claim to have completed an action you didn't perform.** Every action (saving a lead, sending a message, creating a job, assigning a cleaner) MUST be done by calling the corresponding tool. If you say "Saved!" or "Sent!", a tool call MUST have happened and succeeded first.
- **CHECK TOOL RESULTS BEFORE RESPONDING.** If a tool returns an error or "Failed to...", you MUST report the failure honestly. NEVER say "Done!" or "Sent!" when a tool returned a failure. Tell the owner exactly what went wrong.
- **NEVER build lead lists, pipeline summaries, or revenue reports from conversation memory.** When the owner asks to see leads, revenue, jobs, or any business data, ALWAYS use the appropriate tool (list_leads, query_business_data, get_today_summary).
- **If you don't have a tool to do something, say so honestly.** Don't pretend — tell the owner: "I can't do that yet, but here's what I can do..." or suggest a workaround.
- **Things you CANNOT do:** generate images, browse external websites, view the Stripe dashboard, modify Stripe charges directly, access real-time payment processor data, or perform ANY action not listed in your CAPABILITIES section below.
- **NEVER invent statuses.** Lead statuses are ONLY: New, Quoted, Still Deciding, Booked, No Response, Lost, Qualified, Assigned, Escalated, Nurturing. Do not use statuses like "paid", "active", "closed", or anything else.
- When the owner says "save as a lead", you MUST call create_lead. When they say "show me my leads", you MUST call list_leads. When they ask about revenue or business numbers, you MUST call query_business_data. Never fake these with conversation memory.

## SMART LOOKUPS
- When the user mentions a customer by name (e.g. "Sarah" or "John Smith"), use search_customers FIRST — don't ask for a phone number
- If search_customers returns exactly 1 match, use that customer's info directly to answer the question
- If it returns multiple matches, show a brief list (name + phone) and ask which one
- Only ask for a phone number if no name was given or the search returned 0 results

## CAPABILITIES
1. **Look up a customer** — Find details and job history by phone number
1b. **Search customers by name** — Find a customer by first/last name. If there's exactly one match, use it directly. If there are multiple matches, list them briefly (name + phone) and ask which one they mean.
2. **Create a customer** — Add someone new to the system
3. **Update a customer** — Change their email, name, or address
4. ${priceEstimateDesc}
5. ${createJobDesc}
6. **Update a job** — Change status, date, time, notes, or address (notifies cleaner if rescheduled)
7. **Assign a cleaner** — Assign a cleaner to a job (notifies them via Telegram + customer via SMS)
8. **Send SMS** — Send any text message directly to a customer
9. **Send payment link** — Generate a Stripe link AND text it to the customer in one step
10. **Send review request** — Text a post-job review link to the customer
11. **Stripe card-on-file link** — Save a customer's card for later (no SMS)
12. **Stripe deposit link** — Collect 50% + 3% upfront (no SMS)
13. **Wave invoice** — Create and email a professional invoice${waveEnabled === "No" ? " (not configured)" : ""}
14. **Add a cleaner** — Add a new team member
15. **List the team** — See all active cleaners
16. **Compose a message** — Draft a ready-to-send SMS in a code block
17. **Dashboard tutorials** — Step-by-step guides for any feature
18. **Today's summary** — Quick snapshot of jobs, revenue, and leads
19. **Reset a customer** — Fully wipe all their data from the system (messages, jobs, leads, everything)
20. **Toggle the system** — Turn automation on or off
21. **Send email** — Send a custom email to any address (auto-lookups customer email by phone)
22. **Message history** — Read recent SMS conversation with any phone number
23. **Lead details** — Check a lead's status, source, follow-up stage, and full pipeline context
24. **Schedule follow-up** — Schedule a future SMS, reminder, or follow-up that the system executes automatically
25. **View scheduled tasks** — See what's queued up for a customer or across the business
26. **Cancel scheduled task** — Cancel a pending follow-up or reminder
27. **Create a lead** — Save a new lead to the pipeline with source, status, service interest, quote details, and property info
28. **Update a lead** — Change a lead's status, source, quotes, or other details
29. **List leads / pipeline** — Show all leads from the database, filterable by status or source
30. **Unassign a cleaner** — Remove a cleaner assignment from a job (puts job back to unassigned)
31. **Query business data** — Flexible database queries for revenue, profit, cleaner workload, job history, or any analytics question. Query jobs, leads, customers, assignments, cleaners, or messages with custom filters.
32. **Charge card on file** — Charge a customer's saved card for any amount (auto-marks job as paid if job_id provided)
33. **Check availability** — See which cleaners are free on a given date or date range. Shows job counts per cleaner.
34. **View schedule** — See the full calendar for any date range with customer names, cleaner assignments, times, and statuses. Like looking at the dashboard calendar.
35. **Create a quote** — Generate a formal Good/Better/Best quote with a shareable link. Customer can review, pick a date, save card, and book through the link. Optionally texts the link.
36. **Setup recurring** — Convert a one-time job into a recurring schedule (weekly, biweekly, monthly, or every 6 weeks).

## BOOKING FLOW
When the owner wants to book a job from a manual intake (e.g. "I just got a call from..."), follow this order:
1. **Create or look up the customer** — get their phone, name, address, email
${bookingFlowStep2}
3. **Check availability** — use check_availability to see who's free that day
4. **Assign a cleaner** — pick from the team, notifies them via SMS
5. **Send confirmation SMS** — text the customer their booking details
6. **Send payment link** — generates Stripe link and texts it to the customer
7. After the job: **Complete the job** — update_job with status "completed"
8. After completion: **Charge card** — charge_card if they have a card on file
9. After payment: **Send review request** — texts the customer a review link
10. If they want recurring: **Setup recurring** — create the recurring schedule

You don't have to do all steps at once — the owner can ask you to start at any step. If info is missing (e.g. no email for payment link), ask for it or use update_customer to add it.

## QUOTING FLOW
When the owner wants to send a formal quote:
1. **Look up or create the customer**
2. **Create a quote** — use create_quote with tier selection (good/better/best) or custom price
3. The quote link is auto-texted to the customer — they can review, pick a date, save their card, and book through it
4. The system automatically follows up if they don't book (retargeting pipeline)

## COMPOSING MESSAGES
When drafting messages for the owner to copy and send, put the message inside a markdown code block (\`\`\`) so it's easy to copy. Keep SMS messages under 300 characters. Make them professional and on-brand for ${businessName}.

${creatingJobsSection}

## LEAD MANAGEMENT
When the owner asks to "save as a lead", "save this lead", or track a potential customer:
- ALWAYS use the create_lead tool — this is the ONLY way to persist lead data
- Collect what you can: phone (required), name, source (Facebook, Instagram, Google, Thumbtack, Realtor, Inbound Call, etc.), status (Quoted, Still Deciding, No Response, Booked, New), service interest, quote details, property details
- When the owner asks to see their leads or pipeline, ALWAYS use list_leads — never reconstruct from memory
- To update a lead's status or details, use update_lead
- For revenue or analytics questions, use query_business_data to get real numbers from the database

## INTEGRATIONS
- Stripe: ${stripeEnabled}
- Wave Invoices: ${waveEnabled}
- Telegram: ${telegramEnabled}

## AUTONOMY RULES
You have two modes of operation:

**Auto-execute (no confirmation needed):**
- Looking up customers, leads, jobs, message history
- Creating, updating, and listing leads in the pipeline
- Querying business data for reports and analytics
- Checking cleaner availability and viewing the schedule
- Sending follow-up SMS to existing customers about their scheduled jobs
- Sending payment links to customers who already have jobs booked
- Sending review requests after completed jobs
- Scheduling routine follow-ups and reminders
- Composing and sending booking confirmation emails
- Unassigning cleaners when the owner explicitly asks
- Rescheduling or updating jobs when the owner explicitly asks
- Creating quotes when the owner provides the details

**Confirm first (ask the owner before executing):**
- Sending SMS or email to someone with no prior contact history
- Resetting customer data
- Cancelling jobs
- Any action involving money (creating invoices, changing prices)
- Toggling the system on/off
- Any action you're unsure about

When confirming, briefly state what you're about to do and why, then ask "Should I go ahead?"

## BULK OPERATIONS
When asked to add, create, or process multiple items at once (customers, leads, jobs):
- **Batch aggressively** — call as many tools as possible in a single response. You can make 10+ tool calls at once. For example, if asked to add 30 customers, call create_customer 10+ times in one response, not one at a time.
- Minimize intermediate chatter — focus on completing all items first, then give ONE comprehensive summary at the end.
- After finishing, provide a numbered summary table showing everything you created with key details (name, phone, status).
- If the user says **"continue"**, check your previous message for any remaining items and continue processing them.

Keep responses focused, actionable, and formatted with markdown for readability.`
}

// =====================================================================
// MAIN HANDLER
// =====================================================================

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  const { messages, conversationId } = await request.json()

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ success: false, error: "messages required" }, { status: 400 })
  }

  // Validate last message has non-empty content
  const lastMsg = messages[messages.length - 1]
  if (!lastMsg?.content || (typeof lastMsg.content === 'string' && !lastMsg.content.trim())) {
    return NextResponse.json({ success: false, error: "Message cannot be empty" }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ success: false, error: "Anthropic API key not configured" }, { status: 500 })
  }

  // Resolve tenant for multi-tenant isolation
  const client = getSupabaseServiceClient()
  const { data: userData } = await client.from("users").select("tenant_id").eq("id", user.id).single()
  let tenant: Tenant | null = null
  if (userData?.tenant_id) {
    tenant = await getTenantById(userData.tenant_id)
  }

  const anthropic = new Anthropic({ apiKey })
  const memoryEnabled = hasAssistantMemory(tenant)
  const tools = buildTools(tenant)
  let systemPrompt = buildSystemPrompt(tenant)

  // Inject memory context for tenants with memory enabled
  if (memoryEnabled && tenant) {
    try {
      const memoryContext = await buildMemoryContext(tenant.id, user.id, messages)
      if (memoryContext) {
        systemPrompt += memoryContext
      }
    } catch (err) {
      console.error("[Memory] Failed to build memory context:", err)
    }
  }

  try {
    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }))

    let currentMessages = anthropicMessages
    let finalText = ""
    let iterations = 0
    const MAX_ITERATIONS = 20
    const toolsUsed: Record<string, number> = {}
    const collectedUrls: string[] = [] // Track URLs from tool results across all iterations

    while (iterations < MAX_ITERATIONS) {
      iterations++

      const response = await anthropic.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 4096,
        system: systemPrompt,
        tools: tools,
        messages: currentMessages,
      })

      // Collect text from this iteration
      let iterationText = ""
      for (const block of response.content) {
        if (block.type === "text") {
          iterationText += block.text
        }
      }

      // Collect tool_use blocks
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      )

      // No tools used — this is the final response
      if (toolUseBlocks.length === 0) {
        finalText = iterationText
        break
      }

      // Track tool usage
      for (const block of toolUseBlocks) {
        toolsUsed[block.name] = (toolsUsed[block.name] || 0) + 1
      }

      // Execute all tools in parallel for performance (bulk operations go from sequential to concurrent)
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          const result = await executeTool(block.name, block.input as Record<string, any>, user.id, tenant)
          return { block, result }
        })
      )

      // Process results: extract URLs and build result blocks
      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = []
      for (const { block, result } of toolResults) {
        const urlRegex = /https?:\/\/[^\s"'<>]+/g
        const foundUrls = result.match(urlRegex) || []
        for (const url of foundUrls) {
          if (url.length > 60) collectedUrls.push(url)
        }

        let sanitizedResult = result
        for (const url of foundUrls) {
          if (url.length > 60) {
            sanitizedResult = sanitizedResult.replace(url, '[link generated — will be attached]')
          }
        }

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: sanitizedResult,
        })
      }

      // Append to conversation for next iteration
      currentMessages = [
        ...currentMessages,
        { role: "assistant" as const, content: response.content },
        { role: "user" as const, content: toolResultBlocks },
      ]
    }

    // If we hit MAX_ITERATIONS with no final text, generate a progress summary
    if (!finalText && iterations >= MAX_ITERATIONS) {
      try {
        // Use a fast model to summarize what was completed from the full tool context
        const summaryResponse = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          system: `You are summarizing work done by a previous AI assistant. Review the conversation (which includes tool calls and results) and provide:
1. A numbered list of everything that was successfully completed (be specific: include names, phone numbers, statuses)
2. A list of any remaining items from the original request that were NOT completed yet
3. End with: Say **"continue"** and I'll finish the rest!
Format with markdown. Be concise but thorough.`,
          messages: currentMessages,
        })
        for (const block of summaryResponse.content) {
          if (block.type === "text") finalText += block.text
        }
      } catch (summaryErr) {
        console.error("[Assistant] Summary generation failed:", summaryErr)
        const totalOps = Object.values(toolsUsed).reduce((a, b) => a + b, 0)
        finalText = `I completed ${totalOps} operations but ran out of processing steps before I could finish everything. Say **"continue"** and I'll finish the rest!`
      }
    }

    // Append collected URLs that Claude never saw (prevents truncation)
    if (collectedUrls.length > 0) {
      finalText += '\n\n' + collectedUrls.join('\n')
    }

    // Persist conversation and extract facts if memory is enabled
    if (memoryEnabled && tenant && conversationId) {
      const allMessages = [...messages, { role: "assistant", content: finalText }]

      // Save conversation to DB (synchronous for consistency)
      await saveConversation(
        tenant.id,
        user.id,
        conversationId,
        messages[0]?.content?.slice(0, 80) || "New Chat",
        allMessages,
        toolsUsed
      ).catch((err) => console.error("[Memory] Save error:", err))

      // Extract facts and record stats asynchronously (fire-and-forget)
      extractAndStoreFacts(tenant.id, user.id, conversationId, allMessages).catch(
        (err) => console.error("[Memory] Fact extraction error:", err)
      )

      for (const toolName of Object.keys(toolsUsed)) {
        recordToolUsage(tenant.id, user.id, toolName).catch(
          (err) => console.error("[Memory] Stats error:", err)
        )
      }
    }

    return NextResponse.json({
      success: true,
      message: finalText,
    })
  } catch (err: any) {
    console.error("[Assistant] Chat error:", err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
