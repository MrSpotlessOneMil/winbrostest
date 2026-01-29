/**
 * Weather Integration
 *
 * Fetches weather data for crew briefings and rain day detection.
 * Uses OpenWeather API.
 */

// Weather condition
export interface WeatherCondition {
  main: string
  description: string
  icon: string
}

// Daily forecast
export interface DailyForecast {
  date: string
  dayOfWeek: string
  high: number
  low: number
  humidity: number
  precipitationChance: number
  precipitationAmount: number
  windSpeed: number
  conditions: WeatherCondition
  isRainDay: boolean
  isBadWeather: boolean
  summary: string
}

// Current weather
export interface CurrentWeather {
  temperature: number
  feelsLike: number
  humidity: number
  windSpeed: number
  conditions: WeatherCondition
  visibility: number
}

// Weather response
export interface WeatherResponse {
  location: string
  current: CurrentWeather
  forecast: DailyForecast[]
  fetchedAt: string
}

// Rain day thresholds
const RAIN_THRESHOLDS = {
  precipitationChance: 50, // Percent chance that triggers rain day
  precipitationAmount: 0.1, // Inches that triggers rain day
  windSpeed: 25, // MPH that triggers bad weather
}

// OpenWeather API response types
interface OpenWeatherResponse {
  current: {
    temp: number
    feels_like: number
    humidity: number
    wind_speed: number
    visibility: number
    weather: Array<{
      main: string
      description: string
      icon: string
    }>
  }
  daily: Array<{
    dt: number
    temp: {
      min: number
      max: number
    }
    humidity: number
    wind_speed: number
    pop: number
    rain?: number
    snow?: number
    weather: Array<{
      main: string
      description: string
      icon: string
    }>
  }>
}

/**
 * Get API key
 */
function getApiKey(): string {
  const apiKey = process.env.OPENWEATHER_API_KEY
  if (!apiKey) {
    throw new Error('OPENWEATHER_API_KEY not configured')
  }
  return apiKey
}

/**
 * Convert Kelvin to Fahrenheit
 */
function kelvinToFahrenheit(kelvin: number): number {
  return Math.round(((kelvin - 273.15) * 9) / 5 + 32)
}

/**
 * Convert meters/sec to mph
 */
function metersPerSecToMph(mps: number): number {
  return Math.round(mps * 2.237)
}

/**
 * Get day of week from timestamp
 */
function getDayOfWeek(timestamp: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return days[new Date(timestamp * 1000).getDay()]
}

/**
 * Format date from timestamp
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().split('T')[0]
}

/**
 * Determine if it's a rain day
 */
function isRainDay(precipChance: number, precipAmount: number): boolean {
  return (
    precipChance >= RAIN_THRESHOLDS.precipitationChance ||
    precipAmount >= RAIN_THRESHOLDS.precipitationAmount
  )
}

/**
 * Determine if it's bad weather (rain or high wind)
 */
function isBadWeather(
  precipChance: number,
  precipAmount: number,
  windSpeed: number
): boolean {
  return (
    isRainDay(precipChance, precipAmount) ||
    windSpeed >= RAIN_THRESHOLDS.windSpeed
  )
}

/**
 * Generate weather summary for briefing
 */
function generateSummary(
  conditions: string,
  high: number,
  low: number,
  precipChance: number,
  windSpeed: number
): string {
  const parts = [`${conditions}`]

  parts.push(`High ${high}°F`)

  if (precipChance >= 30) {
    parts.push(`${precipChance}% chance of rain`)
  }

  if (windSpeed >= 15) {
    parts.push(`Wind ${windSpeed} mph`)
  }

  return parts.join(', ')
}

/**
 * Fetch weather forecast by ZIP code
 */
export async function getWeatherByZip(
  zip: string,
  days: number = 7
): Promise<WeatherResponse> {
  const apiKey = getApiKey()

  // Get coordinates from ZIP
  const geoUrl = `https://api.openweathermap.org/geo/1.0/zip?zip=${zip},US&appid=${apiKey}`
  const geoResponse = await fetch(geoUrl)

  if (!geoResponse.ok) {
    throw new Error(`Failed to geocode ZIP ${zip}: ${geoResponse.status}`)
  }

  const geoData = await geoResponse.json()
  const { lat, lon, name } = geoData

  // Fetch weather using One Call API
  const weatherUrl = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,hourly,alerts&appid=${apiKey}`
  const weatherResponse = await fetch(weatherUrl)

  if (!weatherResponse.ok) {
    throw new Error(`Failed to fetch weather: ${weatherResponse.status}`)
  }

  const data: OpenWeatherResponse = await weatherResponse.json()

  // Parse current weather
  const current: CurrentWeather = {
    temperature: kelvinToFahrenheit(data.current.temp),
    feelsLike: kelvinToFahrenheit(data.current.feels_like),
    humidity: data.current.humidity,
    windSpeed: metersPerSecToMph(data.current.wind_speed),
    conditions: {
      main: data.current.weather[0].main,
      description: data.current.weather[0].description,
      icon: data.current.weather[0].icon,
    },
    visibility: Math.round(data.current.visibility / 1609), // Convert meters to miles
  }

  // Parse daily forecast
  const forecast: DailyForecast[] = data.daily.slice(0, days).map((day) => {
    const high = kelvinToFahrenheit(day.temp.max)
    const low = kelvinToFahrenheit(day.temp.min)
    const precipChance = Math.round(day.pop * 100)
    const precipAmount = (day.rain || 0) + (day.snow || 0)
    const windSpeed = metersPerSecToMph(day.wind_speed)

    return {
      date: formatDate(day.dt),
      dayOfWeek: getDayOfWeek(day.dt),
      high,
      low,
      humidity: day.humidity,
      precipitationChance: precipChance,
      precipitationAmount: Math.round(precipAmount * 100) / 100,
      windSpeed,
      conditions: {
        main: day.weather[0].main,
        description: day.weather[0].description,
        icon: day.weather[0].icon,
      },
      isRainDay: isRainDay(precipChance, precipAmount),
      isBadWeather: isBadWeather(precipChance, precipAmount, windSpeed),
      summary: generateSummary(
        day.weather[0].description,
        high,
        low,
        precipChance,
        windSpeed
      ),
    }
  })

  return {
    location: name,
    current,
    forecast,
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * Get weather for a specific date
 */
export async function getWeatherForDate(
  zip: string,
  date: string
): Promise<DailyForecast | null> {
  const weather = await getWeatherByZip(zip, 7)

  return weather.forecast.find((day) => day.date === date) || null
}

/**
 * Check if a date is a rain day
 */
export async function checkRainDay(
  zip: string,
  date: string
): Promise<{ isRainDay: boolean; forecast?: DailyForecast }> {
  try {
    const forecast = await getWeatherForDate(zip, date)

    if (!forecast) {
      return { isRainDay: false }
    }

    return {
      isRainDay: forecast.isRainDay,
      forecast,
    }
  } catch (error) {
    console.error('[Weather] Failed to check rain day:', error)
    return { isRainDay: false }
  }
}

/**
 * Get upcoming rain days
 */
export async function getUpcomingRainDays(
  zip: string,
  days: number = 7
): Promise<DailyForecast[]> {
  try {
    const weather = await getWeatherByZip(zip, days)
    return weather.forecast.filter((day) => day.isRainDay)
  } catch (error) {
    console.error('[Weather] Failed to get rain days:', error)
    return []
  }
}

/**
 * Format weather for crew briefing message
 */
export function formatWeatherBriefing(forecast: DailyForecast): string {
  const lines = [
    `📍 Weather: ${forecast.summary}`,
  ]

  if (forecast.isRainDay) {
    lines.push(`⚠️ RAIN DAY - ${forecast.precipitationChance}% chance of rain`)
  }

  if (forecast.windSpeed >= 20) {
    lines.push(`💨 High winds expected: ${forecast.windSpeed} mph`)
  }

  return lines.join('\n')
}

/**
 * Simple weather mock for testing (when API not configured)
 */
export function getMockWeather(date: string): DailyForecast {
  return {
    date,
    dayOfWeek: new Date(date).toLocaleDateString('en-US', { weekday: 'long' }),
    high: 72,
    low: 58,
    humidity: 45,
    precipitationChance: 10,
    precipitationAmount: 0,
    windSpeed: 8,
    conditions: {
      main: 'Clear',
      description: 'clear sky',
      icon: '01d',
    },
    isRainDay: false,
    isBadWeather: false,
    summary: 'Clear sky, High 72°F',
  }
}

// Export thresholds for reference
export const WEATHER_THRESHOLDS = RAIN_THRESHOLDS
