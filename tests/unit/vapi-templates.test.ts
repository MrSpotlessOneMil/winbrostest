/**
 * Unit tests for VAPI template cloning system.
 * Tests template loading, placeholder replacement, read-only field stripping,
 * and the clone flow (with mocked VAPI API).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTemplatesForFlow, cloneVapiForTenant } from '@/lib/vapi-templates'

// Mock global fetch for VAPI API calls
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('getTemplatesForFlow', () => {
  it('returns inbound + outbound for winbros', () => {
    const result = getTemplatesForFlow('winbros')
    expect(result.hasInbound).toBe(true)
    expect(result.hasOutbound).toBe(true)
  })

  it('returns inbound only for spotless', () => {
    const result = getTemplatesForFlow('spotless')
    expect(result.hasInbound).toBe(true)
    expect(result.hasOutbound).toBe(false)
  })

  it('returns inbound only for cedar', () => {
    const result = getTemplatesForFlow('cedar')
    expect(result.hasInbound).toBe(true)
    expect(result.hasOutbound).toBe(false)
  })

  it('returns false for unknown flow type', () => {
    const result = getTemplatesForFlow('nonexistent')
    expect(result.hasInbound).toBe(false)
    expect(result.hasOutbound).toBe(false)
  })
})

describe('template JSON loading', () => {
  it('loads winbros-inbound template without read-only fields', () => {
    const template = require('../../lib/vapi-templates/winbros-inbound.json')
    expect(template).toBeDefined()
    expect(template.name).toContain('{{BUSINESS_NAME}}')
    expect(template.firstMessage).toContain('{{SDR_PERSONA}}')
    // Should NOT have read-only fields
    expect(template.id).toBeUndefined()
    expect(template.orgId).toBeUndefined()
    expect(template.createdAt).toBeUndefined()
    expect(template.updatedAt).toBeUndefined()
  })

  it('loads winbros-outbound template without read-only fields', () => {
    const template = require('../../lib/vapi-templates/winbros-outbound.json')
    expect(template).toBeDefined()
    expect(template.name).toContain('{{BUSINESS_NAME}}')
    expect(template.id).toBeUndefined()
    expect(template.orgId).toBeUndefined()
  })

  it('templates have no toolIds (stripped for cross-account cloning)', () => {
    const inbound = require('../../lib/vapi-templates/winbros-inbound.json')
    const outbound = require('../../lib/vapi-templates/winbros-outbound.json')
    expect(inbound.model.toolIds).toBeUndefined()
    expect(outbound.model.toolIds).toBeUndefined()
  })

  it('inbound template contains all required placeholders in system prompt', () => {
    const template = require('../../lib/vapi-templates/winbros-inbound.json')
    const systemPrompt = template.model.messages[0].content
    expect(systemPrompt).toContain('{{BUSINESS_NAME}}')
    expect(systemPrompt).toContain('{{SERVICE_AREA}}')
    expect(systemPrompt).toContain('{{SERVICE_TYPE}}')
    expect(systemPrompt).toContain('{{SDR_PERSONA}}')
  })
})

describe('cloneVapiForTenant', () => {
  const cloneOpts = {
    slug: 'test-tenant',
    businessName: 'Acme Cleaning Co',
    serviceArea: 'Denver, CO',
    serviceType: 'house cleaning',
    sdrPersona: 'Jessica',
    webhookUrl: 'https://app.example.com/api/webhooks/vapi/test-tenant',
    baseUrl: 'https://app.example.com',
  }

  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('creates inbound assistant for cedar flow (no outbound)', async () => {
    // Mock VAPI POST response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'new-inbound-id-123' }),
    })

    const result = await cloneVapiForTenant('fake-api-key', 'cedar', cloneOpts)

    expect(result.ok).toBe(true)
    expect(result.data.inboundAssistantId).toBe('new-inbound-id-123')
    expect(result.data.outboundAssistantId).toBeUndefined()

    // Verify fetch was called once (inbound only)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Verify the POST body has placeholders replaced
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.vapi.ai/assistant')
    expect(options.method).toBe('POST')

    const body = JSON.parse(options.body)
    expect(body.name).toBe('test-tenant-inbound')
    expect(body.firstMessage).toContain('Jessica')
    expect(body.firstMessage).toContain('Acme Cleaning Co')
    expect(body.firstMessage).not.toContain('{{SDR_PERSONA}}')
    expect(body.firstMessage).not.toContain('{{BUSINESS_NAME}}')
    expect(body.server.url).toBe('https://app.example.com/api/webhooks/vapi/test-tenant')

    // System prompt should have replacements
    const systemPrompt = body.model.messages[0].content
    expect(systemPrompt).toContain('Acme Cleaning Co')
    expect(systemPrompt).toContain('Denver, CO')
    expect(systemPrompt).toContain('house cleaning')
    expect(systemPrompt).toContain('Jessica')
    expect(systemPrompt).not.toContain('{{BUSINESS_NAME}}')
    expect(systemPrompt).not.toContain('{{SERVICE_AREA}}')

    // Should NOT have read-only fields
    expect(body.id).toBeUndefined()
    expect(body.orgId).toBeUndefined()
    expect(body.createdAt).toBeUndefined()
  })

  it('creates inbound + outbound for winbros flow', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'new-inbound-id' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'new-outbound-id' }),
      })

    const result = await cloneVapiForTenant('fake-api-key', 'winbros', cloneOpts)

    expect(result.ok).toBe(true)
    expect(result.data.inboundAssistantId).toBe('new-inbound-id')
    expect(result.data.outboundAssistantId).toBe('new-outbound-id')
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // Second call should be the outbound assistant
    const outboundBody = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(outboundBody.name).toBe('test-tenant-outbound')
  })

  it('returns error for unknown flow type', async () => {
    const result = await cloneVapiForTenant('fake-key', 'nonexistent', cloneOpts)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Unknown flow type')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('throws when VAPI API returns error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    })

    await expect(
      cloneVapiForTenant('bad-key', 'cedar', cloneOpts)
    ).rejects.toThrow('VAPI create assistant failed (401)')
  })

  it('throws when VAPI response missing id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ name: 'created but no id' }),
    })

    await expect(
      cloneVapiForTenant('fake-key', 'cedar', cloneOpts)
    ).rejects.toThrow("missing 'id'")
  })

  it('sets correct Authorization header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'test-id' }),
    })

    await cloneVapiForTenant('my-secret-key', 'cedar', cloneOpts)

    const headers = mockFetch.mock.calls[0][1].headers
    expect(headers.Authorization).toBe('Bearer my-secret-key')
  })

  it('replaces endCallMessage and voicemailMessage placeholders', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'test-id' }),
    })

    await cloneVapiForTenant('fake-key', 'cedar', cloneOpts)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.endCallMessage).toContain('Acme Cleaning Co')
    expect(body.endCallMessage).not.toContain('{{BUSINESS_NAME}}')
    expect(body.voicemailMessage).toContain('Jessica')
    expect(body.voicemailMessage).toContain('Acme Cleaning Co')
  })
})
