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
} from "lucide-react"

interface WorkflowConfig {
  use_housecall_pro: boolean
  use_vapi_inbound: boolean
  use_vapi_outbound: boolean
  use_ghl: boolean
  use_stripe: boolean
  use_wave: boolean
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
  business_name: string | null
  business_name_short: string | null
  openphone_phone_number: string | null
  service_area: string | null
  sdr_persona: string | null
  workflow_config: WorkflowConfig
  active: boolean
  created_at: string
  updated_at: string
}

export default function AdminPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null)

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
                <Button variant="ghost" size="icon" onClick={fetchTenants} disabled={loading}>
                  <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
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
                  <div className="flex gap-2">
                    <Badge variant={currentTenant.active ? "default" : "destructive"}>
                      {currentTenant.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="controls" className="space-y-4">
                  <TabsList>
                    <TabsTrigger value="controls" className="gap-2">
                      <Power className="h-4 w-4" />
                      Controls
                    </TabsTrigger>
                    <TabsTrigger value="booking" className="gap-2">
                      <Settings2 className="h-4 w-4" />
                      Booking Flow
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
                </Tabs>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
