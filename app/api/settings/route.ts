import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"

type NotificationPrefs = {
  newLeads: boolean
  jobClaimed: boolean
  exceptions: boolean
  dailyReport: boolean
  sms: boolean
  email: boolean
}

type BusinessRules = {
  ratePerLaborHour: number
  productionHoursPerDay: number
  dailyTargetPerCrew: number
  minimumJobValue: number
  maxDistanceMinutes: number
  highValueThreshold: number
  initialWindowMinutes: number
  urgentWindowMinutes: number
  escalationTimeoutMinutes: number
  followupInitialTextMin: number
  followupFirstCallMin: number
  followupDoubleCallMin: number
  followupSecondTextMin: number
  followupFinalCallMin: number
  businessHoursStart: string
  businessHoursEnd: string
  timezone: string
  ownerPhone: string
  adminEmail: string
}

const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  newLeads: true,
  jobClaimed: true,
  exceptions: true,
  dailyReport: true,
  sms: true,
  email: false,
}

const DEFAULT_RULES: BusinessRules = {
  ratePerLaborHour: 150,
  productionHoursPerDay: 8,
  dailyTargetPerCrew: 1200,
  minimumJobValue: 100,
  maxDistanceMinutes: 50,
  highValueThreshold: 1000,
  initialWindowMinutes: 10,
  urgentWindowMinutes: 3,
  escalationTimeoutMinutes: 10,
  followupInitialTextMin: 0,
  followupFirstCallMin: 10,
  followupDoubleCallMin: 5,
  followupSecondTextMin: 5,
  followupFinalCallMin: 10,
  businessHoursStart: "09:00",
  businessHoursEnd: "17:00",
  timezone: process.env.TZ || process.env.DEFAULT_TIMEZONE || "America/Los_Angeles",
  ownerPhone: process.env.OWNER_PHONE || "",
  adminEmail: process.env.ADMIN_EMAIL || "",
}

function hasEnv(name: string) {
  const v = process.env[name]
  return typeof v === "string" && v.trim().length > 0
}

function computeIntegrationStatus() {
  return {
    supabase: hasEnv("NEXT_PUBLIC_SUPABASE_URL") && (hasEnv("SUPABASE_SERVICE_ROLE_KEY") || hasEnv("SUPABASE_SERVICE_KEY")),
    housecallPro: hasEnv("HOUSECALL_PRO_API_KEY") && hasEnv("HOUSECALL_PRO_COMPANY_ID"),
    openPhone: hasEnv("OPENPHONE_API_KEY") && (hasEnv("OPENPHONE_PHONE_ID_WINBROS") || hasEnv("OPENPHONE_PHONE_NUMBER_ID")),
    telegram: hasEnv("TELEGRAM_BOT_TOKEN") || hasEnv("TELEGRAM_CONTROL_BOT_TOKEN"),
    vapi: hasEnv("VAPI_API_KEY") && (hasEnv("VAPI_ASSISTANT_ID_WINBROS") || hasEnv("VAPI_ASSISTANT_ID")) && (hasEnv("VAPI_PHONE_ID_WINBROS") || hasEnv("VAPI_PHONE_ID")),
    stripe: hasEnv("STRIPE_SECRET_KEY") && hasEnv("STRIPE_WEBHOOK_SECRET"),
    qstash: hasEnv("QSTASH_TOKEN") && (hasEnv("QSTASH_CURRENT_SIGNING_KEY") || hasEnv("QSTASH_NEXT_SIGNING_KEY")),
    ai: hasEnv("OPENAI_API_KEY") || hasEnv("ANTHROPIC_API_KEY"),
  }
}

function computeWebhookBase(req: NextRequest) {
  const envBase = process.env.NEXT_PUBLIC_DOMAIN || process.env.NEXT_PUBLIC_APP_URL
  if (envBase && envBase.startsWith("http")) return envBase.replace(/\/+$/, "")
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000"
  const proto = req.headers.get("x-forwarded-proto") || "http"
  return `${proto}://${host}`
}

export async function GET(req: NextRequest) {
  const client = getSupabaseServiceClient()
  const base = computeWebhookBase(req)

  const { data, error } = await client
    .from("app_settings")
    .select("id, notifications, business_rules, updated_at")
    .eq("id", "global")
    .single()

  // If table exists but row doesn't, return defaults.
  const notifications = (data?.notifications as any) || DEFAULT_NOTIFICATIONS
  const businessRules = (data?.business_rules as any) || DEFAULT_RULES

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    data: {
      integrationStatus: computeIntegrationStatus(),
      webhookUrls: {
        housecallPro: `${base}/api/webhooks/housecall-pro`,
        telegram: `${base}/api/webhooks/telegram`,
        vapi: `${base}/api/webhooks/vapi`,
        stripe: `${base}/api/webhooks/stripe`,
        openphone: `${base}/api/webhooks/openphone`,
        ghl: `${base}/api/webhooks/ghl`,
      },
      notifications: { ...DEFAULT_NOTIFICATIONS, ...notifications },
      businessRules: { ...DEFAULT_RULES, ...businessRules },
      updated_at: data?.updated_at || null,
    },
  })
}

export async function POST(req: NextRequest) {
  const client = getSupabaseServiceClient()
  const body = await req.json().catch(() => ({}))

  const notificationsPatch = body?.notifications && typeof body.notifications === "object" ? body.notifications : null
  const businessRulesPatch = body?.businessRules && typeof body.businessRules === "object" ? body.businessRules : null

  if (!notificationsPatch && !businessRulesPatch) {
    return NextResponse.json({ success: false, error: "Nothing to update" }, { status: 400 })
  }

  // Load current (or defaults if missing)
  const current = await client
    .from("app_settings")
    .select("notifications,business_rules")
    .eq("id", "global")
    .single()

  const currentNotifications =
    (!current.error && current.data?.notifications && typeof current.data.notifications === "object"
      ? (current.data.notifications as any)
      : DEFAULT_NOTIFICATIONS) || DEFAULT_NOTIFICATIONS

  const currentRules =
    (!current.error && current.data?.business_rules && typeof current.data.business_rules === "object"
      ? (current.data.business_rules as any)
      : DEFAULT_RULES) || DEFAULT_RULES

  const nextNotifications = notificationsPatch ? { ...currentNotifications, ...notificationsPatch } : currentNotifications
  const nextRules = businessRulesPatch ? { ...currentRules, ...businessRulesPatch } : currentRules

  const { data, error } = await client
    .from("app_settings")
    .upsert(
      {
        id: "global",
        notifications: nextNotifications,
        business_rules: nextRules,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select("notifications,business_rules,updated_at")
    .single()

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    data: {
      notifications: data.notifications,
      businessRules: data.business_rules,
      updated_at: data.updated_at,
    },
  })
}

