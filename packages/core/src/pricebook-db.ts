/**
 * Server-side DB loaders for WinBros pricebook data.
 *
 * Separated from pricebook.ts because that file is imported client-side
 * (jobs/page.tsx uses WINBROS_CALENDAR_ADDONS), and importing supabase
 * chains to async_hooks which breaks the browser build.
 */

import { getSupabaseClient } from './supabase'
import { WINDOW_TIERS, FLAT_SERVICES, type WindowTier, type FlatService } from './pricebook'

/**
 * Load window tiers from tenant workflow_config. Falls back to hardcoded WINDOW_TIERS.
 */
export async function getWindowTiersFromDB(tenantId: string): Promise<WindowTier[]> {
  try {
    const client = getSupabaseClient()
    const { data, error } = await client
      .from('tenants')
      .select('workflow_config')
      .eq('id', tenantId)
      .single()

    if (error || !data) return WINDOW_TIERS

    const wc = (data.workflow_config || {}) as Record<string, unknown>
    const stored = wc.window_tiers as WindowTier[] | undefined
    if (!stored || !Array.isArray(stored) || stored.length === 0) return WINDOW_TIERS

    return stored
  } catch {
    return WINDOW_TIERS
  }
}

/**
 * Load flat services from tenant workflow_config. Falls back to hardcoded FLAT_SERVICES.
 */
export async function getFlatServicesFromDB(tenantId: string): Promise<FlatService[]> {
  try {
    const client = getSupabaseClient()
    const { data, error } = await client
      .from('tenants')
      .select('workflow_config')
      .eq('id', tenantId)
      .single()

    if (error || !data) return FLAT_SERVICES

    const wc = (data.workflow_config || {}) as Record<string, unknown>
    const stored = wc.flat_services as FlatService[] | undefined
    if (!stored || !Array.isArray(stored) || stored.length === 0) return FLAT_SERVICES

    return stored
  } catch {
    return FLAT_SERVICES
  }
}