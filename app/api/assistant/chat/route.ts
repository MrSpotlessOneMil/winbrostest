import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { toE164, normalizePhone } from "@/lib/phone-utils"
import Anthropic from "@anthropic-ai/sdk"

const TOOLS: Anthropic.Tool[] = [
  {
    name: "reset_customer",
    description:
      "Reset a customer's data by phone number. Clears their texting transcript, resets lead status to 'new', and clears form data so the booking flow can start fresh.",
    input_schema: {
      type: "object" as const,
      properties: {
        phone_number: {
          type: "string",
          description: "The customer's phone number (any format, e.g. +14241234567 or 424-123-4567)",
        },
      },
      required: ["phone_number"],
    },
  },
  {
    name: "generate_stripe_link",
    description:
      "Generate a Stripe card-on-file link for a customer. Looks up the customer by phone number and creates a secure checkout session link.",
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
    name: "toggle_system",
    description:
      "Turn the entire business system on or off. When off, all automated responses, follow-ups, and SMS are paused.",
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

// Robust customer lookup - tries E164, then last-10-digit match
async function findCustomerByPhone(client: any, phone: string, select = "*") {
  const e164 = toE164(phone)

  // Try exact E164 match first
  if (e164) {
    const { data } = await client
      .from("customers")
      .select(select)
      .eq("phone_number", e164)
      .single()
    if (data) return data
  }

  // Fallback: match by last 10 digits using ilike pattern
  const digits = phone.replace(/\D/g, "")
  const last10 = digits.slice(-10)
  if (last10.length === 10) {
    const { data: matches } = await client
      .from("customers")
      .select(select)
      .like("phone_number", `%${last10}`)
    if (matches && matches.length === 1) return matches[0]
    if (matches && matches.length > 1) return matches[0] // take first match
  }

  return null
}

async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
  userId: number
): Promise<string> {
  const client = getSupabaseServiceClient()

  if (toolName === "reset_customer") {
    try {
      const phone = toolInput.phone_number as string
      console.log("[Assistant] reset_customer called with phone:", phone)

      const customer = await findCustomerByPhone(client, phone, "id, first_name, last_name, phone_number")

      if (!customer) {
        return `No customer found with phone number ${phone}. Make sure the number is correct.`
      }

      console.log("[Assistant] Found customer:", customer.id, customer.phone_number)

      // Reset customer transcript
      const { data: custData, error: custErr } = await client
        .from("customers")
        .update({
          texting_transcript: "",
          updated_at: new Date().toISOString(),
        })
        .eq("id", customer.id)
        .select("id")

      console.log("[Assistant] Customer update result:", { custData, custErr: custErr ? JSON.stringify(custErr) : null })

      if (custErr) {
        console.error("[Assistant] Customer update error:", JSON.stringify(custErr))
        // If texting_transcript column doesn't exist, try without it
        const { error: retryErr } = await client
          .from("customers")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", customer.id)
        if (retryErr) {
          return `Failed to reset customer (code: ${custErr.code}): ${custErr.message}. Details: ${custErr.details || "none"}. Hint: ${custErr.hint || "none"}`
        }
      }

      // Reset any associated leads (status and form_data live on the leads table)
      const { error: leadErr } = await client
        .from("leads")
        .update({
          status: "new",
          form_data: {},
          updated_at: new Date().toISOString(),
        })
        .eq("phone_number", customer.phone_number)

      if (leadErr) {
        console.error("[Assistant] Leads update error:", JSON.stringify(leadErr))
      }

      const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ") || customer.phone_number
      return `Done! Reset customer "${name}" (${customer.phone_number}). Their transcript is cleared, lead status is back to "new", and form data is wiped. They can go through the booking flow again from the start.`
    } catch (err: any) {
      console.error("[Assistant] reset_customer exception:", err)
      return `Error resetting customer: ${err.message}. Stack: ${err.stack?.slice(0, 200)}`
    }
  }

  if (toolName === "generate_stripe_link") {
    const phone = toolInput.phone_number as string
    const customer = await findCustomerByPhone(client, phone)

    if (!customer) {
      return `No customer found with phone number ${phone}.`
    }

    if (!customer.email) {
      return `Customer ${customer.first_name || phone} doesn't have an email on file. A Stripe card-on-file link requires an email address. Ask the customer for their email first.`
    }

    // Get latest job for this customer
    const { data: jobs } = await client
      .from("jobs")
      .select("id")
      .eq("phone_number", customer.phone_number)
      .order("created_at", { ascending: false })
      .limit(1)

    const jobId = jobs?.[0]?.id

    if (!jobId) {
      return `Customer ${customer.first_name || phone} doesn't have any jobs yet. Create a job first, then generate the link.`
    }

    try {
      const { createCardOnFileLink } = await import("@/lib/stripe-client")
      const result = await createCardOnFileLink(customer, jobId)

      if (result.success && result.url) {
        return `Here's the Stripe card-on-file link for ${customer.first_name || phone}:\n\n${result.url}\n\nYou can send this to the customer.`
      } else {
        return `Failed to generate Stripe link: ${result.error || "Unknown error"}`
      }
    } catch (err: any) {
      return `Error generating Stripe link: ${err.message}`
    }
  }

  if (toolName === "toggle_system") {
    const active = toolInput.active as boolean

    // Get user's tenant_id
    const { data: user } = await client
      .from("users")
      .select("tenant_id")
      .eq("id", userId)
      .single()

    if (!user?.tenant_id) {
      return "Could not determine your business. Your account may not be linked to a tenant."
    }

    const { data: tenant, error } = await client
      .from("tenants")
      .update({ active, updated_at: new Date().toISOString() })
      .eq("id", user.tenant_id)
      .select("name, active")
      .single()

    if (error) {
      return `Failed to update system status: ${error.message}`
    }

    return active
      ? `System is now ON for ${tenant.name}. All automated responses, follow-ups, and SMS are active.`
      : `System is now OFF for ${tenant.name}. All automated responses, follow-ups, and SMS are paused. Turn it back on when you're ready.`
  }

  return "Unknown tool"
}

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

  const anthropic = new Anthropic({ apiKey })

  const systemPrompt = `You are the Osiris Assistant, a helpful AI for managing a cleaning business dashboard. You're friendly, concise, and action-oriented.

You can help with:
1. **Reset a customer** - Clear their booking data so they can start fresh. Just ask for the phone number.
2. **Generate a Stripe link** - Create a card-on-file payment link for a customer.
3. **Toggle the system** - Turn the entire business automation system on or off.

When the user asks to do something, use the appropriate tool. Be conversational but efficient. If you need a phone number, ask for it. Confirm actions after they're done.

Keep responses short and clear. Don't over-explain.`

  try {
    // Convert messages to Anthropic format
    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }))

    // Run the conversation loop (handle tool use)
    let currentMessages = anthropicMessages
    let finalText = ""
    let iterations = 0
    const MAX_ITERATIONS = 5

    while (iterations < MAX_ITERATIONS) {
      iterations++

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        system: systemPrompt,
        tools: TOOLS,
        messages: currentMessages,
      })

      // Process response content
      let hasToolUse = false
      const toolResults: Anthropic.MessageParam[] = []

      for (const block of response.content) {
        if (block.type === "text") {
          finalText += block.text
        } else if (block.type === "tool_use") {
          hasToolUse = true
          const toolResult = await executeTool(block.name, block.input as Record<string, any>, user.id)

          // Add the assistant response and tool result to messages
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

      // Continue the loop with tool results
      currentMessages = [...currentMessages, ...toolResults]
      finalText = "" // Reset - we want the final text response
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
