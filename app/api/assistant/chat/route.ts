import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { toE164 } from "@/lib/phone-utils"
import Anthropic from "@anthropic-ai/sdk"
import { getTenantById, tenantHasIntegration, getTenantServiceDescription, type Tenant } from "@/lib/tenant"

// =====================================================================
// TOOL DEFINITIONS
// =====================================================================

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
    description:
      "Calculate a price estimate for a cleaning job based on service type, bedrooms, and bathrooms. Returns a detailed pricing breakdown.",
    input_schema: {
      type: "object" as const,
      properties: {
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
      required: ["service_type", "bedrooms", "bathrooms"],
    },
  },
  {
    name: "create_job",
    description:
      "Create a new job in the system. Automatically calculates pricing. Requires customer phone, service type, and date.",
    input_schema: {
      type: "object" as const,
      properties: {
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
      "Generate a Stripe payment link for a customer. Supports card-on-file (saves card) or deposit (collects 50% + 3% fee). Looks up the customer by phone number.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: {
          type: "string",
          description: "The customer's phone number",
        },
        link_type: {
          type: "string",
          enum: ["card_on_file", "deposit"],
          description:
            "Type of link: 'card_on_file' saves their card for later charges, 'deposit' collects 50% upfront + 3% processing fee. Default: card_on_file",
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
      "Reset a customer's data by phone number. Clears their texting transcript, resets lead status to 'new', and clears form data so the booking flow starts fresh.",
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
]

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

      const { data: jobs } = await client
        .from("jobs")
        .select("id, service_type, date, status, price, scheduled_at")
        .eq("phone_number", customer.phone_number)
        .order("created_at", { ascending: false })
        .limit(5)

      const name = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "Unknown"
      return JSON.stringify({
        name,
        phone: customer.phone_number,
        email: customer.email || "Not on file",
        address: customer.address || "Not on file",
        bedrooms: customer.bedrooms ?? "Unknown",
        bathrooms: customer.bathrooms ?? "Unknown",
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
          status: "scheduled",
          booked: true,
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

      // Get latest job
      const { data: jobs } = await client
        .from("jobs")
        .select("*")
        .eq("phone_number", customer.phone_number)
        .order("created_at", { ascending: false })
        .limit(1)

      const job = jobs?.[0]
      if (!job) {
        return `${customer.first_name || "This customer"} doesn't have any jobs yet. Would you like me to create one first?`
      }

      if (linkType === "deposit") {
        const { createDepositPaymentLink } = await import("@/lib/stripe-client")
        const result = await createDepositPaymentLink(customer, job)
        if (result.success && result.url) {
          const depositAmt = result.amount ? `$${result.amount.toFixed(2)}` : `$${(Math.round((job.price / 2) * 1.03 * 100) / 100).toFixed(2)}`
          return `Here's the deposit payment link for ${customer.first_name || phone}:\n\n${result.url}\n\nDeposit amount: ${depositAmt} (50% of $${job.price} + 3% processing fee)`
        }
        return `Failed to generate deposit link: ${result.error || "Unknown error"}`
      } else {
        const { createCardOnFileLink } = await import("@/lib/stripe-client")
        const result = await createCardOnFileLink(customer, String(job.id))
        if (result.success && result.url) {
          return `Here's the card-on-file link for ${customer.first_name || phone}:\n\n${result.url}\n\nThis saves their card for future charges — no payment is taken now.`
        }
        return `Failed to generate Stripe link: ${result.error || "Unknown error"}`
      }
    } catch (err: any) {
      return `Error generating Stripe link: ${err.message}`
    }
  }

  // ----- CREATE WAVE INVOICE -----
  if (toolName === "create_wave_invoice") {
    try {
      if (!tenant || !tenantHasIntegration(tenant, "wave")) {
        return "Wave invoicing isn't configured for your business yet. You can set it up in Settings > Integrations by adding your Wave API token and business ID."
      }

      const phone = toolInput.phone_number as string
      const customer: any = await findCustomerByPhone(client, phone, tenantId)
      if (!customer) return `No customer found with phone number ${phone}. Would you like me to create one?`
      if (!customer.email) return `${customer.first_name || "This customer"} doesn't have an email on file. An email is required to send a Wave invoice — could you share it?`

      // Get job
      let job: any
      if (toolInput.job_id) {
        const { getJobById } = await import("@/lib/supabase")
        job = await getJobById(toolInput.job_id)
      } else {
        const { data: jobs } = await client
          .from("jobs")
          .select("*")
          .eq("phone_number", customer.phone_number)
          .order("created_at", { ascending: false })
          .limit(1)
        job = jobs?.[0]
      }

      if (!job) return "No job found for this customer. Would you like me to create one first?"
      if (!job.price || job.price <= 0) return "The job doesn't have a price set yet. Let me know the service details and I'll calculate the pricing."

      const { createInvoice } = await import("@/lib/invoices")
      const result = await createInvoice(job, customer)

      if (result.success) {
        return `Wave invoice created and sent to ${customer.email}!\n- Invoice ID: ${result.invoiceId}\n- Amount: $${job.price}\n- Service: ${job.service_type || "Cleaning"}\n${result.invoiceUrl ? `- View invoice: ${result.invoiceUrl}` : ""}`
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
    const usesRouteOpt = tenant?.workflow_config?.use_route_optimization || tenant?.slug === "winbros"
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
      pricing: `TUTORIAL: **How Pricing Works**\n\nPricing is calculated based on:\n- **Service type**: Standard, Deep, or Move-in/Move-out\n- **Property size**: Bedrooms and bathrooms\n- **Add-ons**: Inside fridge, inside oven, laundry, etc.\n\nThe system auto-calculates prices during the SMS booking flow. You can also ask me for a price estimate anytime — just tell me the service type, bedrooms, and bathrooms.\n\n**Payment Options:**\n- **Card on file**: Saves the customer's card (no immediate charge)\n- **Deposit**: Collects 50% + 3% processing fee upfront\n- **Wave invoice**: Sends a professional invoice via email`,
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
      const customer: any = await findCustomerByPhone(client, phone, tenantId, "id, first_name, last_name, phone_number")

      if (!customer) {
        return `No customer found with phone number ${phone}. Double-check the number and try again!`
      }

      // Reset customer transcript
      const { error: custErr } = await client
        .from("customers")
        .update({ texting_transcript: "", updated_at: new Date().toISOString() })
        .eq("id", customer.id)

      if (custErr) {
        // Retry without texting_transcript in case column doesn't exist
        await client.from("customers").update({ updated_at: new Date().toISOString() }).eq("id", customer.id)
      }

      // Reset associated leads
      await client
        .from("leads")
        .update({ status: "new", form_data: {}, updated_at: new Date().toISOString() })
        .eq("phone_number", customer.phone_number)

      const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ") || customer.phone_number
      return `All done! Reset customer "${name}" (${customer.phone_number}). Their transcript is cleared, lead status is back to "new", and form data is wiped. They can go through the booking flow fresh.`
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

  return `Unknown tool: ${toolName}`
}

// =====================================================================
// SYSTEM PROMPT BUILDER
// =====================================================================

function buildSystemPrompt(tenant: Tenant | null): string {
  const businessName = tenant?.business_name_short || tenant?.name || "your business"
  const serviceType = tenant ? getTenantServiceDescription(tenant) : "cleaning"
  const serviceArea = tenant?.service_area || "your area"
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" })
  const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Chicago" })

  const stripeEnabled = tenant?.stripe_secret_key ? "Yes" : "No"
  const waveEnabled = tenant ? tenantHasIntegration(tenant, "wave") ? "Yes" : "No" : "No"
  const telegramEnabled = tenant?.telegram_bot_token ? "Yes" : "No"

  return `You are Osiris, the AI assistant for ${businessName} — a professional ${serviceType} business serving ${serviceArea}.

You're warm, helpful, and genuinely enthusiastic about helping run the business. You speak like a knowledgeable colleague who cares — not a robotic tool.

Today is ${dayOfWeek}, ${today}.

## PERSONALITY
- Be warm, encouraging, and professional — never curt or robotic
- When you need info (like a phone number), ask kindly: "I'd love to help with that! Could you share the customer's phone number?"
- After completing actions, give a brief, positive confirmation
- Use the customer's first name when you know it
- If something fails, be empathetic and suggest next steps
- Use markdown: **bold** for key info, bullet lists for summaries, \`code\` for links/IDs

## CAPABILITIES
1. **Look up a customer** — Find details and job history by phone number
2. **Create a customer** — Add someone new to the system
3. **Price estimate** — Calculate pricing by service type, bedrooms, bathrooms
4. **Create a job** — Set up a job with auto-pricing
5. **Stripe card-on-file link** — Save a customer's card for later
6. **Stripe deposit link** — Collect 50% + 3% upfront
7. **Wave invoice** — Create and email a professional invoice${waveEnabled === "No" ? " (not configured)" : ""}
8. **Add a cleaner** — Add a new team member
9. **List the team** — See all active cleaners
10. **Compose a message** — Draft a ready-to-send SMS in a code block
11. **Dashboard tutorials** — Step-by-step guides for any feature
12. **Today's summary** — Quick snapshot of jobs, revenue, and leads
13. **Reset a customer** — Clear booking data for a fresh start
14. **Toggle the system** — Turn automation on or off

## COMPOSING MESSAGES
When drafting messages for the owner to copy and send, put the message inside a markdown code block (\`\`\`) so it's easy to copy. Keep SMS messages under 300 characters. Make them professional and on-brand for ${businessName}.

## CREATING JOBS
- Ask for: customer phone, service type, date
- Bedrooms/bathrooms are optional but improve pricing accuracy
- Convert natural dates: "next Tuesday" = the upcoming Tuesday from today (${today}), "tomorrow" = the day after today
- The date parameter MUST be YYYY-MM-DD format

## INTEGRATIONS
- Stripe: ${stripeEnabled}
- Wave Invoices: ${waveEnabled}
- Telegram: ${telegramEnabled}

Keep responses focused, actionable, and formatted with markdown for readability.`
}

// =====================================================================
// MAIN HANDLER
// =====================================================================

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  const { messages } = await request.json()

  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ success: false, error: "messages required" }, { status: 400 })
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
  const systemPrompt = buildSystemPrompt(tenant)

  try {
    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }))

    let currentMessages = anthropicMessages
    let finalText = ""
    let iterations = 0
    const MAX_ITERATIONS = 5

    while (iterations < MAX_ITERATIONS) {
      iterations++

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 2048,
        system: systemPrompt,
        tools: TOOLS,
        messages: currentMessages,
      })

      let hasToolUse = false
      const toolResults: Anthropic.MessageParam[] = []

      for (const block of response.content) {
        if (block.type === "text") {
          finalText += block.text
        } else if (block.type === "tool_use") {
          hasToolUse = true
          const toolResult = await executeTool(block.name, block.input as Record<string, any>, user.id, tenant)

          toolResults.push({
            role: "assistant",
            content: response.content,
          })
          toolResults.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: block.id,
                content: toolResult,
              },
            ],
          })
        }
      }

      if (!hasToolUse) {
        break
      }

      currentMessages = [...currentMessages, ...toolResults]
      finalText = "" // Reset — we want the final text response after tool use
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
