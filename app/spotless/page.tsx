import Link from "next/link"
import { SPOTLESS_SERVICES } from "@/lib/marketing/spotless-services"
import { SPOTLESS_AREAS, SPOTLESS_BUSINESS } from "@/lib/marketing/spotless-areas"
import { FAQJsonLd, HowToJsonLd } from "@/components/marketing/json-ld"
import { BookingForm } from "@/components/marketing/booking-form"
import { QuoteCalculator } from "@/components/marketing/quote-calculator"
import { TrustBar } from "@/components/marketing/trust-bar"
import { HowItWorks } from "@/components/marketing/how-it-works"
import { StickyCTA } from "@/components/marketing/sticky-cta"

/* ------------------------------------------------------------------ */
/*  Static data                                                        */
/* ------------------------------------------------------------------ */

const SERVICE_ICONS: Record<string, string> = {
  "standard-cleaning": "&#10024;",   // sparkles
  "deep-cleaning": "&#128269;",      // magnifying glass
  "move-in-out-cleaning": "&#127968;", // house
  "post-construction-cleaning": "&#129521;", // hard hat
  "commercial-cleaning": "&#127970;", // office
  "airbnb-cleaning": "&#128273;",    // key
}

const SERVICE_IMAGES: Record<string, string> = {
  "standard-cleaning": "/images/marketing/standard-bathroom-result.webp",
  "deep-cleaning": "/images/marketing/stock-deep-clean-kitchen.jpg",
  "move-in-out-cleaning": "/images/marketing/move-cleaning.jpg",
  "post-construction-cleaning": "/images/marketing/post-construction-site.jpg",
  "commercial-cleaning": "/images/marketing/stock-commercial-office.jpg",
  "airbnb-cleaning": "/images/marketing/airbnb-bedroom-clean.jpg",
}

const SERVICE_ALTS: Record<string, string> = {
  "standard-cleaning": "Professional standard house cleaning result – spotless bedroom in Los Angeles home",
  "deep-cleaning": "Sparkling clean kitchen sink after professional deep cleaning in LA County",
  "move-in-out-cleaning": "Move-in ready apartment after professional cleaning in Los Angeles",
  "post-construction-cleaning": "Post-construction cleanup in progress – team clearing dust and debris from LA home renovation",
  "commercial-cleaning": "Clean commercial hallway after professional janitorial service in Los Angeles County",
  "airbnb-cleaning": "Modern styled living room ready for Airbnb guests after turnover cleaning in Los Angeles",
}

const SERVICE_PRICE_RANGES: Record<string, string> = {
  "standard-cleaning": "Starting at $150",
  "deep-cleaning": "Starting at $250",
  "move-in-out-cleaning": "Starting at $300",
  "post-construction-cleaning": "Starting at $300",
  "commercial-cleaning": "Starting at $150",
  "airbnb-cleaning": "Starting at $100",
}

const CREW_MEMBERS = [
  { name: "Sonia", role: "Lead Cleaner", specialty: "Residential", years: 2, cleanings: 340, quote: "I treat every home like my own." },
  { name: "Rokia", role: "Lead Cleaner", specialty: "Deep Cleaning", years: 2, cleanings: 280, quote: "The details make the difference." },
  { name: "Ben", role: "Team Lead", specialty: "Commercial", years: 3, cleanings: 520, quote: "We leave it better than we found it." },
  { name: "Jasper", role: "Cleaner", specialty: "Post-Construction", years: 1, cleanings: 190, quote: "No mess is too big." },
  { name: "Maria", role: "Cleaner", specialty: "Residential", years: 2, cleanings: 310, quote: "I love seeing the look on clients' faces." },
  { name: "Carlos", role: "Cleaner", specialty: "Commercial & Airbnb", years: 1, cleanings: 220, quote: "Fast turnovers, zero shortcuts." },
]

const TRUST_STATS = [
  { value: "3+", label: "Years in Business" },
  { value: "2,000+", label: "Cleanings Completed" },
  { value: "4.9", label: "Star Rating" },
  { value: "9", label: "Professional Cleaners" },
]

const WHY_CHOOSE = [
  {
    title: "Safe for Your Family",
    description:
      "We only use high-quality, safe products. I have kids in my own family - I would never bring anything into your home that I would not use in mine.",
  },
  {
    title: "We Actually Show Up",
    description:
      "Sounds basic, right? But if you have dealt with other cleaning companies in LA, you know how rare this is. We show up on time, every single time.",
  },
  {
    title: "Not Happy? We Fix It",
    description:
      "If something is not right, just call me. We will come back and make it right - no charge, no hassle, no attitude. That is how we have kept clients for years.",
  },
  {
    title: "Last-Minute? Call Us",
    description:
      "Guests coming tomorrow? Landlord doing a walkthrough? We get it. We do same-day cleanings when we can - just give us a call and we will figure it out.",
  },
]

const TESTIMONIALS = [
  {
    quote:
      "I'm a very busy professional who travels a lot for work and hadn't had time to give my home more than a quick surface clean in a while. They came in for a deep clean, and the results were beyond my expectations. It was such a relief.",
    name: "Amy Blakeslee",
    city: "Manhattan Beach",
  },
  {
    quote:
      "Sonia was absolutely AMAZING!! She crushed this job and was so kind and easy to work with. I highly recommend this company, but especially Sonia because she does flawless work!",
    name: "Ocean Shapiro",
    city: "Manhattan Beach",
  },
  {
    quote:
      "Just wanted to give a big shout-out to Spotless Scrubbers for their incredible work on my new office space. Post-construction, the place was a mess - dust everywhere, you know the drill. But these guys? Total game changers.",
    name: "Ali Alkhafaji",
    city: "Los Angeles",
  },
  {
    quote:
      "The best cleaning service I've experienced in all my time living in Manhattan Beach! They were very responsive and professional from start to finish. Highly recommend!",
    name: "Mitchell Brink",
    city: "Manhattan Beach",
  },
  {
    quote:
      "They have been cleaning my home at their discounted bi-weekly rate for 3 months now and we love their services. They always bring a team and their own supplies. Amazing service!",
    name: "Vommy",
    city: "Los Angeles",
  },
  {
    quote:
      "Scheduled an appointment to clean my father's bathroom and bedroom before he was released from the hospital. Reasonable pricing. Work was excellent and done in a timely manner.",
    name: "Annaliza Guzman",
    city: "Los Angeles",
  },
  {
    quote:
      "Spotless Scrubbers did a phenomenal job cleaning my apartment! There is a reason they are rated 5 stars.",
    name: "Dasun Jayatissa",
    city: "Los Angeles",
  },
  {
    quote:
      "They did a great job cleaning my house during my move. I didn't have to worry about anything! Efficient and fast team! I highly recommend them!",
    name: "Daise Boldt",
    city: "Los Angeles",
  },
  {
    quote:
      "If you're searching for top-notch cleaning services, Spotless Scrubbers is definitely the move. The cleaners did an amazing job with my kitchen, living room, and bathrooms. The team did such a meticulous job I couldn't believe it.",
    name: "Ryan Wood",
    city: "Los Angeles",
  },
  {
    quote:
      "I'm very pleased and impressed with the cleaning services provided, my house smells nice and clean. I recommend Spotless Scrubbers if you want good work done. They did an excellent job.",
    name: "Herlinda Lutz",
    city: "Los Angeles",
  },
  {
    quote:
      "We recently hired Spotless Scrubbers for our commercial property, and they exceeded all expectations. Professional and thorough, they transformed our space with meticulous attention to detail.",
    name: "Vincent Calta",
    city: "Los Angeles",
  },
  {
    quote:
      "Our office gets cleaned daily and I cannot explain how happy I am with their service.",
    name: "Tanner Lutton",
    city: "Manhattan Beach",
  },
]

const FAQS = [
  {
    question: "How much does a cleaning cost?",
    answer:
      "It depends on your home size and what you need done. A standard cleaning starts at $150, deep cleans start at $250. Just call us or fill out the form and we will give you an honest quote - no surprises, no hidden fees.",
  },
  {
    question: "What do you actually clean?",
    answer:
      "Everything you would expect and then some - dusting, vacuuming, mopping, kitchen (counters, stovetop, sink), bathrooms (toilets, showers, mirrors), trash, bed making. If there is something specific you want us to focus on, just let us know. We are flexible.",
  },
  {
    question: "Can I trust your team in my home?",
    answer:
      "100%. Everyone on my team is background-checked, insured, and bonded. I personally vet every person before they step foot in anyone's home. Your safety is not something I take lightly.",
  },
  {
    question: "Do I need to be there?",
    answer:
      "Nope. A lot of our clients give us a key or a lockbox code. We will text you when we get there and when we are done. Simple as that.",
  },
  {
    question: "Are your products safe for kids and pets?",
    answer:
      "Yes - all our products are safe for kids and pets. If you have allergies or want us to use specific products, just tell us and we will make it work.",
  },
  {
    question: "How do I book?",
    answer:
      "Easiest way is to just call us at " +
      SPOTLESS_BUSINESS.phone +
      " or fill out the form on this page. We will get back to you within the hour. No automated phone trees - you will talk to a real person.",
  },
]

const HOW_TO_STEPS = [
  {
    name: "Tell Us What You Need",
    text: "Call, text, or fill out the form. Let us know what kind of cleaning you need and we will figure out the rest.",
  },
  {
    name: "We Lock In Your Date",
    text: "We will confirm your appointment within the hour and match you with the right crew. Same-day available when we can swing it.",
  },
  {
    name: "We Show Up and Get It Done",
    text: "Our team arrives on time, cleans everything top to bottom, and leaves your place feeling brand new. Simple as that.",
  },
]

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function HomePage() {
  return (
    <>
      {/* ---- 1. Hero Section ---- */}
      <section className="relative">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0c2e3a] via-[#155f73] to-[#1a7a95]">
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
              backgroundSize: "32px 32px",
            }}
          />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-32">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left side - copy */}
            <div className="text-white text-center lg:text-left">
              <p className="text-sm font-medium text-white/70 mb-4 tracking-wide">
                SERVING ALL OF LOS ANGELES COUNTY
              </p>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-[1.1]">
                LA&apos;s Cleaning Crew That Actually Shows Up
              </h1>

              <p className="text-lg text-white/80 mb-10 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Hey, I&apos;m Dominic. My team and I have been cleaning homes and
                businesses across LA County since 2023. We are fully insured,
                background-checked, and we do not cancel on you. Ever.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 mb-8">
                <a
                  href="#quote"
                  className="inline-flex items-center px-8 py-4 bg-[#2195b4] text-white font-semibold text-lg hover:bg-[#1a7a95] transition-colors"
                >
                  Get a Free Quote
                </a>
                <a
                  href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`}
                  className="inline-flex items-center px-8 py-4 border-2 border-white/40 text-white font-semibold text-lg hover:bg-white/10 transition-colors"
                >
                  Call {SPOTLESS_BUSINESS.phone}
                </a>
              </div>

              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-8 gap-y-2 text-sm text-white/60">
                <span>Insured & Bonded</span>
                <span>Background-Checked Team</span>
                <span>5.0 Stars on Google</span>
              </div>
            </div>

            {/* Right side - quote calculator */}
            <div className="w-full max-w-md mx-auto lg:mx-0 lg:ml-auto">
              <QuoteCalculator />
            </div>
          </div>
        </div>
      </section>

      {/* ---- 2. Trust Bar ---- */}
      <TrustBar />

      {/* ---- 3. How It Works ---- */}
      <HowItWorks />

      {/* ---- 4. Services Grid ---- */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-sm font-medium text-[#2195b4] mb-3">
              Our services
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Whatever You Need Cleaned, We Got You
            </h2>
            <p className="text-slate-600 max-w-2xl mx-auto">
              Whether it is your home every two weeks or a construction site that needs to be
              move-in ready by tomorrow - we handle it all.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {SPOTLESS_SERVICES.map((service) => (
              <Link
                key={service.slug}
                href={`/spotless/services/${service.slug}`}
                className="group cursor-pointer overflow-hidden bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.1)] transition-shadow duration-200"
              >
                <div className="relative h-52 overflow-hidden">
                  <img
                    src={SERVICE_IMAGES[service.slug]}
                    alt={SERVICE_ALTS[service.slug] || service.shortTitle}
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                  />
                </div>
                <div className="p-5">
                  <div className="flex items-baseline justify-between mb-2">
                    <h3 className="text-base font-semibold text-[#164E63]">
                      {service.shortTitle}
                    </h3>
                    <span className="text-sm font-medium text-[#2195b4]">
                      {SERVICE_PRICE_RANGES[service.slug]}
                    </span>
                  </div>
                  <p className="text-sm text-[#475569] leading-relaxed line-clamp-2">
                    {service.description}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ---- 5. Why Choose Us ---- */}
      <section className="py-20 bg-[#f8fafa]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-sm font-medium text-[#2195b4] mb-3">
              Why people stick with us
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
              We Do Things Different Around Here
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {WHY_CHOOSE.map((item) => (
              <div key={item.title} className="bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
                <h3 className="text-base font-semibold text-[#164E63] mb-2">{item.title}</h3>
                <p className="text-sm text-[#475569] leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- 6. Testimonials ---- */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-sm font-medium text-[#2195b4] mb-3">
              Real reviews from real clients
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Five-Star Rated on Google
            </h2>
            <div className="flex items-center justify-center gap-2 text-lg">
              <span className="text-amber-400">&#9733;&#9733;&#9733;&#9733;&#9733;</span>
              <span className="text-slate-500 text-sm">5.0 Stars on Google</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t) => (
              <div
                key={t.name}
                className="bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6 flex flex-col"
              >
                <div className="flex gap-0.5 mb-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span key={i} className="text-amber-400 text-sm">&#9733;</span>
                  ))}
                </div>

                <p className="text-[#475569] text-sm leading-relaxed flex-1 mb-4">
                  &ldquo;{t.quote}&rdquo;
                </p>

                <div>
                  <div className="font-semibold text-[#164E63] text-sm">{t.name}</div>
                  <div className="text-[#94A3B8] text-xs">{t.city}, CA</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- 7. The Spotless Promise ---- */}
      <section className="py-16 bg-[#155f73] text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-6">
            The Spotless Promise
          </h2>
          <p className="text-lg text-white/80 mb-10 max-w-2xl mx-auto">
            Every cleaning comes with our guarantee. If something is not right,
            call Dominic directly. We come back and fix it - no charge, no questions, no hassle.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            <div>
              <div className="text-3xl font-bold mb-2">24hr</div>
              <p className="text-sm text-white/70">
                Report any issue within 24 hours and we re-clean the area for free
              </p>
            </div>
            <div>
              <div className="text-3xl font-bold mb-2">100%</div>
              <p className="text-sm text-white/70">
                If we can not make it right, you do not pay. Simple as that.
              </p>
            </div>
            <div>
              <div className="text-3xl font-bold mb-2">Direct</div>
              <p className="text-sm text-white/70">
                You talk to Dominic, not a call center. Real person, real accountability.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Team in Action Photos ---- */}
      <section className="py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <p className="text-sm font-medium text-[#2195b4] mb-3">
              Our team on the job
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
              Real Crew. Real Work. Real Results.
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <img src="/images/marketing/team-branded.jpg" alt="Spotless Scrubbers team member in branded shirt at Los Angeles property" className="w-full h-64 object-cover" />
            <img src="/images/marketing/team-kitchen-clean.jpg" alt="Team member cleaning kitchen in branded shirt" className="w-full h-64 object-cover" />
            <img src="/images/marketing/team-bathroom-clean.jpg" alt="Team member cleaning bathroom in Spotless Scrubbers shirt" className="w-full h-64 object-cover" />
            <img src="/images/marketing/team-post-construction.jpg" alt="Post-construction cleanup in progress at LA home" className="w-full h-64 object-cover" />
          </div>
        </div>
      </section>

      {/* ---- 8. Meet the Crew ---- */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-sm font-medium text-[#2195b4] mb-3">
              The people behind the clean
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Meet Your Cleaning Crew
            </h2>
            <p className="text-slate-600 max-w-2xl mx-auto">
              Every person on this team was hand-picked by Dominic. Background-checked,
              trained, insured, and they genuinely care about doing great work.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {CREW_MEMBERS.map((member) => (
              <div key={member.name} className="bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-[#164E63] flex items-center justify-center text-white text-lg font-semibold rounded-full">
                    {member.name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-semibold text-[#164E63]">{member.name}</div>
                    <div className="text-sm text-[#94A3B8]">{member.role}</div>
                  </div>
                </div>
                <p className="text-sm text-[#475569] italic mb-4">&ldquo;{member.quote}&rdquo;</p>
                <div className="flex gap-4 text-xs text-[#94A3B8]">
                  <span>{member.cleanings}+ cleanings</span>
                  <span>{member.years}+ years</span>
                  <span>{member.specialty}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- 9. Our Results ---- */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-sm font-medium text-[#2195b4] mb-3">
              Our work speaks for itself
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
              Our Results
            </h2>
            <p className="text-slate-600 max-w-2xl mx-auto mt-4">
              Every surface wiped down, floors mopped, beds made, kitchens left sparkling.
              This is what you come home to after a Spotless Scrubbers cleaning.
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <img
                src="/images/marketing/clean-sink-result.jpg"
                alt="Sparkling clean kitchen sink after professional deep cleaning in Los Angeles"
                className="w-full h-64 object-cover"
              />
              <p className="text-center text-sm font-medium text-[#2195b4] mt-2">Kitchen Deep Clean</p>
            </div>
            <div>
              <img
                src="/images/marketing/clean-bedroom.jpg"
                alt="Perfectly made bedroom after standard house cleaning in LA County"
                className="w-full h-64 object-cover"
              />
              <p className="text-center text-sm font-medium text-[#2195b4] mt-2">Bedroom Standard Clean</p>
            </div>
            <div>
              <img
                src="/images/marketing/airbnb-cleaning.jpg"
                alt="Modern styled living room after professional Airbnb turnover cleaning in Los Angeles"
                className="w-full h-64 object-cover"
              />
              <p className="text-center text-sm font-medium text-[#2195b4] mt-2">Airbnb Turnover</p>
            </div>
            <div>
              <img
                src="/images/marketing/commercial-after.jpg"
                alt="Clean commercial hallway after professional janitorial service in LA County"
                className="w-full h-64 object-cover"
              />
              <p className="text-center text-sm font-medium text-[#2195b4] mt-2">Commercial Clean</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---- 8. Service Areas ---- */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-sm font-medium text-[#2195b4] mb-3">
              Service areas
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              All Over LA County
            </h2>
            <p className="text-slate-600 max-w-2xl mx-auto">
              From the beaches to the valleys - if you are in LA County, we can get to you.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {SPOTLESS_AREAS.map((area) => (
              <Link
                key={area.slug}
                href={`/spotless/areas/${area.slug}`}
                className="text-center px-3 py-3 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:border-[#2195b4] hover:text-[#2195b4] hover:shadow-sm transition-all"
              >
                {area.city}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ---- 8. FAQ ---- */}
      <section className="py-20 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-sm font-medium text-[#2195b4] mb-3">
              Common questions
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="space-y-0">
            {FAQS.map((faq, index) => (
              <div
                key={faq.question}
                className={`py-6 ${index !== FAQS.length - 1 ? "border-b border-slate-200" : ""}`}
              >
                <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-start gap-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-[#2195b4]/10 text-[#2195b4] text-sm font-bold flex items-center justify-center mt-0.5">
                    Q
                  </span>
                  {faq.question}
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed pl-10">{faq.answer}</p>
              </div>
            ))}
          </div>

          <FAQJsonLd faqs={FAQS} />
        </div>
      </section>

      {/* ---- HowTo JSON-LD ---- */}
      <HowToJsonLd name="How to Book a House Cleaning" steps={HOW_TO_STEPS} />

      {/* ---- 9. Final CTA with Booking Form ---- */}
      <section id="quote" className="py-20 bg-[#155f73]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Let Us Take Care of It
            </h2>
            <p className="text-white/80 text-lg">
              Drop your info below and I will personally get back to you within the hour.
              No sales pitch, no pressure - just an honest quote from a real person.
            </p>
          </div>

          <div className="bg-white p-6 sm:p-8">
            <BookingForm source="homepage_cta" />
          </div>

          <p className="text-center text-white/60 text-sm mt-6">
            Or call us directly at{" "}
            <a href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`} className="text-white underline underline-offset-2 hover:text-white/90">
              {SPOTLESS_BUSINESS.phone}
            </a>
          </p>
        </div>
      </section>

      {/* ---- 10. Sticky CTA ---- */}
      <StickyCTA />
    </>
  )
}
