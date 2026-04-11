/**
 * Per-tenant SEO blog topics for AI-generated content.
 * Each tenant has a curated list of keywords + topic prompts.
 */

export interface BlogTopic {
  keyword: string
  topic: string
  category: string
}

// ============================================================================
// WINBROS — Window cleaning, pressure washing, gutter cleaning (LA area)
// ============================================================================
const WINBROS_TOPICS: BlogTopic[] = [
  {
    keyword: "window cleaning peoria il",
    topic: "Why professional window cleaning matters for Peoria area homeowners",
    category: "Window Cleaning",
  },
  {
    keyword: "pressure washing driveway peoria illinois",
    topic: "How pressure washing transforms your central Illinois driveway and patio",
    category: "Pressure Washing",
  },
  {
    keyword: "gutter cleaning morton il",
    topic: "Why gutter cleaning is essential before Illinois winter",
    category: "Gutter Cleaning",
  },
  {
    keyword: "hard water stains windows illinois",
    topic: "How to deal with hard water stains on your Illinois windows",
    category: "Window Cleaning",
  },
  {
    keyword: "seasonal window cleaning tips midwest",
    topic: "Seasonal window care tips for central Illinois homes",
    category: "Window Cleaning",
  },
  {
    keyword: "commercial window cleaning peoria il",
    topic: "Why your Peoria business needs professional window cleaning",
    category: "Commercial",
  },
  {
    keyword: "screen repair replacement central illinois",
    topic: "When to repair vs replace your window screens in central Illinois",
    category: "Screen Repair",
  },
  {
    keyword: "pressure washing house exterior illinois",
    topic: "How often should you pressure wash your home exterior in central Illinois",
    category: "Pressure Washing",
  },
  {
    keyword: "gutter guard installation peoria il",
    topic: "Do gutter guards actually work for Illinois homes",
    category: "Gutter Cleaning",
  },
  {
    keyword: "window cleaning frequency how often",
    topic: "How often should you get your windows professionally cleaned",
    category: "Window Cleaning",
  },
  {
    keyword: "pressure washing concrete stains",
    topic: "Removing oil stains and grime from concrete with pressure washing",
    category: "Pressure Washing",
  },
  {
    keyword: "gutter maintenance illinois winter",
    topic: "Year-round gutter maintenance for Illinois homeowners",
    category: "Gutter Cleaning",
  },
  {
    keyword: "curb appeal home value peoria bloomington",
    topic: "How exterior cleaning boosts curb appeal and home value in the Peoria-Bloomington area",
    category: "Pressure Washing",
  },
  {
    keyword: "spring cleaning windows illinois",
    topic: "Getting your windows ready after a long Illinois winter",
    category: "Window Cleaning",
  },
  {
    keyword: "commercial pressure washing storefront peoria",
    topic: "Keep your Peoria storefront looking sharp with pressure washing",
    category: "Commercial",
  },
  {
    keyword: "window cleaning after construction remodel",
    topic: "Post-construction window cleaning tips for homeowners",
    category: "Window Cleaning",
  },
  {
    keyword: "gutter cleaning prevent water damage",
    topic: "How clogged gutters cause water damage and what to do about it",
    category: "Gutter Cleaning",
  },
  {
    keyword: "hiring window cleaning company questions",
    topic: "What to ask before hiring a window cleaning company in central Illinois",
    category: "Window Cleaning",
  },
  {
    keyword: "pressure washing deck fence illinois",
    topic: "How to restore your deck and fence with pressure washing before summer",
    category: "Pressure Washing",
  },
  {
    keyword: "window cleaning bloomington normal il",
    topic: "Professional window cleaning for Bloomington-Normal homeowners",
    category: "Window Cleaning",
  },
]

// ============================================================================
// SPOTLESS SCRUBBERS — House cleaning (LA area)
// ============================================================================
const SPOTLESS_TOPICS: BlogTopic[] = [
  {
    keyword: "house cleaning tips los angeles",
    topic: "Practical house cleaning tips for LA homeowners",
    category: "Cleaning Tips",
  },
  {
    keyword: "best cleaning service los angeles",
    topic: "What to look for when hiring a cleaning service in LA",
    category: "Business",
  },
  {
    keyword: "airbnb cleaning turnover los angeles",
    topic: "How to manage Airbnb turnovers efficiently in Los Angeles",
    category: "Airbnb Hosting",
  },
  {
    keyword: "deep cleaning checklist",
    topic: "A complete deep cleaning checklist room by room",
    category: "Cleaning Tips",
  },
  {
    keyword: "move out cleaning los angeles apartment",
    topic: "How to get your full deposit back when moving out in LA",
    category: "Home Care",
  },
  {
    keyword: "commercial cleaning office los angeles",
    topic: "Why your LA office needs professional cleaning",
    category: "Business",
  },
  {
    keyword: "eco friendly cleaning products safe",
    topic: "Switching to eco-friendly cleaning products at home",
    category: "Cleaning Tips",
  },
  {
    keyword: "los angeles home maintenance tips",
    topic: "Seasonal home maintenance for LA homeowners",
    category: "LA Living",
  },
  {
    keyword: "airbnb superhost cleaning tips",
    topic: "Cleaning habits that separate Superhosts from the rest",
    category: "Airbnb Hosting",
  },
  {
    keyword: "pet friendly house cleaning",
    topic: "How to keep a clean home with dogs and cats in LA",
    category: "Cleaning Tips",
  },
  {
    keyword: "post renovation cleaning tips",
    topic: "What to do after your contractor finishes a renovation",
    category: "Home Care",
  },
  {
    keyword: "kitchen deep clean guide",
    topic: "How to deep clean your kitchen like a professional",
    category: "Cleaning Tips",
  },
  {
    keyword: "hiring cleaning service questions",
    topic: "10 questions to ask before hiring a cleaning company",
    category: "Business",
  },
  {
    keyword: "bathroom cleaning hacks",
    topic: "Bathroom cleaning tips that actually work",
    category: "Cleaning Tips",
  },
  {
    keyword: "la living apartment cleaning hacks",
    topic: "Small apartment cleaning hacks for LA renters",
    category: "LA Living",
  },
  {
    keyword: "vacation rental cleaning checklist california",
    topic: "The ultimate vacation rental cleaning checklist",
    category: "Airbnb Hosting",
  },
  {
    keyword: "how often should you deep clean",
    topic: "How often your home really needs a deep clean",
    category: "Home Care",
  },
  {
    keyword: "santa ana winds dust cleaning",
    topic: "Dealing with dust during Santa Ana wind season in LA",
    category: "LA Living",
  },
  {
    keyword: "office cleaning schedule",
    topic: "How to set up the right cleaning schedule for your business",
    category: "Business",
  },
  {
    keyword: "new homeowner cleaning tips los angeles",
    topic: "First things to clean in your new LA home",
    category: "Home Care",
  },
]

// ============================================================================
// TOPIC REGISTRY — maps tenant slug → topic list
// ============================================================================
const TOPIC_REGISTRY: Record<string, BlogTopic[]> = {
  winbros: WINBROS_TOPICS,
  spotless: SPOTLESS_TOPICS,
}

/**
 * Get SEO topics for a tenant by slug.
 * Returns empty array if no topics configured.
 */
export function getTopicsForTenant(slug: string): BlogTopic[] {
  return TOPIC_REGISTRY[slug] ?? []
}

/**
 * Get all tenant slugs that have blog topics configured.
 */
export function getTenantSlugsWithTopics(): string[] {
  return Object.keys(TOPIC_REGISTRY)
}
