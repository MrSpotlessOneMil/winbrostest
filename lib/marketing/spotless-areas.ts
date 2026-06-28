export interface SpotlessArea {
  slug: string
  city: string
  state: string
  stateAbbr: string
  county: string
  zipCodes: string[]
  neighborhoods: string[]
  landmarks: string[]
  lat: number
  lng: number
}

export const SPOTLESS_AREAS: SpotlessArea[] = [
  {
    slug: "los-angeles",
    city: "Los Angeles",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90001", "90012", "90015", "90017", "90026", "90027", "90028", "90029", "90036", "90038"],
    neighborhoods: ["Downtown LA", "Hollywood", "Silver Lake", "Echo Park", "Koreatown", "Los Feliz"],
    landmarks: ["Hollywood Sign", "Griffith Observatory", "The Grove", "LA Live"],
    lat: 34.0522,
    lng: -118.2437,
  },
  {
    slug: "santa-monica",
    city: "Santa Monica",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90401", "90402", "90403", "90404", "90405"],
    neighborhoods: ["Ocean Park", "Montana Avenue", "Main Street", "Wilshire Montana"],
    landmarks: ["Santa Monica Pier", "Third Street Promenade", "Palisades Park"],
    lat: 34.0195,
    lng: -118.4912,
  },
  {
    slug: "beverly-hills",
    city: "Beverly Hills",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90210", "90211", "90212"],
    neighborhoods: ["The Flats", "Trousdale Estates", "Beverly Hills Gateway", "South Beverly Hills"],
    landmarks: ["Rodeo Drive", "Beverly Wilshire Hotel", "Greystone Mansion"],
    lat: 34.0736,
    lng: -118.4004,
  },
  {
    slug: "west-hollywood",
    city: "West Hollywood",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90046", "90048", "90069"],
    neighborhoods: ["Sunset Strip", "West Hollywood West", "Norma Triangle", "Beverly Grove"],
    landmarks: ["Sunset Strip", "Pacific Design Center", "The Abbey"],
    lat: 34.0900,
    lng: -118.3617,
  },
  {
    slug: "burbank",
    city: "Burbank",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["91501", "91502", "91504", "91505", "91506"],
    neighborhoods: ["Media District", "Magnolia Park", "Rancho Equestrian", "Hillside"],
    landmarks: ["Warner Bros Studio", "Disney Studios", "Burbank Town Center"],
    lat: 34.1808,
    lng: -118.3090,
  },
  {
    slug: "glendale",
    city: "Glendale",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["91201", "91202", "91203", "91204", "91205", "91206", "91208"],
    neighborhoods: ["Downtown Glendale", "Adams Hill", "Rossmoyne", "Sparr Heights", "Verdugo Woodlands"],
    landmarks: ["The Americana at Brand", "Glendale Galleria", "Forest Lawn Memorial Park"],
    lat: 34.1425,
    lng: -118.2551,
  },
  {
    slug: "pasadena",
    city: "Pasadena",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["91101", "91103", "91104", "91105", "91106", "91107"],
    neighborhoods: ["Old Town", "South Lake", "Bungalow Heaven", "Madison Heights", "Caltech area"],
    landmarks: ["Rose Bowl", "Norton Simon Museum", "Old Town Pasadena", "Caltech"],
    lat: 34.1478,
    lng: -118.1445,
  },
  {
    slug: "long-beach",
    city: "Long Beach",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90801", "90802", "90803", "90804", "90805", "90806", "90807", "90808"],
    neighborhoods: ["Belmont Shore", "Naples", "Bixby Knolls", "Downtown Long Beach", "Alamitos Heights"],
    landmarks: ["Queen Mary", "Aquarium of the Pacific", "Long Beach Convention Center"],
    lat: 33.7701,
    lng: -118.1937,
  },
  {
    slug: "torrance",
    city: "Torrance",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90501", "90502", "90503", "90504", "90505"],
    neighborhoods: ["Old Torrance", "Hollywood Riviera", "Seaside", "Walteria", "South Torrance"],
    landmarks: ["Del Amo Fashion Center", "Torrance Beach", "Madrona Marsh Preserve"],
    lat: 33.8358,
    lng: -118.3406,
  },
  {
    slug: "culver-city",
    city: "Culver City",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90230", "90231", "90232"],
    neighborhoods: ["Downtown Culver City", "Culver Crest", "Blair Hills", "Fox Hills"],
    landmarks: ["Sony Pictures Studios", "Culver City Arts District", "Baldwin Hills"],
    lat: 34.0211,
    lng: -118.3965,
  },
  {
    slug: "inglewood",
    city: "Inglewood",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90301", "90302", "90303", "90304", "90305"],
    neighborhoods: ["Downtown Inglewood", "Morningside Park", "Centinela Heights"],
    landmarks: ["SoFi Stadium", "The Forum", "Hollywood Park"],
    lat: 33.9617,
    lng: -118.3531,
  },
  {
    slug: "downey",
    city: "Downey",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90239", "90240", "90241", "90242"],
    neighborhoods: ["Downtown Downey", "North Downey", "South Downey"],
    landmarks: ["Downey Landing", "Columbia Memorial Space Center", "Stonewood Center"],
    lat: 33.9401,
    lng: -118.1332,
  },
  {
    slug: "whittier",
    city: "Whittier",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90601", "90602", "90603", "90604", "90605", "90606"],
    neighborhoods: ["Uptown Whittier", "East Whittier", "South Whittier", "Whittier Heights"],
    landmarks: ["Whittier Narrows", "Pio Pico State Historic Park", "Uptown Whittier"],
    lat: 33.9792,
    lng: -118.0328,
  },
  {
    slug: "pomona",
    city: "Pomona",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["91766", "91767", "91768"],
    neighborhoods: ["Downtown Pomona", "Phillips Ranch", "Indian Hill"],
    landmarks: ["Fairplex", "Cal Poly Pomona", "Pomona Arts Colony"],
    lat: 34.0551,
    lng: -117.7500,
  },
  {
    slug: "west-covina",
    city: "West Covina",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["91790", "91791", "91792"],
    neighborhoods: ["South Hills", "Cameron Park", "Cortez Park"],
    landmarks: ["Westfield West Covina", "Galster Wilderness Park"],
    lat: 34.0686,
    lng: -117.9390,
  },
  {
    slug: "alhambra",
    city: "Alhambra",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["91801", "91803"],
    neighborhoods: ["Downtown Alhambra", "Emery Park", "Midwick Tract", "Granada Park"],
    landmarks: ["Main Street Alhambra", "Almansor Park", "Alhambra Golf Course"],
    lat: 34.0953,
    lng: -118.1270,
  },
  {
    slug: "el-monte",
    city: "El Monte",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["91731", "91732", "91734"],
    neighborhoods: ["Downtown El Monte", "South El Monte", "Mountain View"],
    landmarks: ["El Monte Bus Station", "Whittier Narrows Recreation Area"],
    lat: 34.0686,
    lng: -118.0276,
  },
  {
    slug: "norwalk",
    city: "Norwalk",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90650", "90651"],
    neighborhoods: ["North Norwalk", "South Norwalk", "Southeast Norwalk"],
    landmarks: ["Norwalk Town Square", "Cerritos College", "Hargitt House Museum"],
    lat: 33.9022,
    lng: -118.0817,
  },
  {
    slug: "compton",
    city: "Compton",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90220", "90221", "90222"],
    neighborhoods: ["Downtown Compton", "Richland Farms", "Sunny Cove"],
    landmarks: ["Compton Creek", "Martin Luther King Jr. Transit Center"],
    lat: 33.8959,
    lng: -118.2201,
  },
  {
    slug: "hawthorne",
    city: "Hawthorne",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90250", "90251"],
    neighborhoods: ["Downtown Hawthorne", "North Hawthorne", "Holly Glen"],
    landmarks: ["SpaceX Headquarters", "The Beach Boys' childhood home", "Hawthorne Mall site"],
    lat: 33.9164,
    lng: -118.3526,
  },
  {
    slug: "venice",
    city: "Venice",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90291", "90292"],
    neighborhoods: ["Abbot Kinney", "Venice Canals", "Oakwood", "Marina Peninsula", "Silver Triangle"],
    landmarks: ["Venice Beach Boardwalk", "Abbot Kinney Boulevard", "Venice Canals", "Muscle Beach"],
    lat: 33.9850,
    lng: -118.4695,
  },
  {
    slug: "marina-del-rey",
    city: "Marina del Rey",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90292"],
    neighborhoods: ["Marina Peninsula", "Silver Strand", "Mariners Village", "Marina City"],
    landmarks: ["Marina del Rey Harbor", "Fisherman's Village", "Burton Chace Park"],
    lat: 33.9802,
    lng: -118.4517,
  },
  {
    slug: "pacific-palisades",
    city: "Pacific Palisades",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90272"],
    neighborhoods: ["Palisades Village", "Huntington Palisades", "The Alphabet Streets", "The Highlands", "Castellammare"],
    landmarks: ["Getty Villa", "Will Rogers State Historic Park", "Palisades Village", "Temescal Canyon"],
    lat: 34.0356,
    lng: -118.5156,
  },
  {
    slug: "brentwood",
    city: "Brentwood",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90049"],
    neighborhoods: ["Brentwood Park", "Crestwood Hills", "Mandeville Canyon", "Brentwood Glen", "Sullivan Canyon"],
    landmarks: ["Getty Center", "Brentwood Country Mart", "San Vicente Boulevard"],
    lat: 34.0520,
    lng: -118.4730,
  },
  {
    slug: "bel-air",
    city: "Bel Air",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90077"],
    neighborhoods: ["East Gate Bel Air", "West Gate Bel Air", "Bel Air Crest", "Stone Canyon", "Roscomare Valley"],
    landmarks: ["Hotel Bel-Air", "Bel-Air Country Club", "Stone Canyon Reservoir"],
    lat: 34.0901,
    lng: -118.4595,
  },
  {
    slug: "westwood",
    city: "Westwood",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90024", "90095"],
    neighborhoods: ["Westwood Village", "Holmby Hills", "Little Persia", "Westwood Gardens"],
    landmarks: ["UCLA", "Hammer Museum", "Westwood Village", "Geffen Playhouse"],
    lat: 34.0635,
    lng: -118.4455,
  },
  {
    slug: "manhattan-beach",
    city: "Manhattan Beach",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90266"],
    neighborhoods: ["Sand Section", "Hill Section", "Tree Section", "East Manhattan", "Manhattan Village"],
    landmarks: ["Manhattan Beach Pier", "The Strand", "Manhattan Village", "Polliwog Park"],
    lat: 33.8847,
    lng: -118.4109,
  },
  {
    slug: "hermosa-beach",
    city: "Hermosa Beach",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90254"],
    neighborhoods: ["Sand Section", "Hermosa Hills", "The Valley", "East Hermosa"],
    landmarks: ["Hermosa Beach Pier", "The Strand", "Pier Plaza"],
    lat: 33.8622,
    lng: -118.3995,
  },
  {
    slug: "redondo-beach",
    city: "Redondo Beach",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90277", "90278"],
    neighborhoods: ["South Redondo", "North Redondo", "Riviera Village", "Hollywood Riviera", "Golden Hills"],
    landmarks: ["Redondo Beach Pier", "King Harbor", "Riviera Village", "Veterans Park"],
    lat: 33.8492,
    lng: -118.3884,
  },
  {
    slug: "el-segundo",
    city: "El Segundo",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["90245"],
    neighborhoods: ["Smoky Hollow", "Old Town El Segundo", "Grand Avenue", "The Hill"],
    landmarks: ["El Segundo Beach", "Plaza El Segundo", "Automobile Driving Museum"],
    lat: 33.9192,
    lng: -118.4165,
  },
  {
    slug: "sherman-oaks",
    city: "Sherman Oaks",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["91403", "91423", "91413"],
    neighborhoods: ["Chandler Estates", "Longridge Estates", "Sherman Oaks Hills", "Valley Vista"],
    landmarks: ["Sherman Oaks Galleria", "Westfield Fashion Square", "Ventura Boulevard"],
    lat: 34.1510,
    lng: -118.4490,
  },
  {
    slug: "studio-city",
    city: "Studio City",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["91604", "91602"],
    neighborhoods: ["Colfax Meadows", "Silver Triangle", "Fryman Estates", "Laurel Terrace"],
    landmarks: ["Tujunga Village", "Ventura Boulevard", "CBS Studio Center", "Fryman Canyon"],
    lat: 34.1397,
    lng: -118.3870,
  },
  {
    slug: "encino",
    city: "Encino",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["91316", "91436", "91426"],
    neighborhoods: ["Encino Hills", "Amestoy Estates", "Royal Oaks", "Encino Village"],
    landmarks: ["Los Encinos State Historic Park", "Balboa Park", "Ventura Boulevard"],
    lat: 34.1591,
    lng: -118.5012,
  },
  {
    slug: "woodland-hills",
    city: "Woodland Hills",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["91364", "91367", "91365"],
    neighborhoods: ["Walnut Acres", "Vista de Oro", "Warner Center", "Carlton Terrace"],
    landmarks: ["Westfield Topanga", "The Village", "Warner Center Park"],
    lat: 34.1684,
    lng: -118.6059,
  },
  {
    slug: "calabasas",
    city: "Calabasas",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["91302", "91372"],
    neighborhoods: ["The Oaks", "Calabasas Hills", "Mountain View Estates", "Old Topanga", "Mulholland Heights"],
    landmarks: ["The Commons at Calabasas", "Calabasas Lake", "Leonis Adobe Museum"],
    lat: 34.1367,
    lng: -118.6615,
  },
  {
    slug: "arcadia",
    city: "Arcadia",
    state: "California",
    stateAbbr: "CA",
    county: "Los Angeles County",
    zipCodes: ["91006", "91007"],
    neighborhoods: ["Highland Oaks", "Santa Anita Oaks", "Baldwin Stocker", "Upper Rancho"],
    landmarks: ["Santa Anita Park", "Los Angeles County Arboretum", "Westfield Santa Anita"],
    lat: 34.1397,
    lng: -118.0353,
  },
]

export function getAreaBySlug(slug: string): SpotlessArea | undefined {
  return SPOTLESS_AREAS.find((a) => a.slug === slug)
}

export function getAllAreaSlugs(): string[] {
  return SPOTLESS_AREAS.map((a) => a.slug)
}

export function getAllCityNames(): string[] {
  return SPOTLESS_AREAS.map((a) => a.city)
}

// Unique, genuinely-local intro per city. This is the anti-thin-content asset: it
// differentiates every areas/[city] and services/[slug]/[city] page with real local
// character (housing stock, who lives there, cleaning realities) instead of a swapped
// city name. Required by Google's 2026 thin-content treatment of templated geo pages.
const LOCAL_INTROS: Record<string, string> = {
  "los-angeles":
    "Los Angeles homes range from Spanish-style bungalows in the older flats to downtown high-rise condos and hillside properties in Los Feliz and Silver Lake. City living means tight street parking, mixed-age surfaces and plumbing, and year-round dust off the freeways, so most LA clients book recurring cleaning to stay ahead of it.",
  "santa-monica":
    "Santa Monica cleaning runs from beachfront condos near Ocean Park to older Craftsman homes off Montana Avenue, where salt air and sand track in constantly. Many residents are busy professionals and short-term-rental hosts who want a fast, reliable reset between the beach and work.",
  "beverly-hills":
    "Beverly Hills homes are larger by nature, from the Flats' classic estates to the hillside properties of Trousdale, with delicate finishes like marble, hardwood, and custom millwork that need careful, detail-level cleaning. Clients here value discretion and consistency over speed.",
  "west-hollywood":
    "West Hollywood is dense with condos and apartments along the Sunset Strip and the Norma Triangle, where compact, high-traffic units and design-forward finishes are the norm. Busy professionals and hosts lean on recurring and turnover cleaning to keep small spaces immaculate.",
  "burbank":
    "Burbank's Media District and Magnolia Park are full of single-family homes owned by entertainment-industry families on demanding schedules. Practical, on-time recurring cleaning is the priority, plus the occasional deep clean before hosting.",
  "glendale":
    "Glendale mixes hillside homes in the Verdugo foothills with condos and townhomes near downtown, and the dust that rolls off the foothills shows on surfaces quickly. Multi-generational households here often book deep and recurring cleans.",
  "pasadena":
    "Pasadena is known for historic Craftsman and Spanish Revival homes near Old Town and Bungalow Heaven, where original wood, tile, and built-ins reward careful cleaning. Older homes also mean more molding, nooks, and detail work than a newer build.",
  "long-beach":
    "Long Beach spans waterfront condos near the marina, historic homes in Belmont Heights, and busy rental units citywide, with coastal humidity and salt air that keep windows and surfaces working. Landlords and Airbnb hosts here book frequent turnovers.",
  "torrance":
    "Torrance is largely well-kept single-family suburban homes with families on tight weekday schedules, close enough to the coast to catch a steady layer of fine dust. Reliable biweekly cleaning is the common ask.",
  "culver-city":
    "Culver City has become a tech and media hub, so its bungalows and newer condos are often home to busy professionals near the Arts District and the Sony lot. Quick, dependable recurring service and move-in/out cleaning for the steady rental churn are in high demand.",
  "inglewood":
    "Inglewood is changing fast around SoFi Stadium and the Kia Forum, with a mix of classic single-family homes and new development. Move-in/out and recurring cleaning are common as the neighborhood turns over.",
  "downey":
    "Downey is a family-oriented suburb of mid-century single-family homes, where households want straightforward, thorough recurring cleaning that fits around work and school.",
  "whittier":
    "Whittier blends historic Uptown homes with hillside neighborhoods, and the older housing stock means more original surfaces and detail work. Deep cleans and recurring maintenance are popular here.",
  "pomona":
    "Pomona has a wide range of older and student-adjacent housing near the colleges, so move-in/out and deep cleaning around lease turnovers are frequent requests.",
  "west-covina":
    "West Covina is suburban single-family living for commuting families, where inland heat and dust make regular interior cleaning worthwhile. Biweekly recurring service is the staple.",
  "alhambra":
    "Alhambra's dense mix of single-family homes and condos serves many multi-generational and professional households in the western San Gabriel Valley. Thorough recurring and deep cleaning are the common asks.",
  "el-monte":
    "El Monte is primarily working-family single-family homes, where practical, affordable recurring cleaning that respects a busy schedule matters most.",
  "norwalk":
    "Norwalk is a suburban community of mid-century homes and rentals, with move-in/out and recurring cleaning driving most bookings as units turn over.",
  "compton":
    "Compton is largely single-family homes with proud, long-term owners, where dependable deep and recurring cleaning are the typical requests.",
  "hawthorne":
    "Hawthorne sits near SpaceX and LAX with a mix of apartments and starter homes for an aerospace and commuter workforce. Tenants and hosts here book recurring and turnover cleaning to keep compact units sharp.",
  "venice":
    "Venice ranges from walk-street cottages and canal homes to modern lofts near Abbot Kinney, where sand, salt air, and indoor-outdoor living keep floors and windows busy. It is a heavy short-term-rental area, so same-day Airbnb turnovers are constant.",
  "marina-del-rey":
    "Marina del Rey is dominated by waterfront condos and apartments around the harbor, where compact, high-end units and salt air call for frequent, detail-oriented cleaning. Busy professionals and hosts book recurring and turnover service.",
  "pacific-palisades":
    "Pacific Palisades homes are larger hillside and canyon properties with ocean views, fine finishes, and a lot of glass that shows coastal haze quickly. Clients here favor thorough recurring cleaning and pre-event deep cleans.",
  "brentwood":
    "Brentwood is estate-level living from Brentwood Park to Mandeville Canyon, with sizable homes, delicate surfaces, and high expectations for discreet, consistent, detail-level cleaning.",
  "bel-air":
    "Bel Air is gated estates along winding canyon roads, where large square footage, custom materials, and privacy needs make careful, trusted, detail-driven cleaning essential.",
  "westwood":
    "Westwood blends UCLA-adjacent condos and apartments with the estates of Holmby Hills, so the work ranges from fast student-rental turnovers to careful cleaning of large, finish-heavy homes.",
  "manhattan-beach":
    "Manhattan Beach homes in the Sand and Hill sections sit right on the coast, where sand, salt air, and lots of windows keep cleaning constant. Active beach families book recurring service to stay ahead of it.",
  "hermosa-beach":
    "Hermosa Beach is dense beach living, with Sand Section walk-streets and compact multi-level homes that track in sand and sea air. Recurring and short-term-rental turnover cleaning are the norm.",
  "redondo-beach":
    "Redondo Beach spans the Riviera's hillside homes and townhomes near the pier and harbor, where coastal moisture keeps windows and surfaces working. Families and hosts here lean on regular cleaning.",
  "el-segundo":
    "El Segundo is a tight-knit small-town grid of older homes near the aerospace and tech corridor, with busy professional households that value reliable, low-fuss recurring cleaning.",
  "sherman-oaks":
    "Sherman Oaks mixes Ventura Boulevard condos with hillside homes south of the 101, where Valley heat and dust make interior cleaning a year-round need. Professionals and families book recurring and deep cleans.",
  "studio-city":
    "Studio City is full of entertainment-industry homes from Colfax Meadows flats to Fryman hillside properties, with demanding schedules that make dependable recurring cleaning the priority.",
  "encino":
    "Encino is known for larger Valley homes and gated properties in Encino Hills, where bigger square footage and fine finishes call for thorough, detail-level cleaning. Deep and recurring service are common.",
  "woodland-hills":
    "Woodland Hills offers spacious suburban homes near Warner Center and the hills, where Valley heat and larger floor plans make regular deep and recurring cleaning worthwhile for busy families.",
  "calabasas":
    "Calabasas is gated, master-planned communities and estates like The Oaks, with large homes, premium finishes, and an expectation of discreet, consistent, detail-driven cleaning.",
  "arcadia":
    "Arcadia is known for large, newer custom homes near Santa Anita, often multi-generational, where sizable square footage and fine surfaces make thorough recurring and deep cleaning the standard request.",
}

export function getLocalIntro(slug: string): string {
  return (
    LOCAL_INTROS[slug] ||
    "Our cleaners know this area well and tailor every visit to the home, from compact condos to larger family houses, with insured, background-checked professionals on every job."
  )
}

// Business info used across the site
export const SPOTLESS_BUSINESS = {
  name: "Spotless Scrubbers",
  legalName: "Spotless Scrubbers LLC",
  phone: "(424) 677-1146",
  phoneRaw: "+14246771146",
  email: "spotlessscrubberscleaning@gmail.com",
  url: "https://spotlessscrubbers.org",
  foundingYear: 2023,
  areaServed: "Los Angeles County, CA",
  description:
    "Professional house cleaning in Los Angeles County. Instant booking, insured team, 100% satisfaction guaranteed.",
  rating: 5.0,
  reviewCount: 29,
  priceRange: "$$",
  address: {
    city: "Los Angeles",
    state: "California",
    stateAbbr: "CA",
    country: "US",
  },
  social: {
    instagram: "https://instagram.com/spotlessscrubbers",
    facebook: "https://facebook.com/spotlessscrubbers",
    yelp: "https://yelp.com/biz/spotless-scrubbers-los-angeles",
    google: "https://g.page/spotless-scrubbers",
  },
}
