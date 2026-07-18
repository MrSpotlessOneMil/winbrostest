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
      "After renovation or construction, the dust and debris are everywhere. Our post-construction crews handle rough, final, and touch-up phase cleans for general contractors, builders, and homeowners - removing construction residue, detailing every surface, and leaving the space punch-walk and move-in ready.",
    metaDescription:
      "Post-construction cleaning in Los Angeles for contractors, builders, and homeowners. Rough, final, and touch-up cleans. Drywall dust removal, sticker removal. Insured, COI available.",
    features: [
      "Rough, final, and touch-up phase cleans",
      "Construction dust and debris removal",
      "Drywall dust wiping on all surfaces",
      "Window and glass cleaning (sticker/tape removal)",
      "Floor scrubbing and polishing",
      "Paint splatter removal",
      "HVAC vent and register cleaning",
      "Punch-list detail and final walkthrough inspection",
    ],
    idealFor: [
      "General contractors and builders",
      "Home renovations and remodels",
      "Commercial buildouts and tenant improvements",
    ],
    priceRange: "Starting at $300",
    icon: "HardHat",
  },
  {
    slug: "commercial-cleaning",
    title: "Commercial & Office Cleaning",
    shortTitle: "Commercial Cleaning",
    description:
      "Keep your workplace professional and healthy. We provide recurring janitorial and office cleaning for offices, medical practices, gyms, retail, and managed facilities - nightly, weekly, or on a custom schedule, always working around your business hours. Facility and property managers get one reliable vendor, a COI on file, and a single point of contact.",
    metaDescription:
      "Commercial cleaning and janitorial services in Los Angeles. Offices, medical, gyms, retail, managed facilities. Nightly or weekly, after-hours. Insured and bonded, COI available.",
    features: [
      "Nightly, weekly, or custom janitorial schedules",
      "Desk and workstation sanitizing",
      "Common area and breakroom cleaning",
      "Restroom deep cleaning and restocking",
      "Floor vacuuming, mopping, and buffing",
      "Trash and recycling removal",
      "Window and glass partition cleaning",
      "Reception and lobby maintenance",
    ],
    idealFor: [
      "Facility and property managers",
      "Office buildings and coworking spaces",
      "Medical, dental, and fitness facilities",
    ],
    priceRange: "Starting at $150",
    icon: "Building2",
  },
  {
    slug: "hoa-community-cleaning",
    title: "HOA & Community Area Cleaning",
    shortTitle: "HOA / Community",
    description:
      "Recurring cleaning for HOA common areas, clubhouses, fitness rooms, lobbies, mailrooms, and shared amenities in condo and apartment communities. One insured vendor for the whole property, with COI and vendor-portal onboarding handled - so boards and community managers never chase a cleaner again.",
    metaDescription:
      "HOA and community association cleaning in Los Angeles. Common areas, clubhouses, lobbies, fitness rooms. Insured, COI with additional-insured endorsements, vendor-portal onboarding. Free walkthrough.",
    features: [
      "Lobby, hallway, and mailroom cleaning",
      "Clubhouse and community room upkeep",
      "Fitness room and amenity cleaning",
      "Shared restroom cleaning and restocking",
      "Elevator and stairwell detailing",
      "Trash room and common-area floor care",
      "Pool area and cabana wipe-downs (interior surfaces)",
      "COI and vendor-portal onboarding support",
    ],
    idealFor: [
      "HOA boards and community associations",
      "Community association managers",
      "Condo and apartment property managers",
    ],
    priceRange: "Starting at $200",
    icon: "Building",
  },
  {
    slug: "warehouse-industrial-cleaning",
    title: "Warehouse & Industrial Cleaning",
    shortTitle: "Warehouse / Industrial",
    description:
      "Interior cleaning for warehouses, distribution centers, 3PL operations, and manufacturing facilities. We keep the office areas, breakrooms, restrooms, and floors your team actually uses clean on overnight or weekend schedules - so operations never stop for cleaning.",
    metaDescription:
      "Warehouse and industrial cleaning in Los Angeles. Distribution centers, 3PL, manufacturing facilities. Offices, breakrooms, restrooms, floor care. Overnight schedules. Insured, COI available.",
    features: [
      "Warehouse office and admin area cleaning",
      "Breakroom and locker room cleaning",
      "Restroom deep cleaning and restocking",
      "Warehouse floor sweeping and scrubbing",
      "High-dust removal from ledges and racking (reachable areas)",
      "Trash and debris removal",
      "Entryway, lobby, and reception upkeep",
      "Overnight and weekend scheduling around operations",
    ],
    idealFor: [
      "Warehouses and distribution centers",
      "3PL and logistics operators",
      "Manufacturing and aerospace facilities",
    ],
    priceRange: "Starting at $250",
    icon: "Warehouse",
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
