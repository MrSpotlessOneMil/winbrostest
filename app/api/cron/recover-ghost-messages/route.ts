// route-check:no-vercel-cron
// One-time recovery: send follow-ups to customers who were ghosted by the auto-response bug
// DELETE THIS FILE after running once
import { NextRequest, NextResponse } from "next/server"
import { sendSMS } from "@/lib/openphone"
import { getTenantBySlug } from "@/lib/tenant"

const GHOST_FOLLOWUPS: { phone: string; name: string; message: string }[] = [
  // HOT LEADS - need booking follow-up
  {
    phone: "+16265887885",
    name: "Kevin",
    message: "Hey Kevin sorry about the late reply! We do have openings this week. What kind of cleaning were you looking for and what day works best?",
  },
  {
    phone: "+14136950093",
    name: "Kara MB",
    message: "Hey Kara sorry for the delayed response! Yes we absolutely do deep cleans. Mold removal and cabinet cleaning is no problem, and we can work with your own products too. What's the address and when were you thinking?",
  },
  {
    phone: "+16262005832",
    name: "Lena",
    message: "Hey Lena sorry about the delay! Pricing depends on the size of your place and type of cleaning. How many bedrooms/bathrooms and were you thinking regular clean or deep clean?",
  },
  {
    phone: "+13232029200",
    name: "Ikan",
    message: "Hey sorry for the late reply! What kind of cleaning were you thinking? Regular, deep clean, or move in/out?",
  },
  {
    phone: "+19092610770",
    name: "Reggie",
    message: "Hey Reggie sorry about the delayed response! For a 2 bedroom mobile home, just need to know how many bathrooms and we can get you an exact quote. What day works best for you?",
  },
  {
    phone: "+13238305731",
    name: "Fernando",
    message: "Hey Fernando sorry for the late reply! What kind of cleaning did you need? And what area are you in?",
  },
  {
    phone: "+17862862706",
    name: "Ms Hernandez",
    message: "Hey sorry about the delay! This is Mary with Spotless Scrubbers, we're a cleaning service in LA County, OC and the Valley. Were you interested in getting your place cleaned?",
  },
  {
    phone: "+12134245990",
    name: "Bree",
    message: "Hey sorry for the late reply! We have openings this week. What day and time works best for you?",
  },
  // WRONG NUMBER / CLEANER COMPLAINT - still need polite responses
  {
    phone: "+14242220773",
    name: "Junieth",
    message: "Perdona el error! Que tengas buen dia",
  },
  {
    phone: "+13109257736",
    name: "Jennifer",
    message: "Sounds good! Feel free to reach out anytime you need us. Have a great day!",
  },
  {
    phone: "+17473447375",
    name: "Vlad",
    message: "No worries at all! If you ever need a clean just hit us up. Have a good one!",
  },
]

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret")
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tenant = await getTenantBySlug("spotless-scrubbers")
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 })
  }

  const results: { phone: string; name: string; success: boolean; error?: string }[] = []

  for (const msg of GHOST_FOLLOWUPS) {
    const result = await sendSMS(tenant, msg.phone, msg.message, { skipDedup: true })
    results.push({
      phone: msg.phone,
      name: msg.name,
      success: result.success,
      error: result.error,
    })
    // Small delay between sends
    await new Promise(r => setTimeout(r, 1000))
  }

  return NextResponse.json({
    total: results.length,
    sent: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  })
}
