import type { MetadataRoute } from "next"

// Explicitly welcome every major AI / LLM search crawler so Spotless can be READ and
// CITED by ChatGPT, Gemini, Perplexity, Copilot, Claude, Google AI Overviews, Apple &
// Meta AI. ("*" already allows all, but naming them signals intent and covers crawlers
// that check for a specific user-agent rule — e.g. Google-Extended, which controls
// whether Google may use the content for Gemini / AI Overviews grounding.)
const AI_CRAWLERS = [
  "GPTBot", // OpenAI training
  "OAI-SearchBot", // ChatGPT search
  "ChatGPT-User", // ChatGPT live browsing
  "Google-Extended", // Gemini / Google AI Overviews grounding
  "Googlebot", // Google search + AI Overviews
  "Bingbot", // Bing + Microsoft Copilot
  "PerplexityBot", // Perplexity index
  "Perplexity-User", // Perplexity live fetch
  "ClaudeBot", // Anthropic training
  "anthropic-ai", // Anthropic
  "Claude-Web", // Claude live browsing
  "Applebot", // Apple / Siri
  "Applebot-Extended", // Apple Intelligence
  "Amazonbot", // Amazon / Alexa
  "Meta-ExternalAgent", // Meta AI
  "FacebookBot", // Meta
  "cohere-ai", // Cohere
  "CCBot", // Common Crawl (feeds many LLMs)
  "DuckAssistBot", // DuckDuckGo AI
  "YouBot", // You.com
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/" })),
    ],
    sitemap: "https://spotlessscrubbers.org/sitemap.xml",
    host: "https://spotlessscrubbers.org",
  }
}
