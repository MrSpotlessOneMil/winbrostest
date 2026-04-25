"use client"

/**
 * Wave 3h — worker clock widget for the crew portal.
 *
 * Single protagonist button per state:
 *   off_clock → Clock in   (no secondary)
 *   on_clock  → Clock out  + ghost "Pause" link
 *   paused    → Resume     + ghost "Clock out" link
 *
 * Lives under the header on /crew/[token] for technicians + team leads.
 * Drive time between jobs is paid because the clock keeps running unless
 * the worker explicitly pauses.
 */

import { useCallback, useEffect, useState } from "react"
import { Pause, Play, Square } from "lucide-react"

interface Snapshot {
  state: "off_clock" | "on_clock" | "paused"
  open_entry_id: number | null
  clock_in_at: string | null
  pause_started_at: string | null
  paused_minutes: number
  live_worked_minutes: number
}

interface TodayEntry {
  id: number
  clock_in_at: string
  clock_out_at: string | null
  paused_minutes: number
  pause_started_at: string | null
}

interface ClockResponse {
  snapshot: Snapshot
  today: TodayEntry[]
  week_hours: number
  week_range: { start: string; end: string }
}

function formatHM(totalMin: number): string {
  const h = Math.floor(totalMin / 60)
  const m = Math.floor(totalMin % 60)
  return `${h}h ${m.toString().padStart(2, "0")}m`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function liveMinutesFromSnapshot(snap: Snapshot, nowMs: number): number {
  if (snap.state === "off_clock" || !snap.clock_in_at) return 0
  const startMs = new Date(snap.clock_in_at).getTime()
  const elapsed = Math.max(0, (nowMs - startMs) / 60000)
  const inProgressPause = snap.pause_started_at
    ? Math.max(0, (nowMs - new Date(snap.pause_started_at).getTime()) / 60000)
    : 0
  return Math.max(0, elapsed - snap.paused_minutes - inProgressPause)
}

export function ClockWidget({
  token,
  accent,
}: {
  token: string
  accent: string
}) {
  const [data, setData] = useState<ClockResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/crew/${token}/clock`)
      if (!res.ok) {
        if (res.status === 403) {
          // Salesman or other non-clockable role — silently hide the widget.
          setData(null)
          return
        }
        throw new Error(`HTTP ${res.status}`)
      }
      const body = (await res.json()) as ClockResponse
      setData(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load clock")
    }
  }, [token])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Tick every second so the live timer updates without re-fetching.
  useEffect(() => {
    if (!data || data.snapshot.state === "off_clock") return
    const i = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(i)
  }, [data])

  const act = async (action: "in" | "pause" | "resume" | "out") => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/crew/${token}/clock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed")
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null
  const snap = data.snapshot
  const liveMin = liveMinutesFromSnapshot(snap, now)

  return (
    <div className="shrink-0 border-b bg-white px-4 py-3" style={{ borderColor: "#e8e5de" }}>
      <div className="flex items-center gap-3">
        {/* Live timer */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {snap.state === "off_clock"
              ? "Off the clock"
              : snap.state === "paused"
              ? "Paused"
              : "On the clock"}
          </div>
          <div className="text-2xl font-black text-slate-800 tabular-nums">
            {snap.state === "off_clock" ? "—" : formatHM(liveMin)}
          </div>
          <div className="text-[11px] text-slate-500">
            {data.week_hours.toFixed(1)} h this week
          </div>
        </div>

        {/* Primary CTA */}
        {snap.state === "off_clock" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act("in")}
            className="h-12 rounded-full px-6 text-sm font-bold text-white shadow-sm disabled:opacity-50"
            style={{ background: accent }}
          >
            Clock in
          </button>
        )}
        {snap.state === "on_clock" && (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => act("out")}
              className="h-12 rounded-full px-6 text-sm font-bold text-white shadow-sm disabled:opacity-50 inline-flex items-center gap-1.5"
              style={{ background: accent }}
            >
              <Square className="size-3.5" /> Clock out
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => act("pause")}
              className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Pause className="size-3" /> Pause
            </button>
          </div>
        )}
        {snap.state === "paused" && (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => act("resume")}
              className="h-12 rounded-full px-6 text-sm font-bold text-white shadow-sm disabled:opacity-50 inline-flex items-center gap-1.5"
              style={{ background: accent }}
            >
              <Play className="size-3.5" /> Resume
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => act("out")}
              className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Square className="size-3" /> Clock out
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</div>
      )}

      {/* Today's self-log — collapsed when empty. */}
      {data.today.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600">
            Today · {data.today.length} {data.today.length === 1 ? "shift" : "shifts"}
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {data.today.map(e => (
              <li key={e.id} className="flex items-center justify-between">
                <span className="tabular-nums">
                  {formatTime(e.clock_in_at)}
                  {" → "}
                  {e.clock_out_at ? formatTime(e.clock_out_at) : "now"}
                </span>
                <span className="text-slate-400 tabular-nums">
                  {e.paused_minutes > 0 ? `${e.paused_minutes}m paused` : "—"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
