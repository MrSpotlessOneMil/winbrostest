"use client"

import { useEffect, useState, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ShieldCheck,
  RefreshCcw,
  Building2,
  Phone,
  MessageSquare,
  Settings2,
  Power,
  PowerOff,
  AlertTriangle,
  CheckCircle2,
  Key,
  Plus,
  Eye,
  EyeOff,
  Save,
  X,
  Copy,
  Check,
  Trash2,
  Loader2,
  Calendar,
  Megaphone,
  Edit,
  Clock,
  ClipboardList,
  ExternalLink,
  Users,
} from "lucide-react"
import { CleanersManager } from "./cleaners-manager"

interface WorkflowConfig {
  use_housecall_pro: boolean
  use_vapi_inbound: boolean
  use_vapi_outbound: boolean
  use_ghl: boolean
  use_stripe: boolean
  use_wave: boolean
  use_route_optimization: boolean
  lead_followup_enabled: boolean
  lead_followup_stages: number
  skip_calls_for_sms_leads: boolean
  followup_delays_minutes: number[]
  post_cleaning_followup_enabled: boolean
  post_cleaning_delay_hours: number
  monthly_followup_enabled: boolean
  monthly_followup_days: number
  monthly_followup_discount: string
  cleaner_assignment_auto: boolean
  require_deposit: boolean
  deposit_percentage: number
  sms_auto_response_enabled?: boolean
  // Lifecycle messaging
  seasonal_reminders_enabled?: boolean
  frequency_nudge_enabled?: boolean
  frequency_nudge_days?: number
  review_only_followup_enabled?: boolean
  seasonal_campaigns?: SeasonalCampaign[]
  // Flow flags (multi-tenant v2)
  use_hcp_mirror?: boolean
  use_rainy_day_reschedule?: boolean
  use_team_routing?: boolean
  use_cleaner_dispatch?: boolean
  use_review_request?: boolean
  use_retargeting?: boolean
  use_payment_collection?: boolean
}

interface SeasonalCampaign {
  id: string
  name: string
  message: string
  start_date: string
  end_date: string
  target_segment: 'all' | 'inactive_30' | 'inactive_60' | 'inactive_90' | 'completed_customers'
  enabled: boolean
  created_at: string
  last_sent_at: string | null
}

interface Tenant {
  id: string
  name: string
  slug: string
  email: string | null
  business_name: string | null
  business_name_short: string | null
  service_area: string | null
  service_description: string | null
  timezone: string
  sdr_persona: string | null
  owner_phone: string | null
  owner_email: string | null
  google_review_link: string | null
  // OpenPhone
  openphone_api_key: string | null
  openphone_phone_id: string | null
  openphone_phone_number: string | null
  // VAPI
  vapi_api_key: string | null
  vapi_assistant_id: string | null
  vapi_outbound_assistant_id: string | null
  vapi_phone_id: string | null
  // Stripe
  stripe_secret_key: string | null
  stripe_publishable_key: string | null
  stripe_webhook_secret: string | null
  // HousecallPro
  housecall_pro_api_key: string | null
  housecall_pro_company_id: string | null
  housecall_pro_webhook_secret: string | null
  // GHL
  ghl_location_id: string | null
  ghl_webhook_secret: string | null
  // Telegram
  telegram_bot_token: string | null
  owner_telegram_chat_id: string | null
  // Wave
  wave_api_token: string | null
  wave_business_id: string | null
  wave_income_account_id: string | null
  // Gmail (Email Bot)
  gmail_user: string | null
  gmail_app_password: string | null
  // Webhook registration timestamps
  telegram_webhook_registered_at: string | null
  stripe_webhook_registered_at: string | null
  openphone_webhook_registered_at: string | null
  vapi_webhook_registered_at: string | null
  // Webhook error tracking
  telegram_webhook_error: string | null
  telegram_webhook_error_at: string | null
  stripe_webhook_error: string | null
  stripe_webhook_error_at: string | null
  openphone_webhook_error: string | null
  openphone_webhook_error_at: string | null
  vapi_webhook_error: string | null
  vapi_webhook_error_at: string | null
  // Status
  workflow_config: WorkflowConfig
  active: boolean
  created_at: string
  updated_at: string
  // Injected by GET route (not in DB)
  cleaner_count: number
  pricing_tier_count: number
  webhook_health: {
    housecall_pro: { last_event_at: string; last_event_type: string } | null
    ghl: { last_event_at: string; last_event_type: string } | null
    vapi: { last_event_at: string; last_event_type: string } | null
  }
}

// Helper to mask API keys for display
function maskKey(key: string | null): string {
  if (!key) return ""
  if (key.length <= 8) return "••••••••"
  return "••••••••" + key.slice(-4)
}

export default function AdminPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [selectedTenant, setSelectedTenantRaw] = useState<string | null>(searchParams.get("tenant"))

  // Onboarding wizard state
  const [showAddModal, setShowAddModal] = useState(false)
  const [onboardStep, setOnboardStep] = useState(0) // 0=info, 1=creds, 2=review/execute
  const [onboardForm, setOnboardForm] = useState({
    // Step 1 — Business Info
    name: "",
    slug: "",
    password: "",
    flow_type: "spotless" as "winbros" | "spotless" | "cedar",
    business_name: "",
    business_name_short: "",
    service_area: "",
    service_description: "",
    timezone: "America/Chicago",
    sdr_persona: "Mary",
    owner_phone: "",
    owner_email: "",
    google_review_link: "",
    // Step 2 — API Credentials
    openphone_api_key: "",
    openphone_phone_id: "",
    openphone_phone_number: "",
    telegram_bot_token: "",
    owner_telegram_chat_id: "",
    stripe_secret_key: "",
    stripe_publishable_key: "",
    vapi_api_key: "",
    vapi_assistant_id: "",
    vapi_outbound_assistant_id: "",
    vapi_phone_id: "",
    housecall_pro_api_key: "",
    housecall_pro_company_id: "",
    wave_api_token: "",
    wave_business_id: "",
    wave_income_account_id: "",
    ghl_location_id: "",
    gmail_user: "",
    gmail_app_password: "",
    seed_pricing: "default" as "default" | "skip",
  })
  const [onboarding, setOnboarding] = useState(false)
  const [onboardResults, setOnboardResults] = useState<any>(null)
  const [wizardTesting, setWizardTesting] = useState<string | null>(null)
  const [wizardTestResults, setWizardTestResults] = useState<Record<string, { success: boolean; message: string }>>({})
  const [showExtraServices, setShowExtraServices] = useState(false)
  const [customServices, setCustomServices] = useState<Array<{ name: string; fields: Array<{ key: string; value: string }> }>>([])
  const [wizardRegistering, setWizardRegistering] = useState<string | null>(null)
  const [wizardRegisterResults, setWizardRegisterResults] = useState<Record<string, { success: boolean; message: string; secret?: string }>>({})
  const [vapiCloning, setVapiCloning] = useState(false)
  const [vapiCloneResult, setVapiCloneResult] = useState<{ inbound?: string; outbound?: string } | null>(null)

  // Credentials editing state
  const [editingCredentials, setEditingCredentials] = useState<Partial<Tenant>>({})
  const [savingCredentials, setSavingCredentials] = useState(false)
  const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set())

  // Tab state - persists in URL across reloads
  const [activeTab, setActiveTabRaw] = useState(searchParams.get("tab") || "controls")

  // Sync state to URL params so they survive reloads
  const updateUrlParams = useCallback((params: Record<string, string | null>) => {
    const url = new URL(window.location.href)
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
    router.replace(url.pathname + url.search, { scroll: false })
  }, [router])

  const setSelectedTenant = useCallback((id: string | null) => {
    setSelectedTenantRaw(id)
    updateUrlParams({ tenant: id })
  }, [updateUrlParams])

  const setActiveTab = useCallback((tab: string) => {
    setActiveTabRaw(tab)
    updateUrlParams({ tab })
  }, [updateUrlParams])

  // Copy all credentials state
  const [copied, setCopied] = useState(false)

  // Reset test customers state
  const [resettingPerson, setResettingPerson] = useState<string | null>(null)
  const [resetResult, setResetResult] = useState<{ success: boolean; deletions?: string[]; error?: string; person?: string } | null>(null)

  // Delete business state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Copy URL state
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  // Campaign management state
  const [showCampaignModal, setShowCampaignModal] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState<SeasonalCampaign | null>(null)
  const [campaignForm, setCampaignForm] = useState({
    name: "",
    message: "",
    start_date: "",
    end_date: "",
    target_segment: "all" as SeasonalCampaign["target_segment"],
    enabled: true,
  })

  // Connection test state
  const [testingService, setTestingService] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string; webhookStatus?: "verified" | "warning" | "mismatch" | null }>>({})

  // Webhook registration state
  const [registeringWebhook, setRegisteringWebhook] = useState<string | null>(null)
  const [webhookResults, setWebhookResults] = useState<Record<string, { success: boolean; message: string }>>({})

  // Webhook verification state
  const [verifyingWebhooks, setVerifyingWebhooks] = useState(false)
  const [webhookVerification, setWebhookVerification] = useState<Record<string, { active: boolean; message: string }>>({})

  // Bulk action state
  const [testingAll, setTestingAll] = useState(false)
  const [registeringAll, setRegisteringAll] = useState(false)
  const [webhookConfirmOpen, setWebhookConfirmOpen] = useState(false)
  const [webhookConfirmAction, setWebhookConfirmAction] = useState<(() => void) | null>(null)
  const [webhookConfirmService, setWebhookConfirmService] = useState("")

  function confirmWebhookRegistration(service: string, action: () => void) {
    setWebhookConfirmService(service)
    setWebhookConfirmAction(() => action)
    setWebhookConfirmOpen(true)
  }

  async function fetchTenants() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/tenants", { cache: "no-store" })
      const json = await res.json()
      if (!res.ok) {
        if (res.status === 401) {
          setError("You must be logged in as admin to access this page.")
        } else {
          setError(json.error || "Failed to load tenants")
        }
        return
      }
      setTenants(json.data || [])
      if (json.data?.length > 0 && !selectedTenant) {
        selectTenant(json.data[0].id)
      }
    } catch (e: any) {
      setError(e.message || "Failed to load tenants")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTenants()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-trigger connection checks when entering Step 3
  useEffect(() => {
    if (onboardStep === 2 && !onboardResults && !onboarding) {
      testAllConnectionsDirect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardStep])

  async function updateTenant(tenantId: string, updates: Partial<Tenant> | { workflow_config: Partial<WorkflowConfig> }) {
    setUpdating(tenantId)
    try {
      const res = await fetch("/api/admin/tenants", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, updates }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || "Failed to update tenant")
      }
      // Refresh the list
      await fetchTenants()
    } catch (e: any) {
      setError(e.message || "Failed to update tenant")
    } finally {
      setUpdating(null)
    }
  }

  async function toggleSmsEnabled(tenant: Tenant) {
    const currentValue = tenant.workflow_config.sms_auto_response_enabled !== false
    await updateTenant(tenant.id, {
      workflow_config: {
        sms_auto_response_enabled: !currentValue,
      },
    })
  }

  async function toggleActive(tenant: Tenant) {
    await updateTenant(tenant.id, { active: !tenant.active })
  }

  function resetOnboardWizard() {
    setOnboardStep(0)
    setOnboardForm({
      name: "", slug: "", password: "", flow_type: "spotless",
      business_name: "", business_name_short: "", service_area: "", service_description: "",
      timezone: "America/Chicago", sdr_persona: "Mary",
      owner_phone: "", owner_email: "", google_review_link: "",
      openphone_api_key: "", openphone_phone_id: "", openphone_phone_number: "",
      telegram_bot_token: "", owner_telegram_chat_id: "",
      stripe_secret_key: "", stripe_publishable_key: "",
      vapi_api_key: "", vapi_assistant_id: "", vapi_outbound_assistant_id: "", vapi_phone_id: "",
      housecall_pro_api_key: "", housecall_pro_company_id: "",
      wave_api_token: "", wave_business_id: "", wave_income_account_id: "",
      ghl_location_id: "",
      gmail_user: "",
      gmail_app_password: "",
      seed_pricing: "default",
    })
    setOnboarding(false)
    setOnboardResults(null)
    setWizardTesting(null)
    setWizardTestResults({})
    setShowExtraServices(false)
    setCustomServices([])
    setWizardRegistering(null)
    setWizardRegisterResults({})
  }

  async function testAllConnectionsDirect() {
    const tests: Array<{ service: string; credentials: Record<string, string> }> = []
    if (onboardForm.openphone_api_key && onboardForm.openphone_phone_id)
      tests.push({ service: "openphone", credentials: { openphone_api_key: onboardForm.openphone_api_key, openphone_phone_id: onboardForm.openphone_phone_id } })
    if (onboardForm.telegram_bot_token)
      tests.push({ service: "telegram", credentials: { telegram_bot_token: onboardForm.telegram_bot_token } })
    if (onboardForm.stripe_secret_key)
      tests.push({ service: "stripe", credentials: { stripe_secret_key: onboardForm.stripe_secret_key } })
    if (onboardForm.vapi_api_key)
      tests.push({ service: "vapi-key-only", credentials: { vapi_api_key: onboardForm.vapi_api_key } })
    if (onboardForm.wave_api_token && onboardForm.wave_business_id)
      tests.push({ service: "wave", credentials: { wave_api_token: onboardForm.wave_api_token, wave_business_id: onboardForm.wave_business_id } })
    if (onboardForm.gmail_user && onboardForm.gmail_app_password)
      tests.push({ service: "gmail", credentials: { gmail_user: onboardForm.gmail_user, gmail_app_password: onboardForm.gmail_app_password } })
    if (tests.length === 0) return
    setWizardTesting("all")
    const results = await Promise.allSettled(
      tests.map(async (t) => {
        const res = await fetch("/api/admin/test-connection-direct", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(t),
        })
        if (!res.ok) return { service: t.service, success: false, message: `HTTP ${res.status}` }
        const json = await res.json()
        return { service: t.service, success: json.success, message: json.message || json.error || "Unknown" }
      })
    )
    const newResults: Record<string, { success: boolean; message: string }> = {}
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === "fulfilled") {
        newResults[r.value.service] = { success: r.value.success, message: r.value.message }
      } else {
        newResults[tests[i].service] = { success: false, message: r.reason?.message || "Test failed" }
      }
    }
    setWizardTestResults((prev) => ({ ...prev, ...newResults }))
    setWizardTesting(null)
  }

  async function testConnectionDirect(service: string, credentials: Record<string, string>) {
    setWizardTesting(service)
    try {
      const res = await fetch("/api/admin/test-connection-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, credentials }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setWizardTestResults((prev) => ({
        ...prev,
        [service]: { success: json.success, message: json.message || json.error || "Unknown" },
      }))
    } catch (e: any) {
      setWizardTestResults((prev) => ({
        ...prev,
        [service]: { success: false, message: e.message || "Test failed" },
      }))
    } finally {
      setWizardTesting(null)
    }
  }

  async function registerWebhookDirect(service: string, credentials: Record<string, string>) {
    setWizardRegistering(service)
    try {
      const res = await fetch("/api/admin/register-webhook-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, credentials }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setWizardRegisterResults((prev) => ({
        ...prev,
        [service]: { success: json.success, message: json.message || json.error || "Unknown", secret: json.secret },
      }))
    } catch (e: any) {
      setWizardRegisterResults((prev) => ({
        ...prev,
        [service]: { success: false, message: e.message || "Registration failed" },
      }))
    } finally {
      setWizardRegistering(null)
    }
  }

  async function cloneVapiAssistants() {
    setVapiCloning(true)
    setVapiCloneResult(null)
    try {
      const res = await fetch("/api/admin/clone-vapi-assistants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vapi_api_key: onboardForm.vapi_api_key,
          flow_type: onboardForm.flow_type,
          slug: onboardForm.slug,
          business_name: onboardForm.business_name || onboardForm.name,
          service_area: onboardForm.service_area,
          service_type: onboardForm.service_description,
          sdr_persona: onboardForm.sdr_persona,
        }),
      })
      if (!res.ok) throw new Error(`Clone failed (HTTP ${res.status})`)
      const json = await res.json()
      if (json.success) {
        const result: { inbound?: string; outbound?: string } = {}
        if (json.inbound_assistant_id) {
          result.inbound = json.inbound_assistant_id
          setOnboardForm((prev) => ({ ...prev, vapi_assistant_id: json.inbound_assistant_id }))
        }
        if (json.outbound_assistant_id) {
          result.outbound = json.outbound_assistant_id
          setOnboardForm((prev) => ({ ...prev, vapi_outbound_assistant_id: json.outbound_assistant_id }))
        }
        setVapiCloneResult(result)
      } else {
        setVapiCloneResult(null)
        setWizardTestResults((prev) => ({
          ...prev,
          "vapi-clone": { success: false, message: json.error || "Clone failed" },
        }))
      }
    } catch (e: any) {
      setWizardTestResults((prev) => ({
        ...prev,
        "vapi-clone": { success: false, message: e.message || "Clone failed" },
      }))
    } finally {
      setVapiCloning(false)
    }
  }

  async function runOnboarding() {
    setOnboarding(true)
    setOnboardResults(null)
    setError(null)
    try {
      // Build payload — only include non-empty fields
      const payload: Record<string, any> = {}
      for (const [k, v] of Object.entries(onboardForm)) {
        if (v !== "") payload[k] = v
      }
      // Default password to slug if not provided (matches placeholder hint)
      if (!payload.password && payload.slug) {
        payload.password = payload.slug
      }
      // Include custom services as custom_credentials
      if (customServices.length > 0) {
        const cc: Record<string, Record<string, string>> = {}
        for (const svc of customServices) {
          if (svc.name.trim()) {
            const fields: Record<string, string> = {}
            for (const f of svc.fields) {
              if (f.key.trim() && f.value.trim()) fields[f.key.trim()] = f.value.trim()
            }
            if (Object.keys(fields).length > 0) cc[svc.name.trim()] = fields
          }
        }
        if (Object.keys(cc).length > 0) payload.custom_credentials = cc
      }
      const res = await fetch("/api/admin/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok && !res.headers.get("content-type")?.includes("application/json")) {
        throw new Error(`Server error (HTTP ${res.status})`)
      }
      const json = await res.json()
      if (json.success && json.result?.tenantId && !json.partial) {
        // Full success — navigate directly to the new tenant
        await fetchTenants()
        selectTenant(json.result.tenantId)
        setShowAddModal(false)
        resetOnboardWizard()
      } else if (json.result) {
        // Pipeline ran but had partial failures — show step-by-step results
        setOnboardResults(json.result)
        if (json.result.tenantId) await fetchTenants()
      } else {
        // API returned an error before pipeline started
        setError(json.error || "Onboarding failed")
      }
    } catch (e: any) {
      setError(e.message || "Onboarding failed")
    } finally {
      setOnboarding(false)
    }
  }

  async function saveCredentials() {
    if (!selectedTenant || Object.keys(editingCredentials).length === 0) return
    setSavingCredentials(true)
    try {
      await updateTenant(selectedTenant, editingCredentials)
      setEditingCredentials({})
      setRevealedFields(new Set())
    } catch (e: any) {
      setError(e.message || "Failed to save credentials")
    } finally {
      setSavingCredentials(false)
    }
  }

  function toggleReveal(fieldName: string) {
    setRevealedFields((prev) => {
      const next = new Set(prev)
      if (next.has(fieldName)) {
        next.delete(fieldName)
      } else {
        next.add(fieldName)
      }
      return next
    })
  }

  function getFieldValue(tenant: Tenant, field: keyof Tenant): string {
    // Check if we have a pending edit
    if (field in editingCredentials) {
      return (editingCredentials as any)[field] ?? ""
    }
    return (tenant as any)[field] ?? ""
  }

  function setFieldValue(field: keyof Tenant, value: string) {
    setEditingCredentials((prev) => ({ ...prev, [field]: value }))
  }

  function copyAllCredentials() {
    if (!currentTenant) return

    const credentialFields = [
      { label: "Slug", value: currentTenant.slug },
      { label: "Business Name", value: currentTenant.business_name },
      { label: "Short Name", value: currentTenant.business_name_short },
      { label: "Service Area", value: currentTenant.service_area },
      { label: "Service Type", value: currentTenant.service_description },
      { label: "Timezone", value: currentTenant.timezone },
      { label: "SDR Persona", value: currentTenant.sdr_persona },
      { label: "Owner Phone", value: currentTenant.owner_phone },
      { label: "Owner Email", value: currentTenant.owner_email },
      { label: "Google Review Link", value: currentTenant.google_review_link },
      { label: "OpenPhone API Key", value: currentTenant.openphone_api_key },
      { label: "OpenPhone Phone ID", value: currentTenant.openphone_phone_id },
      { label: "OpenPhone Phone Number", value: currentTenant.openphone_phone_number },
      { label: "VAPI API Key", value: currentTenant.vapi_api_key },
      { label: "VAPI Inbound Assistant ID", value: currentTenant.vapi_assistant_id },
      { label: "VAPI Outbound Assistant ID", value: currentTenant.vapi_outbound_assistant_id },
      { label: "VAPI Phone ID", value: currentTenant.vapi_phone_id },
      { label: "Stripe Secret Key", value: currentTenant.stripe_secret_key },
      { label: "Stripe Webhook Secret", value: currentTenant.stripe_webhook_secret },
      { label: "HousecallPro API Key", value: currentTenant.housecall_pro_api_key },
      { label: "HousecallPro Company ID", value: currentTenant.housecall_pro_company_id },
      { label: "HousecallPro Webhook Secret", value: currentTenant.housecall_pro_webhook_secret },
      { label: "GHL Location ID", value: currentTenant.ghl_location_id },
      { label: "GHL Webhook Secret", value: currentTenant.ghl_webhook_secret },
      { label: "Telegram Bot Token", value: currentTenant.telegram_bot_token },
      { label: "Telegram Owner Chat ID", value: currentTenant.owner_telegram_chat_id },
      { label: "Wave API Token", value: currentTenant.wave_api_token },
      { label: "Wave Business ID", value: currentTenant.wave_business_id },
      { label: "Wave Income Account ID", value: currentTenant.wave_income_account_id },
      { label: "Gmail User", value: currentTenant.gmail_user },
      { label: "Gmail App Password", value: currentTenant.gmail_app_password },
    ]

    const text = credentialFields
      .filter((f) => f.value)
      .map((f) => `${f.label}: ${f.value}`)
      .join("\n")

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const testPersons = [
    { name: "Dominic", phone: "4242755847" },
    { name: "Daniel", phone: "4243270461" },
    { name: "Jack", phone: "4157204580", email: "JasperGrenager@gmail.com" },
  ]

  async function resetPerson(person: { name: string; phone: string; email?: string }) {
    setResettingPerson(person.name)
    setResetResult(null)

    try {
      const res = await fetch("/api/admin/reset-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: person.phone, email: person.email }),
      })
      const json = await res.json()

      if (res.ok && json.success && json.data?.deletions?.length > 0) {
        setResetResult({ success: true, deletions: json.data.deletions, person: person.name })
      } else if (!res.ok) {
        setResetResult({ success: false, error: json.error || "Unknown error", person: person.name })
      } else {
        setResetResult({ success: true, deletions: ["No data found"], person: person.name })
      }
    } catch (e: any) {
      setResetResult({ success: false, error: e.message, person: person.name })
    }

    setResettingPerson(null)
  }

  async function deleteBusiness(tenantId: string) {
    setDeleting(true)
    try {
      const res = await fetch("/api/admin/tenants", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || "Failed to delete business")
      }
      setShowDeleteConfirm(false)
      selectTenant(null)
      await fetchTenants()
    } catch (e: any) {
      setError(e.message || "Failed to delete business")
    } finally {
      setDeleting(false)
    }
  }

  function getWebhookUrl(slug: string, service: string): string {
    const base = typeof window !== "undefined" ? window.location.origin : ""
    return `${base}/api/webhooks/${service}/${slug}`
  }

  function copyUrl(url: string, label: string) {
    navigator.clipboard.writeText(url)
    setCopiedUrl(label)
    setTimeout(() => setCopiedUrl(null), 2000)
  }

  function getFlowType(config: WorkflowConfig): string {
    if (config.use_hcp_mirror && config.use_team_routing) return "winbros"
    if (!config.use_hcp_mirror && !config.use_team_routing && config.use_payment_collection) return "spotless"
    if (!config.use_hcp_mirror && !config.use_team_routing && !config.use_payment_collection) return "cedar"
    return "custom"
  }

  async function setFlowType(tenant: Tenant, flowType: string) {
    if (flowType === "winbros") {
      // Window washing: full flow with HCP mirror + team routing + dispatch + reviews + retargeting
      await updateTenant(tenant.id, {
        workflow_config: {
          use_housecall_pro: true,
          use_route_optimization: true,
          use_hcp_mirror: true,
          use_rainy_day_reschedule: true,
          use_team_routing: true,
          use_cleaner_dispatch: true,
          use_review_request: true,
          use_retargeting: true,
          use_payment_collection: true,
          cleaner_assignment_auto: true,
          skip_calls_for_sms_leads: true,
          use_vapi_inbound: true,
          use_vapi_outbound: true,
        },
      })
    } else if (flowType === "spotless") {
      // House cleaning: call → booked → paid → dispatch → review → retargeting
      await updateTenant(tenant.id, {
        workflow_config: {
          use_housecall_pro: false,
          use_route_optimization: false,
          use_hcp_mirror: false,
          use_rainy_day_reschedule: false,
          use_team_routing: false,
          use_cleaner_dispatch: true,
          use_review_request: true,
          use_retargeting: true,
          use_payment_collection: true,
          cleaner_assignment_auto: false,
          skip_calls_for_sms_leads: false,
          use_vapi_inbound: true,
          use_vapi_outbound: true,
        },
      })
    } else if (flowType === "cedar") {
      // Simple: call → booked → review only (no payment, no dispatch)
      await updateTenant(tenant.id, {
        workflow_config: {
          use_housecall_pro: false,
          use_route_optimization: false,
          use_hcp_mirror: false,
          use_rainy_day_reschedule: false,
          use_team_routing: false,
          use_cleaner_dispatch: false,
          use_review_request: true,
          use_retargeting: false,
          use_payment_collection: false,
          cleaner_assignment_auto: false,
          skip_calls_for_sms_leads: true,
          use_vapi_inbound: true,
          use_vapi_outbound: false,
        },
      })
    }
  }

  function openCampaignModal(campaign?: SeasonalCampaign) {
    if (campaign) {
      setEditingCampaign(campaign)
      setCampaignForm({
        name: campaign.name,
        message: campaign.message,
        start_date: campaign.start_date,
        end_date: campaign.end_date,
        target_segment: campaign.target_segment,
        enabled: campaign.enabled,
      })
    } else {
      setEditingCampaign(null)
      setCampaignForm({
        name: "",
        message: "",
        start_date: "",
        end_date: "",
        target_segment: "all",
        enabled: true,
      })
    }
    setShowCampaignModal(true)
  }

  async function saveCampaign() {
    if (!currentTenant || !campaignForm.name || !campaignForm.message || !campaignForm.start_date || !campaignForm.end_date) return

    const campaigns = [...(currentTenant.workflow_config.seasonal_campaigns || [])]

    if (editingCampaign) {
      const idx = campaigns.findIndex((c) => c.id === editingCampaign.id)
      if (idx >= 0) {
        campaigns[idx] = {
          ...campaigns[idx],
          name: campaignForm.name,
          message: campaignForm.message,
          start_date: campaignForm.start_date,
          end_date: campaignForm.end_date,
          target_segment: campaignForm.target_segment,
          enabled: campaignForm.enabled,
        }
      }
    } else {
      campaigns.push({
        id: crypto.randomUUID(),
        name: campaignForm.name,
        message: campaignForm.message,
        start_date: campaignForm.start_date,
        end_date: campaignForm.end_date,
        target_segment: campaignForm.target_segment,
        enabled: campaignForm.enabled,
        created_at: new Date().toISOString(),
        last_sent_at: null,
      })
    }

    await updateTenant(currentTenant.id, {
      workflow_config: { seasonal_campaigns: campaigns } as any,
    })
    setShowCampaignModal(false)
  }

  async function deleteCampaign(campaignId: string) {
    if (!currentTenant) return
    const campaigns = (currentTenant.workflow_config.seasonal_campaigns || []).filter((c) => c.id !== campaignId)
    await updateTenant(currentTenant.id, {
      workflow_config: { seasonal_campaigns: campaigns } as any,
    })
  }

  async function toggleCampaignEnabled(campaignId: string) {
    if (!currentTenant) return
    const campaigns = [...(currentTenant.workflow_config.seasonal_campaigns || [])]
    const idx = campaigns.findIndex((c) => c.id === campaignId)
    if (idx >= 0) {
      campaigns[idx] = { ...campaigns[idx], enabled: !campaigns[idx].enabled }
      await updateTenant(currentTenant.id, {
        workflow_config: { seasonal_campaigns: campaigns } as any,
      })
    }
  }

  const SEGMENT_LABELS: Record<SeasonalCampaign["target_segment"], string> = {
    all: "All Customers",
    inactive_30: "Inactive 30+ days",
    inactive_60: "Inactive 60+ days",
    inactive_90: "Inactive 90+ days",
    completed_customers: "Past Completed",
  }

  // --- Setup progress & connection testing helpers ---

  function selectTenant(id: string | null) {
    setSelectedTenant(id)
    setTestResults({})
    setWebhookResults({})
    setWebhookVerification({})
    setEditingCredentials({})
    setRevealedFields(new Set())
  }

  function computeSetupChecks(tenant: Tenant) {
    const config = tenant.workflow_config
    const checks: { label: string; complete: boolean; enabled: boolean }[] = [
      {
        label: "Business Info",
        complete: !!(tenant.business_name && tenant.business_name_short && tenant.service_area && tenant.owner_phone),
        enabled: true,
      },
      {
        label: "OpenPhone",
        complete: !!(tenant.openphone_api_key && tenant.openphone_phone_id && tenant.openphone_phone_number),
        enabled: true,
      },
      {
        label: "Stripe",
        complete: !!tenant.stripe_secret_key,
        enabled: !!config.use_stripe,
      },
      {
        label: "VAPI",
        complete: !!(tenant.vapi_api_key && tenant.vapi_assistant_id),
        enabled: !!(config.use_vapi_inbound || config.use_vapi_outbound),
      },
      {
        label: "Telegram",
        complete: !!(tenant.telegram_bot_token && tenant.owner_telegram_chat_id),
        enabled: true,
      },
      {
        label: "HousecallPro",
        complete: !!(tenant.housecall_pro_api_key && tenant.housecall_pro_company_id),
        enabled: !!config.use_housecall_pro,
      },
      {
        label: "GHL",
        complete: !!tenant.ghl_location_id,
        enabled: !!config.use_ghl,
      },
      {
        label: "Wave",
        complete: !!(tenant.wave_api_token && tenant.wave_business_id),
        enabled: !!config.use_wave,
      },
      {
        label: "Telegram Webhook",
        complete: !!tenant.telegram_webhook_registered_at,
        enabled: !!tenant.telegram_bot_token,
      },
      {
        label: "Stripe Webhook",
        complete: !!tenant.stripe_webhook_registered_at,
        enabled: !!config.use_stripe && !!tenant.stripe_secret_key,
      },
      {
        label: "OpenPhone Webhook",
        complete: !!tenant.openphone_webhook_registered_at,
        enabled: !!tenant.openphone_api_key,
      },
      {
        label: "HCP Webhook",
        complete: !!tenant.webhook_health?.housecall_pro?.last_event_at,
        enabled: !!config.use_housecall_pro && !!tenant.housecall_pro_api_key,
      },
      {
        label: "GHL Webhook",
        complete: !!tenant.webhook_health?.ghl?.last_event_at,
        enabled: !!config.use_ghl && !!tenant.ghl_location_id,
      },
      {
        label: "VAPI Webhook",
        complete: !!tenant.vapi_webhook_registered_at || !!tenant.webhook_health?.vapi?.last_event_at,
        enabled: !!(config.use_vapi_inbound || config.use_vapi_outbound) && !!(tenant.vapi_api_key && tenant.vapi_assistant_id),
      },
      {
        label: "Cleaners",
        complete: (tenant.cleaner_count || 0) >= 1,
        enabled: true,
      },
      {
        label: "Pricing",
        complete: (tenant.pricing_tier_count || 0) >= 1,
        enabled: true,
      },
    ]

    const enabledChecks = checks.filter((c) => c.enabled)
    const completedCount = enabledChecks.filter((c) => c.complete).length
    const totalCount = enabledChecks.length
    const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

    return { checks, enabledChecks, completedCount, totalCount, percentage }
  }

  type IntegrationStatus = "connected" | "untested" | "not_configured"

  function getIntegrationStatus(service: string, tenant: Tenant): IntegrationStatus {
    const hasKeys = (() => {
      switch (service) {
        case "openphone": return !!(tenant.openphone_api_key && tenant.openphone_phone_id)
        case "stripe": return !!tenant.stripe_secret_key
        case "vapi": return !!(tenant.vapi_api_key && tenant.vapi_assistant_id)
        case "telegram": return !!tenant.telegram_bot_token
        case "housecall_pro": return !!(tenant.housecall_pro_api_key && tenant.housecall_pro_company_id)
        case "ghl": return !!tenant.ghl_location_id
        case "wave": return !!(tenant.wave_api_token && tenant.wave_business_id)
        default: return false
      }
    })()

    if (!hasKeys) return "not_configured"
    if (testResults[service]?.success) return "connected"
    return "untested"
  }

  async function testConnection(service: string) {
    if (!selectedTenant) return
    setTestingService(service)
    try {
      const res = await fetch("/api/admin/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: selectedTenant, service }),
      })
      const json = await res.json()
      setTestResults((prev) => ({
        ...prev,
        [service]: { success: json.success, message: json.message || json.error || "Unknown", webhookStatus: json.webhookStatus || null },
      }))
    } catch (err: any) {
      setTestResults((prev) => ({
        ...prev,
        [service]: { success: false, message: err.message || "Test failed" },
      }))
    } finally {
      setTestingService(null)
    }
  }

  async function registerWebhook(service: string) {
    if (!selectedTenant) return
    setRegisteringWebhook(service)
    try {
      const res = await fetch("/api/admin/register-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: selectedTenant, service }),
      })
      const json = await res.json()
      setWebhookResults((prev) => ({
        ...prev,
        [service]: { success: json.success, message: json.message || json.error || "Unknown" },
      }))
      if (json.success) {
        await fetchTenants()
      }
    } catch (err: any) {
      setWebhookResults((prev) => ({
        ...prev,
        [service]: { success: false, message: err.message || "Registration failed" },
      }))
    } finally {
      setRegisteringWebhook(null)
    }
  }

  async function testAllConnections() {
    if (!currentTenantRef) return
    if (Object.keys(editingCredentials).length > 0) {
      setError("Save pending credential changes before running Test All.")
      return
    }
    setTestingAll(true)
    const config = currentTenantRef.workflow_config
    const services: string[] = ["openphone", "telegram"]
    if (config.use_stripe) services.push("stripe")
    if (config.use_vapi_inbound || config.use_vapi_outbound) services.push("vapi")

    for (const service of services) {
      await testConnection(service)
    }
    setTestingAll(false)
  }

  async function registerAllWebhooks() {
    if (!currentTenantRef) return
    setRegisteringAll(true)
    const services: string[] = []
    if (currentTenantRef.telegram_bot_token) services.push("telegram")
    if (currentTenantRef.workflow_config.use_stripe && currentTenantRef.stripe_secret_key) services.push("stripe")
    if (currentTenantRef.openphone_api_key) services.push("openphone")
    if (currentTenantRef.vapi_api_key && currentTenantRef.vapi_assistant_id) services.push("vapi")

    for (const service of services) {
      await registerWebhook(service)
    }
    setRegisteringAll(false)
  }

  async function verifyAllWebhooks() {
    if (!currentTenantRef) return
    setVerifyingWebhooks(true)
    setWebhookVerification({})
    try {
      const res = await fetch("/api/admin/verify-webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: selectedTenant }),
      })
      const data = await res.json()
      if (data.success) {
        setWebhookVerification(data.results || {})
      } else {
        setError(data.error || "Webhook verification failed")
      }
    } catch (err: any) {
      setError(err.message || "Webhook verification failed")
    } finally {
      setVerifyingWebhooks(false)
    }
  }

  const currentTenantRef = tenants.find((t) => t.id === selectedTenant)
  const currentTenant = currentTenantRef

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-3 text-2xl font-semibold text-foreground">
            <ShieldCheck className="h-7 w-7 text-primary" />
            Admin Panel
          </h1>
          <div className="flex items-center gap-2">
            {testPersons.map((person) => (
              <button
                key={person.name}
                type="button"
                onClick={() => resetPerson(person)}
                disabled={resettingPerson !== null}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 rounded-md disabled:opacity-50 transition-colors"
                title={`Reset ${person.name} (${person.phone})`}
              >
                {resettingPerson === person.name ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="h-3.5 w-3.5" />
                )}
                {resettingPerson === person.name ? "Resetting..." : `Reset ${person.name}`}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Manage businesses, booking flows, and system controls</p>
        {resetResult && (
          <div className={`mt-2 p-2 rounded-lg border text-xs ${
            resetResult.success
              ? "border-green-500/30 bg-green-500/10"
              : "border-red-500/30 bg-red-500/10"
          }`}>
            {resetResult.success ? (
              <div className="flex items-center gap-2 text-green-400 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {resetResult.person} reset: {resetResult.deletions?.join(", ") || "No data found"}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-red-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {resetResult.person} reset failed: {resetResult.error}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <Alert className="border-destructive/30 bg-destructive/5">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertTitle className="text-destructive">Error</AlertTitle>
          <AlertDescription className="text-muted-foreground">{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading businesses...</div>
      ) : tenants.length === 0 ? (
        <Alert>
          <AlertTitle>No businesses found</AlertTitle>
          <AlertDescription>No businesses have been configured yet.</AlertDescription>
        </Alert>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Business List */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Businesses</CardTitle>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => setShowAddModal(true)} title="Add Business">
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={fetchTenants} disabled={loading}>
                    <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>
              <CardDescription>{tenants.length} business(es)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {tenants.map((tenant) => {
                const smsEnabled = tenant.workflow_config.sms_auto_response_enabled !== false
                return (
                  <button
                    key={tenant.id}
                    onClick={() => selectTenant(tenant.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedTenant === tenant.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm">{tenant.slug}</span>
                      </div>
                      {smsEnabled ? (
                        <Power className="h-4 w-4 text-green-500" />
                      ) : (
                        <PowerOff className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                    {tenant.openphone_phone_number && (
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        {tenant.openphone_phone_number}
                      </div>
                    )}
                    <div className="flex gap-1 mt-2">
                      {tenant.active ? (
                        <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/30">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs bg-red-500/10 text-red-600 border-red-500/30">
                          Inactive
                        </Badge>
                      )}
                      {smsEnabled ? (
                        <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/30">
                          SMS On
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-600 border-orange-500/30">
                          SMS Off
                        </Badge>
                      )}
                    </div>
                  </button>
                )
              })}
            </CardContent>
          </Card>

          {/* Business Details */}
          {currentTenant && (
            <Card className="lg:col-span-3">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{currentTenant.slug}</CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={currentTenant.active ? "default" : "destructive"}>
                      {currentTenant.active ? "Active" : "Inactive"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      onClick={() => setShowDeleteConfirm(true)}
                      title="Delete Business"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {/* Setup Progress Bar */}
              {(() => {
                const setup = computeSetupChecks(currentTenant)
                return (
                  <div className="px-6 pb-4 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Setup Progress</span>
                      <span className="font-medium text-green-500">
                        {setup.completedCount}/{setup.totalCount} Complete
                      </span>
                    </div>
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all duration-500"
                        style={{ width: `${setup.percentage}%` }}
                      />
                    </div>
                    {setup.percentage < 100 && (
                      <div className="flex flex-wrap gap-1.5">
                        {setup.enabledChecks.filter((c) => !c.complete).map((c) => (
                          <Badge key={c.label} variant="outline" className="text-xs text-orange-400 border-orange-500/30">
                            {c.label}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}

              <CardContent>
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                  <TabsList>
                    <TabsTrigger value="controls" className="gap-2">
                      <Power className="h-4 w-4" />
                      Controls
                    </TabsTrigger>
                    <TabsTrigger value="booking" className="gap-2">
                      <Settings2 className="h-4 w-4" />
                      Booking Flow
                    </TabsTrigger>
                    <TabsTrigger value="credentials" className="gap-2">
                      <Key className="h-4 w-4" />
                      Credentials
                    </TabsTrigger>
                    <TabsTrigger value="cleaners" className="gap-2">
                      <Users className="h-4 w-4" />
                      Cleaners
                    </TabsTrigger>
                    <TabsTrigger value="campaigns" className="gap-2">
                      <Megaphone className="h-4 w-4" />
                      Campaigns
                    </TabsTrigger>
                    <TabsTrigger value="info" className="gap-2">
                      <Building2 className="h-4 w-4" />
                      Info
                    </TabsTrigger>
                  </TabsList>

                  {/* Controls Tab - Kill Switches */}
                  <TabsContent value="controls" className="space-y-4">
                    <Alert className={
                      currentTenant.workflow_config.sms_auto_response_enabled !== false
                        ? "border-green-500/30 bg-green-500/5"
                        : "border-orange-500/30 bg-orange-500/5"
                    }>
                      <MessageSquare className="h-4 w-4" />
                      <AlertTitle>SMS Auto-Response</AlertTitle>
                      <AlertDescription>
                        {currentTenant.workflow_config.sms_auto_response_enabled !== false
                          ? "The system is actively responding to incoming text messages for this business."
                          : "SMS auto-responses are DISABLED. Incoming texts will be logged but not responded to."}
                      </AlertDescription>
                    </Alert>

                    <div className="space-y-4">
                      {/* SMS Kill Switch */}
                      <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${
                            currentTenant.workflow_config.sms_auto_response_enabled !== false
                              ? "bg-green-500/10"
                              : "bg-red-500/10"
                          }`}>
                            {currentTenant.workflow_config.sms_auto_response_enabled !== false ? (
                              <CheckCircle2 className="h-5 w-5 text-green-500" />
                            ) : (
                              <PowerOff className="h-5 w-5 text-red-500" />
                            )}
                          </div>
                          <div>
                            <div className="font-medium">SMS Auto-Response</div>
                            <div className="text-sm text-muted-foreground">
                              Toggle automatic AI responses to incoming texts
                            </div>
                          </div>
                        </div>
                        <Switch
                          checked={currentTenant.workflow_config.sms_auto_response_enabled !== false}
                          onCheckedChange={() => toggleSmsEnabled(currentTenant)}
                          disabled={updating === currentTenant.id}
                        />
                      </div>

                      {/* Business Active Toggle */}
                      <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${
                            currentTenant.active ? "bg-green-500/10" : "bg-red-500/10"
                          }`}>
                            {currentTenant.active ? (
                              <Power className="h-5 w-5 text-green-500" />
                            ) : (
                              <PowerOff className="h-5 w-5 text-red-500" />
                            )}
                          </div>
                          <div>
                            <div className="font-medium">Business Active</div>
                            <div className="text-sm text-muted-foreground">
                              Enable or disable this entire business
                            </div>
                          </div>
                        </div>
                        <Switch
                          checked={currentTenant.active}
                          onCheckedChange={() => toggleActive(currentTenant)}
                          disabled={updating === currentTenant.id}
                        />
                      </div>

                      {/* Business Flow Type */}
                      <div className="p-4 rounded-lg border border-border space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <Settings2 className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1">
                            <div className="font-medium">Business Flow</div>
                            <div className="text-sm text-muted-foreground">
                              Select the lead intake and job assignment flow for this business
                            </div>
                          </div>
                        </div>
                        <select
                          value={getFlowType(currentTenant.workflow_config)}
                          onChange={(e) => setFlowType(currentTenant, e.target.value)}
                          disabled={updating === currentTenant.id}
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
                        >
                          <option value="winbros">Window Cleaning (HCP leads, route optimization, auto-assign)</option>
                          <option value="spotless">Remote Cleaning (phone leads, accept/decline cascade)</option>
                          <option value="custom" disabled>Custom</option>
                        </select>
                        <div className="text-xs text-muted-foreground pl-1">
                          {getFlowType(currentTenant.workflow_config) === "winbros" ? (
                            <>HousecallPro enabled, route optimization on, cleaners auto-assigned to calendar</>
                          ) : getFlowType(currentTenant.workflow_config) === "spotless" ? (
                            <>Leads from phone/SMS, cleaners accept or decline jobs in Telegram</>
                          ) : (
                            <>Custom configuration - toggle individual settings in the Booking Flow tab</>
                          )}
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  {/* Booking Flow Tab */}
                  <TabsContent value="booking" className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Lead Follow-up */}
                      <div className="p-4 rounded-lg border border-border space-y-3">
                        <div className="font-medium">Lead Follow-up</div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">Enabled</Label>
                          <Switch
                            checked={currentTenant.workflow_config.lead_followup_enabled}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, {
                                workflow_config: { lead_followup_enabled: checked },
                              })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">Stages</Label>
                          <span className="text-sm font-medium">
                            {currentTenant.workflow_config.lead_followup_stages}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">Skip calls for SMS leads</Label>
                          <Switch
                            checked={currentTenant.workflow_config.skip_calls_for_sms_leads}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, {
                                workflow_config: { skip_calls_for_sms_leads: checked },
                              })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                      </div>

                      {/* Deposit Settings */}
                      <div className="p-4 rounded-lg border border-border space-y-3">
                        <div className="font-medium">Payments</div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">Require Deposit</Label>
                          <Switch
                            checked={currentTenant.workflow_config.require_deposit}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, {
                                workflow_config: { require_deposit: checked },
                              })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">Deposit %</Label>
                          <span className="text-sm font-medium">
                            {currentTenant.workflow_config.deposit_percentage}%
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">Use Stripe</Label>
                          <Switch
                            checked={currentTenant.workflow_config.use_stripe}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, {
                                workflow_config: { use_stripe: checked },
                              })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                      </div>

                      {/* Integrations */}
                      <div className="p-4 rounded-lg border border-border space-y-3">
                        <div className="font-medium">Integrations</div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">HousecallPro</Label>
                          <Switch
                            checked={currentTenant.workflow_config.use_housecall_pro}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, {
                                workflow_config: { use_housecall_pro: checked },
                              })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">VAPI Inbound</Label>
                          <Switch
                            checked={currentTenant.workflow_config.use_vapi_inbound}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, {
                                workflow_config: { use_vapi_inbound: checked },
                              })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">VAPI Outbound</Label>
                          <Switch
                            checked={currentTenant.workflow_config.use_vapi_outbound}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, {
                                workflow_config: { use_vapi_outbound: checked },
                              })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">GHL</Label>
                          <Switch
                            checked={currentTenant.workflow_config.use_ghl}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, {
                                workflow_config: { use_ghl: checked },
                              })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                      </div>

                      {/* Auto Assignment */}
                      <div className="p-4 rounded-lg border border-border space-y-3">
                        <div className="font-medium">Post-Cleaning</div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">Auto follow-up</Label>
                          <Switch
                            checked={currentTenant.workflow_config.post_cleaning_followup_enabled}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, {
                                workflow_config: { post_cleaning_followup_enabled: checked },
                              })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">Monthly follow-up</Label>
                          <Switch
                            checked={currentTenant.workflow_config.monthly_followup_enabled}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, {
                                workflow_config: { monthly_followup_enabled: checked },
                              })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm text-muted-foreground">Auto cleaner assignment</Label>
                          <Switch
                            checked={currentTenant.workflow_config.cleaner_assignment_auto}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, {
                                workflow_config: { cleaner_assignment_auto: checked },
                              })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Flow Flags (multi-tenant) */}
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium text-sm">Flow Steps</div>
                      <p className="text-xs text-muted-foreground">Toggle which steps are active for this business&apos;s automation flow.</p>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm text-muted-foreground">Payment collection</Label>
                            <p className="text-xs text-muted-foreground/60">Stripe deposit + full payment flow</p>
                          </div>
                          <Switch
                            checked={currentTenant.workflow_config.use_payment_collection !== false}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, { workflow_config: { use_payment_collection: checked } })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm text-muted-foreground">Cleaner dispatch</Label>
                            <p className="text-xs text-muted-foreground/60">Notify cleaner via Telegram after booking</p>
                          </div>
                          <Switch
                            checked={currentTenant.workflow_config.use_cleaner_dispatch !== false}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, { workflow_config: { use_cleaner_dispatch: checked } })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm text-muted-foreground">Team routing</Label>
                            <p className="text-xs text-muted-foreground/60">Route optimization + optimal job distance</p>
                          </div>
                          <Switch
                            checked={currentTenant.workflow_config.use_team_routing === true}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, { workflow_config: { use_team_routing: checked } })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm text-muted-foreground">HCP mirror</Label>
                            <p className="text-xs text-muted-foreground/60">Mirror jobs + customers into HouseCall Pro</p>
                          </div>
                          <Switch
                            checked={currentTenant.workflow_config.use_hcp_mirror === true}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, { workflow_config: { use_hcp_mirror: checked } })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm text-muted-foreground">Review request</Label>
                            <p className="text-xs text-muted-foreground/60">Send Google review SMS after job completion</p>
                          </div>
                          <Switch
                            checked={currentTenant.workflow_config.use_review_request !== false}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, { workflow_config: { use_review_request: checked } })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm text-muted-foreground">Retargeting</Label>
                            <p className="text-xs text-muted-foreground/60">Monthly re-engagement + frequency nudge campaigns</p>
                          </div>
                          <Switch
                            checked={currentTenant.workflow_config.use_retargeting !== false}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, { workflow_config: { use_retargeting: checked } })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm text-muted-foreground">Rainy day reschedule</Label>
                            <p className="text-xs text-muted-foreground/60">Show reschedule option in dashboard (outdoor services)</p>
                          </div>
                          <Switch
                            checked={currentTenant.workflow_config.use_rainy_day_reschedule === true}
                            onCheckedChange={(checked) =>
                              updateTenant(currentTenant.id, { workflow_config: { use_rainy_day_reschedule: checked } })
                            }
                            disabled={updating === currentTenant.id}
                          />
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  {/* Credentials Tab */}
                  <TabsContent value="credentials" className="space-y-6">
                    {/* Action buttons */}
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={testAllConnections}
                        disabled={testingAll || Object.keys(editingCredentials).length > 0}
                        title={Object.keys(editingCredentials).length > 0 ? "Save changes before testing" : "Test all configured integrations"}
                      >
                        {testingAll ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCcw className="h-4 w-4 mr-2" />
                        )}
                        {testingAll ? "Testing..." : "Test All"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => confirmWebhookRegistration("all", registerAllWebhooks)}
                        disabled={registeringAll}
                      >
                        {registeringAll ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Settings2 className="h-4 w-4 mr-2" />
                        )}
                        {registeringAll ? "Registering..." : "Register All Webhooks"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={verifyAllWebhooks} disabled={verifyingWebhooks}>
                        {verifyingWebhooks ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCcw className="h-4 w-4 mr-2" />
                        )}
                        {verifyingWebhooks ? "Verifying..." : "Verify Webhooks"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={copyAllCredentials}>
                        {copied ? (
                          <Check className="h-4 w-4 mr-2 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4 mr-2" />
                        )}
                        {copied ? "Copied!" : "Copy All"}
                      </Button>
                      {Object.keys(editingCredentials).length > 0 && (
                        <Button size="sm" onClick={saveCredentials} disabled={savingCredentials}>
                          <Save className="h-4 w-4 mr-2" />
                          {savingCredentials ? "Saving..." : "Save Changes"}
                        </Button>
                      )}
                    </div>

                    {/* Business Info */}
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        Business Info
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm">Slug <span className="text-muted-foreground">(primary identifier)</span></Label>
                          <Input
                            value={getFieldValue(currentTenant, "slug")}
                            onChange={(e) => setFieldValue("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                            placeholder="my-business"
                            className="font-mono"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Business Name <span className="text-muted-foreground">(customer-facing)</span></Label>
                          <Input
                            value={getFieldValue(currentTenant, "business_name")}
                            onChange={(e) => setFieldValue("business_name", e.target.value)}
                            placeholder="WinBros Cleaning"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Short Name <span className="text-muted-foreground">(SMS sender name)</span></Label>
                          <Input
                            value={getFieldValue(currentTenant, "business_name_short")}
                            onChange={(e) => setFieldValue("business_name_short", e.target.value)}
                            placeholder="WinBros"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Service Area</Label>
                          <Input
                            value={getFieldValue(currentTenant, "service_area")}
                            onChange={(e) => setFieldValue("service_area", e.target.value)}
                            placeholder="Los Angeles"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Service Type</Label>
                          <Input
                            value={getFieldValue(currentTenant, "service_description")}
                            onChange={(e) => setFieldValue("service_description", e.target.value)}
                            placeholder="e.g., window cleaning, house cleaning"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Timezone</Label>
                          <select
                            className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={getFieldValue(currentTenant, "timezone") || "America/Chicago"}
                            onChange={(e) => setFieldValue("timezone", e.target.value)}
                          >
                            <option value="America/New_York">Eastern (New York)</option>
                            <option value="America/Chicago">Central (Chicago)</option>
                            <option value="America/Denver">Mountain (Denver)</option>
                            <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
                            <option value="America/Phoenix">Arizona (Phoenix)</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">SDR Persona</Label>
                          <Input
                            value={getFieldValue(currentTenant, "sdr_persona")}
                            onChange={(e) => setFieldValue("sdr_persona", e.target.value)}
                            placeholder="Mary"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Owner Phone</Label>
                          <Input
                            value={getFieldValue(currentTenant, "owner_phone")}
                            onChange={(e) => setFieldValue("owner_phone", e.target.value)}
                            placeholder="+1..."
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Owner Email</Label>
                          <Input
                            value={getFieldValue(currentTenant, "owner_email")}
                            onChange={(e) => setFieldValue("owner_email", e.target.value)}
                            placeholder="owner@example.com"
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label className="text-sm">Google Review Link</Label>
                          <Input
                            value={getFieldValue(currentTenant, "google_review_link")}
                            onChange={(e) => setFieldValue("google_review_link", e.target.value)}
                            placeholder="https://g.page/r/..."
                          />
                        </div>
                      </div>
                    </div>

                    {/* OpenPhone */}
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium flex items-center gap-2">
                        <Phone className="h-4 w-4" />
                        OpenPhone
                        {(() => {
                          const status = getIntegrationStatus("openphone", currentTenant)
                          if (status === "connected") return <Badge className="bg-green-500/10 text-green-600 border-green-500/30 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Connected</Badge>
                          if (status === "untested") return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30 text-xs"><AlertTriangle className="h-3 w-3 mr-1" />Untested</Badge>
                          return <Badge className="bg-red-500/10 text-red-600 border-red-500/30 text-xs"><X className="h-3 w-3 mr-1" />Not configured</Badge>
                        })()}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm">API Key</Label>
                          <div className="flex gap-2">
                            <Input
                              type={revealedFields.has("openphone_api_key") ? "text" : "password"}
                              value={getFieldValue(currentTenant, "openphone_api_key")}
                              onChange={(e) => setFieldValue("openphone_api_key", e.target.value)}
                              placeholder={currentTenant.openphone_api_key ? maskKey(currentTenant.openphone_api_key) : "Enter API key"}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => toggleReveal("openphone_api_key")}
                            >
                              {revealedFields.has("openphone_api_key") ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Phone ID</Label>
                          <Input
                            value={getFieldValue(currentTenant, "openphone_phone_id")}
                            onChange={(e) => setFieldValue("openphone_phone_id", e.target.value)}
                            placeholder="Enter Phone ID"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Phone Number</Label>
                          <Input
                            value={getFieldValue(currentTenant, "openphone_phone_number")}
                            onChange={(e) => setFieldValue("openphone_phone_number", e.target.value)}
                            placeholder="+1..."
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 pt-2 border-t border-border/50 flex-wrap">
                        <Button variant="outline" size="sm" onClick={() => testConnection("openphone")} disabled={testingService === "openphone" || !currentTenant.openphone_api_key}>
                          {testingService === "openphone" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />}
                          Test Connection
                        </Button>
                        {testResults["openphone"] && (
                          <span className="inline-flex cursor-pointer" title={testResults["openphone"].message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(testResults["openphone"].message)}>
                            {testResults["openphone"].success ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          </span>
                        )}
                        <Button variant="outline" size="sm" onClick={() => confirmWebhookRegistration("OpenPhone", () => registerWebhook("openphone"))} disabled={registeringWebhook === "openphone" || !currentTenant.openphone_api_key}>
                          {registeringWebhook === "openphone" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Settings2 className="h-3.5 w-3.5 mr-1.5" />}
                          Register Webhook
                        </Button>
                        {webhookResults["openphone"] && (
                          <span className="inline-flex cursor-pointer" title={webhookResults["openphone"].message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(webhookResults["openphone"].message)}>
                            {webhookResults["openphone"].success ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          </span>
                        )}
                        {!webhookResults["openphone"] && currentTenant.openphone_webhook_error && (
                          <span className="inline-flex cursor-pointer" title={`Failed: ${currentTenant.openphone_webhook_error} (${new Date(currentTenant.openphone_webhook_error_at!).toLocaleDateString()})\n(Click to copy)`} onClick={() => navigator.clipboard.writeText(`Failed: ${currentTenant.openphone_webhook_error}`)}>
                            <X className="h-3.5 w-3.5 text-red-500 shrink-0" />
                          </span>
                        )}
                        {!webhookResults["openphone"] && !currentTenant.openphone_webhook_error && currentTenant.openphone_webhook_registered_at && (
                          <span className="inline-flex cursor-pointer" title={`Webhook registered ${new Date(currentTenant.openphone_webhook_registered_at).toLocaleDateString()}\n(Click to copy)`} onClick={() => navigator.clipboard.writeText(`Webhook registered ${new Date(currentTenant.openphone_webhook_registered_at).toLocaleDateString()}`)}>
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          </span>
                        )}
                        {!webhookResults["openphone"] && !currentTenant.openphone_webhook_error && !currentTenant.openphone_webhook_registered_at && currentTenant.openphone_api_key && (
                          <span className="inline-flex cursor-pointer" title={"Webhook not registered\n(Click to copy)"} onClick={() => navigator.clipboard.writeText("Webhook not registered")}>
                            <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                          </span>
                        )}
                        {webhookVerification["openphone"] && (
                          <span className="inline-flex cursor-pointer" title={webhookVerification["openphone"].message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(webhookVerification["openphone"].message)}>
                            {webhookVerification["openphone"].active ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* VAPI - hidden if disabled */}
                    {(currentTenant.workflow_config.use_vapi_inbound || currentTenant.workflow_config.use_vapi_outbound) && (
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" />
                        VAPI (Voice AI)
                        {(() => {
                          const status = getIntegrationStatus("vapi", currentTenant)
                          if (status === "connected") return <Badge className="bg-green-500/10 text-green-600 border-green-500/30 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Connected</Badge>
                          if (status === "untested") return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30 text-xs"><AlertTriangle className="h-3 w-3 mr-1" />Untested</Badge>
                          return <Badge className="bg-red-500/10 text-red-600 border-red-500/30 text-xs"><X className="h-3 w-3 mr-1" />Not configured</Badge>
                        })()}
                      </div>
                      {/* Auto-generated Server URL */}
                      <div className="space-y-2">
                        <Label className="text-sm">Server URL <span className="text-muted-foreground">(auto-generated)</span></Label>
                        <div className="flex gap-2">
                          <Input
                            readOnly
                            value={getWebhookUrl(currentTenant.slug, "vapi")}
                            className="bg-muted/50 font-mono text-xs"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => copyUrl(getWebhookUrl(currentTenant.slug, "vapi"), "vapi_url")}
                          >
                            {copiedUrl === "vapi_url" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">Paste this into VAPI &rarr; Assistant &rarr; Server URL</p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm">API Key</Label>
                          <div className="flex gap-2">
                            <Input
                              type={revealedFields.has("vapi_api_key") ? "text" : "password"}
                              value={getFieldValue(currentTenant, "vapi_api_key")}
                              onChange={(e) => setFieldValue("vapi_api_key", e.target.value)}
                              placeholder={currentTenant.vapi_api_key ? maskKey(currentTenant.vapi_api_key) : "Enter API key"}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => toggleReveal("vapi_api_key")}
                            >
                              {revealedFields.has("vapi_api_key") ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Phone ID</Label>
                          <Input
                            value={getFieldValue(currentTenant, "vapi_phone_id")}
                            onChange={(e) => setFieldValue("vapi_phone_id", e.target.value)}
                            placeholder="Enter Phone ID"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Inbound Assistant ID</Label>
                          <Input
                            value={getFieldValue(currentTenant, "vapi_assistant_id")}
                            onChange={(e) => setFieldValue("vapi_assistant_id", e.target.value)}
                            placeholder="For receiving calls"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Outbound Assistant ID</Label>
                          <Input
                            value={getFieldValue(currentTenant, "vapi_outbound_assistant_id")}
                            onChange={(e) => setFieldValue("vapi_outbound_assistant_id", e.target.value)}
                            placeholder="For making calls"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 pt-2 border-t border-border/50 flex-wrap">
                        <Button variant="outline" size="sm" onClick={() => testConnection("vapi")} disabled={testingService === "vapi" || !currentTenant.vapi_api_key}>
                          {testingService === "vapi" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />}
                          Test Connection
                        </Button>
                        {testResults["vapi"] && (
                          <span className="inline-flex cursor-pointer" title={testResults["vapi"].message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(testResults["vapi"].message)}>
                            {testResults["vapi"].success ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          </span>
                        )}
                        <Button variant="outline" size="sm" onClick={() => confirmWebhookRegistration("VAPI", () => registerWebhook("vapi"))} disabled={registeringWebhook === "vapi" || !currentTenant.vapi_api_key || !currentTenant.vapi_assistant_id}>
                          {registeringWebhook === "vapi" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Settings2 className="h-3.5 w-3.5 mr-1.5" />}
                          Register Webhook
                        </Button>
                        {webhookResults["vapi"] && (
                          <span className="inline-flex cursor-pointer" title={webhookResults["vapi"].message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(webhookResults["vapi"].message)}>
                            {webhookResults["vapi"].success ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          </span>
                        )}
                        {!webhookResults["vapi"] && currentTenant.vapi_webhook_error && (
                          <span className="inline-flex cursor-pointer" title={`Failed: ${currentTenant.vapi_webhook_error} (${new Date(currentTenant.vapi_webhook_error_at!).toLocaleDateString()})\n(Click to copy)`} onClick={() => navigator.clipboard.writeText(`Failed: ${currentTenant.vapi_webhook_error}`)}>
                            <X className="h-3.5 w-3.5 text-red-500 shrink-0" />
                          </span>
                        )}
                        {!webhookResults["vapi"] && !currentTenant.vapi_webhook_error && currentTenant.vapi_webhook_registered_at && (
                          <span className="inline-flex cursor-pointer" title={`Webhook registered ${new Date(currentTenant.vapi_webhook_registered_at).toLocaleDateString()}\n(Click to copy)`} onClick={() => navigator.clipboard.writeText(`Webhook registered ${new Date(currentTenant.vapi_webhook_registered_at).toLocaleDateString()}`)}>
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          </span>
                        )}
                        {testResults["vapi"]?.webhookStatus === "verified" ? (
                          <span className="inline-flex cursor-pointer" title={"Webhook URL verified — server.url points to our endpoint\n(Click to copy)"} onClick={() => navigator.clipboard.writeText("Webhook URL verified — server.url points to our endpoint")}>
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          </span>
                        ) : testResults["vapi"]?.webhookStatus === "warning" ? (
                          <span className="inline-flex cursor-pointer" title={"No server URL on assistant — may use account-level fallback\n(Click to copy)"} onClick={() => navigator.clipboard.writeText("No server URL on assistant — may use account-level fallback")}>
                            <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                          </span>
                        ) : testResults["vapi"]?.webhookStatus === "mismatch" ? (
                          <span className="inline-flex cursor-pointer" title={"Webhook URL mismatch — server.url points elsewhere. Click Register Webhook to fix.\n(Click to copy)"} onClick={() => navigator.clipboard.writeText("Webhook URL mismatch — server.url points elsewhere")}>
                            <X className="h-3.5 w-3.5 text-red-500 shrink-0" />
                          </span>
                        ) : currentTenant.webhook_health?.vapi?.last_event_at ? (
                          <span className="inline-flex cursor-pointer" title={`Webhook active — last event: ${currentTenant.webhook_health.vapi.last_event_type} (${new Date(currentTenant.webhook_health.vapi.last_event_at).toLocaleDateString()})\n(Click to copy)`} onClick={() => navigator.clipboard.writeText(`Webhook active — last event: ${currentTenant.webhook_health.vapi.last_event_type} (${new Date(currentTenant.webhook_health.vapi.last_event_at).toLocaleDateString()})`)}>
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          </span>
                        ) : (currentTenant.vapi_api_key && currentTenant.vapi_assistant_id) ? (
                          <span className="inline-flex cursor-pointer" title={"No webhook activity — configure Server URL in VAPI dashboard\n(Click to copy)"} onClick={() => navigator.clipboard.writeText("No webhook activity — configure Server URL in VAPI dashboard")}>
                            <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                          </span>
                        ) : null}
                        {webhookVerification["vapi"] && (
                          <span className="inline-flex cursor-pointer" title={webhookVerification["vapi"].message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(webhookVerification["vapi"].message)}>
                            {webhookVerification["vapi"].active ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          </span>
                        )}
                      </div>
                    </div>
                    )}

                    {/* Stripe - hidden if disabled */}
                    {currentTenant.workflow_config.use_stripe && (
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium flex items-center gap-2">
                        <Key className="h-4 w-4" />
                        Stripe
                        {(() => {
                          const status = getIntegrationStatus("stripe", currentTenant)
                          if (status === "connected") return <Badge className="bg-green-500/10 text-green-600 border-green-500/30 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Connected</Badge>
                          if (status === "untested") return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30 text-xs"><AlertTriangle className="h-3 w-3 mr-1" />Untested</Badge>
                          return <Badge className="bg-red-500/10 text-red-600 border-red-500/30 text-xs"><X className="h-3 w-3 mr-1" />Not configured</Badge>
                        })()}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm">Secret Key</Label>
                          <div className="flex gap-2">
                            <Input
                              type={revealedFields.has("stripe_secret_key") ? "text" : "password"}
                              value={getFieldValue(currentTenant, "stripe_secret_key")}
                              onChange={(e) => setFieldValue("stripe_secret_key", e.target.value)}
                              placeholder={currentTenant.stripe_secret_key ? maskKey(currentTenant.stripe_secret_key) : "sk_..."}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => toggleReveal("stripe_secret_key")}
                            >
                              {revealedFields.has("stripe_secret_key") ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Publishable Key</Label>
                          <div className="flex gap-2">
                            <Input
                              type={revealedFields.has("stripe_publishable_key") ? "text" : "password"}
                              value={getFieldValue(currentTenant, "stripe_publishable_key")}
                              onChange={(e) => setFieldValue("stripe_publishable_key", e.target.value)}
                              placeholder={currentTenant.stripe_publishable_key ? maskKey(currentTenant.stripe_publishable_key) : "pk_..."}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => toggleReveal("stripe_publishable_key")}
                            >
                              {revealedFields.has("stripe_publishable_key") ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Webhook Secret</Label>
                          <div className="flex gap-2">
                            <Input
                              type={revealedFields.has("stripe_webhook_secret") ? "text" : "password"}
                              value={getFieldValue(currentTenant, "stripe_webhook_secret")}
                              onChange={(e) => setFieldValue("stripe_webhook_secret", e.target.value)}
                              placeholder={currentTenant.stripe_webhook_secret ? maskKey(currentTenant.stripe_webhook_secret) : "whsec_..."}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => toggleReveal("stripe_webhook_secret")}
                            >
                              {revealedFields.has("stripe_webhook_secret") ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 pt-2 border-t border-border/50 flex-wrap">
                        <Button variant="outline" size="sm" onClick={() => testConnection("stripe")} disabled={testingService === "stripe" || !currentTenant.stripe_secret_key}>
                          {testingService === "stripe" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />}
                          Test Connection
                        </Button>
                        {testResults["stripe"] && (
                          <span className="inline-flex cursor-pointer" title={testResults["stripe"].message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(testResults["stripe"].message)}>
                            {testResults["stripe"].success ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          </span>
                        )}
                        <Button variant="outline" size="sm" onClick={() => confirmWebhookRegistration("Stripe", () => registerWebhook("stripe"))} disabled={registeringWebhook === "stripe" || !currentTenant.stripe_secret_key}>
                          {registeringWebhook === "stripe" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Settings2 className="h-3.5 w-3.5 mr-1.5" />}
                          Register Webhook
                        </Button>
                        {webhookResults["stripe"] && (
                          <span className="inline-flex cursor-pointer" title={webhookResults["stripe"].message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(webhookResults["stripe"].message)}>
                            {webhookResults["stripe"].success ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          </span>
                        )}
                        {!webhookResults["stripe"] && currentTenant.stripe_webhook_error && (
                          <span className="inline-flex cursor-pointer" title={`Failed: ${currentTenant.stripe_webhook_error} (${new Date(currentTenant.stripe_webhook_error_at!).toLocaleDateString()})\n(Click to copy)`} onClick={() => navigator.clipboard.writeText(`Failed: ${currentTenant.stripe_webhook_error}`)}>
                            <X className="h-3.5 w-3.5 text-red-500 shrink-0" />
                          </span>
                        )}
                        {!webhookResults["stripe"] && !currentTenant.stripe_webhook_error && currentTenant.stripe_webhook_registered_at && (
                          <span className="inline-flex cursor-pointer" title={`Webhook registered ${new Date(currentTenant.stripe_webhook_registered_at).toLocaleDateString()}\n(Click to copy)`} onClick={() => navigator.clipboard.writeText(`Webhook registered ${new Date(currentTenant.stripe_webhook_registered_at).toLocaleDateString()}`)}>
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          </span>
                        )}
                        {!webhookResults["stripe"] && !currentTenant.stripe_webhook_error && !currentTenant.stripe_webhook_registered_at && currentTenant.stripe_secret_key && (
                          <span className="inline-flex cursor-pointer" title={"Webhook not registered\n(Click to copy)"} onClick={() => navigator.clipboard.writeText("Webhook not registered")}>
                            <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                          </span>
                        )}
                        {webhookVerification["stripe"] && (
                          <span className="inline-flex cursor-pointer" title={webhookVerification["stripe"].message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(webhookVerification["stripe"].message)}>
                            {webhookVerification["stripe"].active ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          </span>
                        )}
                      </div>
                    </div>
                    )}

                    {/* HousecallPro - hidden if disabled */}
                    {currentTenant.workflow_config.use_housecall_pro && (
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium flex items-center gap-2">
                        <Settings2 className="h-4 w-4" />
                        HousecallPro
                        {(() => {
                          const status = getIntegrationStatus("housecall_pro", currentTenant)
                          if (status === "connected") return <Badge className="bg-green-500/10 text-green-600 border-green-500/30 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Connected</Badge>
                          if (status === "untested") return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30 text-xs"><AlertTriangle className="h-3 w-3 mr-1" />Untested</Badge>
                          return <Badge className="bg-red-500/10 text-red-600 border-red-500/30 text-xs"><X className="h-3 w-3 mr-1" />Not configured</Badge>
                        })()}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm">API Key</Label>
                          <div className="flex gap-2">
                            <Input
                              type={revealedFields.has("housecall_pro_api_key") ? "text" : "password"}
                              value={getFieldValue(currentTenant, "housecall_pro_api_key")}
                              onChange={(e) => setFieldValue("housecall_pro_api_key", e.target.value)}
                              placeholder={currentTenant.housecall_pro_api_key ? maskKey(currentTenant.housecall_pro_api_key) : "Enter API key"}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => toggleReveal("housecall_pro_api_key")}
                            >
                              {revealedFields.has("housecall_pro_api_key") ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Company ID</Label>
                          <Input
                            value={getFieldValue(currentTenant, "housecall_pro_company_id")}
                            onChange={(e) => setFieldValue("housecall_pro_company_id", e.target.value)}
                            placeholder="Enter Company ID"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Webhook Secret</Label>
                          <div className="flex gap-2">
                            <Input
                              type={revealedFields.has("housecall_pro_webhook_secret") ? "text" : "password"}
                              value={getFieldValue(currentTenant, "housecall_pro_webhook_secret")}
                              onChange={(e) => setFieldValue("housecall_pro_webhook_secret", e.target.value)}
                              placeholder={currentTenant.housecall_pro_webhook_secret ? maskKey(currentTenant.housecall_pro_webhook_secret) : "Enter webhook secret"}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => toggleReveal("housecall_pro_webhook_secret")}
                            >
                              {revealedFields.has("housecall_pro_webhook_secret") ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      </div>
                      {/* Webhook health + URL */}
                      <div className="space-y-2 pt-2 border-t border-border/50">
                        <div className="space-y-1">
                          <Label className="text-sm">Webhook URL <span className="text-muted-foreground">(paste in HousecallPro dashboard)</span></Label>
                          <div className="flex gap-2">
                            <Input
                              readOnly
                              value={getWebhookUrl(currentTenant.slug, "housecall-pro")}
                              className="bg-muted/50 font-mono text-xs"
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => copyUrl(getWebhookUrl(currentTenant.slug, "housecall-pro"), "hcp_webhook_url")}
                            >
                              {copiedUrl === "hcp_webhook_url" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                        {currentTenant.webhook_health?.housecall_pro?.last_event_at ? (
                          <span className="inline-flex cursor-pointer" title={`Webhook active — last event: ${currentTenant.webhook_health.housecall_pro.last_event_type} (${new Date(currentTenant.webhook_health.housecall_pro.last_event_at).toLocaleDateString()})\n(Click to copy)`} onClick={() => navigator.clipboard.writeText(`Webhook active — last event: ${currentTenant.webhook_health.housecall_pro.last_event_type} (${new Date(currentTenant.webhook_health.housecall_pro.last_event_at).toLocaleDateString()})`)}>
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          </span>
                        ) : currentTenant.housecall_pro_api_key ? (
                          <span className="inline-flex cursor-pointer" title={"No webhook activity — configure in HousecallPro dashboard\n(Click to copy)"} onClick={() => navigator.clipboard.writeText("No webhook activity — configure in HousecallPro dashboard")}>
                            <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                          </span>
                        ) : null}
                      </div>
                    </div>
                    )}

                    {/* GoHighLevel - hidden if disabled */}
                    {currentTenant.workflow_config.use_ghl && (
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium flex items-center gap-2">
                        <Settings2 className="h-4 w-4" />
                        GoHighLevel
                        {(() => {
                          const status = getIntegrationStatus("ghl", currentTenant)
                          if (status === "connected") return <Badge className="bg-green-500/10 text-green-600 border-green-500/30 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Connected</Badge>
                          if (status === "untested") return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30 text-xs"><AlertTriangle className="h-3 w-3 mr-1" />Untested</Badge>
                          return <Badge className="bg-red-500/10 text-red-600 border-red-500/30 text-xs"><X className="h-3 w-3 mr-1" />Not configured</Badge>
                        })()}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm">Location ID</Label>
                          <Input
                            value={getFieldValue(currentTenant, "ghl_location_id")}
                            onChange={(e) => setFieldValue("ghl_location_id", e.target.value)}
                            placeholder="Enter Location ID"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Webhook Secret</Label>
                          <div className="flex gap-2">
                            <Input
                              type={revealedFields.has("ghl_webhook_secret") ? "text" : "password"}
                              value={getFieldValue(currentTenant, "ghl_webhook_secret")}
                              onChange={(e) => setFieldValue("ghl_webhook_secret", e.target.value)}
                              placeholder={currentTenant.ghl_webhook_secret ? maskKey(currentTenant.ghl_webhook_secret) : "Enter webhook secret"}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => toggleReveal("ghl_webhook_secret")}
                            >
                              {revealedFields.has("ghl_webhook_secret") ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      </div>
                      {/* Webhook health + URL */}
                      <div className="space-y-2 pt-2 border-t border-border/50">
                        <div className="space-y-1">
                          <Label className="text-sm">Webhook URL <span className="text-muted-foreground">(paste in GHL dashboard)</span></Label>
                          <div className="flex gap-2">
                            <Input
                              readOnly
                              value={getWebhookUrl(currentTenant.slug, "ghl")}
                              className="bg-muted/50 font-mono text-xs"
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => copyUrl(getWebhookUrl(currentTenant.slug, "ghl"), "ghl_webhook_url")}
                            >
                              {copiedUrl === "ghl_webhook_url" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                        {currentTenant.webhook_health?.ghl?.last_event_at ? (
                          <span className="inline-flex cursor-pointer" title={`Webhook active — last event: ${currentTenant.webhook_health.ghl.last_event_type} (${new Date(currentTenant.webhook_health.ghl.last_event_at).toLocaleDateString()})\n(Click to copy)`} onClick={() => navigator.clipboard.writeText(`Webhook active — last event: ${currentTenant.webhook_health.ghl.last_event_type} (${new Date(currentTenant.webhook_health.ghl.last_event_at).toLocaleDateString()})`)}>
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          </span>
                        ) : currentTenant.ghl_location_id ? (
                          <span className="inline-flex cursor-pointer" title={"No webhook activity — configure in GHL dashboard\n(Click to copy)"} onClick={() => navigator.clipboard.writeText("No webhook activity — configure in GHL dashboard")}>
                            <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                          </span>
                        ) : null}
                      </div>
                    </div>
                    )}

                    {/* Telegram */}
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" />
                        Telegram
                        {(() => {
                          const status = getIntegrationStatus("telegram", currentTenant)
                          if (status === "connected") return <Badge className="bg-green-500/10 text-green-600 border-green-500/30 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Connected</Badge>
                          if (status === "untested") return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30 text-xs"><AlertTriangle className="h-3 w-3 mr-1" />Untested</Badge>
                          return <Badge className="bg-red-500/10 text-red-600 border-red-500/30 text-xs"><X className="h-3 w-3 mr-1" />Not configured</Badge>
                        })()}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm">Bot Token</Label>
                          <div className="flex gap-2">
                            <Input
                              type={revealedFields.has("telegram_bot_token") ? "text" : "password"}
                              value={getFieldValue(currentTenant, "telegram_bot_token")}
                              onChange={(e) => setFieldValue("telegram_bot_token", e.target.value)}
                              placeholder={currentTenant.telegram_bot_token ? maskKey(currentTenant.telegram_bot_token) : "Enter bot token"}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => toggleReveal("telegram_bot_token")}
                            >
                              {revealedFields.has("telegram_bot_token") ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Owner Chat ID</Label>
                          <Input
                            value={getFieldValue(currentTenant, "owner_telegram_chat_id")}
                            onChange={(e) => setFieldValue("owner_telegram_chat_id", e.target.value)}
                            placeholder="Enter Chat ID"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 pt-2 border-t border-border/50 flex-wrap">
                        <Button variant="outline" size="sm" onClick={() => testConnection("telegram")} disabled={testingService === "telegram" || !currentTenant.telegram_bot_token}>
                          {testingService === "telegram" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />}
                          Test Connection
                        </Button>
                        {testResults["telegram"] && (
                          <span className="inline-flex cursor-pointer" title={testResults["telegram"].message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(testResults["telegram"].message)}>
                            {testResults["telegram"].success ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          </span>
                        )}
                        <Button variant="outline" size="sm" onClick={() => confirmWebhookRegistration("Telegram", () => registerWebhook("telegram"))} disabled={registeringWebhook === "telegram" || !currentTenant.telegram_bot_token}>
                          {registeringWebhook === "telegram" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Settings2 className="h-3.5 w-3.5 mr-1.5" />}
                          Register Webhook
                        </Button>
                        {webhookResults["telegram"] && (
                          <span className="inline-flex cursor-pointer" title={webhookResults["telegram"].message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(webhookResults["telegram"].message)}>
                            {webhookResults["telegram"].success ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          </span>
                        )}
                        {!webhookResults["telegram"] && currentTenant.telegram_webhook_error && (
                          <span className="inline-flex cursor-pointer" title={`Failed: ${currentTenant.telegram_webhook_error} (${new Date(currentTenant.telegram_webhook_error_at!).toLocaleDateString()})\n(Click to copy)`} onClick={() => navigator.clipboard.writeText(`Failed: ${currentTenant.telegram_webhook_error}`)}>
                            <X className="h-3.5 w-3.5 text-red-500 shrink-0" />
                          </span>
                        )}
                        {!webhookResults["telegram"] && !currentTenant.telegram_webhook_error && currentTenant.telegram_webhook_registered_at && (
                          <span className="inline-flex cursor-pointer" title={`Webhook registered ${new Date(currentTenant.telegram_webhook_registered_at).toLocaleDateString()}\n(Click to copy)`} onClick={() => navigator.clipboard.writeText(`Webhook registered ${new Date(currentTenant.telegram_webhook_registered_at).toLocaleDateString()}`)}>
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          </span>
                        )}
                        {!webhookResults["telegram"] && !currentTenant.telegram_webhook_error && !currentTenant.telegram_webhook_registered_at && currentTenant.telegram_bot_token && (
                          <span className="inline-flex cursor-pointer" title={"Webhook not registered\n(Click to copy)"} onClick={() => navigator.clipboard.writeText("Webhook not registered")}>
                            <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                          </span>
                        )}
                        {webhookVerification["telegram"] && (
                          <span className="inline-flex cursor-pointer" title={webhookVerification["telegram"].message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(webhookVerification["telegram"].message)}>
                            {webhookVerification["telegram"].active ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Wave - hidden if disabled */}
                    {currentTenant.workflow_config.use_wave && (
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium flex items-center gap-2">
                        <Settings2 className="h-4 w-4" />
                        Wave Accounting
                        {(() => {
                          const status = getIntegrationStatus("wave", currentTenant)
                          if (status === "connected") return <Badge className="bg-green-500/10 text-green-600 border-green-500/30 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Connected</Badge>
                          if (status === "untested") return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30 text-xs"><AlertTriangle className="h-3 w-3 mr-1" />Untested</Badge>
                          return <Badge className="bg-red-500/10 text-red-600 border-red-500/30 text-xs"><X className="h-3 w-3 mr-1" />Not configured</Badge>
                        })()}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm">API Token</Label>
                          <div className="flex gap-2">
                            <Input
                              type={revealedFields.has("wave_api_token") ? "text" : "password"}
                              value={getFieldValue(currentTenant, "wave_api_token")}
                              onChange={(e) => setFieldValue("wave_api_token", e.target.value)}
                              placeholder={currentTenant.wave_api_token ? maskKey(currentTenant.wave_api_token) : "Enter API token"}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => toggleReveal("wave_api_token")}
                            >
                              {revealedFields.has("wave_api_token") ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Business ID</Label>
                          <Input
                            value={getFieldValue(currentTenant, "wave_business_id")}
                            onChange={(e) => setFieldValue("wave_business_id", e.target.value)}
                            placeholder="Enter Business ID"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Income Account ID</Label>
                          <Input
                            value={getFieldValue(currentTenant, "wave_income_account_id")}
                            onChange={(e) => setFieldValue("wave_income_account_id", e.target.value)}
                            placeholder="Enter Income Account ID"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 pt-2 border-t border-border/50 flex-wrap">
                        <Button variant="outline" size="sm" onClick={() => testConnection("wave")} disabled={testingService === "wave" || !currentTenant.wave_api_token}>
                          {testingService === "wave" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />}
                          Test Connection
                        </Button>
                        {testResults["wave"] && (
                          <span className="inline-flex cursor-pointer" title={testResults["wave"].message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(testResults["wave"].message)}>
                            {testResults["wave"].success ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          </span>
                        )}
                      </div>
                    </div>
                    )}

                    {/* Gmail (Email Bot) */}
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" />
                        Gmail (Email Bot)
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm">Gmail Address</Label>
                          <Input
                            value={getFieldValue(currentTenant, "gmail_user")}
                            onChange={(e) => setFieldValue("gmail_user", e.target.value)}
                            placeholder="business@gmail.com"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">App Password</Label>
                          <div className="flex gap-2">
                            <Input
                              type={revealedFields.has("gmail_app_password") ? "text" : "password"}
                              value={getFieldValue(currentTenant, "gmail_app_password")}
                              onChange={(e) => setFieldValue("gmail_app_password", e.target.value)}
                              placeholder={currentTenant.gmail_app_password ? maskKey(currentTenant.gmail_app_password) : "Enter app password"}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => toggleReveal("gmail_app_password")}
                            >
                              {revealedFields.has("gmail_app_password") ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  {/* Setup Checklist Tab */}
                  <TabsContent value="setup" className="space-y-6">
                    {/* Setup Checklist */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <ClipboardList className="h-5 w-5" />
                          Setup Checklist
                        </CardTitle>
                        <CardDescription>Required integrations and configuration status</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {(() => {
                          const checks = [
                            {
                              label: "Business details",
                              description: "Name, service area, phone, email",
                              ok: !!(currentTenant.business_name && currentTenant.service_area && currentTenant.owner_phone && currentTenant.owner_email),
                            },
                            {
                              label: "OpenPhone",
                              description: "API key, phone ID, phone number",
                              ok: !!(currentTenant.openphone_api_key && currentTenant.openphone_phone_id && currentTenant.openphone_phone_number),
                            },
                            {
                              label: "VAPI (Voice AI)",
                              description: "API key, assistant ID",
                              ok: !!(currentTenant.vapi_api_key && currentTenant.vapi_assistant_id),
                            },
                            {
                              label: "Stripe",
                              description: "Secret key, webhook secret",
                              ok: !!(currentTenant.stripe_secret_key && currentTenant.stripe_webhook_secret),
                            },
                            {
                              label: "Telegram",
                              description: "Bot token, owner chat ID",
                              ok: !!(currentTenant.telegram_bot_token && currentTenant.owner_telegram_chat_id),
                            },
                            {
                              label: "Gmail (Email Bot)",
                              description: "Gmail address, app password",
                              ok: !!(currentTenant.gmail_user && currentTenant.gmail_app_password),
                              optional: true,
                            },
                            {
                              label: "Google Review Link",
                              description: "For post-cleaning review requests",
                              ok: !!currentTenant.google_review_link,
                              optional: true,
                            },
                          ]
                          const doneCount = checks.filter((c) => c.ok).length
                          const requiredCount = checks.filter((c) => !c.optional).length
                          const requiredDone = checks.filter((c) => !c.optional && c.ok).length

                          return (
                            <>
                              <div className="flex items-center gap-2 pb-2 mb-2 border-b">
                                <span className={`text-sm font-medium ${requiredDone === requiredCount ? "text-green-500" : "text-orange-500"}`}>
                                  {doneCount}/{checks.length} configured
                                </span>
                                {requiredDone === requiredCount && (
                                  <Badge variant="outline" className="text-green-500 border-green-500/30">All required done</Badge>
                                )}
                              </div>
                              {checks.map((check) => (
                                <div key={check.label} className="flex items-center gap-3 py-1">
                                  {check.ok ? (
                                    <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                                  ) : (
                                    <AlertTriangle className={`h-5 w-5 shrink-0 ${check.optional ? "text-zinc-400" : "text-orange-500"}`} />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium flex items-center gap-2">
                                      {check.label}
                                      {check.optional && <span className="text-xs text-muted-foreground">(optional)</span>}
                                    </div>
                                    <div className="text-xs text-muted-foreground">{check.description}</div>
                                  </div>
                                </div>
                              ))}
                            </>
                          )
                        })()}
                      </CardContent>
                    </Card>

                    {/* Webhook URLs */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <ExternalLink className="h-5 w-5" />
                          Webhook URLs
                        </CardTitle>
                        <CardDescription>Configure these URLs in the respective external services</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {[
                          { label: "VAPI", service: "vapi", hint: "VAPI → Assistant → Server URL" },
                          { label: "OpenPhone", service: "openphone", hint: "OpenPhone → Settings → Webhooks" },
                          { label: "Stripe", service: "stripe", hint: "Stripe → Developers → Webhooks" },
                          { label: "Telegram", service: "telegram", hint: "Set via bot API setWebhook" },
                        ].map(({ label, service, hint }) => (
                          <div key={service} className="space-y-1">
                            <div className="flex items-center justify-between">
                              <Label className="text-sm font-medium">{label}</Label>
                              <span className="text-xs text-muted-foreground">{hint}</span>
                            </div>
                            <div className="flex gap-2">
                              <Input
                                readOnly
                                value={getWebhookUrl(currentTenant.slug, service)}
                                className="bg-muted/50 font-mono text-xs"
                              />
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => copyUrl(getWebhookUrl(currentTenant.slug, service), `webhook_${service}`)}
                              >
                                {copiedUrl === `webhook_${service}` ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* Cleaners Tab */}
                  <TabsContent value="cleaners" className="space-y-4">
                    <CleanersManager tenantId={currentTenant.id} tenantName={currentTenant.name} />
                  </TabsContent>

                  {/* Campaigns Tab */}
                  <TabsContent value="campaigns" className="space-y-4">
                    {/* Master Toggle */}
                    <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${
                          currentTenant.workflow_config.seasonal_reminders_enabled
                            ? "bg-green-500/10"
                            : "bg-zinc-500/10"
                        }`}>
                          <Megaphone className={`h-5 w-5 ${
                            currentTenant.workflow_config.seasonal_reminders_enabled
                              ? "text-green-500"
                              : "text-zinc-500"
                          }`} />
                        </div>
                        <div>
                          <div className="font-medium">Seasonal Reminders</div>
                          <div className="text-sm text-muted-foreground">
                            Send automated SMS campaigns to customers on scheduled dates
                          </div>
                        </div>
                      </div>
                      <Switch
                        checked={currentTenant.workflow_config.seasonal_reminders_enabled || false}
                        onCheckedChange={(checked) =>
                          updateTenant(currentTenant.id, {
                            workflow_config: { seasonal_reminders_enabled: checked },
                          })
                        }
                        disabled={updating === currentTenant.id}
                      />
                    </div>

                    {/* Frequency Nudge Settings */}
                    <div className="p-4 rounded-lg border border-border space-y-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${
                          currentTenant.workflow_config.frequency_nudge_enabled
                            ? "bg-blue-500/10"
                            : "bg-zinc-500/10"
                        }`}>
                          <Clock className={`h-5 w-5 ${
                            currentTenant.workflow_config.frequency_nudge_enabled
                              ? "text-blue-500"
                              : "text-zinc-500"
                          }`} />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium">Service Frequency Nudges</div>
                          <div className="text-sm text-muted-foreground">
                            Remind customers when they're due for repeat service
                          </div>
                        </div>
                        <Switch
                          checked={currentTenant.workflow_config.frequency_nudge_enabled || false}
                          onCheckedChange={(checked) =>
                            updateTenant(currentTenant.id, {
                              workflow_config: { frequency_nudge_enabled: checked },
                            })
                          }
                          disabled={updating === currentTenant.id}
                        />
                      </div>
                      <div className="flex items-center justify-between pl-12">
                        <Label className="text-sm text-muted-foreground">Days after last service</Label>
                        <Input
                          type="number"
                          min={7}
                          max={90}
                          value={currentTenant.workflow_config.frequency_nudge_days || 21}
                          onChange={(e) =>
                            updateTenant(currentTenant.id, {
                              workflow_config: { frequency_nudge_days: parseInt(e.target.value) || 21 },
                            })
                          }
                          disabled={updating === currentTenant.id}
                          className="w-20 text-center"
                        />
                      </div>
                      <div className="flex items-center justify-between pl-12">
                        <Label className="text-sm text-muted-foreground">Review-only follow-up (no invoice)</Label>
                        <Switch
                          checked={currentTenant.workflow_config.review_only_followup_enabled || false}
                          onCheckedChange={(checked) =>
                            updateTenant(currentTenant.id, {
                              workflow_config: { review_only_followup_enabled: checked },
                            })
                          }
                          disabled={updating === currentTenant.id}
                        />
                      </div>
                    </div>

                    {/* Campaign List */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium">Seasonal Campaigns</h3>
                        <Button
                          size="sm"
                          onClick={() => openCampaignModal()}
                          disabled={updating === currentTenant.id}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Add Campaign
                        </Button>
                      </div>

                      {(!currentTenant.workflow_config.seasonal_campaigns || currentTenant.workflow_config.seasonal_campaigns.length === 0) ? (
                        <div className="text-center py-8 text-muted-foreground border border-dashed border-border rounded-lg">
                          <Megaphone className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No campaigns yet</p>
                          <p className="text-xs mt-1">Create a seasonal campaign to start reaching your customers</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {currentTenant.workflow_config.seasonal_campaigns.map((campaign) => {
                            const now = new Date()
                            const start = new Date(campaign.start_date)
                            const end = new Date(campaign.end_date)
                            const isActive = campaign.enabled && now >= start && now <= end
                            const isPast = now > end
                            const isFuture = now < start

                            return (
                              <div
                                key={campaign.id}
                                className={`p-4 rounded-lg border ${
                                  isActive
                                    ? "border-green-500/30 bg-green-500/5"
                                    : isPast
                                    ? "border-zinc-500/20 bg-zinc-500/5 opacity-60"
                                    : "border-border"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-sm">{campaign.name}</span>
                                      {isActive && (
                                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">Active</Badge>
                                      )}
                                      {isPast && (
                                        <Badge variant="outline" className="text-xs opacity-60">Ended</Badge>
                                      )}
                                      {isFuture && (
                                        <Badge variant="outline" className="text-xs text-blue-400 border-blue-500/30">Scheduled</Badge>
                                      )}
                                      {!campaign.enabled && (
                                        <Badge variant="outline" className="text-xs text-orange-400 border-orange-500/30">Paused</Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                      <span className="flex items-center gap-1">
                                        <Calendar className="h-3 w-3" />
                                        {campaign.start_date} to {campaign.end_date}
                                      </span>
                                      <span>{SEGMENT_LABELS[campaign.target_segment]}</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground mt-2 truncate">
                                      {campaign.message}
                                    </p>
                                    {campaign.last_sent_at && (
                                      <p className="text-xs text-muted-foreground mt-1">
                                        Last sent: {new Date(campaign.last_sent_at).toLocaleDateString()}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Switch
                                      checked={campaign.enabled}
                                      onCheckedChange={() => toggleCampaignEnabled(campaign.id)}
                                      disabled={updating === currentTenant.id}
                                    />
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => openCampaignModal(campaign)}
                                      disabled={updating === currentTenant.id}
                                    >
                                      <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="text-red-400 hover:text-red-300"
                                      onClick={() => deleteCampaign(campaign.id)}
                                      disabled={updating === currentTenant.id}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  {/* Info Tab */}
                  <TabsContent value="info" className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">Slug</Label>
                        <div className="p-2 rounded border border-border bg-muted/30 font-mono text-sm">
                          {currentTenant.slug}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">Business Name</Label>
                        <div className="p-2 rounded border border-border bg-muted/30">
                          {currentTenant.business_name || "-"}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">Short Name</Label>
                        <div className="p-2 rounded border border-border bg-muted/30">
                          {currentTenant.business_name_short || "-"}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">Phone Number</Label>
                        <div className="p-2 rounded border border-border bg-muted/30">
                          {currentTenant.openphone_phone_number || "-"}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">Service Area</Label>
                        <div className="p-2 rounded border border-border bg-muted/30">
                          {currentTenant.service_area || "-"}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">SDR Persona</Label>
                        <div className="p-2 rounded border border-border bg-muted/30">
                          {currentTenant.sdr_persona || "Mary"}
                        </div>
                      </div>
                    </div>
                    <div className="pt-4 text-xs text-muted-foreground">
                      <div>Created: {new Date(currentTenant.created_at).toLocaleString()}</div>
                      <div>Updated: {new Date(currentTenant.updated_at).toLocaleString()}</div>
                    </div>
                  </TabsContent>

                </Tabs>

              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Delete Business Confirmation */}
      {showDeleteConfirm && currentTenant && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-red-400 flex items-center gap-2">
                  <Trash2 className="h-5 w-5" />
                  Delete Business
                </CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowDeleteConfirm(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <CardDescription>
                This will permanently delete <strong>{currentTenant.slug}</strong> and all associated data including customers, jobs, leads, messages, and more.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="border-red-500/30 bg-red-500/15">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                <AlertTitle className="text-red-400">This action cannot be undone</AlertTitle>
                <AlertDescription className="text-muted-foreground">
                  All data for this business will be permanently removed.
                </AlertDescription>
              </Alert>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => deleteBusiness(currentTenant.id)}
                  disabled={deleting}
                >
                  {deleting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Business
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Campaign Create/Edit Modal */}
      {showCampaignModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-lg mx-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Megaphone className="h-5 w-5" />
                  {editingCampaign ? "Edit Campaign" : "New Campaign"}
                </CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowCampaignModal(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <CardDescription>
                {editingCampaign
                  ? "Update this seasonal campaign"
                  : "Create a new SMS campaign to reach your customers"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Campaign Name *</Label>
                <Input
                  value={campaignForm.name}
                  onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })}
                  placeholder="Spring Window Cleaning Special"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>SMS Message *</Label>
                  <span className={`text-xs ${campaignForm.message.length > 160 ? "text-red-400" : "text-muted-foreground"}`}>
                    {campaignForm.message.length}/160
                  </span>
                </div>
                <textarea
                  value={campaignForm.message}
                  onChange={(e) => setCampaignForm({ ...campaignForm, message: e.target.value })}
                  placeholder="Spring is here! Ready to get your windows sparkling? Reply YES for 15% off your next cleaning!"
                  maxLength={160}
                  rows={3}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Customer name is auto-prepended (e.g., "Hi John! " + your message)
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date *</Label>
                  <Input
                    type="date"
                    value={campaignForm.start_date}
                    onChange={(e) => setCampaignForm({ ...campaignForm, start_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>End Date *</Label>
                  <Input
                    type="date"
                    value={campaignForm.end_date}
                    onChange={(e) => setCampaignForm({ ...campaignForm, end_date: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Target Customers</Label>
                <select
                  value={campaignForm.target_segment}
                  onChange={(e) => setCampaignForm({ ...campaignForm, target_segment: e.target.value as SeasonalCampaign["target_segment"] })}
                  aria-label="Target customer segment"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="all">All Customers</option>
                  <option value="inactive_30">Inactive 30+ days</option>
                  <option value="inactive_60">Inactive 60+ days</option>
                  <option value="inactive_90">Inactive 90+ days</option>
                  <option value="completed_customers">Past Completed Customers</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <Label>Enabled</Label>
                <Switch
                  checked={campaignForm.enabled}
                  onCheckedChange={(checked) => setCampaignForm({ ...campaignForm, enabled: checked })}
                />
              </div>
              <div className="flex gap-2 pt-4">
                <Button variant="outline" className="flex-1" onClick={() => setShowCampaignModal(false)}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={saveCampaign}
                  disabled={
                    updating !== null ||
                    !campaignForm.name ||
                    !campaignForm.message ||
                    !campaignForm.start_date ||
                    !campaignForm.end_date ||
                    campaignForm.message.length > 160
                  }
                >
                  {editingCampaign ? "Save Changes" : "Create Campaign"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Onboarding Wizard */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-3xl mx-4 max-h-[95vh] flex flex-col overflow-hidden !bg-zinc-900">
            <CardHeader className="shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle>
                  {onboardStep === 0 && "Step 1: Business Info"}
                  {onboardStep === 1 && "Step 2: API Credentials"}
                  {onboardStep === 2 && "Step 3: Review & Setup"}
                </CardTitle>
                <Button variant="ghost" size="icon" onClick={() => { setShowAddModal(false); resetOnboardWizard() }}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {/* Step indicators */}
              <div className="flex gap-2 mt-2">
                {[0, 1, 2].map((s) => (
                  <div key={s} className={`h-1.5 flex-1 rounded-full ${s <= onboardStep ? "bg-primary" : "bg-muted"}`} />
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 overflow-y-auto">
              {/* STEP 0 — Business Info */}
              {onboardStep === 0 && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Business Name *</Label>
                      <Input
                        value={onboardForm.name}
                        onChange={(e) => {
                          const name = e.target.value
                          const autoSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
                          setOnboardForm({ ...onboardForm, name, slug: onboardForm.slug || autoSlug, business_name: onboardForm.business_name || name })
                        }}
                        placeholder="WinBros Cleaning"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Slug *</Label>
                      <Input
                        value={onboardForm.slug}
                        onChange={(e) => setOnboardForm({ ...onboardForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                        placeholder="winbros"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Password</Label>
                      <Input
                        type="password"
                        value={onboardForm.password}
                        onChange={(e) => setOnboardForm({ ...onboardForm, password: e.target.value })}
                        placeholder="Defaults to slug"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Flow Type *</Label>
                      <select
                        className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-800 text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        value={onboardForm.flow_type}
                        onChange={(e) => setOnboardForm({ ...onboardForm, flow_type: e.target.value as any })}
                      >
                        <option value="winbros" className="bg-zinc-800 text-zinc-100">WinBros (Window Cleaning — Full HCP)</option>
                        <option value="spotless" className="bg-zinc-800 text-zinc-100">Spotless (House Cleaning)</option>
                        <option value="cedar" className="bg-zinc-800 text-zinc-100">Cedar (Simple Booking)</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Pricing</Label>
                      <select
                        className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-800 text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        value={onboardForm.seed_pricing}
                        onChange={(e) => setOnboardForm({ ...onboardForm, seed_pricing: e.target.value as any })}
                      >
                        <option value="default" className="bg-zinc-800 text-zinc-100">Default (14 tiers + 7 addons)</option>
                        <option value="skip" className="bg-zinc-800 text-zinc-100">Skip — configure later</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Short Name</Label>
                      <Input
                        value={onboardForm.business_name_short}
                        onChange={(e) => setOnboardForm({ ...onboardForm, business_name_short: e.target.value })}
                        placeholder="WinBros"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Service Area</Label>
                      <Input
                        value={onboardForm.service_area}
                        onChange={(e) => setOnboardForm({ ...onboardForm, service_area: e.target.value })}
                        placeholder="Dallas, TX"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Service Type</Label>
                      <Input
                        value={onboardForm.service_description}
                        onChange={(e) => setOnboardForm({ ...onboardForm, service_description: e.target.value })}
                        placeholder="e.g., window cleaning, house cleaning"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Timezone</Label>
                      <select
                        className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-800 text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        value={onboardForm.timezone}
                        onChange={(e) => setOnboardForm({ ...onboardForm, timezone: e.target.value })}
                      >
                        <option value="America/New_York" className="bg-zinc-800 text-zinc-100">Eastern</option>
                        <option value="America/Chicago" className="bg-zinc-800 text-zinc-100">Central</option>
                        <option value="America/Denver" className="bg-zinc-800 text-zinc-100">Mountain</option>
                        <option value="America/Los_Angeles" className="bg-zinc-800 text-zinc-100">Pacific</option>
                        <option value="America/Phoenix" className="bg-zinc-800 text-zinc-100">Arizona</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>SDR Persona</Label>
                      <Input
                        value={onboardForm.sdr_persona}
                        onChange={(e) => setOnboardForm({ ...onboardForm, sdr_persona: e.target.value })}
                        placeholder="Mary"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Owner Phone</Label>
                      <Input
                        value={onboardForm.owner_phone}
                        onChange={(e) => setOnboardForm({ ...onboardForm, owner_phone: e.target.value })}
                        placeholder="+1234567890"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Owner Email</Label>
                      <Input
                        value={onboardForm.owner_email}
                        onChange={(e) => setOnboardForm({ ...onboardForm, owner_email: e.target.value })}
                        placeholder="owner@example.com"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Google Review Link</Label>
                    <Input
                      value={onboardForm.google_review_link}
                      onChange={(e) => setOnboardForm({ ...onboardForm, google_review_link: e.target.value })}
                      placeholder="https://g.page/..."
                    />
                  </div>
                  <div className="flex justify-end items-center gap-3 pt-4">
                    {onboardForm.slug && (onboardForm.slug.length < 3 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(onboardForm.slug)) && (
                      <p className="text-xs text-red-400">Slug must be 3+ chars, lowercase alphanumeric with single hyphens (no leading/trailing)</p>
                    )}
                    <Button onClick={() => setOnboardStep(1)} disabled={!onboardForm.name || !onboardForm.slug || onboardForm.slug.length < 3 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(onboardForm.slug)}>
                      Next: API Credentials
                    </Button>
                  </div>
                </>
              )}

              {/* STEP 1 — API Credentials */}
              {onboardStep === 1 && (
                <div className="space-y-2">
                  {/* OpenPhone */}
                  <div className="border border-zinc-600 rounded-lg p-2">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Label className="font-semibold text-sm">OpenPhone</Label>
                      <a href="https://my.openphone.com/settings/api" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">Dashboard</a>
                      <div className="flex-1" />
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs shrink-0"
                        disabled={!onboardForm.openphone_api_key || !onboardForm.openphone_phone_id || !!wizardTesting}
                        onClick={() => testConnectionDirect("openphone", { openphone_api_key: onboardForm.openphone_api_key, openphone_phone_id: onboardForm.openphone_phone_id })}
                      >
                        {wizardTesting === "openphone" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                      </Button>
                      {wizardTestResults.openphone && (
                        <span className="inline-flex cursor-pointer" title={wizardTestResults.openphone.message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(wizardTestResults.openphone.message)}>
                          {wizardTestResults.openphone.success
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                            : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                        </span>
                      )}
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs shrink-0"
                        disabled={!onboardForm.openphone_api_key || !!wizardRegistering}
                        onClick={() => registerWebhookDirect("openphone", { openphone_api_key: onboardForm.openphone_api_key })}
                      >
                        {wizardRegistering === "openphone" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Register"}
                      </Button>
                      {wizardRegisterResults.openphone && (
                        <span className="inline-flex cursor-pointer" title={(wizardRegisterResults.openphone.success ? "Webhook registered" : wizardRegisterResults.openphone.message) + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(wizardRegisterResults.openphone.success ? "Webhook registered" : wizardRegisterResults.openphone.message)}>
                          {wizardRegisterResults.openphone.success
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                            : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <Input className="h-8 text-sm" placeholder="API Key" value={onboardForm.openphone_api_key} onChange={(e) => setOnboardForm({ ...onboardForm, openphone_api_key: e.target.value })} />
                      <Input className="h-8 text-sm" placeholder="Phone ID" value={onboardForm.openphone_phone_id} onChange={(e) => setOnboardForm({ ...onboardForm, openphone_phone_id: e.target.value })} />
                      <Input className="h-8 text-sm" placeholder="Phone Number" value={onboardForm.openphone_phone_number} onChange={(e) => setOnboardForm({ ...onboardForm, openphone_phone_number: e.target.value })} />
                    </div>
                  </div>

                  {/* Telegram */}
                  <div className="border border-zinc-600 rounded-lg p-2">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Label className="font-semibold text-sm">Telegram</Label>
                      <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">BotFather</a>
                      <div className="flex-1" />
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs shrink-0"
                        disabled={!onboardForm.telegram_bot_token || !!wizardTesting}
                        onClick={() => testConnectionDirect("telegram", { telegram_bot_token: onboardForm.telegram_bot_token })}
                      >
                        {wizardTesting === "telegram" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                      </Button>
                      {wizardTestResults.telegram && (
                        <span className="inline-flex cursor-pointer" title={wizardTestResults.telegram.message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(wizardTestResults.telegram.message)}>
                          {wizardTestResults.telegram.success
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                            : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                        </span>
                      )}
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs shrink-0"
                        disabled={!onboardForm.telegram_bot_token || !onboardForm.slug || !!wizardRegistering}
                        onClick={() => registerWebhookDirect("telegram", { telegram_bot_token: onboardForm.telegram_bot_token, slug: onboardForm.slug })}
                      >
                        {wizardRegistering === "telegram" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Register"}
                      </Button>
                      {wizardRegisterResults.telegram && (
                        <span className="inline-flex cursor-pointer" title={(wizardRegisterResults.telegram.success ? "Webhook registered" : wizardRegisterResults.telegram.message) + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(wizardRegisterResults.telegram.success ? "Webhook registered" : wizardRegisterResults.telegram.message)}>
                          {wizardRegisterResults.telegram.success
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                            : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <Input className="h-8 text-sm" placeholder="Bot Token" value={onboardForm.telegram_bot_token} onChange={(e) => setOnboardForm({ ...onboardForm, telegram_bot_token: e.target.value })} />
                      <Input className="h-8 text-sm" placeholder="Owner Chat ID" value={onboardForm.owner_telegram_chat_id} onChange={(e) => setOnboardForm({ ...onboardForm, owner_telegram_chat_id: e.target.value })} />
                    </div>
                  </div>

                  {/* Stripe */}
                  <div className="border border-zinc-600 rounded-lg p-2">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Label className="font-semibold text-sm">Stripe</Label>
                      <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">Dashboard</a>
                      <div className="flex-1" />
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs shrink-0"
                        disabled={!onboardForm.stripe_secret_key || !!wizardTesting}
                        onClick={() => testConnectionDirect("stripe", { stripe_secret_key: onboardForm.stripe_secret_key })}
                      >
                        {wizardTesting === "stripe" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                      </Button>
                      {wizardTestResults.stripe && (
                        <span className="inline-flex cursor-pointer" title={wizardTestResults.stripe.message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(wizardTestResults.stripe.message)}>
                          {wizardTestResults.stripe.success
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                            : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                        </span>
                      )}
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs shrink-0"
                        disabled={!onboardForm.stripe_secret_key || !!wizardRegistering}
                        onClick={() => registerWebhookDirect("stripe", { stripe_secret_key: onboardForm.stripe_secret_key })}
                      >
                        {wizardRegistering === "stripe" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Register"}
                      </Button>
                      {wizardRegisterResults.stripe && (
                        <span className="inline-flex cursor-pointer" title={(wizardRegisterResults.stripe.success ? `Webhook registered${wizardRegisterResults.stripe.secret ? " (secret saved)" : ""}` : wizardRegisterResults.stripe.message) + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(wizardRegisterResults.stripe.success ? `Webhook registered${wizardRegisterResults.stripe.secret ? " (secret saved)" : ""}` : wizardRegisterResults.stripe.message)}>
                          {wizardRegisterResults.stripe.success
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                            : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                        </span>
                      )}
                    </div>
                    <Input className="h-8 text-sm" placeholder="Secret Key (sk_...)" value={onboardForm.stripe_secret_key} onChange={(e) => setOnboardForm({ ...onboardForm, stripe_secret_key: e.target.value })} />
                    <Input className="h-8 text-sm mt-1.5" placeholder="Publishable Key (pk_...)" value={onboardForm.stripe_publishable_key} onChange={(e) => setOnboardForm({ ...onboardForm, stripe_publishable_key: e.target.value })} />
                  </div>

                  {/* VAPI */}
                  <div className="border border-zinc-600 rounded-lg p-2">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Label className="font-semibold text-sm">VAPI</Label>
                      <a href="https://dashboard.vapi.ai" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">Dashboard</a>
                      <div className="flex-1" />
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs shrink-0"
                        disabled={!onboardForm.vapi_api_key || !!wizardTesting}
                        onClick={() => testConnectionDirect("vapi-key-only", { vapi_api_key: onboardForm.vapi_api_key })}
                      >
                        {wizardTesting === "vapi-key-only" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test Key"}
                      </Button>
                      {wizardTestResults["vapi-key-only"] && (
                        <span className="inline-flex cursor-pointer" title={wizardTestResults["vapi-key-only"].message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(wizardTestResults["vapi-key-only"].message)}>
                          {wizardTestResults["vapi-key-only"].success
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                            : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                        </span>
                      )}
                    </div>
                    <Input className="h-8 text-sm" placeholder="API Key" value={onboardForm.vapi_api_key} onChange={(e) => setOnboardForm({ ...onboardForm, vapi_api_key: e.target.value })} />
                    <Input className="h-8 text-sm mt-1.5" placeholder="Phone ID" value={onboardForm.vapi_phone_id} onChange={(e) => setOnboardForm({ ...onboardForm, vapi_phone_id: e.target.value })} />

                    {/* Clone from template */}
                    <div className="mt-2 border border-dashed border-zinc-500 rounded p-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">Clone from template</span>
                        <span className="text-xs text-muted-foreground">({onboardForm.flow_type})</span>
                        <div className="flex-1" />
                        <Button size="sm" variant="outline" className="h-6 px-2 text-xs shrink-0"
                          disabled={!onboardForm.vapi_api_key || !onboardForm.slug || vapiCloning || !!vapiCloneResult}
                          onClick={cloneVapiAssistants}
                        >
                          {vapiCloning ? <Loader2 className="h-3 w-3 animate-spin" /> : vapiCloneResult ? "Cloned" : "Clone Assistants"}
                        </Button>
                        {vapiCloneResult && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        )}
                        {wizardTestResults["vapi-clone"] && !wizardTestResults["vapi-clone"].success && (
                          <span className="inline-flex cursor-pointer" title={wizardTestResults["vapi-clone"].message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(wizardTestResults["vapi-clone"].message)}>
                            <X className="h-3.5 w-3.5 text-red-500 shrink-0" />
                          </span>
                        )}
                      </div>
                      {vapiCloneResult && (
                        <p className="text-xs text-green-400 mt-1">
                          Inbound: {vapiCloneResult.inbound}{vapiCloneResult.outbound ? ` | Outbound: ${vapiCloneResult.outbound}` : ""}
                        </p>
                      )}
                      {wizardTestResults["vapi-clone"] && !wizardTestResults["vapi-clone"].success && (
                        <p className="text-xs text-red-400 mt-1">{wizardTestResults["vapi-clone"].message}</p>
                      )}
                    </div>

                    {/* Manual override / advanced */}
                    <details className="mt-1.5">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Advanced: manual assistant IDs</summary>
                      <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                        <Input className="h-8 text-sm" placeholder="Inbound Assistant ID" value={onboardForm.vapi_assistant_id} onChange={(e) => setOnboardForm({ ...onboardForm, vapi_assistant_id: e.target.value })} />
                        <Input className="h-8 text-sm" placeholder="Outbound Assistant ID" value={onboardForm.vapi_outbound_assistant_id} onChange={(e) => setOnboardForm({ ...onboardForm, vapi_outbound_assistant_id: e.target.value })} />
                      </div>
                    </details>
                  </div>

                  {/* Gmail (Email Bot) */}
                  <div className="border border-zinc-600 rounded-lg p-2">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Label className="font-semibold text-sm">Gmail (Email Bot)</Label>
                      <span className="text-xs text-muted-foreground">Automated email sending</span>
                      <div className="flex-1" />
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs shrink-0"
                        disabled={!onboardForm.gmail_user || !onboardForm.gmail_app_password || !!wizardTesting}
                        onClick={() => testConnectionDirect("gmail", { gmail_user: onboardForm.gmail_user, gmail_app_password: onboardForm.gmail_app_password })}
                      >
                        {wizardTesting === "gmail" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                      </Button>
                      {wizardTestResults.gmail && (
                        <span className="inline-flex cursor-pointer" title={wizardTestResults.gmail.message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(wizardTestResults.gmail.message)}>
                          {wizardTestResults.gmail.success
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                            : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Input className="h-8 text-sm" type="email" placeholder="Gmail address (e.g. business@gmail.com)" value={onboardForm.gmail_user} onChange={(e) => setOnboardForm({ ...onboardForm, gmail_user: e.target.value })} />
                      <Input className="h-8 text-sm" type="password" placeholder="App Password (not regular password)" value={onboardForm.gmail_app_password} onChange={(e) => setOnboardForm({ ...onboardForm, gmail_app_password: e.target.value })} />
                      <p className="text-xs text-muted-foreground">Use a Gmail App Password — generate one at Google Account → Security → App Passwords</p>
                    </div>
                  </div>

                  {/* Additional Services — expandable */}
                  <button
                    type="button"
                    className="w-full text-left text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 py-1"
                    onClick={() => setShowExtraServices(!showExtraServices)}
                  >
                    <span className={`transition-transform ${showExtraServices ? "rotate-90" : ""}`}>&#9654;</span>
                    Additional Services
                  </button>
                  {showExtraServices && (
                    <div className="space-y-2 pl-2 border-l-2 border-muted">
                      {/* HousecallPro */}
                      <div className="border border-zinc-600 rounded-lg p-2">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Label className="font-semibold text-sm">HousecallPro</Label>
                          <a href="https://app.housecallpro.com" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">Settings</a>
                          <span className="text-xs text-orange-500">Manual webhook setup required</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <Input className="h-8 text-sm" placeholder="API Key" value={onboardForm.housecall_pro_api_key} onChange={(e) => setOnboardForm({ ...onboardForm, housecall_pro_api_key: e.target.value })} />
                          <Input className="h-8 text-sm" placeholder="Company ID" value={onboardForm.housecall_pro_company_id} onChange={(e) => setOnboardForm({ ...onboardForm, housecall_pro_company_id: e.target.value })} />
                        </div>
                        <div className="text-xs text-muted-foreground mt-1.5 space-y-0.5">
                          <p className="font-medium">Manual webhook setup:</p>
                          <p>1. Go to HCP Settings &gt; Integrations &gt; Webhooks</p>
                          <p>2. Add webhook URL: <code className="bg-muted px-1 rounded">{"{baseUrl}"}/api/webhooks/housecall-pro</code></p>
                          <p>3. Enable events: job.scheduled, job.completed, estimate.scheduled</p>
                        </div>
                      </div>
                      {/* Wave */}
                      <div className="border border-zinc-600 rounded-lg p-2">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Label className="font-semibold text-sm">Wave Accounting</Label>
                          <a href="https://my.waveapps.com" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">Dashboard</a>
                          <div className="flex-1" />
                          <Button size="sm" variant="outline" className="h-6 px-2 text-xs shrink-0"
                            disabled={!onboardForm.wave_api_token || !onboardForm.wave_business_id || !!wizardTesting}
                            onClick={() => testConnectionDirect("wave", { wave_api_token: onboardForm.wave_api_token, wave_business_id: onboardForm.wave_business_id })}
                          >
                            {wizardTesting === "wave" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                          </Button>
                          {wizardTestResults.wave && (
                            <span className="inline-flex cursor-pointer" title={wizardTestResults.wave.message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(wizardTestResults.wave.message)}>
                              {wizardTestResults.wave.success
                                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                                : <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          <Input className="h-8 text-sm" placeholder="API Token" value={onboardForm.wave_api_token} onChange={(e) => setOnboardForm({ ...onboardForm, wave_api_token: e.target.value })} />
                          <Input className="h-8 text-sm" placeholder="Business ID" value={onboardForm.wave_business_id} onChange={(e) => setOnboardForm({ ...onboardForm, wave_business_id: e.target.value })} />
                          <Input className="h-8 text-sm" placeholder="Income Account ID" value={onboardForm.wave_income_account_id} onChange={(e) => setOnboardForm({ ...onboardForm, wave_income_account_id: e.target.value })} />
                        </div>
                      </div>
                      {/* GHL */}
                      <div className="border border-zinc-600 rounded-lg p-2">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Label className="font-semibold text-sm">GHL (GoHighLevel)</Label>
                          <a href="https://app.gohighlevel.com/settings" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">Settings</a>
                          <span className="text-xs text-orange-500">Manual webhook setup required</span>
                        </div>
                        <Input className="h-8 text-sm" placeholder="Location ID" value={onboardForm.ghl_location_id} onChange={(e) => setOnboardForm({ ...onboardForm, ghl_location_id: e.target.value })} />
                        <div className="text-xs text-muted-foreground mt-1.5 space-y-0.5">
                          <p className="font-medium">Manual webhook setup:</p>
                          <p>1. Go to GHL Settings &gt; Webhooks</p>
                          <p>2. Add webhook URL: <code className="bg-muted px-1 rounded">{"{baseUrl}"}/api/webhooks/ghl</code></p>
                          <p>3. Enable: Contact Create, Contact Update, Opportunity Status Change</p>
                        </div>
                      </div>

                      {/* Custom Services */}
                      {customServices.map((svc, si) => (
                        <div key={si} className="border border-zinc-600 rounded-lg p-2">
                          <div className="flex items-center gap-2 mb-1.5">
                            <Input className="h-7 text-sm font-semibold w-40" placeholder="Service Name" value={svc.name}
                              onChange={(e) => {
                                const updated = [...customServices]
                                updated[si] = { ...svc, name: e.target.value }
                                setCustomServices(updated)
                              }}
                            />
                            <Button size="sm" variant="ghost" className="h-6 px-1 text-xs text-red-500"
                              onClick={() => setCustomServices(customServices.filter((_, i) => i !== si))}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                          {svc.fields.map((f, fi) => (
                            <div key={fi} className="grid grid-cols-[1fr_1fr_auto] gap-1.5 mb-1">
                              <Input className="h-7 text-xs" placeholder="Key (e.g. api_key)" value={f.key}
                                onChange={(e) => {
                                  const updated = [...customServices]
                                  updated[si].fields[fi] = { ...f, key: e.target.value }
                                  setCustomServices(updated)
                                }}
                              />
                              <Input className="h-7 text-xs" placeholder="Value" value={f.value}
                                onChange={(e) => {
                                  const updated = [...customServices]
                                  updated[si].fields[fi] = { ...f, value: e.target.value }
                                  setCustomServices(updated)
                                }}
                              />
                              <Button size="sm" variant="ghost" className="h-7 px-1"
                                onClick={() => {
                                  const updated = [...customServices]
                                  updated[si].fields = svc.fields.filter((_, i) => i !== fi)
                                  setCustomServices(updated)
                                }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                          <Button size="sm" variant="ghost" className="h-6 text-xs"
                            onClick={() => {
                              const updated = [...customServices]
                              updated[si].fields = [...svc.fields, { key: "", value: "" }]
                              setCustomServices(updated)
                            }}
                          >
                            + Add Field
                          </Button>
                        </div>
                      ))}
                      <Button size="sm" variant="outline" className="w-full h-7 text-xs"
                        onClick={() => setCustomServices([...customServices, { name: "", fields: [{ key: "", value: "" }] }])}
                      >
                        + Add Custom Service
                      </Button>
                    </div>
                  )}

                  {/* Test All + Navigation */}
                  <div className="flex items-center gap-2 pt-3">
                    <Button variant="outline" onClick={() => setOnboardStep(0)}>Back</Button>
                    <Button variant="outline" size="sm"
                      disabled={!!wizardTesting || (!onboardForm.openphone_api_key && !onboardForm.telegram_bot_token && !onboardForm.stripe_secret_key && !onboardForm.vapi_api_key && !onboardForm.wave_api_token)}
                      onClick={testAllConnectionsDirect}
                    >
                      {wizardTesting === "all" ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Testing...</> : "Test All"}
                    </Button>
                    <div className="flex-1" />
                    <Button onClick={() => setOnboardStep(2)}>Next: Review</Button>
                  </div>
                </div>
              )}

              {/* STEP 2 — Review & Setup (check → create) */}
              {onboardStep === 2 && (() => {
                // Compute untested credentials
                const untestedServices: string[] = []
                if (onboardForm.openphone_api_key && !wizardTestResults.openphone) untestedServices.push("OpenPhone")
                if (onboardForm.telegram_bot_token && !wizardTestResults.telegram) untestedServices.push("Telegram")
                if (onboardForm.stripe_secret_key && !wizardTestResults.stripe) untestedServices.push("Stripe")
                if (onboardForm.vapi_api_key && !wizardTestResults["vapi-key-only"]) untestedServices.push("VAPI")
                if (onboardForm.wave_api_token && !wizardTestResults.wave) untestedServices.push("Wave")

                return (
                  <>
                    {/* Business Info Review */}
                    <div className="space-y-1.5 text-sm">
                      <p className="font-medium text-base">Business Info</p>
                      {([
                        { label: "Business Name", value: onboardForm.name, required: true },
                        { label: "Slug", value: onboardForm.slug, required: true },
                        { label: "Flow Type", value: onboardForm.flow_type.charAt(0).toUpperCase() + onboardForm.flow_type.slice(1), required: true },
                        { label: "Password", value: onboardForm.password ? "Set" : "Default (slug)", required: false, always: true },
                        { label: "Pricing", value: onboardForm.seed_pricing === "default" ? "Default (14 tiers + 7 addons)" : "Skip", required: false, always: true },
                        { label: "Short Name", value: onboardForm.business_name_short },
                        { label: "Service Area", value: onboardForm.service_area },
                        { label: "Service Type", value: onboardForm.service_description },
                        { label: "Timezone", value: ({ "America/New_York": "Eastern", "America/Chicago": "Central", "America/Denver": "Mountain", "America/Los_Angeles": "Pacific" } as Record<string, string>)[onboardForm.timezone] || onboardForm.timezone, required: false, always: true },
                        { label: "SDR Persona", value: onboardForm.sdr_persona, required: false, always: true },
                        { label: "Owner Phone", value: onboardForm.owner_phone },
                        { label: "Owner Email", value: onboardForm.owner_email },
                        { label: "Google Review Link", value: onboardForm.google_review_link },
                      ] as Array<{ label: string; value: string; required?: boolean; always?: boolean }>).map((field) => (
                        <div key={field.label} className="flex items-center gap-2 pl-2">
                          {field.value
                            ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                            : field.required
                              ? <X className="h-4 w-4 text-red-500 shrink-0" />
                              : <div className="h-4 w-4 rounded-full border-2 border-muted shrink-0" />}
                          <span className="w-36 text-muted-foreground shrink-0">{field.label}</span>
                          <span className={field.value ? "font-medium" : "text-muted-foreground italic"}>{field.value || "Not set"}</span>
                        </div>
                      ))}
                    </div>

                    {/* API Credentials Review — only configured services */}
                    {(() => {
                      const configuredServices = [
                        { name: "OpenPhone", configured: !!onboardForm.openphone_api_key, testKey: "openphone", registerKey: "openphone", needsManual: false },
                        { name: "Telegram", configured: !!onboardForm.telegram_bot_token, testKey: "telegram", registerKey: "telegram", needsManual: false },
                        { name: "Stripe", configured: !!onboardForm.stripe_secret_key, testKey: "stripe", registerKey: "stripe", needsManual: false },
                        { name: "VAPI", configured: !!onboardForm.vapi_api_key, testKey: "vapi-key-only", registerKey: null, needsManual: false },
                        { name: "HousecallPro", configured: !!onboardForm.housecall_pro_api_key, testKey: null, registerKey: null, needsManual: true },
                        { name: "Wave", configured: !!onboardForm.wave_api_token, testKey: "wave", registerKey: null, needsManual: false },
                        { name: "GHL", configured: !!onboardForm.ghl_location_id, testKey: null, registerKey: null, needsManual: true },
                        { name: "Gmail", configured: !!onboardForm.gmail_user, testKey: "gmail", registerKey: null, needsManual: false },
                      ].filter(s => s.configured)
                      if (configuredServices.length === 0) return (
                        <div className="border-t border-zinc-600 pt-3 mt-3 text-sm">
                          <p className="font-medium text-base">API Credentials</p>
                          <p className="text-muted-foreground italic pl-2 mt-1">None — you can add credentials later</p>
                        </div>
                      )
                      return (
                        <div className="border-t border-zinc-600 pt-3 mt-3 space-y-1.5 text-sm">
                          <p className="font-medium text-base">API Credentials</p>
                          {configuredServices.map((svc) => {
                            const testResult = svc.testKey ? wizardTestResults[svc.testKey] : null
                            const regResult = svc.registerKey ? wizardRegisterResults[svc.registerKey] : null
                            const isTestingThis = wizardTesting === "all" && svc.testKey && !testResult
                            const anyFailed = (testResult && !testResult.success) || (regResult && !regResult.success)
                            const testVerified = svc.testKey ? (testResult && testResult.success) : true
                            const regVerified = svc.registerKey ? (regResult && regResult.success) : true
                            const fullyVerified = testVerified && regVerified
                            const needsManualAttention = svc.needsManual && !anyFailed && !isTestingThis
                            return (
                              <div key={svc.name} className="flex items-center gap-2 pl-2">
                                {isTestingThis
                                  ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                                  : anyFailed
                                    ? <X className="h-4 w-4 text-red-500 shrink-0" />
                                    : needsManualAttention
                                      ? <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
                                      : fullyVerified
                                        ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                                        : <X className="h-4 w-4 text-red-500 shrink-0" />}
                                <span className="w-36 font-medium shrink-0">{svc.name}</span>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                  {testResult && (
                                    <span className="inline-flex items-center gap-1 cursor-pointer" title={testResult.message + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(testResult.message)}>
                                      {testResult.success
                                        ? <CheckCircle2 className="h-3 w-3 text-green-500" />
                                        : <X className="h-3 w-3 text-red-500" />}
                                      tested
                                    </span>
                                  )}
                                  {regResult && (
                                    <span className="inline-flex items-center gap-1 cursor-pointer" title={(regResult.success ? "Webhook registered" : regResult.message) + "\n(Click to copy)"} onClick={() => navigator.clipboard.writeText(regResult.success ? "Webhook registered" : regResult.message)}>
                                      {regResult.success
                                        ? <CheckCircle2 className="h-3 w-3 text-green-500" />
                                        : <X className="h-3 w-3 text-red-500" />}
                                      registered
                                    </span>
                                  )}
                                  {svc.needsManual && <span className="text-orange-500">unverified — manual setup needed</span>}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}

                    {/* Untested credential reminder */}
                    {untestedServices.length > 0 && !onboardResults && wizardTesting !== "all" && (
                      <div className="mt-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                        Not verified: {untestedServices.join(", ")}. Go back to test these credentials before creating.
                      </div>
                    )}

                    {/* Error message (shown inside wizard) */}
                    {error && !onboarding && (
                      <div className="mt-2 px-3 py-2 bg-red-950/50 border border-red-500/30 rounded text-xs text-red-400">
                        <span className="font-medium">Error:</span> {error}
                      </div>
                    )}

                    {/* Pipeline running indicator */}
                    {onboarding && !onboardResults && (
                      <div className="flex items-center gap-2 pt-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Creating tenant...
                      </div>
                    )}

                    {/* Pipeline results — only shown on failure (success auto-navigates) */}
                    {onboardResults && (
                      <div className="border-t border-zinc-600 pt-3 mt-3 space-y-2 text-sm">
                        {/* Core steps */}
                        {(["create_tenant", "create_user", "seed_pricing", "save_credentials"] as const).map((key) => {
                          const step = onboardResults.steps[key]
                          if (!step) return null
                          const label = key.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
                          return (
                            <div key={key} className="flex items-center gap-2">
                              {step.status === "success" ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                              ) : step.status === "skipped" ? (
                                <div className="h-4 w-4 rounded-full border-2 border-muted shrink-0" />
                              ) : (
                                <X className="h-4 w-4 text-red-500 shrink-0" />
                              )}
                              <span className="font-medium">{label}</span>
                              <span className="text-muted-foreground ml-auto text-right break-words max-w-[400px] select-text cursor-text text-xs" title={step.message}>{step.message}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Post-Onboarding Checklist — shown after successful creation */}
                    {onboardResults && onboardResults.steps.create_tenant?.status === "success" && (
                      <div className="border border-orange-500/30 bg-orange-500/5 rounded-lg p-3 mt-4">
                        <p className="font-medium text-sm mb-2 flex items-center gap-1.5">
                          <ClipboardList className="h-4 w-4 text-orange-500" />
                          Manual Setup Required
                        </p>
                        <div className="space-y-2 text-xs">
                          {onboardForm.housecall_pro_api_key && (
                            <div className="flex items-start gap-2">
                              <span className="text-orange-500 mt-0.5">&#9634;</span>
                              <div>
                                <p className="font-medium">HousecallPro Webhook</p>
                                <p className="text-muted-foreground">Add this URL in HCP → Settings → Webhooks:</p>
                                <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded select-all cursor-text block mt-0.5">
                                  {typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/housecall-pro
                                </code>
                              </div>
                            </div>
                          )}
                          {onboardForm.ghl_location_id && (
                            <div className="flex items-start gap-2">
                              <span className="text-orange-500 mt-0.5">&#9634;</span>
                              <div>
                                <p className="font-medium">GoHighLevel Webhook</p>
                                <p className="text-muted-foreground">Add this URL in GHL → Settings → Webhooks:</p>
                                <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded select-all cursor-text block mt-0.5">
                                  {typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/ghl/{onboardForm.slug}
                                </code>
                              </div>
                            </div>
                          )}
                          {onboardForm.vapi_api_key && (
                            <div className="flex items-start gap-2">
                              <span className="text-orange-500 mt-0.5">&#9634;</span>
                              <div>
                                <p className="font-medium">VAPI Server URL &amp; Phone Setup</p>
                                <p className="text-muted-foreground">1. Go to VAPI Dashboard → Phone Numbers → set Server URL to:</p>
                                <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded select-all cursor-text block mt-0.5">
                                  {typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/vapi/{onboardForm.slug}
                                </code>
                                <p className="text-muted-foreground mt-1">2. Assign the inbound assistant to your phone number</p>
                                <p className="text-muted-foreground">3. Make a test call to verify</p>
                              </div>
                            </div>
                          )}
                          <div className="flex items-start gap-2">
                            <span className="text-orange-500 mt-0.5">&#9634;</span>
                            <div>
                              <p className="font-medium">Add Cleaners</p>
                              <p className="text-muted-foreground">Add at least one cleaner with Telegram chat ID for dispatch to work</p>
                            </div>
                          </div>
                          {!onboardForm.google_review_link && (
                            <div className="flex items-start gap-2">
                              <span className="text-orange-500 mt-0.5">&#9634;</span>
                              <div>
                                <p className="font-medium">Google Review Link</p>
                                <p className="text-muted-foreground">Add a Google review link to enable review request automation</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Navigation */}
                    <div className="flex justify-between pt-4">
                      <Button variant="outline" disabled={onboarding}
                        onClick={() => { setOnboardResults(null); setOnboardStep(1) }}>
                        Back
                      </Button>
                      <Button onClick={runOnboarding} disabled={onboarding || wizardTesting === "all" || !!onboardResults}>
                        {onboarding ? (
                          <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Creating...</>
                        ) : (
                          "Create Tenant"
                        )}
                      </Button>
                    </div>
                  </>
                )
              })()}
            </CardContent>
          </Card>
        </div>
      )}
      <AlertDialog open={webhookConfirmOpen} onOpenChange={setWebhookConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Re-register {webhookConfirmService === "all" ? "all webhooks" : `${webhookConfirmService} webhook`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the existing webhook and create a new one with a new signing secret. The current secret will be invalidated. If the new secret fails to save, webhook signature validation will break until re-registered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                webhookConfirmAction?.()
                setWebhookConfirmOpen(false)
              }}
            >
              Re-register
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
