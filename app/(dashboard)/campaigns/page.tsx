"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Megaphone,
  Plus,
  Calendar,
  Clock,
  Edit,
  Trash2,
  X,
  Loader2,
  RefreshCcw,
} from "lucide-react"

interface SeasonalCampaign {
  id: string
  name: string
  message: string
  start_date: string
  end_date: string
  target_segment: "all" | "inactive_30" | "inactive_60" | "inactive_90" | "completed_customers"
  enabled: boolean
  created_at: string
  last_sent_at: string | null
}

interface CampaignSettings {
  seasonal_reminders_enabled: boolean
  frequency_nudge_enabled: boolean
  frequency_nudge_days: number
  review_only_followup_enabled: boolean
  seasonal_campaigns: SeasonalCampaign[]
}

const SEGMENT_LABELS: Record<SeasonalCampaign["target_segment"], string> = {
  all: "All Customers",
  inactive_30: "Inactive 30+ days",
  inactive_60: "Inactive 60+ days",
  inactive_90: "Inactive 90+ days",
  completed_customers: "Past Completed",
}

export default function CampaignsPage() {
  const [settings, setSettings] = useState<CampaignSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState<SeasonalCampaign | null>(null)
  const [form, setForm] = useState({
    name: "",
    message: "",
    start_date: "",
    end_date: "",
    target_segment: "all" as SeasonalCampaign["target_segment"],
    enabled: true,
  })

  async function fetchSettings() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/tenant/campaigns", { cache: "no-store" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to load")
      setSettings(json.data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSettings() }, [])

  async function updateSettings(updates: Partial<CampaignSettings>) {
    setSaving(true)
    try {
      const res = await fetch("/api/tenant/campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error || "Failed to save")
      }
      await fetchSettings()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function openModal(campaign?: SeasonalCampaign) {
    if (campaign) {
      setEditingCampaign(campaign)
      setForm({
        name: campaign.name,
        message: campaign.message,
        start_date: campaign.start_date,
        end_date: campaign.end_date,
        target_segment: campaign.target_segment,
        enabled: campaign.enabled,
      })
    } else {
      setEditingCampaign(null)
      setForm({ name: "", message: "", start_date: "", end_date: "", target_segment: "all", enabled: true })
    }
    setShowModal(true)
  }

  async function saveCampaign() {
    if (!settings || !form.name || !form.message || !form.start_date || !form.end_date) return

    const campaigns = [...settings.seasonal_campaigns]

    if (editingCampaign) {
      const idx = campaigns.findIndex((c) => c.id === editingCampaign.id)
      if (idx >= 0) {
        campaigns[idx] = { ...campaigns[idx], ...form }
      }
    } else {
      campaigns.push({
        id: crypto.randomUUID(),
        ...form,
        created_at: new Date().toISOString(),
        last_sent_at: null,
      })
    }

    await updateSettings({ seasonal_campaigns: campaigns })
    setShowModal(false)
  }

  async function deleteCampaign(id: string) {
    if (!settings) return
    await updateSettings({
      seasonal_campaigns: settings.seasonal_campaigns.filter((c) => c.id !== id),
    })
  }

  async function toggleCampaign(id: string) {
    if (!settings) return
    const campaigns = [...settings.seasonal_campaigns]
    const idx = campaigns.findIndex((c) => c.id === id)
    if (idx >= 0) {
      campaigns[idx] = { ...campaigns[idx], enabled: !campaigns[idx].enabled }
      await updateSettings({ seasonal_campaigns: campaigns })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading campaigns...
      </div>
    )
  }

  if (error && !settings) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 mb-4">{error}</p>
        <Button onClick={fetchSettings}>Retry</Button>
      </div>
    )
  }

  if (!settings) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold text-foreground">
            <Megaphone className="h-7 w-7 text-primary" />
            Campaigns
          </h1>
          <p className="text-sm text-muted-foreground">Manage seasonal offers and automated follow-ups</p>
        </div>
        <Button variant="ghost" size="icon" onClick={fetchSettings} disabled={loading}>
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Settings Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Seasonal Reminders Toggle */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${settings.seasonal_reminders_enabled ? "bg-green-500/10" : "bg-zinc-500/10"}`}>
                  <Megaphone className={`h-5 w-5 ${settings.seasonal_reminders_enabled ? "text-green-500" : "text-zinc-500"}`} />
                </div>
                <div>
                  <div className="font-medium">Seasonal Reminders</div>
                  <div className="text-sm text-muted-foreground">Auto-send SMS campaigns on scheduled dates</div>
                </div>
              </div>
              <Switch
                checked={settings.seasonal_reminders_enabled}
                onCheckedChange={(checked) => updateSettings({ seasonal_reminders_enabled: checked })}
                disabled={saving}
              />
            </div>
          </CardContent>
        </Card>

        {/* Frequency Nudge */}
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${settings.frequency_nudge_enabled ? "bg-blue-500/10" : "bg-zinc-500/10"}`}>
                  <Clock className={`h-5 w-5 ${settings.frequency_nudge_enabled ? "text-blue-500" : "text-zinc-500"}`} />
                </div>
                <div>
                  <div className="font-medium">Service Frequency Nudges</div>
                  <div className="text-sm text-muted-foreground">Remind customers when due for repeat service</div>
                </div>
              </div>
              <Switch
                checked={settings.frequency_nudge_enabled}
                onCheckedChange={(checked) => updateSettings({ frequency_nudge_enabled: checked })}
                disabled={saving}
              />
            </div>
            <div className="flex items-center justify-between pl-12">
              <Label className="text-sm text-muted-foreground">Days after last service</Label>
              <Input
                type="number"
                min={7}
                max={90}
                value={settings.frequency_nudge_days}
                onChange={(e) => updateSettings({ frequency_nudge_days: parseInt(e.target.value) || 21 })}
                disabled={saving}
                className="w-20 text-center"
              />
            </div>
            <div className="flex items-center justify-between pl-12">
              <Label className="text-sm text-muted-foreground">Review-only follow-up (no invoice)</Label>
              <Switch
                checked={settings.review_only_followup_enabled}
                onCheckedChange={(checked) => updateSettings({ review_only_followup_enabled: checked })}
                disabled={saving}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Campaign List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Seasonal Campaigns</CardTitle>
              <CardDescription>SMS campaigns sent to your customers during specific date ranges</CardDescription>
            </div>
            <Button onClick={() => openModal()} disabled={saving}>
              <Plus className="h-4 w-4 mr-1" />
              Add Campaign
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {settings.seasonal_campaigns.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
              <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No campaigns yet</p>
              <p className="text-sm mt-1">Create a seasonal campaign to start reaching your customers</p>
              <Button className="mt-4" onClick={() => openModal()}>
                <Plus className="h-4 w-4 mr-1" />
                Create Your First Campaign
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {settings.seasonal_campaigns.map((campaign) => {
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{campaign.name}</span>
                          {isActive && <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">Active</Badge>}
                          {isPast && <Badge variant="outline" className="text-xs opacity-60">Ended</Badge>}
                          {isFuture && <Badge variant="outline" className="text-xs text-blue-400 border-blue-500/30">Scheduled</Badge>}
                          {!campaign.enabled && <Badge variant="outline" className="text-xs text-orange-400 border-orange-500/30">Paused</Badge>}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {campaign.start_date} to {campaign.end_date}
                          </span>
                          <span>{SEGMENT_LABELS[campaign.target_segment]}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">{campaign.message}</p>
                        {campaign.last_sent_at && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Last sent: {new Date(campaign.last_sent_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Switch
                          checked={campaign.enabled}
                          onCheckedChange={() => toggleCampaign(campaign.id)}
                          disabled={saving}
                        />
                        <Button variant="ghost" size="icon" onClick={() => openModal(campaign)} disabled={saving}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-300" onClick={() => deleteCampaign(campaign.id)} disabled={saving}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Campaign Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-lg mx-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Megaphone className="h-5 w-5" />
                  {editingCampaign ? "Edit Campaign" : "New Campaign"}
                </CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowModal(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <CardDescription>
                {editingCampaign ? "Update this seasonal campaign" : "Create a new SMS campaign to reach your customers"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Campaign Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Spring Window Cleaning Special"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>SMS Message *</Label>
                  <span className={`text-xs ${form.message.length > 160 ? "text-red-400" : "text-muted-foreground"}`}>
                    {form.message.length}/160
                  </span>
                </div>
                <textarea
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  placeholder="Spring is here! Ready to get your windows sparkling? Reply YES for 15% off your next cleaning!"
                  maxLength={160}
                  rows={3}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Customer name is auto-prepended (e.g., &quot;Hi John! &quot; + your message)
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date *</Label>
                  <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>End Date *</Label>
                  <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Target Customers</Label>
                <select
                  value={form.target_segment}
                  onChange={(e) => setForm({ ...form, target_segment: e.target.value as SeasonalCampaign["target_segment"] })}
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
                <Switch checked={form.enabled} onCheckedChange={(checked) => setForm({ ...form, enabled: checked })} />
              </div>
              <div className="flex gap-2 pt-4">
                <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button
                  className="flex-1"
                  onClick={saveCampaign}
                  disabled={saving || !form.name || !form.message || !form.start_date || !form.end_date || form.message.length > 160}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  {editingCampaign ? "Save Changes" : "Create Campaign"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
