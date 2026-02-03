import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Parse form_data field from database.
 * Handles both cases: when it's already an object OR when it's a JSON string.
 * This is needed because some database entries have form_data stored as a string.
 */
export function parseFormData(formData: unknown): Record<string, unknown> {
  if (!formData) return {}

  // If it's already an object, return it
  if (typeof formData === 'object' && formData !== null) {
    return formData as Record<string, unknown>
  }

  // If it's a string, try to parse it
  if (typeof formData === 'string') {
    try {
      const parsed = JSON.parse(formData)
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Record<string, unknown>
      }
    } catch (e) {
      // Invalid JSON string, return empty object
      console.warn('[parseFormData] Failed to parse form_data string:', formData)
    }
  }

  return {}
}
