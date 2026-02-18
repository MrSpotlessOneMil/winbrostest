"use client"

import React from "react"
import { useSearchParams } from "next/navigation"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import {
  Database,
  Phone,
  MessageSquare,
  Mic,
  CreditCard,
  Clock,
  Bot,
  CheckCircle2,
  XCircle,
  Settings,
  Bell,
  Shield,
  Zap,
  DollarSign,
  RefreshCw,
  Save,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

interface IntegrationCardProps {
  name: string
  description: string
  icon: React.ReactNode
  configured: boolean
  envVars: string[]
}

function IntegrationCard({ name, description, icon, configured, envVars }: IntegrationCardProps) {
  return (
    <Card className={configured ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${configured ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"}`}>
              {icon}
            </div>
            <div>
              <CardTitle className="text-base">{name}</CardTitle>
              <CardDescription className="text-xs">{description}</CardDescription>
            </div>
          </div>
          {configured ? (
            <Badge variant="outline" className="bg-success/10 text-success border-success/30">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
              <XCircle className="w-3 h-3 mr-1" />
              Not Configured
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Required vars:</span>{" "}
          {envVars.map((v, i) => (
            <code key={v} className="bg-muted px-1 py-0.5 rounded text-[10px]">
              {v}
              {i < envVars.length - 1 ? ", " : ""}
            </code>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

type SettingsPayload = {
  integrationStatus: Record<string, boolean>
  webhookUrls: Record<string, string>
  notifications: {
    newLeads: boolean
    jobClaimed: boolean
    exceptions: boolean
    dailyReport: boolean
    sms: boolean
    email: boolean
  }
  businessRules: Record<string, any>
  updated_at?: string | null
}

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const validTabs = ['integrations', 'notifications', 'business', 'pricing', 'security']
  const initialTab = tabParam && validTabs.includes(tabParam) ? tabParam : 'integrations'

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsPayload | null>(null)

  const notifications = settings?.notifications
  const webhookUrls = settings?.webhookUrls || {}
  const integrationStatus = settings?.integrationStatus || {}

  const [businessRulesDraft, setBusinessRulesDraft] = useState<Record<string, any>>({})

  // Pricing state
  type PricingTier = {
    id?: number
    bedrooms: number
    bathrooms: number
    max_sq_ft: number
    price: number
    labor_hours: number
    cleaners: number
    hours_per_cleaner: number | null
  }
  type PricingAddon = {
    id?: number
    addon_key: string
    label: string
    minutes: number
    flat_price: number | null
    active: boolean
  }
  const [pricingLoading, setPricingLoading] = useState(false)
  const [pricingSaving, setPricingSaving] = useState(false)
  const [standardTiers, setStandardTiers] = useState<PricingTier[]>([])
  const [deepTiers, setDeepTiers] = useState<PricingTier[]>([])
  const [addons, setAddons] = useState<PricingAddon[]>([])
  const [pricingError, setPricingError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/settings", { cache: "no-store" })
        const json = await res.json()
        if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed to load settings")
        if (cancelled) return
        setSettings(json.data as SettingsPayload)
        setBusinessRulesDraft((json.data as SettingsPayload)?.businessRules || {})
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load settings")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Load pricing data
  async function loadPricing() {
    setPricingLoading(true)
    setPricingError(null)
    try {
      const res = await fetch("/api/pricing", { cache: "no-store" })
      const json = await res.json()
      if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed to load pricing")
      const data = json.data
      setStandardTiers(data.tiers?.standard || [])
      setDeepTiers(data.tiers?.deep || [])
      setAddons(data.addons || [])
    } catch (e: any) {
      setPricingError(e?.message || "Failed to load pricing")
    } finally {
      setPricingLoading(false)
    }
  }

  useEffect(() => {
    loadPricing()
  }, [])

  async function savePricing() {
    setPricingSaving(true)
    setPricingError(null)
    try {
      const res = await fetch("/api/pricing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tiers: { standard: standardTiers, deep: deepTiers },
          addons,
        }),
      })
      const json = await res.json()
      if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed to save pricing")
    } catch (e: any) {
      setPricingError(e?.message || "Failed to save pricing")
    } finally {
      setPricingSaving(false)
    }
  }

  async function resetPricingToDefaults() {
    setPricingSaving(true)
    setPricingError(null)
    try {
      const res = await fetch("/api/pricing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      })
      const json = await res.json()
      if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed to reset pricing")
      await loadPricing()
    } catch (e: any) {
      setPricingError(e?.message || "Failed to reset pricing")
    } finally {
      setPricingSaving(false)
    }
  }

  function updateTier(type: 'standard' | 'deep', index: number, field: keyof PricingTier, value: number) {
    const setter = type === 'standard' ? setStandardTiers : setDeepTiers
    setter(prev => prev.map((tier, i) => i === index ? { ...tier, [field]: value } : tier))
  }

  function updateAddon(index: number, field: keyof PricingAddon, value: number | string | boolean) {
    setAddons(prev => prev.map((addon, i) => i === index ? { ...addon, [field]: value } : addon))
  }

  const updatedAtLabel = useMemo(() => {
    if (!settings?.updated_at) return null
    try {
      return new Date(settings.updated_at).toLocaleString()
    } catch {
      return null
    }
  }, [settings?.updated_at])

  async function updateNotifications(patch: Partial<SettingsPayload["notifications"]>) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notifications: patch }),
      })
      const json = await res.json()
      if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed to save notifications")
      setSettings((prev) =>
        prev
          ? { ...prev, notifications: { ...prev.notifications, ...patch }, updated_at: json?.data?.updated_at || prev.updated_at }
          : prev
      )
    } catch (e: any) {
      setError(e?.message || "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  async function saveBusinessRules() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessRules: businessRulesDraft }),
      })
      const json = await res.json()
      if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed to save business rules")
      setSettings((prev) =>
        prev ? { ...prev, businessRules: { ...businessRulesDraft }, updated_at: json?.data?.updated_at || prev.updated_at } : prev
      )
    } catch (e: any) {
      setError(e?.message || "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage OSIRIS integrations, notifications, and system configuration
        </p>
        {updatedAtLabel && <p className="text-xs text-muted-foreground mt-1">Last saved: {updatedAtLabel}</p>}
        {error && <p className="text-sm text-destructive mt-2">{error}</p>}
      </div>

      <Tabs defaultValue={initialTab} className="space-y-6">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="integrations" className="gap-2">
            <Zap className="w-4 h-4" />
            Integrations
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="w-4 h-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="business" className="gap-2">
            <Settings className="w-4 h-4" />
            Business Rules
          </TabsTrigger>
          <TabsTrigger value="pricing" className="gap-2">
            <DollarSign className="w-4 h-4" />
            Pricing
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Shield className="w-4 h-4" />
            Security
          </TabsTrigger>
        </TabsList>

        <TabsContent value="integrations" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Integration Status</CardTitle>
              <CardDescription>
                All integrations must be configured for OSIRIS to function properly.
                Add environment variables in the Vercel dashboard or .env file.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <IntegrationCard
                name="Supabase"
                description="Database & automation logs"
                icon={<Database className="w-4 h-4" />}
                configured={Boolean(integrationStatus.supabase)}
                envVars={["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]}
              />
              <IntegrationCard
                name="Housecall Pro"
                description="Job management (source of truth)"
                icon={<Settings className="w-4 h-4" />}
                configured={Boolean(integrationStatus.housecallPro)}
                envVars={["HOUSECALL_PRO_API_KEY", "HOUSECALL_PRO_COMPANY_ID"]}
              />
              <IntegrationCard
                name="OpenPhone"
                description="SMS customer communications"
                icon={<Phone className="w-4 h-4" />}
                configured={Boolean(integrationStatus.openPhone)}
                envVars={["OPENPHONE_API_KEY", "OPENPHONE_PHONE_ID_WINBROS"]}
              />
              <IntegrationCard
                name="Telegram"
                description="Team notifications & job claiming"
                icon={<MessageSquare className="w-4 h-4" />}
                configured={Boolean(integrationStatus.telegram)}
                envVars={["TELEGRAM_BOT_TOKEN", "TELEGRAM_CONTROL_BOT_TOKEN"]}
              />
              <IntegrationCard
                name="VAPI"
                description="AI voice for calls & after-hours"
                icon={<Mic className="w-4 h-4" />}
                configured={Boolean(integrationStatus.vapi)}
                envVars={["VAPI_API_KEY", "VAPI_ASSISTANT_ID_WINBROS", "VAPI_PHONE_ID_WINBROS"]}
              />
              <IntegrationCard
                name="Stripe"
                description="Payment processing"
                icon={<CreditCard className="w-4 h-4" />}
                configured={Boolean(integrationStatus.stripe)}
                envVars={["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]}
              />
              <IntegrationCard
                name="QStash"
                description="Background jobs & scheduling"
                icon={<Clock className="w-4 h-4" />}
                configured={Boolean(integrationStatus.qstash)}
                envVars={["QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY"]}
              />
              <IntegrationCard
                name="AI Models"
                description="OpenAI & Anthropic for AI features"
                icon={<Bot className="w-4 h-4" />}
                configured={Boolean(integrationStatus.ai)}
                envVars={["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Webhook URLs</CardTitle>
              <CardDescription>
                Configure these URLs in your external services to receive events
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Housecall Pro Webhook</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhookUrls.housecallPro || ""}
                    className="font-mono text-sm"
                  />
                  <Button variant="outline" size="sm" onClick={() => copy(webhookUrls.housecallPro || "")} disabled={!webhookUrls.housecallPro}>
                    Copy
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Telegram Bot Webhook</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhookUrls.telegram || ""}
                    className="font-mono text-sm"
                  />
                  <Button variant="outline" size="sm" onClick={() => copy(webhookUrls.telegram || "")} disabled={!webhookUrls.telegram}>
                    Copy
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>VAPI Webhook</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhookUrls.vapi || ""}
                    className="font-mono text-sm"
                  />
                  <Button variant="outline" size="sm" onClick={() => copy(webhookUrls.vapi || "")} disabled={!webhookUrls.vapi}>
                    Copy
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Stripe Webhook</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhookUrls.stripe || ""}
                    className="font-mono text-sm"
                  />
                  <Button variant="outline" size="sm" onClick={() => copy(webhookUrls.stripe || "")} disabled={!webhookUrls.stripe}>
                    Copy
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>
                Control what notifications you receive and how
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h4 className="text-sm font-medium">Event Notifications</h4>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>New Lead Alerts</Label>
                      <p className="text-xs text-muted-foreground">Get notified when a new lead comes in</p>
                    </div>
                    <Switch
                      checked={Boolean(notifications?.newLeads)}
                      onCheckedChange={(checked) => updateNotifications({ newLeads: checked })}
                      disabled={saving || loading || !notifications}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Job Claimed</Label>
                      <p className="text-xs text-muted-foreground">When a team lead claims a job</p>
                    </div>
                    <Switch
                      checked={Boolean(notifications?.jobClaimed)}
                      onCheckedChange={(checked) => updateNotifications({ jobClaimed: checked })}
                      disabled={saving || loading || !notifications}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Exceptions</Label>
                      <p className="text-xs text-muted-foreground">Rain days, complaints, escalations</p>
                    </div>
                    <Switch
                      checked={Boolean(notifications?.exceptions)}
                      onCheckedChange={(checked) => updateNotifications({ exceptions: checked })}
                      disabled={saving || loading || !notifications}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Daily Report</Label>
                      <p className="text-xs text-muted-foreground">End of day performance summary</p>
                    </div>
                    <Switch
                      checked={Boolean(notifications?.dailyReport)}
                      onCheckedChange={(checked) => updateNotifications({ dailyReport: checked })}
                      disabled={saving || loading || !notifications}
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-6 space-y-4">
                <h4 className="text-sm font-medium">Delivery Methods</h4>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>SMS Notifications</Label>
                      <p className="text-xs text-muted-foreground">Receive alerts via text message</p>
                    </div>
                    <Switch
                      checked={Boolean(notifications?.sms)}
                      onCheckedChange={(checked) => updateNotifications({ sms: checked })}
                      disabled={saving || loading || !notifications}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Email Notifications</Label>
                      <p className="text-xs text-muted-foreground">Receive alerts via email</p>
                    </div>
                    <Switch
                      checked={Boolean(notifications?.email)}
                      onCheckedChange={(checked) => updateNotifications({ email: checked })}
                      disabled={saving || loading || !notifications}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="business" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Booking Rules</CardTitle>
              <CardDescription>
                Configure pricing, scheduling, and operational parameters
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Rate per Labor Hour ($)</Label>
                <Input
                  type="number"
                  value={businessRulesDraft.ratePerLaborHour ?? 0}
                  onChange={(e) => setBusinessRulesDraft({ ...businessRulesDraft, ratePerLaborHour: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Production Hours per Day</Label>
                <Input
                  type="number"
                  value={businessRulesDraft.productionHoursPerDay ?? 0}
                  onChange={(e) =>
                    setBusinessRulesDraft({ ...businessRulesDraft, productionHoursPerDay: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Daily Target per Crew ($)</Label>
                <Input
                  type="number"
                  value={businessRulesDraft.dailyTargetPerCrew ?? 0}
                  onChange={(e) =>
                    setBusinessRulesDraft({ ...businessRulesDraft, dailyTargetPerCrew: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Minimum Job Value ($)</Label>
                <Input
                  type="number"
                  value={businessRulesDraft.minimumJobValue ?? 0}
                  onChange={(e) =>
                    setBusinessRulesDraft({ ...businessRulesDraft, minimumJobValue: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Max Distance (minutes)</Label>
                <Input
                  type="number"
                  value={businessRulesDraft.maxDistanceMinutes ?? 0}
                  onChange={(e) =>
                    setBusinessRulesDraft({ ...businessRulesDraft, maxDistanceMinutes: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>High Value Threshold ($)</Label>
                <Input
                  type="number"
                  value={businessRulesDraft.highValueThreshold ?? 0}
                  onChange={(e) =>
                    setBusinessRulesDraft({ ...businessRulesDraft, highValueThreshold: Number(e.target.value) })
                  }
                />
              </div>
            </CardContent>
            <CardContent className="pt-0">
              <Button onClick={saveBusinessRules} disabled={saving || loading} variant="outline">
                {saving ? "Saving…" : "Save business rules"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Team Assignment Timing</CardTitle>
              <CardDescription>
                Configure broadcast windows and escalation timeouts
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Initial Window (minutes)</Label>
                <Input
                  type="number"
                  value={businessRulesDraft.initialWindowMinutes ?? 0}
                  onChange={(e) =>
                    setBusinessRulesDraft({ ...businessRulesDraft, initialWindowMinutes: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Urgent Window (minutes)</Label>
                <Input
                  type="number"
                  value={businessRulesDraft.urgentWindowMinutes ?? 0}
                  onChange={(e) =>
                    setBusinessRulesDraft({ ...businessRulesDraft, urgentWindowMinutes: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Escalation Timeout (minutes)</Label>
                <Input
                  type="number"
                  value={businessRulesDraft.escalationTimeoutMinutes ?? 0}
                  onChange={(e) =>
                    setBusinessRulesDraft({ ...businessRulesDraft, escalationTimeoutMinutes: Number(e.target.value) })
                  }
                />
              </div>
            </CardContent>
            <CardContent className="pt-0">
              <Button onClick={saveBusinessRules} disabled={saving || loading} variant="outline">
                {saving ? "Saving…" : "Save timing"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lead Follow-up Timing</CardTitle>
              <CardDescription>
                Configure the automated lead nurture sequence
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-2">
                <Label>Initial Text (min)</Label>
                <Input
                  type="number"
                  value={Number(businessRulesDraft.followupInitialTextMin ?? 0)}
                  onChange={(e) =>
                    setBusinessRulesDraft({ ...businessRulesDraft, followupInitialTextMin: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>First Call (min)</Label>
                <Input
                  type="number"
                  value={Number(businessRulesDraft.followupFirstCallMin ?? 0)}
                  onChange={(e) =>
                    setBusinessRulesDraft({ ...businessRulesDraft, followupFirstCallMin: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Double Call (min)</Label>
                <Input
                  type="number"
                  value={Number(businessRulesDraft.followupDoubleCallMin ?? 0)}
                  onChange={(e) =>
                    setBusinessRulesDraft({ ...businessRulesDraft, followupDoubleCallMin: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Second Text (min)</Label>
                <Input
                  type="number"
                  value={Number(businessRulesDraft.followupSecondTextMin ?? 0)}
                  onChange={(e) =>
                    setBusinessRulesDraft({ ...businessRulesDraft, followupSecondTextMin: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Final Call (min)</Label>
                <Input
                  type="number"
                  value={Number(businessRulesDraft.followupFinalCallMin ?? 0)}
                  onChange={(e) =>
                    setBusinessRulesDraft({ ...businessRulesDraft, followupFinalCallMin: Number(e.target.value) })
                  }
                />
              </div>
            </CardContent>
            <CardContent className="pt-0">
              <Button onClick={saveBusinessRules} disabled={saving || loading} variant="outline">
                {saving ? "Saving…" : "Save follow-up timing"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Business Hours</CardTitle>
              <CardDescription>
                Define when automated calls can be made
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={String(businessRulesDraft.businessHoursStart ?? "09:00")}
                  onChange={(e) => setBusinessRulesDraft({ ...businessRulesDraft, businessHoursStart: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={String(businessRulesDraft.businessHoursEnd ?? "17:00")}
                  onChange={(e) => setBusinessRulesDraft({ ...businessRulesDraft, businessHoursEnd: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Timezone</Label>
                <Input
                  value={String(businessRulesDraft.timezone ?? "")}
                  onChange={(e) => setBusinessRulesDraft({ ...businessRulesDraft, timezone: e.target.value })}
                />
              </div>
            </CardContent>
            <CardContent className="pt-0">
              <Button onClick={saveBusinessRules} disabled={saving || loading} variant="outline">
                {saving ? "Saving…" : "Save business hours"}
              </Button>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={saveBusinessRules} disabled={saving || loading}>
              {saving ? "Saving…" : "Save all business settings"}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="pricing" className="space-y-6">
          {pricingError && <p className="text-sm text-destructive">{pricingError}</p>}

          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Pricing Configuration</h3>
              <p className="text-sm text-muted-foreground">
                Set prices for Standard and Deep cleaning services by bedroom/bathroom count
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={resetPricingToDefaults}
                disabled={pricingLoading || pricingSaving}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Reset to Defaults
              </Button>
              <Button onClick={savePricing} disabled={pricingLoading || pricingSaving}>
                <Save className="w-4 h-4 mr-2" />
                {pricingSaving ? "Saving…" : "Save Pricing"}
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Standard Cleaning Prices</CardTitle>
              <CardDescription>
                Pricing for regular cleaning services
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pricingLoading ? (
                <p className="text-sm text-muted-foreground">Loading pricing...</p>
              ) : standardTiers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pricing tiers configured. Click "Reset to Defaults" to initialize.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">Beds</th>
                        <th className="text-left py-2 px-2">Baths</th>
                        <th className="text-left py-2 px-2">Max Sq Ft</th>
                        <th className="text-left py-2 px-2">Price ($)</th>
                        <th className="text-left py-2 px-2">Labor Hrs</th>
                        <th className="text-left py-2 px-2">Cleaners</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standardTiers.slice(0, 20).map((tier, idx) => (
                        <tr key={`standard-${idx}`} className="border-b">
                          <td className="py-2 px-2">{tier.bedrooms}</td>
                          <td className="py-2 px-2">{tier.bathrooms}</td>
                          <td className="py-2 px-2">{tier.max_sq_ft}</td>
                          <td className="py-2 px-2">
                            <Input
                              type="number"
                              step="0.01"
                              className="w-24 h-8"
                              value={tier.price}
                              onChange={(e) => updateTier('standard', idx, 'price', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td className="py-2 px-2">
                            <Input
                              type="number"
                              step="0.25"
                              className="w-20 h-8"
                              value={tier.labor_hours}
                              onChange={(e) => updateTier('standard', idx, 'labor_hours', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td className="py-2 px-2">
                            <Input
                              type="number"
                              className="w-16 h-8"
                              value={tier.cleaners}
                              onChange={(e) => updateTier('standard', idx, 'cleaners', parseInt(e.target.value) || 1)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {standardTiers.length > 20 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Showing first 20 of {standardTiers.length} tiers
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Deep Cleaning Prices</CardTitle>
              <CardDescription>
                Pricing for deep cleaning and move-in/out services
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pricingLoading ? (
                <p className="text-sm text-muted-foreground">Loading pricing...</p>
              ) : deepTiers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pricing tiers configured.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">Beds</th>
                        <th className="text-left py-2 px-2">Baths</th>
                        <th className="text-left py-2 px-2">Max Sq Ft</th>
                        <th className="text-left py-2 px-2">Price ($)</th>
                        <th className="text-left py-2 px-2">Labor Hrs</th>
                        <th className="text-left py-2 px-2">Cleaners</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deepTiers.slice(0, 20).map((tier, idx) => (
                        <tr key={`deep-${idx}`} className="border-b">
                          <td className="py-2 px-2">{tier.bedrooms}</td>
                          <td className="py-2 px-2">{tier.bathrooms}</td>
                          <td className="py-2 px-2">{tier.max_sq_ft}</td>
                          <td className="py-2 px-2">
                            <Input
                              type="number"
                              step="0.01"
                              className="w-24 h-8"
                              value={tier.price}
                              onChange={(e) => updateTier('deep', idx, 'price', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td className="py-2 px-2">
                            <Input
                              type="number"
                              step="0.25"
                              className="w-20 h-8"
                              value={tier.labor_hours}
                              onChange={(e) => updateTier('deep', idx, 'labor_hours', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td className="py-2 px-2">
                            <Input
                              type="number"
                              className="w-16 h-8"
                              value={tier.cleaners}
                              onChange={(e) => updateTier('deep', idx, 'cleaners', parseInt(e.target.value) || 1)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {deepTiers.length > 20 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Showing first 20 of {deepTiers.length} tiers
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add-ons</CardTitle>
              <CardDescription>
                Configure pricing for additional services
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pricingLoading ? (
                <p className="text-sm text-muted-foreground">Loading addons...</p>
              ) : addons.length === 0 ? (
                <p className="text-sm text-muted-foreground">No add-ons configured.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">Add-on</th>
                        <th className="text-left py-2 px-2">Label</th>
                        <th className="text-left py-2 px-2">Minutes</th>
                        <th className="text-left py-2 px-2">Flat Price ($)</th>
                        <th className="text-left py-2 px-2">Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {addons.map((addon, idx) => (
                        <tr key={addon.addon_key} className="border-b">
                          <td className="py-2 px-2 font-mono text-xs">{addon.addon_key}</td>
                          <td className="py-2 px-2">
                            <Input
                              className="w-40 h-8"
                              value={addon.label}
                              onChange={(e) => updateAddon(idx, 'label', e.target.value)}
                            />
                          </td>
                          <td className="py-2 px-2">
                            <Input
                              type="number"
                              className="w-20 h-8"
                              value={addon.minutes}
                              onChange={(e) => updateAddon(idx, 'minutes', parseInt(e.target.value) || 0)}
                            />
                          </td>
                          <td className="py-2 px-2">
                            <Input
                              type="number"
                              step="0.01"
                              className="w-24 h-8"
                              value={addon.flat_price ?? ''}
                              placeholder="Time-based"
                              onChange={(e) => updateAddon(idx, 'flat_price', e.target.value ? parseFloat(e.target.value) : null as any)}
                            />
                          </td>
                          <td className="py-2 px-2">
                            <Switch
                              checked={addon.active}
                              onCheckedChange={(checked) => updateAddon(idx, 'active', checked)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Admin Contacts</CardTitle>
              <CardDescription>
                Configure who receives escalations and critical alerts
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Owner Phone Number</Label>
                <Input
                  placeholder="+1 (555) 123-4567"
                  value={String(businessRulesDraft.ownerPhone ?? "")}
                  onChange={(e) => setBusinessRulesDraft({ ...businessRulesDraft, ownerPhone: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Receives escalations and critical system alerts
                </p>
              </div>
              <div className="space-y-2">
                <Label>Admin Email</Label>
                <Input
                  type="email"
                  placeholder="admin@winbros.com"
                  value={String(businessRulesDraft.adminEmail ?? "")}
                  onChange={(e) => setBusinessRulesDraft({ ...businessRulesDraft, adminEmail: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Receives daily reports and system notifications
                </p>
              </div>
            </CardContent>
            <CardContent className="pt-0">
              <Button onClick={saveBusinessRules} disabled={saving || loading} variant="outline">
                {saving ? "Saving…" : "Save admin contacts"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>API Access</CardTitle>
              <CardDescription>
                Manage API keys and webhook security
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  API keys are managed through environment variables in your Vercel dashboard.
                  Never expose API keys in client-side code.
                </p>
              </div>
              <Button variant="outline">View Environment Variables</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
