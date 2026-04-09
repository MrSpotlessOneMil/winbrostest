export interface SpotlessService {
  slug: string
  title: string
  shortTitle: string
  description: string
  metaDescription: string
  features: string[]
  idealFor: string[]
  priceRange: string
  icon: string // Lucide icon name
}

export const SPOTLESS_SERVICES: SpotlessService[] = [
  {
    slug: "standard-cleaning",
    title: "Standard House Cleaning",
    shortTitle: "Standard Cleaning",
    description:
      "Our regular house cleaning service keeps your home fresh and tidy week after week. We handle dusting, vacuuming, mopping, kitchen and bathroom sanitizing, and all the details that make your space shine.",
    metaDescription:
      "Professional standard house cleaning in Los Angeles. Weekly, biweekly, or monthly plans. Insured cleaners, 5-star rated.",
    features: [
      "Dusting all surfaces and fixtures",
      "Vacuuming carpets and rugs",
      "Mopping hard floors",
      "Kitchen counters, stovetop, and sink cleaning",
      "Bathroom sanitizing (toilets, showers, sinks)",
      "Mirror and glass cleaning",
      "Trash removal and bag replacement",
      "Bed making and light tidying",
    ],
    idealFor: [
      "Busy professionals",
      "Families with children",
      "Recurring weekly or biweekly maintenance",
    ],
    priceRange: "Starting at $150",
    icon: "Sparkles",
  },
  {
    slug: "deep-cleaning",
    title: "Deep House Cleaning",
    shortTitle: "Deep Cleaning",
    description:
      "A thorough, top-to-bottom deep clean that reaches every corner. We scrub baseboards, clean inside appliances, detail grout, wash windows, and tackle built-up grime that regular cleaning misses.",
    metaDescription:
      "Professional deep cleaning in Los Angeles. Baseboards, inside appliances, grout, windows. Insured, satisfaction guaranteed.",
    features: [
      "Everything in standard cleaning, plus:",
      "Baseboard and door frame scrubbing",
      "Inside oven and microwave cleaning",
      "Inside refrigerator cleaning",
      "Window sill and track detailing",
      "Light fixture and ceiling fan dusting",
      "Cabinet exterior wiping",
      "Grout scrubbing in bathrooms",
      "Behind and under furniture cleaning",
    ],
    idealFor: [
      "First-time cleanings",
      "Seasonal deep refreshes",
      "Homes that haven't been cleaned in a while",
    ],
    priceRange: "Starting at $250",
    icon: "Search",
  },
  {
    slug: "move-in-out-cleaning",
    title: "Move-In / Move-Out Cleaning",
    shortTitle: "Move-In/Out Cleaning",
    description:
      "Get your deposit back or start fresh in your new home. Our move-in/out cleaning covers every surface, inside every cabinet, every appliance, and leaves the space spotless for the next chapter.",
    metaDescription:
      "Move-in and move-out cleaning in Los Angeles. Get your deposit back. Inside cabinets, appliances, every surface. Insured and reliable.",
    features: [
      "Complete interior deep clean",
      "Inside all cabinets and closets",
      "Inside all appliances (oven, fridge, dishwasher)",
      "Window cleaning (interior)",
      "Baseboard and trim detailing",
      "Light switch and outlet plate wiping",
      "Garage sweeping (if applicable)",
      "Final walkthrough inspection",
    ],
    idealFor: [
      "Tenants moving out (deposit recovery)",
      "New homeowners moving in",
      "Property managers between tenants",
    ],
    priceRange: "Starting at $300",
    icon: "Home",
  },
  {
    slug: "post-construction-cleaning",
    title: "Post-Construction Cleaning",
    shortTitle: "Post-Construction",
    description:
      "After renovation or construction, the dust and debris are everywhere. Our post-construction team removes construction residue, cleans surfaces, and makes your newly built or remodeled space move-in ready.",
    metaDescription:
      "Post-construction cleaning in Los Angeles. Dust removal, debris cleanup, surface detailing after renovation. Licensed, insured, thorough.",
    features: [
      "Construction dust and debris removal",
      "Drywall dust wiping on all surfaces",
      "Window and glass cleaning (sticker/tape removal)",
      "Floor scrubbing and polishing",
      "Paint splatter removal",
      "HVAC vent and register cleaning",
      "Fixture and hardware polishing",
      "Final detail inspection",
    ],
    idealFor: [
      "Home renovations and remodels",
      "New construction projects",
      "Commercial buildouts",
    ],
    priceRange: "Starting at $300",
    icon: "HardHat",
  },
  {
    slug: "commercial-cleaning",
    title: "Commercial & Office Cleaning",
    shortTitle: "Commercial Cleaning",
    description:
      "Keep your workplace professional and healthy. We clean offices, retail spaces, and commercial properties with flexible scheduling that works around your business hours.",
    metaDescription:
      "Commercial and office cleaning in Los Angeles. Flexible scheduling, professional products. Offices, retail, medical. Insured and bonded.",
    features: [
      "Desk and workstation sanitizing",
      "Common area and breakroom cleaning",
      "Restroom deep cleaning and restocking",
      "Floor vacuuming, mopping, and buffing",
      "Trash and recycling removal",
      "Window and glass partition cleaning",
      "Kitchen/breakroom appliance cleaning",
      "Reception and lobby maintenance",
    ],
    idealFor: [
      "Office buildings and coworking spaces",
      "Retail stores and showrooms",
      "Medical and dental offices",
    ],
    priceRange: "Starting at $150",
    icon: "Building2",
  },
  {
    slug: "airbnb-cleaning",
    title: "Airbnb & Short-Term Rental Cleaning",
    shortTitle: "Airbnb Cleaning",
    description:
      "Fast, reliable turnover cleaning between guests. We restock essentials, change linens, and make sure your rental is 5-star ready for every check-in. Same-day turnarounds available.",
    metaDescription:
      "Airbnb and short-term rental cleaning in Los Angeles. Fast turnover, linen change, restock. Same-day available. 5-star guest ready.",
    features: [
      "Full clean between guest stays",
      "Linen change and bed making",
      "Towel replacement and folding",
      "Kitchen deep clean (dishes, appliances, counters)",
      "Bathroom sanitizing and restocking",
      "Trash removal and supply check",
      "Welcome setup (amenities arrangement)",
      "Damage and maintenance reporting",
    ],
    idealFor: [
      "Airbnb and VRBO hosts",
      "Short-term rental property managers",
      "Vacation rental companies",
    ],
    priceRange: "Starting at $100",
    icon: "Key",
  },
]

export function getServiceBySlug(slug: string): SpotlessService | undefined {
  return SPOTLESS_SERVICES.find((s) => s.slug === slug)
}

export function getAllServiceSlugs(): string[] {
  return SPOTLESS_SERVICES.map((s) => s.slug)
}
