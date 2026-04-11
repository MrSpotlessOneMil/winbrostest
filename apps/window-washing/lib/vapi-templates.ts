import { StepResult } from "./admin-onboard"

// ---------------------------------------------------------------------------
// Template flow map — which templates to clone per flow type
// ---------------------------------------------------------------------------

type FlowType = "winbros" | "spotless" | "cedar"

interface TemplateSet {
  inbound: string   // JSON filename in lib/vapi-templates/
  outbound?: string // null = no outbound assistant for this flow
}

const TEMPLATE_FLOW_MAP: Record<FlowType, TemplateSet> = {
  winbros: {
    inbound: "winbros-inbound",
    outbound: "winbros-outbound",
  },
  spotless: {
    inbound: "house-cleaning-inbound", // V2: natural greeting, gives pricing, fewer questions
  },
  cedar: {
    inbound: "house-cleaning-inbound",
  },
}

// Fields returned by GET that must be stripped before POST
const READONLY_FIELDS = [
  "id", "orgId", "org", "createdAt", "updatedAt", "analytics",
  "squad", "squadId", "isServerUrlSecretSet",
]

// Placeholder tokens in the template system prompt
const PLACEHOLDERS = {
  BUSINESS_NAME: "{{BUSINESS_NAME}}",
  SERVICE_AREA: "{{SERVICE_AREA}}",
  SERVICE_TYPE: "{{SERVICE_TYPE}}",
  SDR_PERSONA: "{{SDR_PERSONA}}",
  OWNER_FIRST_NAME: "{{OWNER_FIRST_NAME}}",
  OWNER_PHONE: "{{OWNER_PHONE}}",
} as const

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CloneOptions {
  slug: string
  businessName: string
  serviceArea: string
  serviceType: string
  sdrPersona: string
  ownerFirstName: string
  ownerPhone: string   // E.164 format, e.g. +14246771146
  webhookUrl: string   // e.g. https://example.com/api/webhooks/vapi/my-slug
  baseUrl: string      // e.g. https://example.com
}

export interface CloneResult {
  inboundAssistantId: string
  outboundAssistantId?: string
}

/**
 * Returns which template types are available for a given flow.
 */
export function getTemplatesForFlow(flowType: string): { hasInbound: boolean; hasOutbound: boolean } {
  const templates = TEMPLATE_FLOW_MAP[flowType as FlowType]
  if (!templates) return { hasInbound: false, hasOutbound: false }
  return { hasInbound: true, hasOutbound: !!templates.outbound }
}

/**
 * Clone VAPI assistants for a tenant from static template snapshots.
 * Reads template JSON → strips read-only fields → customizes → POSTs to tenant's VAPI account.
 */
export async function cloneVapiForTenant(
  tenantApiKey: string,
  flowType: string,
  opts: CloneOptions,
): Promise<StepResult & { data: CloneResult }> {
  const templates = TEMPLATE_FLOW_MAP[flowType as FlowType]
  if (!templates) {
    return { ok: false, message: `Unknown flow type: ${flowType}`, data: { inboundAssistantId: "" } }
  }

  // Clone inbound
  const inboundTemplate = loadTemplate(templates.inbound)
  const inboundConfig = customizeAssistantConfig(
    stripReadOnlyFields(inboundTemplate),
    { ...opts, role: "inbound" },
  )
  const inboundId = await createAssistant(tenantApiKey, inboundConfig)

  // Clone outbound (if flow has one)
  let outboundId: string | undefined
  if (templates.outbound) {
    const outboundTemplate = loadTemplate(templates.outbound)
    const outboundConfig = customizeAssistantConfig(
      stripReadOnlyFields(outboundTemplate),
      { ...opts, role: "outbound" },
    )
    outboundId = await createAssistant(tenantApiKey, outboundConfig)
  }

  const result: CloneResult = { inboundAssistantId: inboundId }
  if (outboundId) result.outboundAssistantId = outboundId

  const names = [inboundId, outboundId].filter(Boolean).join(", ")
  return {
    ok: true,
    message: `Cloned ${outboundId ? 2 : 1} assistant(s): ${names}`,
    data: result,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function loadTemplate(name: string): Record<string, any> {
  // Dynamic require of static JSON snapshots
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const template = require(`./vapi-templates/${name}.json`)
  return JSON.parse(JSON.stringify(template)) // deep clone to avoid mutation
}

function stripReadOnlyFields(config: Record<string, any>): Record<string, any> {
  const cleaned = { ...config }
  for (const field of READONLY_FIELDS) {
    delete cleaned[field]
  }
  return cleaned
}

function customizeAssistantConfig(
  config: Record<string, any>,
  opts: CloneOptions & { role: "inbound" | "outbound" },
): Record<string, any> {
  // 1. Rename assistant
  config.name = `${opts.slug}-${opts.role}`

  // 2. Set webhook server URL
  config.server = { ...(config.server || {}), url: opts.webhookUrl }

  // 3. Replace placeholders in system prompt
  //    VAPI stores prompt in model.messages[0].content or model.systemMessage
  replaceInPrompt(config, opts)

  // 4. Update tool server URLs to point to correct base URL
  updateToolUrls(config, opts.baseUrl)

  return config
}

function replaceInPrompt(config: Record<string, any>, opts: CloneOptions): void {
  const replacements: Record<string, string> = {
    [PLACEHOLDERS.BUSINESS_NAME]: opts.businessName,
    [PLACEHOLDERS.SERVICE_AREA]: opts.serviceArea,
    [PLACEHOLDERS.SERVICE_TYPE]: opts.serviceType,
    [PLACEHOLDERS.SDR_PERSONA]: opts.sdrPersona,
    [PLACEHOLDERS.OWNER_FIRST_NAME]: opts.ownerFirstName,
    [PLACEHOLDERS.OWNER_PHONE]: opts.ownerPhone,
  }

  const doReplace = (text: string): string => {
    for (const [placeholder, value] of Object.entries(replacements)) {
      text = text.replaceAll(placeholder, value)
    }
    return text
  }

  // model.messages array (newer VAPI format)
  if (config.model?.messages && Array.isArray(config.model.messages)) {
    for (const msg of config.model.messages) {
      if (typeof msg.content === "string") {
        msg.content = doReplace(msg.content)
      }
    }
  }

  // firstMessage (greeting the caller hears)
  if (typeof config.firstMessage === "string") {
    config.firstMessage = doReplace(config.firstMessage)
  }

  // firstMessageMode / model.systemMessage (older VAPI format, just in case)
  if (typeof config.model?.systemMessage === "string") {
    config.model.systemMessage = doReplace(config.model.systemMessage)
  }

  // endCallMessage, voicemailMessage
  if (typeof config.endCallMessage === "string") {
    config.endCallMessage = doReplace(config.endCallMessage)
  }
  if (typeof config.voicemailMessage === "string") {
    config.voicemailMessage = doReplace(config.voicemailMessage)
  }

  // transferCall tool: replace placeholders in function schema, destinations, and messages
  // Check both top-level tools (correct location) and model.tools (legacy)
  const allToolArrays = [config.tools, config.model?.tools].filter(Array.isArray)
  for (const toolsArr of allToolArrays) {
    for (const tool of toolsArr) {
      if (tool.type === 'transferCall') {
        // Destinations
        if (Array.isArray(tool.destinations)) {
          for (const dest of tool.destinations) {
            if (typeof dest.number === "string") dest.number = doReplace(dest.number)
            if (typeof dest.message === "string") dest.message = doReplace(dest.message)
          }
        }
        // Function schema (enum values for destination parameter)
        const enumArr = tool.function?.parameters?.properties?.destination?.enum
        if (Array.isArray(enumArr)) {
          for (let i = 0; i < enumArr.length; i++) {
            if (typeof enumArr[i] === "string") enumArr[i] = doReplace(enumArr[i])
          }
        }
        // Messages
        if (Array.isArray(tool.messages)) {
          for (const msg of tool.messages) {
            if (typeof msg.content === "string") msg.content = doReplace(msg.content)
            if (Array.isArray(msg.conditions)) {
              for (const cond of msg.conditions) {
                if (typeof cond.value === "string") cond.value = doReplace(cond.value)
              }
            }
          }
        }
      }
    }
  }
}

function updateToolUrls(config: Record<string, any>, baseUrl: string): void {
  // Walk model.tools and update any server.url that looks like a known app endpoint
  const tools = config.model?.tools
  if (!Array.isArray(tools)) return

  for (const tool of tools) {
    if (tool.server?.url && typeof tool.server.url === "string") {
      // Replace the base URL portion while preserving the path
      // Template URLs look like: https://old-domain.vercel.app/api/vapi/choose-team
      try {
        const parsed = new URL(tool.server.url)
        const path = parsed.pathname + parsed.search
        tool.server.url = `${baseUrl}${path}`
      } catch {
        // Not a valid URL, leave as-is
      }
    }
  }
}

async function createAssistant(apiKey: string, config: Record<string, any>): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)

  const res = await fetch("https://api.vapi.ai/assistant", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
    signal: controller.signal,
  })
  clearTimeout(timeout)

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`VAPI create assistant failed (${res.status}): ${errText}`)
  }

  const data = await res.json()
  if (!data.id) {
    throw new Error("VAPI create assistant response missing 'id'")
  }

  return data.id
}
