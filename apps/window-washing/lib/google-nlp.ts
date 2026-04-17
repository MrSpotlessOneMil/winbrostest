/**
 * Google Cloud Natural Language API integration
 *
 * Provides real ML-powered sentiment analysis and entity extraction.
 * Used by the Osiris Brain for nightly scoring. Falls back to regex
 * sentiment if API key is not configured.
 */

const API_BASE = 'https://language.googleapis.com/v1/documents'

interface SentimentResult {
  score: number      // -1 (negative) to 1 (positive)
  magnitude: number  // 0 to inf, strength of sentiment
  label: 'positive' | 'negative' | 'neutral' | 'mixed'
}

interface Entity {
  name: string
  type: string        // PERSON, LOCATION, ADDRESS, NUMBER, etc.
  salience: number    // 0-1, importance in the text
}

interface NlpAnalysis {
  sentiment: SentimentResult
  entities: Entity[]
}

function getApiKey(): string | null {
  return process.env.GOOGLE_CLOUD_NLP_API_KEY || null
}

/**
 * Analyze sentiment of text using Google Cloud NLP.
 * Returns null if API key is not configured.
 */
export async function analyzeSentiment(text: string): Promise<SentimentResult | null> {
  const apiKey = getApiKey()
  if (!apiKey) return null
  if (!text || text.trim().length < 10) return null

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(`${API_BASE}:analyzeSentiment?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: { type: 'PLAIN_TEXT', content: text.slice(0, 5000) },
        encodingType: 'UTF8',
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) {
      console.error(`[google-nlp] Sentiment API error: ${res.status} ${res.statusText}`)
      return null
    }

    const data = await res.json()
    const score = data.documentSentiment?.score ?? 0
    const magnitude = data.documentSentiment?.magnitude ?? 0

    let label: SentimentResult['label'] = 'neutral'
    if (score > 0.25) label = 'positive'
    else if (score < -0.25) label = 'negative'
    else if (magnitude > 1.5) label = 'mixed'

    return { score, magnitude, label }
  } catch (err) {
    console.error('[google-nlp] Sentiment error:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Extract entities (addresses, names, numbers) from text using Google Cloud NLP.
 * Returns null if API key is not configured.
 */
export async function extractEntities(text: string): Promise<Entity[] | null> {
  const apiKey = getApiKey()
  if (!apiKey) return null
  if (!text || text.trim().length < 10) return null

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(`${API_BASE}:analyzeEntities?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: { type: 'PLAIN_TEXT', content: text.slice(0, 5000) },
        encodingType: 'UTF8',
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) {
      console.error(`[google-nlp] Entity API error: ${res.status} ${res.statusText}`)
      return null
    }

    const data = await res.json()
    return (data.entities || []).map((e: any) => ({
      name: e.name,
      type: e.type,
      salience: e.salience || 0,
    }))
  } catch (err) {
    console.error('[google-nlp] Entity error:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Full analysis: sentiment + entity extraction in parallel.
 * Used by the Osiris Brain for comprehensive customer scoring.
 */
export async function analyzeText(text: string): Promise<NlpAnalysis | null> {
  const apiKey = getApiKey()
  if (!apiKey) return null
  if (!text || text.trim().length < 10) return null

  const [sentiment, entities] = await Promise.all([
    analyzeSentiment(text),
    extractEntities(text),
  ])

  if (!sentiment) return null

  return {
    sentiment,
    entities: entities || [],
  }
}

/**
 * Check if Google NLP is available (API key configured).
 */
export function isNlpAvailable(): boolean {
  return !!getApiKey()
}
