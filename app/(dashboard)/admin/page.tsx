"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  Wrench,
  Loader2,
} from "lucide-react"

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
}

interface Tenant {
  id: string
  name: string
  slug: string
  email: string | null
  business_name: string | null
  business_name_short: string | null
  service_area: string | null
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
  // Status
  workflow_config: WorkflowConfig
  active: boolean
  created_at: string
  updated_at: string
}

// Helper to mask API keys for display
function maskKey(key: string | null): string {
  if (!key) return ""
  if (key.length <= 8) return "••••••••"
  return "••••••••" + key.slice(-4)
}

export default function AdminPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null)

  // Add New Business modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [newBusiness, setNewBusiness] = useState({ name: "", slug: "", email: "", password: "" })
  const [creating, setCreating] = useState(false)

  // Credentials editing state
  const [editingCredentials, setEditingCredentials] = useState<Partial<Tenant>>({})
  const [savingCredentials, setSavingCredentials] = useState(false)
  const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set())

  // Tab state - persists across saves
  const [activeTab, setActiveTab] = useState("controls")

  // Copy all credentials state
  const [copied, setCopied] = useState(false)

  // Reset test customers state
  const [resetting, setResetting] = useState(false)
  const [resetResult, setResetResult] = useState<{ success: boolean; deletions?: string[]; error?: string } | null>(null)

  // Delete business state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
        setSelectedTenant(json.data[0].id)
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

  async function createBusiness() {
    if (!newBusiness.name || !newBusiness.slug) {
      setError("Name and slug are required")
      return
    }
    setCreating(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newBusiness),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || "Failed to create business")
      }
      setShowAddModal(false)
      setNewBusiness({ name: "", slug: "", email: "", password: "" })
      await fetchTenants()
      // Select the newly created tenant
      if (json.data?.id) {
        setSelectedTenant(json.data.id)
      }
    } catch (e: any) {
      setError(e.message || "Failed to create business")
    } finally {
      setCreating(false)
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
      return (editingCredentials as any)[field] || ""
    }
    return (tenant as any)[field] || ""
  }

  function setFieldValue(field: keyof Tenant, value: string) {
    setEditingCredentials((prev) => ({ ...prev, [field]: value }))
  }

  function copyAllCredentials() {
    if (!currentTenant) return

    const credentialFields = [
      { label: "Business Name", value: currentTenant.business_name },
      { label: "Short Name", value: currentTenant.business_name_short },
      { label: "Service Area", value: currentTenant.service_area },
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

  async function resetTestCustomers() {
    console.log("[ADMIN] resetTestCustomers called")
    const testPhones = ["4242755847", "4157204580"]

    // No confirmation - just do it immediately
    setResetting(true)
    setResetResult(null)
    console.log("[ADMIN] Starting reset...")

    const allDeletions: string[] = []
    let hasError = false

    for (const phone of testPhones) {
      try {
        console.log(`[ADMIN] Resetting phone: ${phone}`)
        const res = await fetch("/api/admin/reset-customer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phoneNumber: phone }),
        })
        console.log(`[ADMIN] Response status for ${phone}:`, res.status)
        const json = await res.json()
        console.log(`[ADMIN] Response for ${phone}:`, json)

        if (res.ok && json.success && json.data?.deletions) {
          allDeletions.push(`--- ${phone} ---`, ...json.data.deletions)
        } else if (!res.ok) {
          allDeletions.push(`--- ${phone} --- Error: ${json.error || 'Unknown error'}`)
          hasError = true
        } else {
          allDeletions.push(`--- ${phone} --- No data found`)
        }
      } catch (e: any) {
        console.error(`[ADMIN] Error resetting ${phone}:`, e)
        allDeletions.push(`--- ${phone} --- Error: ${e.message}`)
        hasError = true
      }
    }

    console.log("[ADMIN] Reset complete, deletions:", allDeletions)
    setResetResult({
      success: !hasError,
      deletions: allDeletions.length > 0 ? allDeletions : ["No data found for test numbers"]
    })
    setResetting(false)
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
      setSelectedTenant(null)
      await fetchTenants()
    } catch (e: any) {
      setError(e.message || "Failed to delete business")
    } finally {
      setDeleting(false)
    }
  }

  function getFlowType(config: WorkflowConfig): string {
    if (config.use_housecall_pro && config.use_route_optimization) return "winbros"
    if (!config.use_housecall_pro && !config.use_route_optimization) return "spotless"
    return "custom"
  }

  async function setFlowType(tenant: Tenant, flowType: string) {
    if (flowType === "winbros") {
      await updateTenant(tenant.id, {
        workflow_config: {
          use_housecall_pro: true,
          use_route_optimization: true,
          cleaner_assignment_auto: true,
          skip_calls_for_sms_leads: true,
          use_vapi_inbound: true,
          use_vapi_outbound: true,
        },
      })
    } else if (flowType === "spotless") {
      await updateTenant(tenant.id, {
        workflow_config: {
          use_housecall_pro: false,
          use_route_optimization: false,
          cleaner_assignment_auto: false,
          skip_calls_for_sms_leads: false,
          use_vapi_inbound: true,
          use_vapi_outbound: true,
        },
      })
    }
  }

  const currentTenant = tenants.find((t) => t.id === selectedTenant)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-semibold text-foreground">
          <ShieldCheck className="h-7 w-7 text-primary" />
          Admin Panel
        </h1>
        <p className="text-sm text-muted-foreground">Manage businesses, booking flows, and system controls</p>
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
                    onClick={() => setSelectedTenant(tenant.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedTenant === tenant.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm">{tenant.business_name || tenant.name}</span>
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
                    <CardTitle>{currentTenant.business_name || currentTenant.name}</CardTitle>
                    <CardDescription>Slug: {currentTenant.slug}</CardDescription>
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
                    <TabsTrigger value="info" className="gap-2">
                      <Building2 className="h-4 w-4" />
                      Info
                    </TabsTrigger>
                    <TabsTrigger value="tools" className="gap-2">
                      <Wrench className="h-4 w-4" />
                      Tools
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
                  </TabsContent>

                  {/* Credentials Tab */}
                  <TabsContent value="credentials" className="space-y-6">
                    {/* Action buttons */}
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={copyAllCredentials}>
                        {copied ? (
                          <Check className="h-4 w-4 mr-2 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4 mr-2" />
                        )}
                        {copied ? "Copied!" : "Copy All"}
                      </Button>
                      {Object.keys(editingCredentials).length > 0 && (
                        <Button onClick={saveCredentials} disabled={savingCredentials}>
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
                          <Label className="text-sm">Business Name</Label>
                          <Input
                            value={getFieldValue(currentTenant, "business_name")}
                            onChange={(e) => setFieldValue("business_name", e.target.value)}
                            placeholder="WinBros Cleaning"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Short Name</Label>
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
                    </div>

                    {/* VAPI */}
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" />
                        VAPI (Voice AI)
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
                    </div>

                    {/* Stripe */}
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium flex items-center gap-2">
                        <Key className="h-4 w-4" />
                        Stripe
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    </div>

                    {/* HousecallPro */}
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium flex items-center gap-2">
                        <Settings2 className="h-4 w-4" />
                        HousecallPro
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
                    </div>

                    {/* GoHighLevel */}
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium flex items-center gap-2">
                        <Settings2 className="h-4 w-4" />
                        GoHighLevel
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
                    </div>

                    {/* Telegram */}
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" />
                        Telegram
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
                    </div>

                    {/* Wave */}
                    <div className="p-4 rounded-lg border border-border space-y-4">
                      <div className="font-medium flex items-center gap-2">
                        <Settings2 className="h-4 w-4" />
                        Wave Accounting
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
                    </div>
                  </TabsContent>

                  {/* Info Tab */}
                  <TabsContent value="info" className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">Slug</Label>
                        <div className="p-2 rounded border border-border bg-muted/30 font-mono text-sm">
                          {currentTenant.slug}
                        </div>
                      </div>
                    </div>
                    <div className="pt-4 text-xs text-muted-foreground">
                      <div>Created: {new Date(currentTenant.created_at).toLocaleString()}</div>
                      <div>Updated: {new Date(currentTenant.updated_at).toLocaleString()}</div>
                    </div>
                  </TabsContent>

                  {/* Tools Tab */}
                  <TabsContent value="tools" className="space-y-6">
                    {/* Reset Test Customers */}
                    <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/5 space-y-4">
                      <div className="font-medium flex items-center gap-2 text-red-400">
                        <Trash2 className="h-4 w-4" />
                        Reset Test Customers
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Delete all data for test phone numbers: <code className="text-xs bg-zinc-800 px-1 rounded">(424) 275-5847</code> and <code className="text-xs bg-zinc-800 px-1 rounded">(415) 720-4580</code>
                        <br />
                        <strong className="text-red-400">This action cannot be undone.</strong>
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          console.log("[ADMIN] Button clicked!")
                          resetTestCustomers()
                        }}
                        disabled={resetting}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        style={{ cursor: resetting ? 'not-allowed' : 'pointer' }}
                      >
                        {resetting ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Resetting...
                          </>
                        ) : (
                          <>
                            <Trash2 className="h-4 w-4" />
                            Reset Data
                          </>
                        )}
                      </button>

                      {/* Result display */}
                      {resetResult && (
                        <div className={`p-3 rounded-lg border ${
                          resetResult.success
                            ? "border-green-500/30 bg-green-500/10"
                            : "border-red-500/30 bg-red-500/10"
                        }`}>
                          {resetResult.success ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-green-400 font-medium">
                                <CheckCircle2 className="h-4 w-4" />
                                Customer data reset successfully
                              </div>
                              {resetResult.deletions && resetResult.deletions.length > 0 && (
                                <ul className="text-sm text-muted-foreground list-disc list-inside">
                                  {resetResult.deletions.map((d, i) => (
                                    <li key={i}>{d}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-red-400">
                              <AlertTriangle className="h-4 w-4" />
                              {resetResult.error}
                            </div>
                          )}
                        </div>
                      )}
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
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
                This will permanently delete <strong>{currentTenant.business_name || currentTenant.name}</strong> and all associated data including customers, jobs, leads, messages, and more.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="border-red-500/30 bg-red-500/5">
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

      {/* Add New Business Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Add New Business</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowAddModal(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <CardDescription>Create a new business/tenant</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Business Name *</Label>
                <Input
                  value={newBusiness.name}
                  onChange={(e) => setNewBusiness({ ...newBusiness, name: e.target.value })}
                  placeholder="WinBros Cleaning"
                />
              </div>
              <div className="space-y-2">
                <Label>Slug *</Label>
                <Input
                  value={newBusiness.slug}
                  onChange={(e) => setNewBusiness({ ...newBusiness, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                  placeholder="winbros"
                />
                <p className="text-xs text-muted-foreground">URL-safe identifier (lowercase, no spaces)</p>
              </div>
              <div className="space-y-2">
                <Label>Admin Email</Label>
                <Input
                  type="email"
                  value={newBusiness.email}
                  onChange={(e) => setNewBusiness({ ...newBusiness, email: e.target.value })}
                  placeholder="admin@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Admin Password</Label>
                <Input
                  type="password"
                  value={newBusiness.password}
                  onChange={(e) => setNewBusiness({ ...newBusiness, password: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
              <div className="flex gap-2 pt-4">
                <Button variant="outline" className="flex-1" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button className="flex-1" onClick={createBusiness} disabled={creating || !newBusiness.name || !newBusiness.slug}>
                  {creating ? "Creating..." : "Create Business"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
