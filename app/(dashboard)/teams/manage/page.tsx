"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Users, ArrowLeft, Plus, Trash2 } from "lucide-react"

type Team = { id: number; name: string }
type Cleaner = { id: number; name: string; phone?: string | null; team_id: number | null }

async function api(action: string, payload: Record<string, unknown>) {
  const res = await fetch("/api/manage-teams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || `Request failed (${res.status})`)
  }
  return json
}

export default function ManageTeamsPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [cleaners, setCleaners] = useState<Cleaner[]>([])

  const [newTeamName, setNewTeamName] = useState("")
  const [newCleanerName, setNewCleanerName] = useState("")
  const [newCleanerPhone, setNewCleanerPhone] = useState("")

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/manage-teams", { cache: "no-store" })
      const json = await res.json()
      const data = json?.data || {}
      setTeams(Array.isArray(data.teams) ? data.teams : [])
      setCleaners(Array.isArray(data.cleaners) ? data.cleaners : [])
    } catch (e: any) {
      setError(e?.message || "Failed to load")
      setTeams([])
      setCleaners([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const cleanersByTeam = useMemo(() => {
    const map = new Map<number | "unassigned", Cleaner[]>()
    map.set("unassigned", [])
    for (const t of teams) map.set(t.id, [])
    for (const c of cleaners) {
      const key = c.team_id == null ? "unassigned" : c.team_id
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(c)
    }
    for (const [k, arr] of map.entries()) {
      map.set(
        k,
        arr.slice().sort((a, b) => a.name.localeCompare(b.name))
      )
    }
    return map
  }, [teams, cleaners])

  function onDragStart(e: React.DragEvent, cleanerId: number) {
    e.dataTransfer.setData("text/plain", String(cleanerId))
    e.dataTransfer.effectAllowed = "move"
  }

  async function onDrop(e: React.DragEvent, teamId: number | null) {
    e.preventDefault()
    const raw = e.dataTransfer.getData("text/plain")
    const cleanerId = Number(raw)
    if (!Number.isFinite(cleanerId)) return
    try {
      setError(null)
      await api("move_cleaner", { cleaner_id: cleanerId, team_id: teamId })
      await load()
    } catch (err: any) {
      setError(err?.message || "Move failed")
    }
  }

  function allowDrop(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }

  async function createTeam() {
    const name = newTeamName.trim()
    if (!name) return
    try {
      setError(null)
      await api("create_team", { name })
      setNewTeamName("")
      await load()
    } catch (err: any) {
      setError(err?.message || "Create team failed")
    }
  }

  async function createCleaner() {
    const name = newCleanerName.trim()
    if (!name) return
    try {
      setError(null)
      await api("create_cleaner", { name, phone: newCleanerPhone.trim() || null })
      setNewCleanerName("")
      setNewCleanerPhone("")
      await load()
    } catch (err: any) {
      setError(err?.message || "Create cleaner failed")
    }
  }

  async function deleteTeam(teamId: number) {
    if (!confirm("Delete this team? (It will be hidden; existing jobs keep their history.)")) return
    try {
      setError(null)
      await api("delete_team", { team_id: teamId })
      await load()
    } catch (err: any) {
      setError(err?.message || "Delete team failed")
    }
  }

  async function deleteCleaner(cleanerId: number) {
    if (!confirm("Delete this user/cleaner? (It will be deactivated.)")) return
    try {
      setError(null)
      await api("delete_cleaner", { cleaner_id: cleanerId })
      await load()
    } catch (err: any) {
      setError(err?.message || "Delete cleaner failed")
    }
  }

  const unassigned = cleanersByTeam.get("unassigned") || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold text-foreground">
            <Users className="h-7 w-7" />
            Manage Teams
          </h1>
          <p className="text-sm text-muted-foreground">Drag & drop cleaners between teams (live Supabase updates)</p>
        </div>
        <Button asChild variant="outline" className="gap-2">
          <Link href="/teams">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      {error && (
        <Alert className="border-destructive/30 bg-destructive/5">
          <AlertTitle className="text-destructive">Action failed</AlertTitle>
          <AlertDescription className="text-muted-foreground">{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create Team</CardTitle>
            <CardDescription>Add a new team (writes to `teams`)</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="Team name" />
            <Button onClick={createTeam} className="gap-2" disabled={loading}>
              <Plus className="h-4 w-4" />
              Create
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create User (Cleaner)</CardTitle>
            <CardDescription>Add a new cleaner (writes to `cleaners`)</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row">
            <Input value={newCleanerName} onChange={(e) => setNewCleanerName(e.target.value)} placeholder="Name" />
            <Input value={newCleanerPhone} onChange={(e) => setNewCleanerPhone(e.target.value)} placeholder="Phone (optional)" />
            <Button onClick={createCleaner} className="gap-2" disabled={loading}>
              <Plus className="h-4 w-4" />
              Create
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card onDragOver={allowDrop} onDrop={(e) => onDrop(e, null)} className="min-h-[240px]">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Unassigned</span>
              <Badge variant="outline">{unassigned.length}</Badge>
            </CardTitle>
            <CardDescription>Drop cleaners here to remove from a team</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {unassigned.map((c) => (
              <div
                key={c.id}
                draggable
                onDragStart={(e) => onDragStart(e, c.id)}
                className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.phone || "—"}</div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => deleteCleaner(c.id)} title="Delete cleaner">
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
            {!loading && unassigned.length === 0 && <p className="text-sm text-muted-foreground">No unassigned users.</p>}
          </CardContent>
        </Card>

        {teams.map((t) => {
          const list = cleanersByTeam.get(t.id) || []
          return (
            <Card key={t.id} onDragOver={allowDrop} onDrop={(e) => onDrop(e, t.id)} className="min-h-[240px]">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="truncate">{t.name}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{list.length}</Badge>
                    <Button variant="ghost" size="icon" onClick={() => deleteTeam(t.id)} title="Delete team">
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </CardTitle>
                <CardDescription>Drop cleaners here to assign to this team</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {list.map((c) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, c.id)}
                    className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{c.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{c.phone || "—"}</div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => deleteCleaner(c.id)} title="Delete cleaner">
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
                {!loading && list.length === 0 && <p className="text-sm text-muted-foreground">No users yet.</p>}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="text-xs text-muted-foreground">
        Storage model: teams in <code>teams</code>, users in <code>cleaners</code>, membership in <code>team_members</code> (we flip{" "}
        <code>is_active</code> when moving).
      </div>
    </div>
  )
}

