/**
 * Brand Detection System
 *
 * Maps phone numbers and integration IDs to brand names.
 * This allows a single deployment to serve multiple brands.
 */

import type { BrandMode } from './client-config'

interface BrandMapping {
  brand: BrandMode
  openphoneIds?: string[]  // OpenPhone phone number IDs
  vapiPhoneIds?: string[]  // VAPI phone number IDs
  ghlLocationIds?: string[] // GoHighLevel location IDs
}

/**
 * Brand mappings - configure these via environment variables
 */
function getBrandMappings(): BrandMapping[] {
  const mappings: BrandMapping[] = []

  // Spotless Scrubbers
  const spotlessOpenphone = process.env.BRAND_OPENPHONE_SPOTLESS?.split(',').map(s => s.trim()).filter(Boolean) || []
  const spotlessVapi = process.env.BRAND_VAPI_SPOTLESS?.split(',').map(s => s.trim()).filter(Boolean) || []
  const spotlessGHL = process.env.BRAND_GHL_SPOTLESS?.split(',').map(s => s.trim()).filter(Boolean) || []

  if (spotlessOpenphone.length || spotlessVapi.length || spotlessGHL.length) {
    mappings.push({
      brand: 'spotless',
      openphoneIds: spotlessOpenphone,
      vapiPhoneIds: spotlessVapi,
      ghlLocationIds: spotlessGHL,
    })
  }

  // Figueroa's Maintenance Services
  const figueroaOpenphone = process.env.BRAND_OPENPHONE_FIGUEROA?.split(',').map(s => s.trim()).filter(Boolean) || []
  const figueroaVapi = process.env.BRAND_VAPI_FIGUEROA?.split(',').map(s => s.trim()).filter(Boolean) || []
  const figueroaGHL = process.env.BRAND_GHL_FIGUEROA?.split(',').map(s => s.trim()).filter(Boolean) || []

  if (figueroaOpenphone.length || figueroaVapi.length || figueroaGHL.length) {
    mappings.push({
      brand: 'figueroa',
      openphoneIds: figueroaOpenphone,
      vapiPhoneIds: figueroaVapi,
      ghlLocationIds: figueroaGHL,
    })
  }

  // WinBros Window Cleaning
  const winbrosOpenphone = process.env.BRAND_OPENPHONE_WINBROS?.split(',').map(s => s.trim()).filter(Boolean) || []
  const winbrosVapi = process.env.BRAND_VAPI_WINBROS?.split(',').map(s => s.trim()).filter(Boolean) || []
  const winbrosGHL = process.env.BRAND_GHL_WINBROS?.split(',').map(s => s.trim()).filter(Boolean) || []

  if (winbrosOpenphone.length || winbrosVapi.length || winbrosGHL.length) {
    mappings.push({
      brand: 'winbros',
      openphoneIds: winbrosOpenphone,
      vapiPhoneIds: winbrosVapi,
      ghlLocationIds: winbrosGHL,
    })
  }

  return mappings
}

/**
 * Detect brand from OpenPhone phone number ID
 */
export function detectBrandFromOpenPhone(phoneNumberId: string): BrandMode {
  const mappings = getBrandMappings()

  for (const mapping of mappings) {
    if (mapping.openphoneIds?.includes(phoneNumberId)) {
      return mapping.brand
    }
  }

  // Fallback to environment variable or default
  return (process.env.BRAND_MODE || process.env.DEPLOYMENT_MODE || 'spotless') as BrandMode
}

/**
 * Detect brand from VAPI phone number ID
 */
export function detectBrandFromVAPI(phoneNumberId: string): BrandMode {
  const mappings = getBrandMappings()

  for (const mapping of mappings) {
    if (mapping.vapiPhoneIds?.includes(phoneNumberId)) {
      return mapping.brand
    }
  }

  // Fallback to environment variable or default
  return (process.env.BRAND_MODE || process.env.DEPLOYMENT_MODE || 'spotless') as BrandMode
}

/**
 * Detect brand from GoHighLevel location ID
 */
export function detectBrandFromGHL(locationId: string): BrandMode {
  const mappings = getBrandMappings()

  for (const mapping of mappings) {
    if (mapping.ghlLocationIds?.includes(locationId)) {
      return mapping.brand
    }
  }

  // Fallback to environment variable or default
  return (process.env.BRAND_MODE || process.env.DEPLOYMENT_MODE || 'spotless') as BrandMode
}

/**
 * Get all configured brands
 */
export function getAllConfiguredBrands(): BrandMode[] {
  const mappings = getBrandMappings()
  const brands = mappings.map(m => m.brand)

  // If no mappings configured, return default from env
  if (brands.length === 0) {
    const defaultBrand = (process.env.BRAND_MODE || process.env.DEPLOYMENT_MODE || 'spotless') as BrandMode
    return [defaultBrand]
  }

  return brands
}
