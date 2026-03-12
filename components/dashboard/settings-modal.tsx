"use client"

import { useState, useEffect } from "react"
import { ArrowLeft, Loader2, Clock, Save } from "lucide-react"
import { cn } from "@/lib/utils"
import CubeLoader from "@/components/ui/cube-loader"
import { ServiceEditor } from "./service-editor"

interface SettingsData {
  business_hours_start: number
  business_hours_end: number
  salesman_buffer_minutes: number
  technician_buffer_minutes: number
}

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

function timeStringToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + (m || 0)
}

function formatTimeDisplay(minutes: number): string {
  const h24 = Math.floor(minutes / 60)
  const m = minutes % 60
  const period = h24 >= 12 ? "PM" : "AM"
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24
  return `${h12}:${String(m).padStart(2, "0")} ${period}`
}

type SettingsTab = "general" | "service-editor"

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [isWindowCleaning, setIsWindowCleaning] = useState(false)
  const [tenantName, setTenantName] = useState("")
  const [settings, setSettings] = useState<SettingsData>({
    business_hours_start: 480,
    business_hours_end: 1020,
    salesman_buffer_minutes: 30,
    technician_buffer_minutes: 30,
  })

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError("")
    setSuccess(false)
    fetch("/api/actions/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setSettings(data.settings)
          setTenantName(data.tenant_name || "")
          const desc = (data.service_description || "").toLowerCase()
          setIsWindowCleaning(desc.includes("window"))
        } else {
          setError(data.error || "Failed to load settings")
        }
      })
      .catch(() => setError("Failed to load settings"))
      .finally(() => setLoading(false))
  }, [open])

  const handleSave = async () => {
    setSaving(true)
    setError("")
    setSuccess(false)
    try {
      const res = await fetch("/api/actions/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })
      const data = await res.json()
      if (data.success) {
        setSuccess(true)
        setTimeout(() => setSuccess(false), 2000)
      } else {
        setError(data.error || "Failed to save")
      }
    } catch {
      setError("Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="flex flex-col w-full h-full bg-zinc-900/80">
      {/* Full-page content */}
      <div className="relative w-full h-full flex flex-col overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center gap-3 px-4 md:px-8 h-14 border-b border-white/[0.06] shrink-0">
          <button
            onClick={onClose}
            className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="h-4 w-px bg-zinc-800" />
          <h1 className="text-sm font-semibold text-zinc-100">Settings</h1>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-1 bg-zinc-800/60 rounded-lg p-0.5">
            <button
              onClick={() => setActiveTab("general")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeTab === "general"
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab("service-editor")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeTab === "service-editor"
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Service Editor
            </button>
          </div>
          {tenantName && (
            <>
              <div className="h-4 w-px bg-zinc-800" />
              <span className="text-xs text-zinc-500">{tenantName}</span>
            </>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "service-editor" ? (
            <ServiceEditor />
          ) : (
          <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
            {loading ? (
              <div className="flex items-center justify-center py-24">
                <CubeLoader />
              </div>
            ) : !isWindowCleaning ? (
              <div className="py-24 text-center">
                <div className="w-14 h-14 rounded-full bg-zinc-800/80 flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-7 h-7 text-zinc-500" />
                </div>
                <p className="text-base text-zinc-400">No configurable settings available</p>
                <p className="text-sm text-zinc-600 mt-2 max-w-xs mx-auto">
                  Scheduling settings are only available for window cleaning businesses
                </p>
              </div>
            ) : (
              <div className="space-y-10">
                {/* Section: Business Hours */}
                <section>
                  <h2 className="text-base font-semibold text-zinc-100 mb-1">Business Hours</h2>
                  <p className="text-sm text-zinc-500 mb-5">
                    Set the hours during which appointments can be scheduled
                  </p>

                  <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-5">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <label className="text-xs font-medium text-zinc-400 mb-1.5 block">Opening Time</label>
                        <input
                          type="time"
                          value={minutesToTimeString(settings.business_hours_start)}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              business_hours_start: timeStringToMinutes(e.target.value),
                            }))
                          }
                          className="w-full px-4 py-3 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50 transition-colors"
                        />
                        <span className="text-xs text-zinc-600 mt-1 block">
                          {formatTimeDisplay(settings.business_hours_start)}
                        </span>
                      </div>
                      <span className="text-zinc-600 text-lg mt-4">—</span>
                      <div className="flex-1">
                        <label className="text-xs font-medium text-zinc-400 mb-1.5 block">Closing Time</label>
                        <input
                          type="time"
                          value={minutesToTimeString(settings.business_hours_end)}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              business_hours_end: timeStringToMinutes(e.target.value),
                            }))
                          }
                          className="w-full px-4 py-3 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50 transition-colors"
                        />
                        <span className="text-xs text-zinc-600 mt-1 block">
                          {formatTimeDisplay(settings.business_hours_end)}
                        </span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Section: Appointment Gaps */}
                <section>
                  <h2 className="text-base font-semibold text-zinc-100 mb-1">Appointment Gaps</h2>
                  <p className="text-sm text-zinc-500 mb-5">
                    Buffer time between consecutive appointments to allow for travel and preparation
                  </p>

                  <div className="space-y-4">
                    {/* Salesman Buffer */}
                    <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-5">
                      <div className="flex items-start justify-between gap-6">
                        <div className="flex-1">
                          <h3 className="text-sm font-medium text-zinc-200">Salesman Estimates</h3>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            Minimum gap between estimate appointments
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <input
                            type="number"
                            min={0}
                            max={240}
                            step={15}
                            value={settings.salesman_buffer_minutes}
                            onChange={(e) =>
                              setSettings((s) => ({
                                ...s,
                                salesman_buffer_minutes: Math.max(0, Number(e.target.value) || 0),
                              }))
                            }
                            className="w-20 px-3 py-2.5 text-sm text-center bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50 transition-colors"
                          />
                          <span className="text-xs text-zinc-500">min</span>
                        </div>
                      </div>
                      <div className="mt-4 pt-3 border-t border-white/[0.04]">
                        <p className="text-xs text-zinc-600">
                          With a {settings.salesman_buffer_minutes} min buffer starting at {formatTimeDisplay(settings.business_hours_start)} (30 min appointments), slots would be:{" "}
                          <span className="text-zinc-400">
                            {(() => {
                              const step = 30 + settings.salesman_buffer_minutes
                              const slots = []
                              for (let i = 0; i < 4 && settings.business_hours_start + i * step < settings.business_hours_end; i++) {
                                slots.push(formatTimeDisplay(settings.business_hours_start + i * step))
                              }
                              return slots.join(", ")
                            })()}
                          </span>
                        </p>
                      </div>
                    </div>

                    {/* Technician Buffer */}
                    <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-5">
                      <div className="flex items-start justify-between gap-6">
                        <div className="flex-1">
                          <h3 className="text-sm font-medium text-zinc-200">Technician Jobs</h3>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            Minimum gap between cleaning/service appointments
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <input
                            type="number"
                            min={0}
                            max={240}
                            step={15}
                            value={settings.technician_buffer_minutes}
                            onChange={(e) =>
                              setSettings((s) => ({
                                ...s,
                                technician_buffer_minutes: Math.max(0, Number(e.target.value) || 0),
                              }))
                            }
                            className="w-20 px-3 py-2.5 text-sm text-center bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50 transition-colors"
                          />
                          <span className="text-xs text-zinc-500">min</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Error */}
                {error && (
                  <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
                    <p className="text-sm text-red-400">{error}</p>
                  </div>
                )}

                {/* Save bar */}
                <div className="sticky bottom-0 -mx-4 md:-mx-8 px-4 md:px-8 py-4">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className={cn(
                      "w-full py-3 text-sm font-medium rounded-xl flex items-center justify-center gap-2 transition-all",
                      success
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "btn-glow glow-pulse text-white disabled:opacity-50 disabled:pointer-events-none",
                    )}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving...
                      </>
                    ) : success ? (
                      "Saved!"
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        Save Changes
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
