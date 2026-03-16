// route-check:no-vercel-cron
// Round 2: remaining ghosted customers from March 15-16
// DELETE THIS FILE after running once
import { NextRequest, NextResponse } from "next/server"
import { sendSMS } from "@/lib/openphone"
import { getTenantBySlug } from "@/lib/tenant"

const GHOST_FOLLOWUPS: { phone: string; name: string; message: string }[] = [
  // HOT LEADS
  {
    phone: "+13104066871",
    name: "Deniella",
    message: "Hey Deniella sorry about the late reply! We don't do hourly rates since every home is different, but I can get you an exact quote real quick. How many bedrooms and bathrooms? And were you thinking regular clean or deep clean?",
  },
  {
    phone: "+14242221081",
    name: "Shannon",
    message: "Hey Shannon sorry for the delayed response! We do regular cleanings, deep cleans, and move in/out cleans across LA County, OC and the Valley. What kind of cleaning were you looking for? I can get you a quote right away",
  },
  {
    phone: "+15625366145",
    name: "Beatrice",
    message: "Hey Beatrice sorry about the late reply! This is Mary with Spotless Scrubbers, we're a cleaning service in LA. We reached out to see if you needed help getting your place cleaned. Still interested?",
  },
  // SCHEDULING / IN-PROGRESS CONVOS
  {
    phone: "+13109945582",
    name: "Mahas",
    message: "Hey Mahas sorry for the delay! Just let me know once Raza confirms the date and we'll get everything locked in for you",
  },
  // POLITE DECLINES - still need a response
  {
    phone: "+17142907486",
    name: "Young",
    message: "No worries at all! I'll check back with you closer to May. Just text me whenever you're ready!",
  },
  {
    phone: "+13174000456",
    name: "kristina",
    message: "No problem at all, appreciate you letting me know! If your schedule ever opens up feel free to reach out",
  },
  {
    phone: "+13303128612",
    name: "James",
    message: "Ah got it, my bad! We're only in LA County, OC and the Valley right now. Appreciate you letting me know!",
  },
  {
    phone: "+17814606806",
    name: "Jackom",
    message: "Got it, thanks for letting me know! If you ever need cleaning yourself feel free to reach out. Have a good one!",
  },
  // SARAI - cleaner with pay complaint, needs empathetic response
  {
    phone: "+15624584190",
    name: "Sarai",
    message: "Hey Sarai I hear you and I appreciate you being real with me. Your work was solid and I'm sorry you felt that way about the pay. If things change or you want to talk about it, my door is always open",
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
    results.push({ phone: msg.phone, name: msg.name, success: result.success, error: result.error })
    await new Promise(r => setTimeout(r, 1000))
  }

  return NextResponse.json({
    total: results.length,
    sent: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  })
}
