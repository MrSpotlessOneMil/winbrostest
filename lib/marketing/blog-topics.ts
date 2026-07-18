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
  // --- GEO cost guides (answer-first, table-friendly: the formats AI engines cite most) ---
  {
    keyword: "house cleaning cost santa monica",
    topic: "How much house cleaning costs in Santa Monica in 2026, with a clear price table by home size and service type",
    category: "Pricing",
  },
  {
    keyword: "house cleaning cost beverly hills",
    topic: "What house cleaning really costs in Beverly Hills, and what premium estates should expect to pay",
    category: "Pricing",
  },
  {
    keyword: "deep cleaning cost los angeles",
    topic: "Deep cleaning prices in LA explained: what is included, what is an add-on, and the real cost ranges",
    category: "Pricing",
  },
  {
    keyword: "move out cleaning cost los angeles",
    topic: "Move-out cleaning cost in LA and whether it actually gets your security deposit back",
    category: "Pricing",
  },
  {
    keyword: "airbnb cleaning fee los angeles",
    topic: "What to charge for Airbnb cleaning in LA: setting a turnover fee that covers a same-day reset",
    category: "Airbnb Hosting",
  },
  // --- Comparison / 'best' (high AI-citation formats) ---
  {
    keyword: "deep cleaning vs standard cleaning difference",
    topic: "Deep clean vs standard clean: the real difference, when you need each, and the price gap",
    category: "Comparisons",
  },
  {
    keyword: "recurring vs one time cleaning los angeles",
    topic: "Recurring vs one-time cleaning in LA: which actually saves you money over a year",
    category: "Comparisons",
  },
  {
    keyword: "solo cleaner vs cleaning company los angeles",
    topic: "Hiring a solo cleaner vs a professional team in LA: trust, reliability, and the trade-offs",
    category: "Comparisons",
  },
  // --- Westside city + service specific (hub-and-spoke to the area/service pages) ---
  {
    keyword: "move out cleaning culver city deposit",
    topic: "The Culver City move-out cleaning checklist that protects your deposit",
    category: "Home Care",
  },
  {
    keyword: "airbnb turnover cleaning venice",
    topic: "Same-day Airbnb turnover cleaning for Venice hosts, and why the turnover clean drives your reviews",
    category: "Airbnb Hosting",
  },
  {
    keyword: "house cleaning brentwood estate",
    topic: "What estate-level house cleaning looks like in Brentwood and Bel Air",
    category: "LA Living",
  },
  {
    keyword: "listing photo cleaning los angeles realtor",
    topic: "The pre-listing clean LA real estate agents book before the photographer arrives",
    category: "Business",
  },
  {
    keyword: "post construction cleaning los angeles remodel",
    topic: "Post-renovation cleaning in LA: where construction dust hides and how pros remove it",
    category: "Home Care",
  },
  // --- Trust / guilt-unlock (humanize the crew, insured + background-checked) ---
  {
    keyword: "are house cleaners insured background checked",
    topic: "What insured and background-checked actually means when a stranger cleans your home",
    category: "Business",
  },
  {
    keyword: "tipping house cleaners los angeles etiquette",
    topic: "Tipping your house cleaner in LA: what is normal, and how to treat the crew well",
    category: "LA Living",
  },
  // --- Seasonal / local LA hooks ---
  {
    keyword: "spring deep cleaning los angeles",
    topic: "A spring deep-cleaning game plan for LA homes after pollen and Santa Ana dust season",
    category: "LA Living",
  },
  {
    keyword: "holiday house cleaning los angeles hosting",
    topic: "Getting your LA home guest-ready before holiday hosting, room by room",
    category: "Home Care",
  },
  // --- Post-construction cluster (GCs, builders, remodeling homeowners) ---
  {
    keyword: "post construction cleaning cost los angeles",
    topic: "What post-construction cleaning costs in LA in 2026, priced by square footage and phase, with a clear cost table",
    category: "Pricing",
  },
  {
    keyword: "final clean checklist general contractor",
    topic: "The final clean checklist LA general contractors run before the punch walk",
    category: "Business",
  },
  {
    keyword: "rough clean vs final clean construction",
    topic: "Rough clean vs final clean vs touch-up clean: what happens at each construction phase and who books which",
    category: "Comparisons",
  },
  {
    keyword: "drywall dust removal after renovation",
    topic: "Why drywall dust keeps coming back after a renovation, and how pros actually get rid of it",
    category: "Home Care",
  },
  // --- Commercial / facility management cluster (office, janitorial, FM buyers) ---
  {
    keyword: "commercial cleaning cost per square foot los angeles",
    topic: "Commercial cleaning cost per square foot in LA: real 2026 rates by facility type, with a pricing table",
    category: "Pricing",
  },
  {
    keyword: "janitorial services vs commercial cleaning difference",
    topic: "Janitorial services vs commercial cleaning: what each covers and which your facility needs",
    category: "Comparisons",
  },
  {
    keyword: "how to choose commercial cleaning company facility manager",
    topic: "How facility managers vet a commercial cleaning company: COI, scope, walkthroughs, and the red flags",
    category: "Business",
  },
  {
    keyword: "office cleaning checklist daily weekly monthly",
    topic: "The office cleaning checklist LA facility managers use: daily, weekly, and monthly tasks by area",
    category: "Business",
  },
  {
    keyword: "medical office cleaning standards los angeles",
    topic: "What medical and dental office cleaning requires that regular office cleaning doesn't",
    category: "Business",
  },
  {
    keyword: "gym cleaning checklist member retention",
    topic: "Gym and studio cleaning that shows up in reviews: the high-touch checklist that protects member retention",
    category: "Business",
  },
]

// ============================================================================
// TOPIC REGISTRY — maps tenant slug → topic list
// ============================================================================
const TOPIC_REGISTRY: Record<string, BlogTopic[]> = {
  winbros: WINBROS_TOPICS,
  spotless: SPOTLESS_TOPICS,
  // The live tenant row's slug is "spotless-scrubbers" (see scripts/05-add-tenant-timezone.sql);
  // without this entry the blog cron finds zero topics for the tenant and never generates.
  "spotless-scrubbers": SPOTLESS_TOPICS,
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
