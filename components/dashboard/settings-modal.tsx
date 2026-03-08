"use client"

import { useState, useEffect } from "react"
import { X, Loader2, Clock, Save } from "lucide-react"

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

export function SettingsModal({ open, onClose }: SettingsModalProps) {
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md mx-4 rounded-xl border border-white/[0.08] overflow-hidden animate-in zoom-in-95 duration-200"
        style={{
          background: "rgba(24, 24, 27, 0.95)",
          backdropFilter: "blur(24px)",
          boxShadow: "0 25px 60px rgba(0, 0, 0, 0.5)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Settings</h2>
            {tenantName && (
              <p className="text-xs text-zinc-500 mt-0.5">{tenantName}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
            </div>
          ) : !isWindowCleaning ? (
            <div className="py-8 text-center">
              <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
                <Clock className="w-5 h-5 text-zinc-500" />
              </div>
              <p className="text-sm text-zinc-400">No configurable settings available</p>
              <p className="text-xs text-zinc-600 mt-1">
                Scheduling settings are only available for window cleaning businesses
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Business Hours */}
              <div>
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Business Hours
                </label>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex-1">
                    <label className="text-[11px] text-zinc-500 mb-1 block">Start</label>
                    <input
                      type="time"
                      value={minutesToTimeString(settings.business_hours_start)}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          business_hours_start: timeStringToMinutes(e.target.value),
                        }))
                      }
                      className="w-full px-3 py-2 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50 transition-colors"
                    />
                    <span className="text-[10px] text-zinc-600 mt-0.5 block">
                      {formatTimeDisplay(settings.business_hours_start)}
                    </span>
                  </div>
                  <span className="text-zinc-600 mt-3">—</span>
                  <div className="flex-1">
                    <label className="text-[11px] text-zinc-500 mb-1 block">End</label>
                    <input
                      type="time"
                      value={minutesToTimeString(settings.business_hours_end)}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          business_hours_end: timeStringToMinutes(e.target.value),
                        }))
                      }
                      className="w-full px-3 py-2 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50 transition-colors"
                    />
                    <span className="text-[10px] text-zinc-600 mt-0.5 block">
                      {formatTimeDisplay(settings.business_hours_end)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Salesman Buffer */}
              <div>
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Gap Between Salesman Estimates
                </label>
                <p className="text-[11px] text-zinc-600 mt-0.5">
                  Minimum time between estimate appointments
                </p>
                <div className="mt-2 flex items-center gap-3">
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
                    className="w-24 px-3 py-2 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50 transition-colors"
                  />
                  <span className="text-xs text-zinc-500">minutes</span>
                </div>
                <p className="text-[10px] text-zinc-600 mt-1">
                  Example: if buffer = {settings.salesman_buffer_minutes} min, start = {formatTimeDisplay(settings.business_hours_start)}, appointment = 30 min → slots at{" "}
                  {(() => {
                    const step = 30 + settings.salesman_buffer_minutes
                    const slots = []
                    for (let i = 0; i < 3 && settings.business_hours_start + i * step < settings.business_hours_end; i++) {
                      slots.push(formatTimeDisplay(settings.business_hours_start + i * step))
                    }
                    return slots.join(", ")
                  })()}
                </p>
              </div>

              {/* Technician Buffer */}
              <div>
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Gap Between Technician Jobs
                </label>
                <p className="text-[11px] text-zinc-600 mt-0.5">
                  Minimum time between cleaning/service appointments
                </p>
                <div className="mt-2 flex items-center gap-3">
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
                    className="w-24 px-3 py-2 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50 transition-colors"
                  />
                  <span className="text-xs text-zinc-500">minutes</span>
                </div>
              </div>

              {error && (
                <p className="text-xs text-red-400">{error}</p>
              )}

              {/* Save */}
              <button
                onClick={handleSave}
                disabled={saving}
                className={`w-full py-2.5 text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-all ${
                  success
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "bg-purple-500 hover:bg-purple-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white"
                }`}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Saving...
                  </>
                ) : success ? (
                  "Saved!"
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
