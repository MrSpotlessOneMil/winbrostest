/**
 * Director Agent — autonomous SMS-driven ads manager for Dominic.
 *
 * Dominic texts his own business number. The OpenPhone webhook
 * identifies his number (owner_phone, god mode) and routes here
 * instead of the normal customer AI responder.
 *
 * The agent parses intent via Claude, calls tools against the Meta
 * Graph API, and replies via SMS. Supports multi-turn via
 * conversation_history from the messages table.
 *
 * Scope is intentionally narrow: ads status, pause, scale, lead
 * summary. It will NOT launch campaigns or spend net-new money —
 * that still requires Dominic's explicit approval flow.
 */

import Anthropic from '@anthropic-ai/sdk'
import { getSupabaseServiceClient } from './supabase'
import { sendSMS } from './openphone'
import type { Tenant } from './tenant'

const META = 'https://graph.facebook.com/v21.0'
const AD_ACCOUNT = 'act_2746942098983588'

interface ToolResult {
  ok: boolean
  summary: string
  data?: unknown
}

async function metaGet(path: string, params: Record<string, string>, token: string): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const url = new URL(`${META}/${path}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const r = await fetch(url.toString())
  const json = await r.json()
  return { ok: r.ok, json }
}
async function metaPost(path: string, fields: Record<string, string>, token: string): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const body = new URLSearchParams({ access_token: token, ...fields })
  const r = await fetch(`${META}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
  const json = await r.json()
  return { ok: r.ok, json }
}

async function getMetaToken(tenant: Tenant): Promise<string | null> {
  const wc = (tenant.workflow_config || {}) as Record<string, unknown>
  const t = wc.meta_ads_access_token
  if (typeof t === 'string' && t.trim()) return t.trim()
  return process.env.META_ACCESS_TOKEN || null
}

async function toolGetStatus(tenant: Tenant): Promise<ToolResult> {
  const token = await getMetaToken(tenant)
  if (!token) return { ok: false, summary: 'No Meta token configured.' }
  const sb = getSupabaseServiceClient()

  const [insights, campaigns, leadsToday] = await Promise.all([
    metaGet(`${AD_ACCOUNT}/insights`, {
      level: 'campaign',
      date_preset: 'today',
      fields: 'campaign_name,spend,impressions,clicks,actions',
      limit: '25',
    }, token),
    metaGet(`${AD_ACCOUNT}/campaigns`, {
      fields: 'id,name,status,daily_budget',
      effective_status: JSON.stringify(['ACTIVE']),
      limit: '25',
    }, token),
    sb.from('leads').select('id').eq('tenant_id', tenant.id).gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
  ])

  const countLeads = (a: Array<{ action_type: string; value: string }> | undefined) =>
    (a || []).filter((x) => ['lead', 'onsite_web_lead', 'on_facebook_leads', 'offsite_conversion.fb_pixel_lead'].includes(x.action_type))
      .reduce((s, x) => s + parseInt(x.value || '0', 10), 0)

  const today = (insights.json.data as Array<Record<string, unknown>> | undefined) || []
  const active = ((campaigns.json.data as Array<{ status: string; name: string; daily_budget?: string }> | undefined) || []).filter((c) => c.status === 'ACTIVE')
  const totalSpend = today.reduce((s, c) => s + parseFloat((c.spend as string) || '0'), 0)
  const totalLeads = today.reduce((s, c) => s + countLeads(c.actions as Array<{ action_type: string; value: string }>), 0)

  const lines = [
    `Today: $${totalSpend.toFixed(2)} / ${totalLeads} leads`,
    `CRM leads 24h: ${(leadsToday.data || []).length}`,
    `Active: ${active.length} campaigns`,
    ...active.slice(0, 6).map((c) => {
      const insight = today.find((x) => x.campaign_name === c.name)
      const spend = insight ? parseFloat((insight.spend as string) || '0') : 0
      const leads = insight ? countLeads(insight.actions as Array<{ action_type: string; value: string }>) : 0
      const budget = parseInt(c.daily_budget || '0', 10) / 100
      return `- ${c.name} [$${budget}/d] $${spend.toFixed(2)} today, ${leads} lead${leads === 1 ? '' : 's'}`
    }),
  ]
  return { ok: true, summary: lines.join('\n') }
}

async function fuzzyFindCampaign(tenant: Tenant, query: string): Promise<{ id: string; name: string; daily_budget?: string } | null> {
  const token = await getMetaToken(tenant)
  if (!token) return null
  const r = await metaGet(`${AD_ACCOUNT}/campaigns`, {
    fields: 'id,name,status,daily_budget',
    limit: '50',
  }, token)
  const all = (r.json.data as Array<{ id: string; name: string; daily_budget?: string; status: string }> | undefined) || []
  const q = query.toLowerCase().trim()
  return (
    all.find((c) => c.name.toLowerCase() === q) ||
    all.find((c) => c.name.toLowerCase().includes(q)) ||
    all.find((c) => q.split(/\s+/).every((w) => c.name.toLowerCase().includes(w))) ||
    null
  )
}

async function toolPauseCampaign(tenant: Tenant, query: string): Promise<ToolResult> {
  const token = await getMetaToken(tenant)
  if (!token) return { ok: false, summary: 'No token.' }
  const camp = await fuzzyFindCampaign(tenant, query)
  if (!camp) return { ok: false, summary: `No campaign matched "${query}".` }
  const r = await metaPost(camp.id, { status: 'PAUSED' }, token)
  if (!r.ok) return { ok: false, summary: `Meta rejected pause: ${JSON.stringify(r.json).slice(0, 120)}` }
  return { ok: true, summary: `Paused "${camp.name}".`, data: { id: camp.id } }
}

async function toolResumeCampaign(tenant: Tenant, query: string): Promise<ToolResult> {
  const token = await getMetaToken(tenant)
  if (!token) return { ok: false, summary: 'No token.' }
  const camp = await fuzzyFindCampaign(tenant, query)
  if (!camp) return { ok: false, summary: `No campaign matched "${query}".` }
  const r = await metaPost(camp.id, { status: 'ACTIVE' }, token)
  if (!r.ok) return { ok: false, summary: `Meta rejected resume: ${JSON.stringify(r.json).slice(0, 120)}` }
  return { ok: true, summary: `Resumed "${camp.name}".`, data: { id: camp.id } }
}

async function toolScaleCampaign(tenant: Tenant, query: string, newDailyDollars: number): Promise<ToolResult> {
  if (!newDailyDollars || newDailyDollars < 1 || newDailyDollars > 500) {
    return { ok: false, summary: `Budget $${newDailyDollars}/day out of safe range [$1, $500].` }
  }
  const token = await getMetaToken(tenant)
  if (!token) return { ok: false, summary: 'No token.' }
  const camp = await fuzzyFindCampaign(tenant, query)
  if (!camp) return { ok: false, summary: `No campaign matched "${query}".` }
  const cents = String(Math.round(newDailyDollars * 100))
  const r = await metaPost(camp.id, { daily_budget: cents }, token)
  if (!r.ok) return { ok: false, summary: `Meta rejected budget change: ${JSON.stringify(r.json).slice(0, 120)}` }
  return { ok: true, summary: `Set "${camp.name}" to $${newDailyDollars}/day.`, data: { id: camp.id, dollars: newDailyDollars } }
}

async function toolRecentLeads(tenant: Tenant): Promise<ToolResult> {
  const sb = getSupabaseServiceClient()
  const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
  const { data } = await sb
    .from('leads')
    .select('first_name,last_name,phone_number,source,status,created_at')
    .eq('tenant_id', tenant.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(12)
  const rows = (data || []).map((l) => {
    const name = `${l.first_name || ''} ${l.last_name || ''}`.trim() || 'Unknown'
    const when = new Date(l.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    return `- ${name} (${l.source || '?'}) [${l.status}] ${when}`
  })
  return { ok: true, summary: rows.length ? `${rows.length} leads 48h:\n${rows.join('\n')}` : 'No leads in last 48h.' }
}

const TOOL_SCHEMAS = [
  {
    name: 'get_status',
    description: 'Get the live ads + leads status. Use this when Dominic asks how things are going, what leads we got, current spend, etc.',
    input_schema: { type: 'object', properties: {}, required: [] } as const,
  },
  {
    name: 'pause_campaign',
    description: 'Pause a Spotless ad campaign by name or partial name. Use when Dominic says "pause X", "kill X", "stop X".',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Campaign name or keyword (e.g. "airbnb", "commercial")' } }, required: ['query'] } as const,
  },
  {
    name: 'resume_campaign',
    description: 'Resume/unpause a Spotless ad campaign by name. Use when Dominic says "turn on X", "resume X", "unpause X".',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } as const,
  },
  {
    name: 'scale_campaign',
    description: 'Set a new daily budget (in dollars) for a Spotless ad campaign. Safe range $1-$500. Use for "bump X to $Y/day" or "set X at $Y".',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, daily_dollars: { type: 'number' } }, required: ['query', 'daily_dollars'] } as const,
  },
  {
    name: 'recent_leads',
    description: 'Show leads from the last 48 hours across all sources. Use when Dominic asks "who reached out", "any new leads", etc.',
    input_schema: { type: 'object', properties: {}, required: [] } as const,
  },
] as const

async function executeTool(name: string, input: Record<string, unknown>, tenant: Tenant): Promise<ToolResult> {
  switch (name) {
    case 'get_status': return toolGetStatus(tenant)
    case 'pause_campaign': return toolPauseCampaign(tenant, String(input.query || ''))
    case 'resume_campaign': return toolResumeCampaign(tenant, String(input.query || ''))
    case 'scale_campaign': return toolScaleCampaign(tenant, String(input.query || ''), Number(input.daily_dollars || 0))
    case 'recent_leads': return toolRecentLeads(tenant)
    default: return { ok: false, summary: `Unknown tool: ${name}` }
  }
}

const SYSTEM_PROMPT = `You are Dominic Lutz's personal ads director for Spotless Scrubbers (LA house cleaning company). Dominic owns the business. He is texting YOU from his personal phone.

Style: casual, zero fluff, like a trusted colleague who respects his time. Short SMS-length replies. No emojis unless he uses them first. No "I hope this helps" or similar filler.

Capabilities (via tools): check live ads performance, pause campaigns, resume campaigns, set new daily budgets ($1-$500), look up recent leads.

Rules:
- When in doubt, call get_status and report back with the answer.
- If he asks to pause/resume/scale, call the tool — don't ask for confirmation. He already authorized you.
- If he asks something you can't do (launch a new campaign, change targeting, contact a specific customer), tell him plainly you'll need to escalate.
- Never invent data. If a tool failed, say so briefly.
- If he says "thanks", "k", "ok", just acknowledge with one word. Don't loop.`

export async function handleDirectorMessage(
  tenant: Tenant,
  messageText: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
): Promise<{ reply: string; toolsUsed: string[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { reply: "Director AI offline (no API key). Tell Claude Code to fix this.", toolsUsed: [] }
  }

  const client = new Anthropic({ apiKey })

  const messages: Array<Anthropic.Messages.MessageParam> = [
    ...conversationHistory.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: messageText },
  ]

  const toolsUsed: string[] = []

  const cachedTools = (TOOL_SCHEMAS as unknown as Anthropic.Messages.Tool[]).map((t, i, arr) =>
    i === arr.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t
  )

  for (let turn = 0; turn < 4; turn++) {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 600,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: cachedTools,
      messages,
    })

    const toolUses = resp.content.filter((b) => b.type === 'tool_use') as Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>
    const textBlocks = resp.content.filter((b) => b.type === 'text') as Array<{ type: 'text'; text: string }>

    if (toolUses.length === 0) {
      const reply = textBlocks.map((b) => b.text).join('\n').trim() || 'On it.'
      return { reply, toolsUsed }
    }

    messages.push({ role: 'assistant', content: resp.content })
    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
    for (const tu of toolUses) {
      toolsUsed.push(tu.name)
      const result = await executeTool(tu.name, tu.input, tenant)
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result.summary })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  return { reply: 'Hit my turn limit thinking about that. Try rephrasing.', toolsUsed }
}

export async function handleDirectorSMS(tenant: Tenant, senderPhone: string, messageText: string, opMessageId?: string | null): Promise<void> {
  const sb = getSupabaseServiceClient()

  await sb.from('messages').insert({
    tenant_id: tenant.id,
    phone_number: senderPhone,
    role: 'client',
    content: messageText,
    direction: 'inbound',
    message_type: 'sms',
    ai_generated: false,
    timestamp: new Date().toISOString(),
    source: 'director_agent',
    external_message_id: opMessageId || null,
    metadata: { director: true },
  })

  const { data: prior } = await sb
    .from('messages')
    .select('role,content,timestamp')
    .eq('tenant_id', tenant.id)
    .eq('phone_number', senderPhone)
    .eq('source', 'director_agent')
    .order('timestamp', { ascending: false })
    .limit(10)

  const history = ((prior || []).reverse()).slice(0, -1).map((m) => ({
    role: m.role === 'client' ? 'user' as const : 'assistant' as const,
    content: m.content || '',
  }))

  let reply = 'On it.'
  let toolsUsed: string[] = []
  try {
    const out = await handleDirectorMessage(tenant, messageText, history)
    reply = out.reply
    toolsUsed = out.toolsUsed
  } catch (err) {
    console.error('[DirectorAgent] error:', err)
    reply = `Director crashed: ${err instanceof Error ? err.message : 'unknown'}`
  }

  await sendSMS(tenant, senderPhone, reply, { source: 'director_agent', bypassFilters: true, skipThrottle: true })

  await sb.from('messages').insert({
    tenant_id: tenant.id,
    phone_number: senderPhone,
    role: 'assistant',
    content: reply,
    direction: 'outbound',
    message_type: 'sms',
    ai_generated: true,
    timestamp: new Date().toISOString(),
    source: 'director_agent',
    metadata: { tools_used: toolsUsed },
  })
}
