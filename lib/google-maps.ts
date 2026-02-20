/**
 * Google Maps Platform Integration
 *
 * Provides geocoding (address → lat/lng) and distance matrix
 * (traffic-aware drive times between locations) for route optimization.
 *
 * Requires GOOGLE_MAPS_API_KEY environment variable.
 */

// ── Types ──────────────────────────────────────────────────────

export interface LatLng {
  lat: number
  lng: number
}

export interface GeocodeResult {
  lat: number
  lng: number
  formattedAddress: string
  placeId: string
}

export interface DistanceMatrixEntry {
  originIndex: number
  destinationIndex: number
  distanceMeters: number
  distanceMiles: number
  durationSeconds: number
  durationMinutes: number
  durationInTrafficSeconds?: number
  durationInTrafficMinutes?: number
}

export interface DistanceMatrixResult {
  entries: DistanceMatrixEntry[]
  origins: string[]
  destinations: string[]
}

// ── In-memory geocode cache ────────────────────────────────────

const geocodeCache = new Map<string, GeocodeResult>()

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ')
}

// ── Helpers ────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) {
    throw new Error('GOOGLE_MAPS_API_KEY not configured')
  }
  return key
}

/**
 * Haversine great-circle distance between two lat/lng points, in km.
 */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Estimate drive time in minutes using straight-line distance.
 * Assumes ~30 km/h average city speed + 5 min fixed overhead (lights, turns, etc.).
 * Used as a fallback when Google Maps is not available.
 */
function haversineMinutes(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const km = haversineKm(lat1, lng1, lat2, lng2)
  return Math.max(1, Math.round((km / 30) * 60) + 5)
}

/**
 * Geocode an address using OpenStreetMap Nominatim (free, no API key required).
 * Used as fallback when GOOGLE_MAPS_API_KEY is not configured.
 */
async function geocodeWithNominatim(address: string): Promise<GeocodeResult | null> {
  try {
    const encoded = encodeURIComponent(address)
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'WinBros-RouteOptimizer/1.0 (contact@winbros.com)',
        'Accept-Language': 'en',
      },
    })

    if (!response.ok) {
      console.error(`[Nominatim] HTTP error for "${address}": ${response.status}`)
      return null
    }

    const data = await response.json()
    if (!Array.isArray(data) || data.length === 0) {
      console.warn(`[Nominatim] No results for "${address}"`)
      return null
    }

    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      formattedAddress: data[0].display_name || address,
      placeId: String(data[0].place_id || ''),
    }
  } catch (error) {
    console.error(`[Nominatim] Error geocoding "${address}":`, error)
    return null
  }
}

function metersToMiles(meters: number): number {
  return Math.round((meters / 1609.344) * 10) / 10
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Geocoding ──────────────────────────────────────────────────

/**
 * Geocode a street address to lat/lng coordinates.
 * Tries Google Maps first (if API key is configured), then falls back to Nominatim.
 * Results are cached in-memory by normalized address.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const cacheKey = normalizeAddress(address)
  const cached = geocodeCache.get(cacheKey)
  if (cached) return cached

  const apiKey = process.env.GOOGLE_MAPS_API_KEY

  // Try Google Maps if key is available
  if (apiKey) {
    try {
      const encoded = encodeURIComponent(address)
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${apiKey}`

      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        if (data.status === 'OK' && data.results?.length) {
          const result: GeocodeResult = {
            lat: data.results[0].geometry.location.lat,
            lng: data.results[0].geometry.location.lng,
            formattedAddress: data.results[0].formatted_address,
            placeId: data.results[0].place_id,
          }
          geocodeCache.set(cacheKey, result)
          return result
        }
        console.error(`[GoogleMaps] Geocode failed for "${address}": ${data.status}`)
      } else {
        console.error(`[GoogleMaps] Geocode HTTP error: ${response.status}`)
      }
    } catch (error) {
      console.error(`[GoogleMaps] Geocode error for "${address}":`, error)
    }
  }

  // Fallback: OpenStreetMap Nominatim (free, no key required)
  if (!apiKey) {
    console.log(`[GoogleMaps] No API key — using Nominatim for "${address}"`)
  } else {
    console.log(`[GoogleMaps] Google Maps failed — using Nominatim fallback for "${address}"`)
  }

  const nominatimResult = await geocodeWithNominatim(address)
  if (nominatimResult) {
    geocodeCache.set(cacheKey, nominatimResult)
    return nominatimResult
  }

  return null
}

/**
 * Batch geocode multiple addresses.
 * Skips addresses already in cache. Returns a Map of original address → result.
 */
export async function batchGeocodeAddresses(
  addresses: string[]
): Promise<Map<string, GeocodeResult>> {
  const results = new Map<string, GeocodeResult>()
  const toGeocode: string[] = []

  // Check cache first
  for (const addr of addresses) {
    const key = normalizeAddress(addr)
    const cached = geocodeCache.get(key)
    if (cached) {
      results.set(addr, cached)
    } else if (!toGeocode.includes(addr)) {
      toGeocode.push(addr)
    }
  }

  // Geocode missing addresses with rate limit delay
  const hasGoogleKey = !!process.env.GOOGLE_MAPS_API_KEY
  for (let i = 0; i < toGeocode.length; i++) {
    const addr = toGeocode[i]
    const result = await geocodeAddress(addr)
    if (result) {
      results.set(addr, result)
    }
    // Delay between requests: Nominatim requires ≥1s, Google Maps is fine at 50ms
    if (i < toGeocode.length - 1) {
      await sleep(hasGoogleKey ? 50 : 1100)
    }
  }

  return results
}

// ── Distance Matrix ────────────────────────────────────────────

/**
 * Format a location as a string for the Distance Matrix API.
 */
function formatLocation(loc: string | LatLng): string {
  if (typeof loc === 'string') return loc
  return `${loc.lat},${loc.lng}`
}

/**
 * Get distances and durations between origins and destinations.
 * Uses traffic-aware departure time when provided.
 *
 * Note: Google Distance Matrix API allows max 25 origins or 25 destinations per request.
 */
export async function getDistanceMatrix(
  origins: Array<string | LatLng>,
  destinations: Array<string | LatLng>,
  departureTime?: Date
): Promise<DistanceMatrixResult> {
  const apiKey = getApiKey()

  const originsStr = origins.map(formatLocation).join('|')
  const destinationsStr = destinations.map(formatLocation).join('|')

  let url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(originsStr)}&destinations=${encodeURIComponent(destinationsStr)}&units=imperial&key=${apiKey}`

  // Add departure_time for traffic-aware estimates
  if (departureTime) {
    url += `&departure_time=${Math.floor(departureTime.getTime() / 1000)}`
  } else {
    // Use "now" for current traffic conditions
    url += `&departure_time=now`
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`[GoogleMaps] Distance Matrix HTTP error: ${response.status}`)
  }

  const data = await response.json()

  if (data.status !== 'OK') {
    throw new Error(`[GoogleMaps] Distance Matrix API error: ${data.status}`)
  }

  const entries: DistanceMatrixEntry[] = []

  for (let i = 0; i < data.rows.length; i++) {
    for (let j = 0; j < data.rows[i].elements.length; j++) {
      const element = data.rows[i].elements[j]

      if (element.status !== 'OK') {
        // Use a large fallback value for unreachable routes
        entries.push({
          originIndex: i,
          destinationIndex: j,
          distanceMeters: 999999,
          distanceMiles: 999,
          durationSeconds: 99999,
          durationMinutes: 999,
        })
        continue
      }

      entries.push({
        originIndex: i,
        destinationIndex: j,
        distanceMeters: element.distance.value,
        distanceMiles: metersToMiles(element.distance.value),
        durationSeconds: element.duration.value,
        durationMinutes: Math.round(element.duration.value / 60),
        durationInTrafficSeconds: element.duration_in_traffic?.value,
        durationInTrafficMinutes: element.duration_in_traffic
          ? Math.round(element.duration_in_traffic.value / 60)
          : undefined,
      })
    }
  }

  return {
    entries,
    origins: origins.map(formatLocation),
    destinations: destinations.map(formatLocation),
  }
}

/**
 * Calculate pairwise distance matrix for a set of locations.
 * Returns an NxN matrix where matrix[i][j] is the drive time in minutes from i to j.
 *
 * For sets larger than 25, batches requests to stay under API limits.
 */
export async function getPairwiseDistanceMatrix(
  locations: Array<{ id: string; address: string; lat?: number; lng?: number }>
): Promise<{
  matrix: number[][]
  locationIds: string[]
}> {
  // Geocode any locations missing coordinates
  const needsGeocode = locations.filter(l => l.lat == null || l.lng == null)
  if (needsGeocode.length > 0) {
    const geocoded = await batchGeocodeAddresses(needsGeocode.map(l => l.address))
    for (const loc of needsGeocode) {
      const result = geocoded.get(loc.address)
      if (result) {
        loc.lat = result.lat
        loc.lng = result.lng
      }
    }
  }

  // Build LatLng array (filter out locations that failed geocoding)
  const validLocations = locations.filter(l => l.lat != null && l.lng != null)
  const locationIds = validLocations.map(l => l.id)
  const n = validLocations.length

  // Initialize NxN matrix with zeros on diagonal
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0))

  if (n <= 1) return { matrix, locationIds }

  // If no Google Maps key, build matrix using Haversine straight-line distances
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn('[GoogleMaps] No API key — building distance matrix using straight-line (Haversine) estimates')
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue
        const a = validLocations[i]
        const b = validLocations[j]
        matrix[i][j] = haversineMinutes(a.lat!, a.lng!, b.lat!, b.lng!)
      }
    }
    return { matrix, locationIds }
  }

  // Batch by 25 to stay within API limits
  const BATCH_SIZE = 25

  for (let oi = 0; oi < n; oi += BATCH_SIZE) {
    const originSlice = validLocations.slice(oi, Math.min(oi + BATCH_SIZE, n))
    const originLatLngs: LatLng[] = originSlice.map(l => ({ lat: l.lat!, lng: l.lng! }))

    for (let di = 0; di < n; di += BATCH_SIZE) {
      const destSlice = validLocations.slice(di, Math.min(di + BATCH_SIZE, n))
      const destLatLngs: LatLng[] = destSlice.map(l => ({ lat: l.lat!, lng: l.lng! }))

      const result = await getDistanceMatrix(originLatLngs, destLatLngs)

      for (const entry of result.entries) {
        const row = oi + entry.originIndex
        const col = di + entry.destinationIndex
        // Prefer traffic-aware duration when available
        matrix[row][col] = entry.durationInTrafficMinutes ?? entry.durationMinutes
      }

      // Small delay between batches
      await sleep(100)
    }
  }

  return { matrix, locationIds }
}
